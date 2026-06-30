import { NextResponse } from "next/server";
import {
  applySessionSegmentation,
  markSessionSegmentFailure,
  selectSessionsToSegment,
} from "@/lib/inquiry-store";
import { segmentSession } from "@/lib/inquiry-segment";

// Batch inquiry segmenter. Like /api/judge/batch, this is decoupled from the eve
// turn hook (a thrown hook breaks the user's turn) and runs on Vercel Cron (GET
// with Bearer CRON_SECRET) or a manual authenticated POST. Idempotent: only
// sessions with an un-segmented turn (inquiry_no IS NULL) are selected, so a
// re-run re-segments only sessions that grew, and never re-bills settled ones.

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMIT = 25;
// Small concurrency cap so we never fan many gateway calls at once.
const CONCURRENCY = 3;

// Same auth-gate contract as /api/judge/batch.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[segment/batch] CRON_SECRET not set — allowing unauthenticated run (dev only).");
    return true;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sessions;
  try {
    sessions = await selectSessionsToSegment(LIMIT);
  } catch (error) {
    console.error("[segment/batch] failed to load sessions", error);
    return NextResponse.json({ error: "Could not load sessions" }, { status: 500 });
  }

  let segmented = 0;
  let errors = 0;

  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const chunk = sessions.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (session) => {
        try {
          const assignments = await segmentSession(session.turns);
          await applySessionSegmentation(session.sessionId, assignments);
          segmented += 1;
        } catch (error) {
          errors += 1;
          console.error("[segment/batch] failed to segment session", session.sessionId, error);
          // Poison-session guard: bump segment_attempts; at 3 it stops selecting.
          try {
            await markSessionSegmentFailure(session.sessionId);
          } catch (markError) {
            console.error("[segment/batch] failed to mark segment failure", markError);
          }
        }
      }),
    );
  }

  return NextResponse.json({ selected: sessions.length, segmented, errors });
}

// Vercel Cron invokes via GET; a manual run can use POST. Same handler for both.
export const GET = handle;
export const POST = handle;
