import { CoinsIcon, FlagIcon, SearchCheckIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { feedbackAnalytics, listFeedback } from "@/lib/feedback-store";
import {
  type FeedbackAnalytics,
  formatFeedbackDate,
  formatUsd,
  reasonBadgeClass,
  reasonLabel,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

// The team's review queue reflects flags as they land; always render fresh.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Flagged threads — Clever Support Agent",
  description: "Threads the support team flagged for review while beta-testing the assistant.",
};

export default async function FeedbackPage() {
  // Run the list + the dashboard roll-up concurrently.
  const [items, stats] = await Promise.all([listFeedback(), feedbackAnalytics()]);

  return (
    <main className="bg-white text-clever-black">
      <section className="relative overflow-hidden px-6 pt-16 pb-8">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-44 w-44 bg-clever-orange/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="inline-flex items-center gap-1.5 font-semibold text-clever-orange text-xs uppercase tracking-wider">
            <FlagIcon className="size-3.5" />
            Beta review queue
          </p>
          <h1 className="mt-1 font-normal text-4xl text-clever-navy leading-[1.05] sm:text-5xl">
            Flagged threads
          </h1>
          <p className="mt-4 max-w-xl text-clever-black/60 leading-relaxed">
            Threads the team flagged because the assistant got something wrong. Each
            one keeps the full transcript and the retrieval trail — confidence and
            sources — so you can see what the answer was based on and why it went off.
          </p>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-3xl space-y-6">
          {stats.total > 0 ? <AnalyticsDashboard stats={stats} /> : null}

          <p className="text-clever-black/40 text-sm">
            {items.length} {items.length === 1 ? "flagged thread" : "flagged threads"}
          </p>

          {items.length === 0 ? (
            <div className="rounded-xl border border-clever-light-blue bg-clever-light-blue/20 px-5 py-10 text-center">
              <SearchCheckIcon className="mx-auto size-6 text-clever-blue/50" />
              <p className="mt-3 font-medium text-clever-navy">Nothing flagged yet</p>
              <p className="mt-1 text-clever-black/50 text-sm">
                When a tester hits <span className="font-medium">Flag</span> on a thread
                that got something wrong, it shows up here.
              </p>
              <Link
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy"
                href="/"
              >
                Open the assistant
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-clever-light-blue/70 overflow-hidden rounded-xl border border-clever-light-blue">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    className="flex flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-clever-light-blue/30"
                    href={`/feedback/${item.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium text-[11px]",
                          reasonBadgeClass(item.reason),
                        )}
                      >
                        {reasonLabel(item.reason)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-clever-navy text-sm">
                        {item.title}
                      </span>
                      {item.topConfidence === "low" || item.topConfidence === "unscored" ? (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-clever-orange/10 px-2 py-0.5 font-medium text-[10px] text-clever-orange"
                          title="The best retrieval for this thread was weakly grounded"
                        >
                          <ShieldAlertIcon className="size-3" />
                          low confidence
                        </span>
                      ) : null}
                    </div>
                    {item.note ? (
                      <p className="line-clamp-2 text-clever-black/55 text-sm">{item.note}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-2 text-clever-black/40 text-xs">
                      <span>{formatFeedbackDate(item.createdAt)}</span>
                      {item.reporter ? <span>· {item.reporter}</span> : null}
                      {item.retrievalCount > 0 ? (
                        <span>
                          · {item.retrievalCount} retrieval{item.retrievalCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function AnalyticsDashboard({ stats }: { readonly stats: FeedbackAnalytics }) {
  const maxReason = Math.max(1, ...stats.byReason.map((r) => r.count));
  return (
    <div className="space-y-4 rounded-xl border border-clever-light-blue bg-clever-light-blue/15 p-4">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total flags" value={String(stats.total)} />
        <Stat label="Last 7 days" value={String(stats.last7Days)} />
        <Stat
          accent={stats.lowConfidenceCount > 0}
          label="Low-confidence"
          value={String(stats.lowConfidenceCount)}
        />
        <Stat
          icon={<CoinsIcon className="size-3 text-clever-blue/60" />}
          label="Avg thread cost"
          value={formatUsd(stats.avgCost)}
        />
      </div>

      {/* Reason breakdown */}
      {stats.byReason.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">
            By reason
          </p>
          <div className="space-y-1.5">
            {stats.byReason.map((r) => (
              <div className="flex items-center gap-2" key={r.reason}>
                <span className="w-32 shrink-0 truncate text-clever-navy/70 text-xs">
                  {reasonLabel(r.reason)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-clever-light-blue/60">
                  <span
                    className={cn("block h-full rounded-full", barColor(r.reason))}
                    style={{ width: `${Math.max(4, Math.round((r.count / maxReason) * 100))}%` }}
                  />
                </span>
                <span className="w-6 text-right text-clever-black/50 text-xs tabular-nums">
                  {r.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Top reporters */}
      {stats.topReporters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-clever-black/40">Top reporters:</span>
          {stats.topReporters.map((r) => (
            <span
              className="rounded-full bg-white px-2 py-0.5 text-clever-navy/70"
              key={r.reporter}
            >
              {r.reporter} · {r.count}
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
      <p
        className={cn(
          "mt-0.5 flex items-center gap-1 font-medium text-lg tabular-nums",
          accent ? "text-clever-orange" : "text-clever-navy",
        )}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}

function barColor(reason: string): string {
  switch (reason) {
    case "hallucination":
    case "wrong":
      return "bg-clever-orange";
    case "incomplete":
      return "bg-clever-yellow";
    case "bad-source":
      return "bg-clever-blue";
    default:
      return "bg-clever-navy/40";
  }
}
