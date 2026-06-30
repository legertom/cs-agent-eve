import { ensureAnswerFeedbackSchema } from "./answer-feedback-store";
import { getSql } from "./db";

// Persistence for EVERY agent turn (not just flagged ones), backed by Neon
// Postgres. This is the analytics denominator: flags tell you which answers were
// wrong, but only a full log of every inquiry tells you how often that happens,
// what it costs, and what people actually ask. Written from a server-side eve
// hook (agent/hooks/log-inquiry.ts) so it captures web AND Discord turns.
//
// No PII expected — internal tool, a handful of Clever CS-agent testers. If that
// changes, add a retention policy + redaction before widening access.

// One captured search within a turn (compact — full detail isn't needed for
// analytics, and keeps the jsonb small).
export type InquirySearchLog = {
  readonly query?: string;
  readonly method?: string;
  readonly count?: number;
  readonly confidence?: {
    readonly level?: string;
    readonly topScore?: number | null;
    readonly margin?: number | null;
  };
  readonly retrievalCost?: number;
  readonly sources?: ReadonlyArray<{
    readonly rank?: number;
    readonly title?: string;
    readonly url?: string;
    readonly score?: number | null;
  }>;
};

// What the hook hands us for one completed turn. created_at is set by the DB.
export type InquiryRecord = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly channel: string;
  readonly question: string;
  readonly answer: string;
  readonly searchCount: number;
  readonly topConfidence: string;
  readonly retrievalCost: number;
  readonly answerCost: number;
  readonly totalCost: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
  // Deep-dive detail (searches + raw token usage) for later auto-eval / review.
  readonly payload: unknown;
};

// Slim row for the dashboard list — avoids shipping every full answer body.
// Judge + human-signal fields are optional: they're only populated by
// listInquiriesWithSignals (the dashboard query), not by listInquiries.
export type InquirySummary = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly createdAt: string;
  readonly channel: string;
  readonly question: string;
  readonly answer: string;
  readonly searchCount: number;
  readonly topConfidence: string;
  readonly totalCost: number;
  // Judge signals (C) — null/undefined until the row has been scored.
  readonly judged?: boolean;
  readonly judgeGroundedness?: number | null;
  readonly judgeRelevance?: number | null;
  readonly judgeHallucination?: boolean | null;
  // Human signals (A/B) rolled up from answer_feedback on (session_id, turn_id).
  readonly up?: number;
  readonly down?: number;
  readonly edits?: number;
  readonly downReason?: string | null;
};

// One inquiry the judge still needs to score (the batch route's work item). The
// only grounding material the stored payload has is the source titles + URLs —
// there is NO article body/excerpt anywhere in the payload.
export type UnjudgedInquiry = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly question: string;
  readonly answer: string;
  readonly sources: ReadonlyArray<{
    readonly rank?: number;
    readonly title?: string;
    readonly url?: string;
  }>;
};

// The judge's verdict for one inquiry, persisted onto the inquiry row.
export type InquiryJudgment = {
  readonly groundedness: number; // 0..1
  readonly relevance: number; // 0..1
  readonly hallucination: boolean;
  readonly verdict: string;
  readonly model: string;
  // USD spent on this judge call. Optional so the failure path / other callers
  // needn't supply it (NULL persisted when absent).
  readonly judge_cost?: number;
};

// Roll-up for the analytics dashboard — "how many inquiries, what do they cost,
// and how often are we answering with weak grounding (or no search at all)?"
export type InquiryAnalytics = {
  readonly total: number;
  // Distinct inquiries (session, inquiry_no) once segmented — unsegmented sessions
  // count as one each until the Haiku batch splits them. The honest "how many
  // separate questions" denominator, vs `total` which counts every turn.
  readonly distinctInquiries: number;
  readonly last7Days: number;
  readonly totalCost: number;
  readonly avgCost: number;
  // Turns that ran a search but the best hit was low/unscored — weak grounding.
  readonly lowConfidenceCount: number;
  // Turns that answered with no search at all (clarifying questions, or ungrounded).
  readonly noSearchCount: number;
  readonly byChannel: ReadonlyArray<{ readonly channel: string; readonly count: number }>;
  // Eval signals (C). Judge aggregates are over JUDGED rows; human aggregates are
  // counts of answer_feedback rows. All zero until judging/feedback happen.
  readonly judgedCount: number;
  readonly avgGroundedness: number;
  readonly avgRelevance: number;
  readonly hallucinationCount: number;
  readonly thumbsUpCount: number;
  readonly thumbsDownCount: number;
  readonly expertEditCount: number;
};

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unscored: 0 };
export function bestConfidence(levels: ReadonlyArray<string | undefined>): string {
  let best = "unscored";
  for (const level of levels) {
    if (level && (CONFIDENCE_RANK[level] ?? -1) > (CONFIDENCE_RANK[best] ?? -1)) best = level;
  }
  return best;
}

