import { NextResponse } from "next/server";
import {
  markInquiryJudgeFailure,
  selectUnjudgedInquiries,
  updateInquiryJudgment,
} from "@/lib/inquiry-store";
import { JUDGE_MODEL, judgeAnswer } from "@/lib/judge";
import { canonicalizeUrl, getArticleByUrl } from "@/lib/search";
import { judgeInferenceCost } from "@/lib/inference-cost";

// Batch LLM-as-judge scorer. NOT inline in the eve turn hook — judging adds
// ~2-5s/row and a thrown hook breaks the user's turn, so scoring is decoupled
// here and can be triggered by Vercel Cron (GET with Bearer CRON_SECRET) or a
// manual authenticated POST. Idempotent: a second run scores zero already-judged
// rows (the SELECT filters judged_at IS NOT NULL), so it never re-bills.
//
// Grounding: the judge scores against the retrieved sources' full article BODIES,
// fetched LIVE from the KB here at judge time (the stored payload has only
// title/url). Bodies are bounded by the caps below before the prompt is built,
// then dropped after judging — never persisted onto the inquiry.

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMIT = 20;
// Small concurrency cap so we never fan 20 gateway calls at once.
const CONCURRENCY = 3;

// --- Judge body-grounding token-budget caps ---
// All caps are measured in JavaScript string length (UTF-16 code units) — a
// deliberate, simple proxy for tokens (no real tokenization). They are applied at
// enrichment time, BEFORE the prompt is built (never inside generateText), in
// this order: sort sources by rank ascending → per-source 2k char cap → at most
// 5 bodied sources → 8k total body-char budget.
const MAX_BODY_CHARS = 2000; // per-source body cap (≈ a token proxy)
const MAX_BODIED_SOURCES = 5; // only the top-5 sources (by rank) get bodies
const MAX_TOTAL_BODY_CHARS = 8000; // backstop on the SUM of attached body chars

type SourceIn = { rank?: number; title?: string; url?: string };
type SourceWithBody = SourceIn & { body?: string };

// Truncate one article body to MAX_BODY_CHARS, appending the marker ONLY when the
// body was actually longer than the cap (≤ cap → returned whole, no marker).
function capBody(text: string): string {
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)} …[truncated]` : text;
}

// Resolve and attach capped article bodies to a row's sources for body-grounded
// judging. The judge still SEES every retrieved source row (in original order);
// only the top-5-by-rank are eligible for a body, the body fetch is deduped by
// canonical URL, and attachment is bounded by the overall body-char budget.
// Every failure mode (KB miss, null URL, empty body, thrown lookup, cold/failed
// index) degrades a source to title-only — it never throws.
async function enrichSourcesWithBodies(
  sources: ReadonlyArray<SourceIn>,
): Promise<SourceWithBody[]> {
  if (sources.length === 0) return [];

  // Stable sort by rank ascending (rank ?? MAX_SAFE), original index as the
  // tie-breaker for equal/undefined ranks — so the BEST sources get bodies first,
  // without re-ranking. We keep the original index to attach back in source order.
  const ranked = sources
    .map((s, i) => ({ s, i, canon: canonicalizeUrl(s.url) }))
    .sort(
      (a, b) =>
        (a.s.rank ?? Number.MAX_SAFE_INTEGER) - (b.s.rank ?? Number.MAX_SAFE_INTEGER) || a.i - b.i,
    );

  // Top-N by rank are eligible for a body fetch; the rest stay title-only.
  const eligible = ranked.slice(0, MAX_BODIED_SOURCES);

  // Dedupe the body FETCH by canonical URL: one turn can repeat the same article
  // across searches — fetch each distinct URL's capped body at most once, reuse it.
  const bodyByCanon = new Map<string, string>(); // canon URL → capped body
  const fetched = new Set<string>();
  await Promise.all(
    eligible.map(async ({ s, canon }) => {
      if (!canon || fetched.has(canon)) return;
      fetched.add(canon);
      try {
        const article = await getArticleByUrl(s.url);
        const text = article?.text?.trim();
        // Empty / whitespace-only body == no body (title-only fallback).
        if (text) bodyByCanon.set(canon, capBody(text));
      } catch {
        // A thrown lookup degrades this source to title-only; never fail the row.
      }
    }),
  );

  // Attach bodies in rank order under the overall body-char budget. Once adding
  // the next capped body would exceed the budget, stop attaching (that source and
  // all lower-ranked ones stay title-only).
  const bodyForIndex = new Map<number, string>();
  let totalBodyChars = 0;
  for (const { i, canon } of eligible) {
    const body = canon ? bodyByCanon.get(canon) : undefined;
    if (!body) continue;
    if (totalBodyChars + body.length > MAX_TOTAL_BODY_CHARS) break;
    totalBodyChars += body.length;
    bodyForIndex.set(i, body);
  }

  // Build the enriched array in ORIGINAL order — the judge sees every source row.
  return sources.map((s, i) => {
    const body = bodyForIndex.get(i);
    return body ? { ...s, body } : { ...s };
  });
}

// Auth-gate: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when
// CRON_SECRET is set. If it's set, require a match (401 otherwise). If it's unset
// (local dev), allow the run but warn — read at request time, not module load.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[judge/batch] CRON_SECRET not set — allowing unauthenticated run (dev only).");
    return true;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows;
  try {
    rows = await selectUnjudgedInquiries(LIMIT);
  } catch (error) {
    console.error("[judge/batch] failed to load unjudged inquiries", error);
    return NextResponse.json({ error: "Could not load inquiries" }, { status: 500 });
  }

  let judged = 0;
  let errors = 0;

  // Process in chunks of CONCURRENCY (<= 3). JS is single-threaded, so the
  // shared counters are safe to ++ inside the concurrent closures.
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (row) => {
        try {
          // Fetch + attach capped article bodies (title-only fallback on any
          // miss). An empty source list skips all body work — judged as today.
          const sources = await enrichSourcesWithBodies(row.sources);
          const bodied = sources.filter((s) => s.body);
          if (bodied.length) {
            const bodyChars = bodied.reduce((n, s) => n + (s.body?.length ?? 0), 0);
            console.log(`[judge/batch] ${row.turnId}: ${bodied.length} bodied sources, ${bodyChars} body chars`);
          }
          const { result, usage } = await judgeAnswer({
            question: row.question,
            answer: row.answer,
            sources,
          });
          const judgeCost = judgeInferenceCost(usage);
          await updateInquiryJudgment(row.sessionId, row.turnId, {
            ...result,
            model: JUDGE_MODEL,
            judge_cost: judgeCost,
          });
          judged += 1;
        } catch (error) {
          errors += 1;
          const reason = error instanceof Error ? error.message : "judge failed";
          // Poison-row guard: bump judge_attempts, keep judged_at NULL until 3.
          try {
            await markInquiryJudgeFailure(row.sessionId, row.turnId, reason);
          } catch (markError) {
            console.error("[judge/batch] failed to mark judge failure", markError);
          }
        }
      }),
    );
  }

  return NextResponse.json({ selected: rows.length, judged, errors });
}

// Vercel Cron invokes via GET; a manual run can use POST. Same handler for both.
export const GET = handle;
export const POST = handle;
