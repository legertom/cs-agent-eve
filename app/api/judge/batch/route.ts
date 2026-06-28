import { NextResponse } from "next/server";
import {
  markInquiryJudgeFailure,
  selectUnjudgedInquiries,
  updateInquiryJudgment,
} from "@/lib/inquiry-store";
import { JUDGE_MODEL, judgeAnswer } from "@/lib/judge";

// Batch LLM-as-judge scorer. NOT inline in the eve turn hook — judging adds
// ~2-5s/row and a thrown hook breaks the user's turn, so scoring is decoupled
// here and can be triggered by Vercel Cron (GET with Bearer CRON_SECRET) or a
// manual authenticated POST. Idempotent: a second run scores zero already-judged
// rows (the SELECT filters judged_at IS NOT NULL), so it never re-bills.

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMIT = 20;
// Small concurrency cap so we never fan 20 gateway calls at once.
const CONCURRENCY = 3;

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
          const result = await judgeAnswer({
            question: row.question,
            answer: row.answer,
            sources: row.sources,
          });
          await updateInquiryJudgment(row.sessionId, row.turnId, { ...result, model: JUDGE_MODEL });
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
