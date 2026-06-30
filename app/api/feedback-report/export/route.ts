import { exportFilename, reportToCsv, reportToMarkdown } from "@/lib/feedback-report-export";
import { loadLatestReport, loadReport } from "@/lib/feedback-report-store";

// Download a stored QA report as Markdown (the readable report) or CSV (a
// recommendation worklist for the customer-education team). Read-only — no model
// calls, no generation — so it's an unauthenticated GET like the /reports page.
// ?format=md|csv (default md), ?id=<reportId> (default the latest report).

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "md";
  const id = url.searchParams.get("id");

  try {
    const report = id ? await loadReport(id) : (await loadLatestReport())?.report ?? null;
    if (!report) {
      return new Response("No report found.", { status: 404 });
    }

    const body = format === "csv" ? reportToCsv(report, url.origin) : reportToMarkdown(report, url.origin);
    const filename = exportFilename(report, format);
    const contentType = format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8";

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[feedback-report/export] failed", error);
    return new Response("Export failed.", { status: 500 });
  }
}
