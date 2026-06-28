import { getSql } from "./db";
import type {
  FeedbackAnalytics,
  FeedbackPayload,
  FeedbackSummary,
} from "./feedback";

// Persistence for flagged ("log thread with feedback") threads, backed by Neon
// Postgres (Vercel Marketplace). Structured columns make the threads reviewable
// and analyzable with SQL — filter by reason, aggregate cost, find low-confidence
// answers — while the full transcript + retrieval trail live in a jsonb payload.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function newId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url"); // 12 url-safe chars, 72 bits
}

// Best retrieval confidence in the thread, ranked high > medium > low > unscored.
// Surfaces the "answered with weak grounding" case for triage.
const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unscored: 0 };
function topConfidenceOf(payload: FeedbackPayload): string {
  let best = "unscored";
  for (const r of payload.retrievals) {
    const level = (r.output as { confidence?: { level?: string } } | null)?.confidence?.level;
    if (level && (CONFIDENCE_RANK[level] ?? -1) > (CONFIDENCE_RANK[best] ?? -1)) {
      best = level;
    }
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
        CREATE TABLE IF NOT EXISTS flagged_threads (
          id              text PRIMARY KEY,
          created_at      timestamptz NOT NULL DEFAULT now(),
          reason          text NOT NULL,
          note            text NOT NULL DEFAULT '',
          reporter        text,
          persona         text NOT NULL DEFAULT 'anyone',
          title           text NOT NULL DEFAULT '',
          thread_cost     double precision NOT NULL DEFAULT 0,
          retrieval_count integer NOT NULL DEFAULT 0,
          top_confidence  text NOT NULL DEFAULT 'unscored',
          payload         jsonb NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS flagged_threads_created_at_idx ON flagged_threads (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS flagged_threads_reason_idx ON flagged_threads (reason)`;
    })().catch((err) => {
      // Don't cache a failed init — let the next call retry.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export async function saveFeedback(payload: FeedbackPayload): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const id = newId();
  await sql`
    INSERT INTO flagged_threads
      (id, created_at, reason, note, reporter, persona, title, thread_cost, retrieval_count, top_confidence, payload)
    VALUES (
      ${id}, ${payload.createdAt}, ${payload.reason}, ${payload.note},
      ${payload.reporter ?? null}, ${payload.persona}, ${payload.title},
      ${payload.threadCost}, ${payload.retrievalCount}, ${topConfidenceOf(payload)},
      ${JSON.stringify(payload)}::jsonb
    )
  `;
  return id;
}

export async function loadFeedback(id: string): Promise<FeedbackPayload | null> {
  if (!ID_RE.test(id)) return null;
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`SELECT payload FROM flagged_threads WHERE id = ${id}`) as Array<{
      payload: FeedbackPayload;
    }>;
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

export async function listFeedback(limit = 200): Promise<FeedbackSummary[]> {
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT id, created_at, title, reason, note, reporter, retrieval_count, top_confidence
      FROM flagged_threads
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as Array<{
      id: string;
      created_at: string;
      title: string;
      reason: string;
      note: string;
      reporter: string | null;
      retrieval_count: number;
      top_confidence: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      title: r.title,
      reason: r.reason,
      note: r.note,
      reporter: r.reporter ?? undefined,
      retrievalCount: r.retrieval_count,
      topConfidence: r.top_confidence,
    }));
  } catch {
    return [];
  }
}

// Roll-up for the review dashboard. One round trip per metric, run concurrently.
export async function feedbackAnalytics(): Promise<FeedbackAnalytics> {
  try {
    await ensureSchema();
    const sql = getSql();
    const [totals, byReason, reporters] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
          COALESCE(SUM(thread_cost), 0)::float8 AS total_cost,
          COALESCE(AVG(thread_cost), 0)::float8 AS avg_cost,
          COUNT(*) FILTER (WHERE top_confidence IN ('low', 'unscored'))::int AS low_conf
        FROM flagged_threads
      `,
      sql`SELECT reason, COUNT(*)::int AS count FROM flagged_threads GROUP BY reason ORDER BY count DESC`,
      sql`
        SELECT reporter, COUNT(*)::int AS count
        FROM flagged_threads
        WHERE reporter IS NOT NULL AND reporter <> ''
        GROUP BY reporter ORDER BY count DESC LIMIT 5
      `,
    ]);
    const t = (totals as Array<Record<string, number>>)[0] ?? {};
    return {
      total: t.total ?? 0,
      last7Days: t.last7 ?? 0,
      totalCost: t.total_cost ?? 0,
      avgCost: t.avg_cost ?? 0,
      lowConfidenceCount: t.low_conf ?? 0,
      byReason: (byReason as Array<{ reason: string; count: number }>).map((r) => ({
        reason: r.reason,
        count: r.count,
      })),
      topReporters: (reporters as Array<{ reporter: string; count: number }>).map((r) => ({
        reporter: r.reporter,
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
      byReason: [],
      topReporters: [],
    };
  }
}
