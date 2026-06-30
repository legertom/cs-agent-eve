import { getSql } from "./db";
import { reasonLabel } from "./feedback";
import {
  buildReport,
  type FeedbackReport,
  type GatheredSignals,
  REPORT_WINDOW_DAYS,
  type ReportStats,
  type ReportSummary,
  type SignalItem,
  type SignalKind,
  SIGNAL_KINDS,
} from "./feedback-report";

// Persistence for the Support QA Analyst:
//   • gatherNegativeSignals — reads the THREE existing signal tables (no schema of
//     its own to gather) and normalizes them into one SignalItem[] + window stats.
//   • feedback_reports       — stores each generated report (jsonb) so the page can
//     render the latest one and we keep history for trend.
// Mirrors the other stores: memoized idempotent ensureSchema + try/catch reads.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOW_GROUND_THRESHOLD = 0.5;
const PER_SOURCE = 60;

function newId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function clip(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// --- Gather: the three negative-signal sources -----------------------------

// Pull every negative signal since `sinceIso`, newest first, capped per source so
// the cluster prompt stays bounded. The aggregate stats are computed UNCAPPED (real
// counts) in a separate set of queries — the items feed clustering/evidence, the
// stats feed the dashboard.
export async function gatherNegativeSignals(sinceIso: string, windowDays: number): Promise<GatheredSignals> {
  const sql = getSql();

  const [flagsRaw, answerFbRaw, judgedRaw, agg] = await Promise.all([
    // Manual flags.
    sql`
      SELECT id, created_at, reason, note, title, top_confidence
      FROM flagged_threads
      WHERE created_at >= ${sinceIso}
      ORDER BY created_at DESC
      LIMIT ${PER_SOURCE}
    `,
    // Thumbs-down + expert edits (skip plain thumbs-up — that's positive).
    sql`
      SELECT session_id, created_at, kind, reason, note, question, original_answer, edited_answer
      FROM answer_feedback
      WHERE kind IN ('down', 'edit') AND created_at >= ${sinceIso}
      ORDER BY created_at DESC
      LIMIT ${PER_SOURCE}
    `,
    // Judge negatives: a hallucination flag OR weak groundedness.
    sql`
      SELECT session_id, created_at, question, judge_verdict, judge_groundedness, judge_hallucination, top_confidence, total_cost
      FROM inquiries
      WHERE judged_at IS NOT NULL
        AND (judge_hallucination = true OR judge_groundedness < ${LOW_GROUND_THRESHOLD})
        AND created_at >= ${sinceIso}
      ORDER BY created_at DESC
      LIMIT ${PER_SOURCE}
    `,
    gatherStats(sinceIso, windowDays),
  ]);

  const flags = flagsRaw as Array<{ id: string; created_at: string; reason: string; note: string; title: string; top_confidence: string }>;
  const answerFb = answerFbRaw as Array<{
    session_id: string;
    created_at: string;
    kind: string;
    reason: string | null;
    note: string;
    question: string;
    original_answer: string;
    edited_answer: string | null;
  }>;
  const judged = judgedRaw as Array<{
    session_id: string;
    created_at: string;
    question: string;
    judge_verdict: string | null;
    judge_groundedness: number | null;
    judge_hallucination: boolean | null;
    top_confidence: string;
    total_cost: number;
  }>;

  const items: SignalItem[] = [];

  for (const f of flags) {
    items.push({
      kind: "flag",
      createdAt: new Date(f.created_at).toISOString(),
      question: clip(f.title, 180),
      detail: clip([reasonLabel(f.reason), f.note].filter(Boolean).join(": "), 240),
      href: `/feedback/${f.id}`,
      label: `Flag: ${reasonLabel(f.reason)}`,
      topConfidence: f.top_confidence,
    });
  }

  for (const a of answerFb) {
    const isEdit = a.kind === "edit";
    items.push({
      kind: isEdit ? "expert_edit" : "thumbs_down",
      createdAt: new Date(a.created_at).toISOString(),
      question: clip(a.question, 180),
      detail: isEdit
        ? clip(`Expert rewrote the answer${a.note ? `: ${a.note}` : ""}`, 240)
        : clip([a.reason ? reasonLabel(a.reason) : "Thumbs down", a.note].filter(Boolean).join(": "), 240),
      href: `/inquiries/${a.session_id}`,
      label: isEdit ? "Expert edit" : "Thumbs down",
    });
  }

  for (const j of judged) {
    items.push({
      kind: j.judge_hallucination ? "judge_hallucination" : "judge_low_ground",
      createdAt: new Date(j.created_at).toISOString(),
      question: clip(j.question, 180),
      detail: clip(j.judge_verdict ?? (j.judge_hallucination ? "Hallucination" : "Weak grounding"), 240),
      href: `/inquiries/${j.session_id}`,
      label: j.judge_hallucination ? "Judge: hallucination" : "Judge: weak grounding",
      cost: j.total_cost,
      topConfidence: j.top_confidence,
    });
  }

  // Newest first overall, then cap the combined list as a final safety bound.
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return { items: items.slice(0, PER_SOURCE * 3), stats: agg };
}

// Uncapped window aggregates. One round trip per group, concurrent.
async function gatherStats(sinceIso: string, windowDays: number): Promise<ReportStats> {
  const sql = getSql();
  const [flagAgg, flagReasons, fbAgg, judgeAgg] = await Promise.all([
    sql`SELECT COUNT(*)::int AS flags FROM flagged_threads WHERE created_at >= ${sinceIso}`,
    sql`SELECT reason, COUNT(*)::int AS count FROM flagged_threads WHERE created_at >= ${sinceIso} GROUP BY reason ORDER BY count DESC`,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE kind = 'up')::int   AS up,
        COUNT(*) FILTER (WHERE kind = 'down')::int AS down,
        COUNT(*) FILTER (WHERE kind = 'edit')::int AS edits
      FROM answer_feedback WHERE created_at >= ${sinceIso}
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE judge_hallucination)::int AS halluc,
        COUNT(*) FILTER (WHERE judge_groundedness < ${LOW_GROUND_THRESHOLD})::int AS low_ground,
        AVG(judge_groundedness) FILTER (WHERE judged_at IS NOT NULL) AS avg_ground,
        COALESCE(SUM(total_cost) FILTER (WHERE judge_hallucination OR judge_groundedness < ${LOW_GROUND_THRESHOLD}), 0)::float8 AS neg_cost
      FROM inquiries WHERE created_at >= ${sinceIso} AND judged_at IS NOT NULL
    `,
  ]);

  const f = (flagAgg as Array<Record<string, number>>)[0] ?? {};
  const fb = (fbAgg as Array<Record<string, number>>)[0] ?? {};
  const j = (judgeAgg as Array<Record<string, number | null>>)[0] ?? {};

  const byKind: Record<SignalKind, number> = {
    flag: f.flags ?? 0,
    thumbs_down: (fb.down as number) ?? 0,
    expert_edit: (fb.edits as number) ?? 0,
    judge_hallucination: (j.halluc as number) ?? 0,
    judge_low_ground: Math.max(0, ((j.low_ground as number) ?? 0) - ((j.halluc as number) ?? 0)),
  };
  const totalSignals = SIGNAL_KINDS.reduce((sum, k) => sum + byKind[k], 0);
  const avgG = j.avg_ground;

  return {
    windowDays,
    since: sinceIso,
    totalSignals,
    byKind,
    flagsByReason: (flagReasons as Array<{ reason: string; count: number }>).map((r) => ({
      reason: reasonLabel(r.reason),
      count: r.count,
    })),
    thumbsUp: (fb.up as number) ?? 0,
    thumbsDown: (fb.down as number) ?? 0,
    expertEdits: (fb.edits as number) ?? 0,
    hallucinationCount: (j.halluc as number) ?? 0,
    avgGroundednessJudged: typeof avgG === "number" ? avgG : null,
    negativeSignalCost: (j.neg_cost as number) ?? 0,
  };
}

// --- feedback_reports table -------------------------------------------------

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS feedback_reports (
          id                   text PRIMARY KEY,
          generated_at         timestamptz NOT NULL DEFAULT now(),
          window_days          integer NOT NULL DEFAULT 0,
          since                timestamptz,
          model                text NOT NULL DEFAULT '',
          total_signals        integer NOT NULL DEFAULT 0,
          recommendation_count integer NOT NULL DEFAULT 0,
          report               jsonb NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS feedback_reports_generated_at_idx ON feedback_reports (generated_at DESC)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export async function saveReport(report: FeedbackReport): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const id = newId();
  await sql`
    INSERT INTO feedback_reports
      (id, generated_at, window_days, since, model, total_signals, recommendation_count, report)
    VALUES (
      ${id}, ${report.generatedAt}, ${report.windowDays}, ${report.since}, ${report.model},
      ${report.stats.totalSignals}, ${report.recommendations.length},
      ${JSON.stringify(report)}::jsonb
    )
  `;
  return id;
}

export async function loadLatestReport(): Promise<{ id: string; report: FeedbackReport } | null> {
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT id, report FROM feedback_reports ORDER BY generated_at DESC LIMIT 1
    `) as Array<{ id: string; report: FeedbackReport }>;
    return rows[0] ? { id: rows[0].id, report: rows[0].report } : null;
  } catch {
    return null;
  }
}