// CREATE TABLE is idempotent and cheap; memoize so a warm instance runs it once.
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS inquiries (
          session_id     text NOT NULL,
          turn_id        text NOT NULL,
          created_at     timestamptz NOT NULL DEFAULT now(),
          channel        text NOT NULL DEFAULT '',
          question       text NOT NULL DEFAULT '',
          answer         text NOT NULL DEFAULT '',
          search_count   integer NOT NULL DEFAULT 0,
          top_confidence text NOT NULL DEFAULT 'unscored',
          retrieval_cost double precision NOT NULL DEFAULT 0,
          answer_cost    double precision NOT NULL DEFAULT 0,
          total_cost     double precision NOT NULL DEFAULT 0,
          input_tokens   integer NOT NULL DEFAULT 0,
          output_tokens  integer NOT NULL DEFAULT 0,
          model          text NOT NULL DEFAULT '',
          payload        jsonb NOT NULL,
          PRIMARY KEY (session_id, turn_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS inquiries_created_at_idx ON inquiries (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS inquiries_channel_idx ON inquiries (channel)`;
      // LLM-as-judge auto-eval columns (C). Added idempotently with ADD COLUMN IF
      // NOT EXISTS so this same memoized ensureSchema() — which logInquiry() also
      // awaits — stays safe to re-run and never blocks turn logging.
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_groundedness double precision`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_relevance double precision`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_hallucination boolean`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_verdict text`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_model text`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judged_at timestamptz`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_attempts integer NOT NULL DEFAULT 0`;
      // judge_cost: USD spent on the (body-grounded) judge call for this row.
      // re_judge_at: operator marker to re-score an already-judged row ONCE (the
      // guarded body-grounding backfill — see selectUnjudgedInquiries).
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_cost double precision`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS re_judge_at timestamptz`;
      await sql`CREATE INDEX IF NOT EXISTS inquiries_judged_at_idx ON inquiries (judged_at DESC) WHERE judged_at IS NOT NULL`;
      // Inquiry segmentation (D). A session is N distinct inquiries when users
      // stack unrelated questions in one thread; these columns let the dashboard
      // group a session by its real inquiries. inquiry_no is NULL until the Haiku
      // batch (lib/inquiry-segment.ts) stamps it — NULL means "not yet segmented"
      // and is the work signal for the segment batch (a new turn re-NULLs nothing,
      // it just arrives NULL, which re-qualifies the whole session for re-segment).
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS inquiry_no integer`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS inquiry_title text`;
      await sql`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS segment_attempts integer NOT NULL DEFAULT 0`;
    })().catch((err) => {
      schemaReady = null; // don't cache a failed init
      throw err;
    });
  }
  return schemaReady;
}

