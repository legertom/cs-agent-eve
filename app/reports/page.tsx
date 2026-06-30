import {
  ArrowUpRightIcon,
  CoinsIcon,
  FileSearchIcon,
  FlagIcon,
  LightbulbIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { RunReportButton } from "@/app/_components/run-report-button";
import { formatFeedbackDate, formatUsd } from "@/lib/feedback";
import {
  type EvidenceRef,
  type FeedbackReport,
  type KbRef,
  type Recommendation,
  RECOMMENDATION_TYPE_LABEL,
  type ReportStats,
  type ReportSummary,
  type ReportTheme,
  type SignalKind,
  SIGNAL_KINDS,
  SIGNAL_LABEL,
  type Severity,
} from "@/lib/feedback-report";
import { listReports, loadLatestReport } from "@/lib/feedback-report-store";
import { cn } from "@/lib/utils";

// The QA report regenerates on a schedule and on demand — always render the latest.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Support QA Report — Clever Support Agent",
  description: "An AI analyst reviews every negative signal and recommends what to fix.",
};

export default async function ReportPage() {
  const [latest, history] = await Promise.all([loadLatestReport(), listReports(12)]);
  const report = latest?.report ?? null;

  return (
    <main className="bg-white text-clever-black">
      <section className="relative overflow-hidden px-6 pt-16 pb-8">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-44 w-44 bg-clever-blue/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="inline-flex items-center gap-1.5 font-semibold text-clever-blue text-xs uppercase tracking-wider">
            <SparklesIcon className="size-3.5" />
            QA analyst
          </p>
          <h1 className="mt-1 font-normal text-4xl text-clever-navy leading-[1.05] sm:text-5xl">
            Support QA Report
          </h1>
          <p className="mt-4 max-w-xl text-clever-black/60 leading-relaxed">
            An AI analyst reads every negative signal — flags, thumbs-down, expert
            edits, and the judge's hallucination calls — groups them into recurring
            themes, checks each against the knowledge base, and recommends what to fix.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <RunReportButton hasReport={Boolean(report)} />
            {report ? (
              <span className="text-clever-black/40 text-xs">
                Generated {formatFeedbackDate(report.generatedAt)} · last {report.windowDays} days · {report.model}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-3xl space-y-6">
          {report ? (
            <>
              <HealthPanel report={report} />
              <StatsDashboard stats={report.stats} />
              <Recommendations items={report.recommendations} />
              <Themes themes={report.themes} />
              {history.length > 1 ? <History items={history} currentId={latest?.id} /> : null}
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-clever-light-blue bg-clever-light-blue/20 px-5 py-10 text-center">
      <FileSearchIcon className="mx-auto size-6 text-clever-blue/50" />
      <p className="mt-3 font-medium text-clever-navy">No report yet</p>
      <p className="mt-1 text-clever-black/50 text-sm">
        Run the analyst to review the last 30 days of feedback. It also runs daily.
      </p>
      <div className="mt-4 flex justify-center">
        <RunReportButton hasReport={false} />
      </div>
    </div>
  );
}

function HealthPanel({ report }: { readonly report: FeedbackReport }) {
  return (
    <div className="rounded-xl border border-clever-light-blue bg-gradient-to-br from-clever-light-blue/30 to-white p-5">
      <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">Health</p>
      <p className="mt-1.5 text-clever-navy leading-relaxed">{report.health.summary}</p>
      {report.health.trend ? (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-clever-blue text-xs">
          <TrendingUpIcon className="size-3.5" />
          {report.health.trend}
        </p>
      ) : null}
    </div>
  );
}

function StatsDashboard({ stats }: { readonly stats: ReportStats }) {
  const activeKinds = SIGNAL_KINDS.filter((k) => stats.byKind[k] > 0);
  const maxKind = Math.max(1, ...SIGNAL_KINDS.map((k) => stats.byKind[k]));
  return (
    <div className="space-y-4 rounded-xl border border-clever-light-blue bg-clever-light-blue/15 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Negative signals" value={String(stats.totalSignals)} />
        <Stat
          accent={stats.hallucinationCount > 0}
          icon={<ShieldAlertIcon className="size-3 text-clever-orange/70" />}
          label="Hallucinations"
          value={String(stats.hallucinationCount)}
        />
        <Stat
          label="Avg groundedness"
          value={stats.avgGroundednessJudged == null ? "—" : stats.avgGroundednessJudged.toFixed(2)}
        />
        <Stat
          icon={<CoinsIcon className="size-3 text-clever-blue/60" />}
          label="Wrong-answer spend"
          value={formatUsd(stats.negativeSignalCost)}
        />
      </div>

      {activeKinds.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">By signal</p>
          <div className="space-y-1.5">
            {activeKinds.map((k) => (
              <div className="flex items-center gap-2" key={k}>
                <span className="w-36 shrink-0 truncate text-clever-navy/70 text-xs">{SIGNAL_LABEL[k]}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-clever-light-blue/60">
                  <span
                    className={cn("block h-full rounded-full", kindBar(k))}
                    style={{ width: `${Math.max(4, Math.round((stats.byKind[k] / maxKind) * 100))}%` }}
                  />
                </span>
                <span className="w-6 text-right text-clever-black/50 text-xs tabular-nums">{stats.byKind[k]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-clever-black/40">Context:</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-clever-navy/70">{stats.thumbsUp} 👍 / {stats.thumbsDown} 👎</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-clever-navy/70">{stats.expertEdits} expert edits</span>
        {stats.flagsByReason.map((r) => (
          <span className="rounded-full bg-white px-2 py-0.5 text-clever-navy/70" key={r.reason}>
            {r.reason} · {r.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function Recommendations({ items }: { readonly items: ReadonlyArray<Recommendation> }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 font-medium text-clever-navy text-lg">
        <LightbulbIcon className="size-4 text-clever-yellow" />
        Recommendations
      </h2>
      <ol className="space-y-3">
        {items.map((rec) => (
          <li
            className="rounded-xl border border-clever-light-blue bg-white p-4 shadow-[0_1px_0_0_var(--clever-light-blue)]"
            key={rec.rank}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-clever-navy font-semibold text-[11px] text-white tabular-nums">
                {rec.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-clever-navy">{rec.title}</span>
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-[11px]", typeBadge(rec.type))}>
                    {RECOMMENDATION_TYPE_LABEL[rec.type]}
                  </span>
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide", severityBadge(rec.severity))}>
                    {rec.severity}
                  </span>
                </div>
                <p className="mt-1.5 text-clever-black/60 text-sm leading-relaxed">{rec.rationale}</p>
                <p className="mt-2 text-clever-black/80 text-sm leading-relaxed">
                  <span className="font-medium text-clever-navy">Do: </span>
                  {rec.action}
                </p>
                {rec.kbRefs.length > 0 ? <KbRefs refs={rec.kbRefs} /> : null}
                {rec.evidence.length > 0 ? <Evidence refs={rec.evidence} /> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Themes({ themes }: { readonly themes: ReadonlyArray<ReportTheme> }) {
  if (themes.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="font-medium text-clever-navy text-lg">Themes</h2>
      <ul className="divide-y divide-clever-light-blue/70 overflow-hidden rounded-xl border border-clever-light-blue">
        {themes.map((t) => (
          <li className="space-y-2 px-4 py-3.5" key={t.title}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-clever-navy text-sm">{t.title}</span>
              <span className="shrink-0 rounded-full bg-clever-light-blue/60 px-2 py-0.5 text-clever-navy/70 text-[11px] tabular-nums">
                {t.count} signal{t.count === 1 ? "" : "s"}
              </span>
            </div>
            {t.description ? <p className="text-clever-black/55 text-sm">{t.description}</p> : null}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={cn("rounded-full px-2 py-0.5", coverageBadge(t.kbCoverage.confidence))}>
                KB: {t.kbCoverage.confidence}
              </span>
              {t.kinds.map((k) => (
                <span className="rounded-full bg-clever-light-blue/40 px-2 py-0.5 text-clever-navy/60" key={k}>
                  {SIGNAL_LABEL[k]}
                </span>
              ))}
            </div>
            {t.evidence.length > 0 ? <Evidence refs={t.evidence} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function KbRefs({ refs }: { readonly refs: ReadonlyArray<KbRef> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-clever-black/40 text-xs">KB:</span>
      {refs.map((r) => (
        <a
          className="inline-flex items-center gap-1 rounded-full border border-clever-light-blue bg-clever-light-blue/20 px-2 py-0.5 text-clever-blue text-xs transition-colors hover:bg-clever-light-blue/50"
          href={r.url}
          key={`${r.url}-${r.title}`}
          rel="noreferrer"
          target="_blank"
        >
          <span className="max-w-[16rem] truncate">{r.title}</span>
          {r.score != null ? <span className="text-clever-black/40 tabular-nums">{r.score.toFixed(2)}</span> : null}
          <ArrowUpRightIcon className="size-3" />
        </a>
      ))}
    </div>
  );
}

function Evidence({ refs }: { readonly refs: ReadonlyArray<EvidenceRef> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <FlagIcon className="size-3 text-clever-black/30" />
      {refs.map((ev, i) => (
        <Link
          className="rounded-full bg-clever-light-blue/40 px-2 py-0.5 text-clever-navy/70 text-xs transition-colors hover:bg-clever-light-blue/70"
          href={ev.href}
          key={`${ev.href}-${i}`}
        >
          {ev.label}
        </Link>
      ))}
    </div>
  );
}

function History({ items, currentId }: { readonly items: ReadonlyArray<ReportSummary>; readonly currentId?: string }) {
  return (
    <details className="rounded-xl border border-clever-light-blue bg-white">
      <summary className="cursor-pointer px-4 py-3 font-medium text-clever-navy text-sm">
        Report history ({items.length})
      </summary>
      <ul className="divide-y divide-clever-light-blue/70 border-clever-light-blue border-t">
        {items.map((r) => (
          <li
            className={cn(
              "flex items-center justify-between gap-2 px-4 py-2.5 text-sm",
              r.id === currentId && "bg-clever-light-blue/20",
            )}
            key={r.id}
          >
            <span className="text-clever-black/60">{formatFeedbackDate(r.generatedAt)}</span>
            <span className="text-clever-black/40 text-xs">
              {r.totalSignals} signals · {r.recommendationCount} recs
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Stat({
  label,
  value,
  icon,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly icon?: React.ReactNode;
  readonly accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-clever-light-blue/70 bg-white px-3 py-2.5">
      <p className="text-clever-black/40 text-[11px] uppercase tracking-wide">{label}</p>
      <p className={cn("mt-0.5 flex items-center gap-1 font-medium text-lg tabular-nums", accent ? "text-clever-orange" : "text-clever-navy")}>
        {icon}
        {value}
      </p>
    </div>
  );
}

function kindBar(kind: SignalKind): string {
  switch (kind) {
    case "flag":
    case "judge_hallucination":
      return "bg-clever-orange";
    case "thumbs_down":
      return "bg-clever-yellow";
    case "expert_edit":
      return "bg-clever-navy/50";
    default:
      return "bg-clever-blue";
  }
}

function typeBadge(type: Recommendation["type"]): string {
  switch (type) {
    case "kb_gap":
      return "border-clever-orange/50 bg-clever-orange/10 text-clever-orange";
    case "kb_fix":
      return "border-clever-yellow/60 bg-clever-yellow/15 text-clever-navy";
    case "prompt":
    case "retrieval":
      return "border-clever-blue/40 bg-clever-blue/10 text-clever-blue";
    default:
      return "border-clever-light-blue bg-clever-light-blue/50 text-clever-navy";
  }
}

function severityBadge(severity: Severity): string {
  switch (severity) {
    case "high":
      return "bg-clever-orange/15 text-clever-orange";
    case "medium":
      return "bg-clever-yellow/20 text-clever-navy";
    default:
      return "bg-clever-light-blue/60 text-clever-navy/70";
  }
}

function coverageBadge(confidence: string): string {
  switch (confidence) {
    case "high":
      return "bg-clever-blue/10 text-clever-blue";
    case "medium":
      return "bg-clever-yellow/15 text-clever-navy";
    default:
      return "bg-clever-orange/10 text-clever-orange";
  }
}