export async function loadReport(id: string): Promise<FeedbackReport | null> {
  if (!ID_RE.test(id)) return null;
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`SELECT report FROM feedback_reports WHERE id = ${id}`) as Array<{ report: FeedbackReport }>;
    return rows[0]?.report ?? null;
  } catch {
    return null;
  }
}

export async function listReports(limit = 20): Promise<ReportSummary[]> {
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT id, generated_at, window_days, total_signals, recommendation_count
      FROM feedback_reports
      ORDER BY generated_at DESC
      LIMIT ${limit}
    `) as Array<{ id: string; generated_at: string; window_days: number; total_signals: number; recommendation_count: number }>;
    return rows.map((r) => ({
      id: r.id,
      generatedAt: new Date(r.generated_at).toISOString(),
      windowDays: r.window_days,
      totalSignals: r.total_signals,
      recommendationCount: r.recommendation_count,
    }));
  } catch {
    return [];
  }
}

// Most-recent report timestamp — used by the route to debounce manual "Run now"
// clicks (and to fetch the prior report's stats for trend).
export async function latestReportGeneratedAt(): Promise<string | null> {
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`SELECT generated_at FROM feedback_reports ORDER BY generated_at DESC LIMIT 1`) as Array<{
      generated_at: string;
    }>;
    return rows[0] ? new Date(rows[0].generated_at).toISOString() : null;
  } catch {
    return null;
  }
}

// --- Orchestrator: gather → analyze → persist -------------------------------

// One full run. Rolling window ending at `nowIso`; the previous report's stats are
// passed through for the trend line. Persists and returns the new report. The
// route owns auth/debounce; this owns the work.
export async function runFeedbackReport(nowIso: string): Promise<{ id: string; report: FeedbackReport }> {
  const sinceIso = new Date(Date.parse(nowIso) - REPORT_WINDOW_DAYS * 86_400_000).toISOString();
  const prev = await loadLatestReport();
  const gathered = await gatherNegativeSignals(sinceIso, REPORT_WINDOW_DAYS);
  const report = await buildReport(gathered, prev?.report.stats ?? null, nowIso);
  const id = await saveReport(report);
  return { id, report };
}