// Log one completed turn. Idempotent: a (session_id, turn_id) that already exists
// is left untouched, so a retried/duplicated hook can't double-count.
export async function logInquiry(record: InquiryRecord): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO inquiries
      (session_id, turn_id, channel, question, answer, search_count, top_confidence,
       retrieval_cost, answer_cost, total_cost, input_tokens, output_tokens, model, payload)
    VALUES (
      ${record.sessionId}, ${record.turnId}, ${record.channel}, ${record.question},
      ${record.answer}, ${record.searchCount}, ${record.topConfidence},
      ${record.retrievalCost}, ${record.answerCost}, ${record.totalCost},
      ${record.inputTokens}, ${record.outputTokens}, ${record.model},
      ${JSON.stringify(record.payload)}::jsonb
    )
    ON CONFLICT (session_id, turn_id) DO NOTHING
  `;
}

export async function listInquiries(limit = 100): Promise<InquirySummary[]> {
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT session_id, turn_id, created_at, channel, question, answer,
             search_count, top_confidence, total_cost
      FROM inquiries
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as Array<{
      session_id: string;
      turn_id: string;
      created_at: string;
      channel: string;
      question: string;
      answer: string;
      search_count: number;
      top_confidence: string;
      total_cost: number;
    }>;
    return rows.map((r) => ({
      sessionId: r.session_id,
      turnId: r.turn_id,
      createdAt: new Date(r.created_at).toISOString(),
      channel: r.channel,
      question: r.question,
      answer: r.answer,
      searchCount: r.search_count,
      topConfidence: r.top_confidence,
      totalCost: r.total_cost,
    }));
  } catch {
    return [];
  }
}

// One round trip per metric group, run concurrently.
export async function inquiryAnalytics(): Promise<InquiryAnalytics> {
  try {
    await ensureSchema();
    await ensureAnswerFeedbackSchema();
    const sql = getSql();
    const [totals, byChannel, judge, human] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(DISTINCT (session_id, COALESCE(inquiry_no, 1)))::int AS distinct_inquiries,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
          COALESCE(SUM(total_cost), 0)::float8 AS total_cost,
          COALESCE(AVG(total_cost), 0)::float8 AS avg_cost,
          COUNT(*) FILTER (WHERE search_count > 0 AND top_confidence IN ('low', 'unscored'))::int AS low_conf,
          COUNT(*) FILTER (WHERE search_count = 0)::int AS no_search
        FROM inquiries
      `,
      sql`SELECT channel, COUNT(*)::int AS count FROM inquiries GROUP BY channel ORDER BY count DESC`,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE judged_at IS NOT NULL)::int AS judged,
          COALESCE(AVG(judge_groundedness) FILTER (WHERE judged_at IS NOT NULL), 0)::float8 AS avg_g,
          COALESCE(AVG(judge_relevance) FILTER (WHERE judged_at IS NOT NULL), 0)::float8 AS avg_r,
          COUNT(*) FILTER (WHERE judge_hallucination)::int AS halluc
        FROM inquiries
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE kind = 'up')::int   AS up,
          COUNT(*) FILTER (WHERE kind = 'down')::int AS down,
          COUNT(*) FILTER (WHERE kind = 'edit')::int AS edits
        FROM answer_feedback
      `,
    ]);
    const t = (totals as Array<Record<string, number>>)[0] ?? {};
    const j = (judge as Array<Record<string, number>>)[0] ?? {};
    const h = (human as Array<Record<string, number>>)[0] ?? {};
    return {
      total: t.total ?? 0,
      distinctInquiries: t.distinct_inquiries ?? 0,
      last7Days: t.last7 ?? 0,
      totalCost: t.total_cost ?? 0,
      avgCost: t.avg_cost ?? 0,
      lowConfidenceCount: t.low_conf ?? 0,
      noSearchCount: t.no_search ?? 0,
      byChannel: (byChannel as Array<{ channel: string; count: number }>).map((r) => ({
        channel: r.channel || "unknown",
        count: r.count,
      })),
      judgedCount: j.judged ?? 0,
      avgGroundedness: j.avg_g ?? 0,
      avgRelevance: j.avg_r ?? 0,
      hallucinationCount: j.halluc ?? 0,
      thumbsUpCount: h.up ?? 0,
      thumbsDownCount: h.down ?? 0,
      expertEditCount: h.edits ?? 0,
    };
  } catch {
    return {
      total: 0,
      distinctInquiries: 0,
      last7Days: 0,
      totalCost: 0,
      avgCost: 0,
      lowConfidenceCount: 0,
      noSearchCount: 0,
      byChannel: [],
      judgedCount: 0,
      avgGroundedness: 0,
      avgRelevance: 0,
      hallucinationCount: 0,
      thumbsUpCount: 0,
      thumbsDownCount: 0,
      expertEditCount: 0,
    };
  }
}

// One search's ranked sources, pulled from the stored payload for the thread view.
export type InquiryTurnSource = {
  readonly rank?: number;
  readonly title?: string;
  readonly url?: string;
  readonly score?: number | null;
};
export type InquiryTurnSearch = {
  readonly query?: string;
  readonly method?: string;
  readonly count?: number;
  readonly confidence?: {
    readonly level?: string;
    readonly topScore?: number | null;
    readonly margin?: number | null;
  };
  readonly sources?: ReadonlyArray<InquiryTurnSource>;
};

// A single turn with its full retrieval trail — what the thread detail view needs.
export type SessionInquiryTurn = InquirySummary & {
  readonly searches: ReadonlyArray<InquiryTurnSearch>;
  readonly judgeVerdict?: string | null;
  // Segmentation (D): which distinct inquiry within the session this turn belongs
  // to, and that inquiry's auto-title. null until the Haiku batch has run.
  readonly inquiryNo?: number | null;
  readonly inquiryTitle?: string | null;
};

function extractSearches(payload: unknown): InquiryTurnSearch[] {
  const searches = (payload as { searches?: unknown })?.searches;
  if (!Array.isArray(searches)) return [];
  return searches as InquiryTurnSearch[];
}

// All turns for one session, oldest first — reconstructs the full thread from the
// per-turn log (every turn is keyed by session_id, so the session's rows ARE the
// conversation). Same signal join as the dashboard list, plus the payload searches
// and judge verdict so each turn can show its retrieval trail.
export async function listSessionInquiries(sessionId: string): Promise<SessionInquiryTurn[]> {
  try {
    await ensureSchema();
    await ensureAnswerFeedbackSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT i.session_id, i.turn_id, i.created_at, i.channel, i.question, i.answer,
             i.search_count, i.top_confidence, i.total_cost, i.payload,
             i.judge_groundedness, i.judge_relevance, i.judge_hallucination,
             i.judge_verdict, i.judged_at, i.inquiry_no, i.inquiry_title,
             COUNT(*) FILTER (WHERE af.kind = 'up')::int   AS up,
             COUNT(*) FILTER (WHERE af.kind = 'down')::int AS down,
             COUNT(*) FILTER (WHERE af.kind = 'edit')::int AS edits,
             (ARRAY_AGG(af.reason ORDER BY af.created_at DESC)
                FILTER (WHERE af.kind = 'down' AND af.reason IS NOT NULL))[1] AS down_reason
      FROM inquiries i
      LEFT JOIN answer_feedback af
        ON af.session_id = i.session_id AND af.turn_id = i.turn_id
      WHERE i.session_id = ${sessionId}
      GROUP BY i.session_id, i.turn_id, i.created_at, i.channel, i.question, i.answer,
               i.search_count, i.top_confidence, i.total_cost, i.payload,
               i.judge_groundedness, i.judge_relevance, i.judge_hallucination,
               i.judge_verdict, i.judged_at, i.inquiry_no, i.inquiry_title
      ORDER BY i.created_at ASC
    `) as Array<{
      session_id: string;
      turn_id: string;
      created_at: string;
      channel: string;
      question: string;
      answer: string;
      search_count: number;
      top_confidence: string;
      total_cost: number;
      payload: unknown;
      judge_groundedness: number | null;
      judge_relevance: number | null;
      judge_hallucination: boolean | null;
      judge_verdict: string | null;
      judged_at: string | null;
      inquiry_no: number | null;
      inquiry_title: string | null;
      up: number;
      down: number;
      edits: number;
      down_reason: string | null;
    }>;
    return rows.map((r) => ({
      sessionId: r.session_id,
      turnId: r.turn_id,
      createdAt: new Date(r.created_at).toISOString(),
      channel: r.channel,
      question: r.question,
      answer: r.answer,
      searchCount: r.search_count,
      topConfidence: r.top_confidence,
      totalCost: r.total_cost,
      searches: extractSearches(r.payload),
      judged: r.judged_at != null,
      judgeGroundedness: r.judge_groundedness,
      judgeRelevance: r.judge_relevance,
      judgeHallucination: r.judge_hallucination,
      judgeVerdict: r.judge_verdict,
      inquiryNo: r.inquiry_no,
      inquiryTitle: r.inquiry_title,
      up: r.up,
      down: r.down,
      edits: r.edits,
      downReason: r.down_reason,
    }));
  } catch {
    return [];
  }
}

