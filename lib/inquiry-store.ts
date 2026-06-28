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
};

// Roll-up for the analytics dashboard — "how many inquiries, what do they cost,
// and how often are we answering with weak grounding (or no search at all)?"
export type InquiryAnalytics = {
  readonly total: number;
  readonly last7Days: number;
  readonly totalCost: number;
  readonly avgCost: number;
  // Turns that ran a search but the best hit was low/unscored — weak grounding.
  readonly lowConfidenceCount: number;
  // Turns that answered with no search at all (clarifying questions, or ungrounded).
  readonly noSearchCount: number;
  readonly byChannel: ReadonlyArray<{ readonly channel: string; readonly count: number }>;
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
    const sql = getSql();
    const [totals, byChannel] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
          COALESCE(SUM(total_cost), 0)::float8 AS total_cost,
          COALESCE(AVG(total_cost), 0)::float8 AS avg_cost,
          COUNT(*) FILTER (WHERE search_count > 0 AND top_confidence IN ('low', 'unscored'))::int AS low_conf,
          COUNT(*) FILTER (WHERE search_count = 0)::int AS no_search
        FROM inquiries
      `,
      sql`SELECT channel, COUNT(*)::int AS count FROM inquiries GROUP BY channel ORDER BY count DESC`,
    ]);
    const t = (totals as Array<Record<string, number>>)[0] ?? {};
    return {
      total: t.total ?? 0,
      last7Days: t.last7 ?? 0,
      totalCost: t.total_cost ?? 0,
      avgCost: t.avg_cost ?? 0,
      lowConfidenceCount: t.low_conf ?? 0,
      noSearchCount: t.no_search ?? 0,
      byChannel: (byChannel as Array<{ channel: string; count: number }>).map((r) => ({
        channel: r.channel || "unknown",
        count: r.count,
      })),
    };
  } catch {
    return {
      total: 0,
      last7Days: 0,
      totalCost: 0,
      avgCost: 0,
      lowConfidenceCount: 0,
      noSearchCount: 0,
      byChannel: [],
    };
  }
}
