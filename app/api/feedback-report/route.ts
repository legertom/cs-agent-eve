import { NextResponse } from "next/server";
import {
  latestReportGeneratedAt,
  loadLatestReport,
  runFeedbackReport,
} from "@/lib/feedback-report-store";

// Support QA Analyst runner. Generation is decoupled from the page (it makes a
// Haiku cluster call, a handful of KB searches, and a Sonnet synthesis — a few
// seconds), so it runs here and can be triggered two ways:
//   • GET  — Vercel Cron (daily), auth-gated by CRON_SECRET. Always regenerates.
//   • POST — the "Run now" button on /feedback/report. Debounced so repeated
//            clicks on this unauthenticated internal tool can't re-bill: a report
//            generated in the last DEBOUNCE_MS is returned as-is.
// Same CRON_SECRET pattern as /api/judge/batch.

export const runtime = "nodejs";
export const maxDuration = 300;

const DEBOUNCE_MS = 2 * 60 * 1000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[feedback-report] CRON_SECRET not set — allowing unauthenticated run (dev only).");
    return true;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id, report } = await runFeedbackReport(new Date().toISOString());
    return NextResponse.json({
      id,
      generatedAt: report.generatedAt,
      totalSignals: report.stats.totalSignals,
      recommendations: report.recommendations.length,
    });
  } catch (error) {
    console.error("[feedback-report] generation failed", error);
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const last = await latestReportGeneratedAt();
    if (last && Date.now() - Date.parse(last) < DEBOUNCE_MS) {
      const latest = await loadLatestReport();
      return NextResponse.json({ id: latest?.id, reused: true, generatedAt: last });
    }
    const { id, report } = await runFeedbackReport(new Date().toISOString());
    return NextResponse.json({
      id,
      reused: false,
      generatedAt: report.generatedAt,
      totalSignals: report.stats.totalSignals,
      recommendations: report.recommendations.length,
    });
  } catch (error) {
    console.error("[feedback-report] manual generation failed", error);
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}