// --- LLM-as-judge auto-eval (C) ---

// Rows the judge still needs to score. Poison-row guard: skip rows that already
// failed 3 times (judge_attempts) so a malformed answer isn't re-billed forever,
// and skip clarifying-only turns (search_count = 0) — there's nothing to ground.
// Also admits already-judged rows explicitly marked for a one-time re-score via
// re_judge_at (the guarded body-grounding backfill): a row qualifies if it is
// unjudged OR re-marked, but in BOTH cases judge_attempts < 3 and search_count > 0
// still apply (a row poisoned at 3 attempts is NOT re-judged by marking
// re_judge_at — that needs an explicit operator reset of judge_attempts).
// updateInquiryJudgment clears re_judge_at on success, so a marked row re-scores
// exactly once per marking and then drops back out of this SELECT.
//
// Re-judge rows that were judged before bodies shipped (run ONCE, manually):
//   UPDATE inquiries SET re_judge_at = now()
//   WHERE judge_model = 'anthropic/claude-haiku-4.5'
//     AND judged_at < '<cutoff-iso-timestamp>'
//     AND judge_attempts < 3;
// The batch then re-scores up to LIMIT (20) marked rows per run; re_judge_at is
// cleared on each successful re-score, so large backfills drain across multiple
// runs. Marking >LIMIT rows is safe — they persist until processed.
export async function selectUnjudgedInquiries(limit = 20): Promise<UnjudgedInquiry[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT session_id, turn_id, question, answer, payload
    FROM inquiries
    WHERE (judged_at IS NULL OR (re_judge_at IS NOT NULL AND re_judge_at <= now()))
      AND judge_attempts < 3
      AND search_count > 0
    ORDER BY created_at ASC
    LIMIT ${limit}
  `) as Array<{
    session_id: string;
    turn_id: string;
    question: string;
    answer: string;
    payload: { searches?: Array<{ sources?: Array<{ rank?: number; title?: string; url?: string }> }> };
  }>;
  return rows.map((r) => {
    const sources: Array<{ rank?: number; title?: string; url?: string }> = [];
    for (const search of r.payload?.searches ?? []) {
      for (const src of search?.sources ?? []) {
        sources.push({ rank: src?.rank, title: src?.title, url: src?.url });
      }
    }
    return {
      sessionId: r.session_id,
      turnId: r.turn_id,
      question: r.question,
      answer: r.answer,
      sources,
    };
  });
}

// Persist a successful judgment. Plain UPDATE guarded by the batch SELECT's
// `judged_at IS NULL` so a second run never re-scores (and never re-bills) a row.
export async function updateInquiryJudgment(
  sessionId: string,
  turnId: string,
  j: InquiryJudgment,
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE inquiries SET
      judge_groundedness  = ${j.groundedness},
      judge_relevance     = ${j.relevance},
      judge_hallucination = ${j.hallucination},
      judge_verdict       = ${j.verdict.slice(0, 280)},
      judge_model         = ${j.model},
      judge_cost          = ${j.judge_cost ?? null},
      judged_at           = now(),
      re_judge_at         = NULL
    WHERE session_id = ${sessionId} AND turn_id = ${turnId}
  `;
}

