import { CoinsIcon, MessageSquareIcon, SearchCheckIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { formatFeedbackDate, formatUsd } from "@/lib/feedback";
import {
  type InquiryAnalytics,
  type InquirySummary,
  inquiryAnalytics,
  listInquiries,
} from "@/lib/inquiry-store";
import { cn } from "@/lib/utils";

// Every turn lands here as it happens; always render fresh.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Inquiries — Clever Support Assistant",
  description: "Every question asked of the assistant, with retrieval confidence and cost.",
};

export default async function InquiriesPage() {
  const [items, stats] = await Promise.all([listInquiries(), inquiryAnalytics()]);

  return (
    <main className="bg-white text-clever-black">
      <section className="relative overflow-hidden px-6 pt-16 pb-8">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-44 w-44 bg-clever-blue/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="inline-flex items-center gap-1.5 font-semibold text-clever-blue text-xs uppercase tracking-wider">
            <MessageSquareIcon className="size-3.5" />
            Usage analytics
          </p>
          <h1 className="mt-1 font-normal text-4xl text-clever-navy leading-[1.05] sm:text-5xl">
            Inquiries
          </h1>
          <p className="mt-4 max-w-xl text-clever-black/60 leading-relaxed">
            Every question asked of the assistant — not just the flagged ones. This is
            the denominator: how much we're answering, how well it's grounded, and what
            it costs. Flags tell you what went wrong; this tells you how often.
          </p>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-3xl space-y-6">
          {stats.total > 0 ? <AnalyticsDashboard stats={stats} /> : null}

          <p className="text-clever-black/40 text-sm">
            {items.length} {items.length === 1 ? "inquiry" : "inquiries"} (most recent)
          </p>

          {items.length === 0 ? (
            <div className="rounded-xl border border-clever-light-blue bg-clever-light-blue/20 px-5 py-10 text-center">
              <SearchCheckIcon className="mx-auto size-6 text-clever-blue/50" />
              <p className="mt-3 font-medium text-clever-navy">No inquiries logged yet</p>
              <p className="mt-1 text-clever-black/50 text-sm">
                Every turn is logged automatically as testers chat. Ask the assistant a
                question and it'll show up here.
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
                <InquiryRow item={item} key={`${item.sessionId}:${item.turnId}`} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function InquiryRow({ item }: { readonly item: InquirySummary }) {
  const weak = item.searchCount > 0 && (item.topConfidence === "low" || item.topConfidence === "unscored");
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-clever-navy text-sm">
          {item.question || "(no question captured)"}
        </span>
        {weak ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-clever-orange/10 px-2 py-0.5 font-medium text-[10px] text-clever-orange"
            title="Answered with weak grounding (best retrieval was low/unscored)"
          >
            <ShieldAlertIcon className="size-3" />
            low confidence
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-clever-light-blue/40 px-2 py-0.5 font-medium text-[11px] text-clever-black/55 tabular-nums">
          <CoinsIcon className="size-3 text-clever-blue/60" />
          {formatUsd(item.totalCost)}
        </span>
      </div>
      {item.answer ? (
        <p className="line-clamp-2 text-clever-black/55 text-sm">{item.answer}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 text-clever-black/40 text-xs">
        <span>{formatFeedbackDate(item.createdAt)}</span>
        <span>· {channelLabel(item.channel)}</span>
        <span>
          ·{" "}
          {item.searchCount === 0
            ? "no search"
            : `${item.searchCount} search${item.searchCount === 1 ? "" : "es"}`}
        </span>
        {item.searchCount > 0 ? <span>· {item.topConfidence} confidence</span> : null}
      </div>
    </li>
  );
}

function AnalyticsDashboard({ stats }: { readonly stats: InquiryAnalytics }) {
  const maxChannel = Math.max(1, ...stats.byChannel.map((c) => c.count));
  return (
    <div className="space-y-4 rounded-xl border border-clever-light-blue bg-clever-light-blue/15 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total inquiries" value={String(stats.total)} />
        <Stat label="Last 7 days" value={String(stats.last7Days)} />
        <Stat
          accent={stats.lowConfidenceCount > 0}
          label="Low-confidence"
          value={String(stats.lowConfidenceCount)}
        />
        <Stat
          icon={<CoinsIcon className="size-3 text-clever-blue/60" />}
          label="Avg cost"
          value={formatUsd(stats.avgCost)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <Stat
          icon={<CoinsIcon className="size-3 text-clever-blue/60" />}
          label="Total spend"
          value={formatUsd(stats.totalCost)}
        />
        <Stat label="No-search turns" value={String(stats.noSearchCount)} />
      </div>

      {stats.byChannel.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">
            By channel
          </p>
          <div className="space-y-1.5">
            {stats.byChannel.map((c) => (
              <div className="flex items-center gap-2" key={c.channel}>
                <span className="w-20 shrink-0 truncate text-clever-navy/70 text-xs">
                  {channelLabel(c.channel)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-clever-light-blue/60">
                  <span
                    className="block h-full rounded-full bg-clever-blue"
                    style={{ width: `${Math.max(4, Math.round((c.count / maxChannel) * 100))}%` }}
                  />
                </span>
                <span className="w-6 text-right text-clever-black/50 text-xs tabular-nums">
                  {c.count}
                </span>
              </div>
            ))}
          </div>
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

// "channel:eve" → "Web", "channel:discord" → "Discord", else best-effort.
function channelLabel(kind: string): string {
  const k = kind.replace(/^channel:/, "");
  if (k === "eve") return "Web";
  if (!k || k === "unknown") return "Unknown";
  return k.charAt(0).toUpperCase() + k.slice(1);
}