// Poison-row guard: on judge/parse failure bump judge_attempts and leave a
// marker, but keep judged_at NULL until attempts are exhausted (then the batch
// SELECT stops picking it). Never re-bills a successfully judged row.
export async function markInquiryJudgeFailure(
  sessionId: string,
  turnId: string,
  reason: string,
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE inquiries SET
      judge_attempts = judge_attempts + 1,
      judge_verdict  = ${`error: ${reason}`.slice(0, 280)}
    WHERE session_id = ${sessionId} AND turn_id = ${turnId}
  `;
}

// Dashboard list with both judge columns and human-feedback signals, via a
// race-tolerant LEFT JOIN on (session_id, turn_id): an inquiry with no
// answer_feedback renders "no signal" (counts 0), and answer_feedback rows with
// no matching inquiry simply don't appear here. Ensures BOTH tables exist first.
export async function listInquiriesWithSignals(limit = 100): Promise<InquirySummary[]> {
  try {
    await ensureSchema();
    await ensureAnswerFeedbackSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT i.session_id, i.turn_id, i.created_at, i.channel, i.question, i.answer,
             i.search_count, i.top_confidence, i.total_cost,
             i.judge_groundedness, i.judge_relevance, i.judge_hallucination, i.judged_at,
             COUNT(*) FILTER (WHERE af.kind = 'up')::int   AS up,
             COUNT(*) FILTER (WHERE af.kind = 'down')::int AS down,
             COUNT(*) FILTER (WHERE af.kind = 'edit')::int AS edits,
             (ARRAY_AGG(af.reason ORDER BY af.created_at DESC)
                FILTER (WHERE af.kind = 'down' AND af.reason IS NOT NULL))[1] AS down_reason
      FROM inquiries i
      LEFT JOIN answer_feedback af
        ON af.session_id = i.session_id AND af.turn_id = i.turn_id
      GROUP BY i.session_id, i.turn_id, i.created_at, i.channel, i.question, i.answer,
               i.search_count, i.top_confidence, i.total_cost,
               i.judge_groundedness, i.judge_relevance, i.judge_hallucination, i.judged_at
      ORDER BY i.created_at DESC
      LIMIT ${limit}
    `) as Array<{
      session_id: string;
      turn_id: string;
      created_at: string;
      channel: string;
      question: string;
      answer: string;
      search_count: number;
      top_confidence: string;
      total_cost: number;
      judge_groundedness: number | null;
      judge_relevance: number | null;
      judge_hallucination: boolean | null;
      judged_at: string | null;
      up: number;
      down: number;
      edits: number;
      down_reason: string | null;
    }>;
    return rows.map((r) => ({
      sessionId: r.session_id,
      turnId: r.turn_id,
      createdAt: new Date(r.created_at).toISOString(),
      channel: r.channel,
      question: r.question,
      answer: r.answer,
      searchCount: r.search_count,
      topConfidence: r.top_confidence,
      totalCost: r.total_cost,
      judged: r.judged_at != null,
      judgeGroundedness: r.judge_groundedness,
      judgeRelevance: r.judge_relevance,
      judgeHallucination: r.judge_hallucination,
      up: r.up,
      down: r.down,
      edits: r.edits,
      downReason: r.down_reason,
    }));
  } catch {
    return [];
  }
}

// --- Inquiry segmentation (D) ---

// One turn handed to the Haiku segmenter: just enough signal (the question plus
// the turn's strongest search query + top source title) to tell where one
// inquiry ends and the next begins, without shipping full answer bodies.
export type SegmentTurn = {
  readonly turnId: string;
  readonly question: string;
  readonly topQuery: string;
  readonly topSource: string;
};
export type SessionToSegment = {
  readonly sessionId: string;
  readonly turns: ReadonlyArray<SegmentTurn>;
};
// The segmenter's assignment for one turn.
export type SegmentAssignment = {
  readonly turnId: string;
  readonly inquiryNo: number;
  readonly inquiryTitle: string;
};

function topQueryAndSource(payload: unknown): { topQuery: string; topSource: string } {
  const searches = (payload as { searches?: InquirySearchLog[] })?.searches ?? [];
  const first = searches[0];
  return {
    topQuery: first?.query ?? "",
    topSource: first?.sources?.[0]?.title ?? "",
  };
}

// Sessions that still have at least one un-segmented turn (inquiry_no IS NULL)
// and haven't exhausted their retry budget. A newly-logged turn always arrives
// with inquiry_no NULL, so its whole session re-qualifies and gets re-segmented
// — which is exactly what we want when a thread grows.
export async function selectSessionsToSegment(limit = 25): Promise<SessionToSegment[]> {
  await ensureSchema();
  const sql = getSql();
  const sessions = (await sql`
    SELECT session_id
    FROM inquiries
    GROUP BY session_id
    HAVING bool_or(inquiry_no IS NULL) AND max(segment_attempts) < 3
    ORDER BY max(created_at) DESC
    LIMIT ${limit}
  `) as Array<{ session_id: string }>;

  const out: SessionToSegment[] = [];
  for (const s of sessions) {
    const rows = (await sql`
      SELECT turn_id, question, payload
      FROM inquiries
      WHERE session_id = ${s.session_id}
      ORDER BY created_at ASC
    `) as Array<{ turn_id: string; question: string; payload: unknown }>;
    out.push({
      sessionId: s.session_id,
      turns: rows.map((r) => {
        const { topQuery, topSource } = topQueryAndSource(r.payload);
        return { turnId: r.turn_id, question: r.question, topQuery, topSource };
      }),
    });
  }
  return out;
}

// Persist the segmenter's assignments for one session. Stamps inquiry_no +
// inquiry_title (and clears segment_attempts) so the session drops out of the
// work set until a new turn re-NULLs it.
export async function applySessionSegmentation(
  sessionId: string,
  assignments: ReadonlyArray<SegmentAssignment>,
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  for (const a of assignments) {
    await sql`
      UPDATE inquiries
      SET inquiry_no = ${a.inquiryNo},
          inquiry_title = ${a.inquiryTitle.slice(0, 120)},
          segment_attempts = 0
      WHERE session_id = ${sessionId} AND turn_id = ${a.turnId}
    `;
  }
}

// Poison-session guard: on a segmenter/parse failure bump segment_attempts on
// every turn of the session; at 3 the session stops being selected.
export async function markSessionSegmentFailure(sessionId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE inquiries SET segment_attempts = segment_attempts + 1
    WHERE session_id = ${sessionId}
  `;
}
