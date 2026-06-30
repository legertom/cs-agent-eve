import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  Link2Icon,
  PencilIcon,
  RefreshCwIcon,
  RocketIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { formatFeedbackDate } from "@/lib/feedback";
import type { ArticleBrief, ChangelogEntry } from "@/lib/kb-types";
import { getKbStatus } from "@/lib/kb-status";
import { cn } from "@/lib/utils";

// The KB freshness data lives in Vercel Blob and changes daily — always render
// fresh so "last synced / last updated" are accurate.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Changelog — Clever Support Agent",
  description:
    "When the assistant last re-synced Clever's help center, when its knowledge last actually changed, and an AI-written log of every article added, removed, or updated.",
};

// Hand-maintained product changelog — what we SHIPPED to the app, distinct from
// the auto-generated knowledge-base freshness log below it (that tracks Clever
// help-center article changes). Add the newest entry to the top.
type ProductUpdate = {
  readonly date: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
};
const PRODUCT_UPDATES: readonly ProductUpdate[] = [
  {
    date: "June 30, 2026",
    title: "Inquiry Boundaries — new questions start clean",
    body:
      "Testers often stacked several unrelated questions into one chat instead of starting a new thread, so each new question inherited the previous one's topic and audience — polluting retrieval and the answer. Now the agent detects when a message opens a new, unrelated inquiry and drops the stale context (on web and Discord), the web chat nudges you to start a fresh thread when the topic shifts, and the Inquiries dashboard splits each session into its real, auto-titled inquiries.",
    tags: ["Agent", "Web", "Discord", "Analytics"],
  },
];

// Server-rendered relative time ("yesterday", "3 days ago"). The page is
// force-dynamic, so Date.now() is evaluated per request.
function relativeFromNow(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  return `${Math.floor(days / 30)} months ago`;
}

export default async function ChangelogPage() {
  const status = await getKbStatus();

  return (
    <main className="bg-white text-clever-black">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-16 pb-8">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-44 w-44 bg-clever-green/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="inline-flex items-center gap-1.5 font-semibold text-clever-blue text-xs uppercase tracking-wider">
            <RefreshCwIcon className="size-3.5" />
            Changelog
          </p>
          <h1 className="mt-1 font-normal text-4xl text-clever-navy leading-[1.05] sm:text-5xl">
            What&apos;s changed
          </h1>
          <p className="mt-4 max-w-xl text-clever-black/60 leading-relaxed">
            The assistant re-syncs Clever&apos;s help center every day. It only records an
            entry when the content actually changes — so a quiet week shows nothing new,
            and a fresh article shows up the day after it&apos;s published. Each note is
            written automatically.
          </p>
        </div>
      </section>

      {PRODUCT_UPDATES.length > 0 ? (
        <section className="px-6 pb-4">
          <div className="mx-auto max-w-3xl space-y-3">
            <p className="flex items-center gap-1.5 font-medium text-clever-black/40 text-xs uppercase tracking-wide">
              <RocketIcon className="size-3.5 text-clever-blue/70" />
              Product updates
            </p>
            <ol className="space-y-4">
              {PRODUCT_UPDATES.map((u) => (
                <ProductUpdateCard key={u.title} update={u} />
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-3xl space-y-6">
          <p className="flex items-center gap-1.5 border-clever-light-blue/70 border-t pt-6 font-medium text-clever-black/40 text-xs uppercase tracking-wide">
            <RefreshCwIcon className="size-3.5 text-clever-green/70" />
            Knowledge base freshness
          </p>
          {status.available ? (
            <>
              <FreshnessCards status={status} />
              {status.entries.length === 0 ? (
                <EmptyState />
              ) : (
                <ol className="space-y-4">
                  {status.entries.map((entry) => (
                    <EntryCard entry={entry} key={entry.at} />
                  ))}
                </ol>
              )}
            </>
          ) : (
            <Unavailable />
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              className="inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy"
              href="/browse"
            >
              Browse all articles <ArrowRightIcon className="size-4" />
            </Link>
            <Link
              className="inline-flex items-center gap-1.5 rounded-lg border border-clever-light-blue px-3 py-1.5 font-medium text-clever-navy text-sm transition-colors hover:border-clever-blue/40"
              href="/about"
            >
              How it works
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function ProductUpdateCard({ update }: { readonly update: ProductUpdate }) {
  return (
    <li className="rounded-xl border border-clever-light-blue bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-clever-navy">{update.title}</span>
        <span className="text-clever-black/40 text-xs">{update.date}</span>
      </div>
      <p className="mt-2 flex items-start gap-2 text-clever-black/80 leading-relaxed">
        <SparklesIcon className="mt-1 size-4 shrink-0 text-clever-blue/70" />
        <span>{update.body}</span>
      </p>
      {update.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {update.tags.map((tag) => (
            <span
              className="inline-flex items-center rounded-full bg-clever-blue/10 px-2 py-0.5 font-medium text-[11px] text-clever-blue"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function FreshnessCards({ status }: { readonly status: Awaited<ReturnType<typeof getKbStatus>> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <FreshnessCard
        icon={<RefreshCwIcon className="size-4 text-clever-blue" />}
        label="Last synced"
        primary={status.syncedAt ? relativeFromNow(status.syncedAt) : "—"}
        secondary={status.syncedAt ? formatFeedbackDate(status.syncedAt) : "never"}
      />
      <FreshnessCard
        accent
        icon={<PencilIcon className="size-4 text-clever-green" />}
        label="Last updated"
        primary={status.changedAt ? relativeFromNow(status.changedAt) : "—"}
        secondary={
          status.changedAt ? formatFeedbackDate(status.changedAt) : "no changes yet"
        }
      />
      <FreshnessCard
        icon={<BookOpenCheckIcon className="size-4 text-clever-navy" />}
        label="Articles indexed"
        primary={status.count != null ? String(status.count) : "—"}
        secondary="from support.clever.com"
      />
    </div>
  );
}

function FreshnessCard({
  icon,
  label,
  primary,
  secondary,
  accent,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly primary: string;
  readonly secondary: string;
  readonly accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-4",
        accent ? "border-clever-green/40 bg-clever-green/[0.04]" : "border-clever-light-blue",
      )}
    >
      <p className="flex items-center gap-1.5 text-clever-black/40 text-[11px] uppercase tracking-wide">
        {icon}
        {label}
      </p>
      <p className="mt-1.5 font-medium text-clever-navy text-xl">{primary}</p>
      <p className="mt-0.5 text-clever-black/45 text-xs">{secondary}</p>
    </div>
  );
}

function EntryCard({ entry }: { readonly entry: ChangelogEntry }) {
  const { added, removed, modified, counts } = entry;
  return (
    <li className="rounded-xl border border-clever-light-blue bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-clever-navy text-sm">
          {relativeFromNow(entry.at)}
        </span>
        <span className="text-clever-black/40 text-xs">{formatFeedbackDate(entry.at)}</span>
      </div>

      {/* AI-written note */}
      <p className="mt-2 flex items-start gap-2 text-clever-black/80 leading-relaxed">
        <SparklesIcon className="mt-1 size-4 shrink-0 text-clever-blue/70" />
        <span>{entry.summary}</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {counts.added > 0 ? (
          <CountChip className="bg-clever-green/10 text-clever-green" label={`+${counts.added} added`} />
        ) : null}
        {counts.removed > 0 ? (
          <CountChip className="bg-clever-orange/10 text-clever-orange" label={`−${counts.removed} removed`} />
        ) : null}
        {counts.modified > 0 ? (
          <CountChip className="bg-clever-blue/10 text-clever-blue" label={`~${counts.modified} updated`} />
        ) : null}
      </div>

      <ArticleList accent="green" articles={added} extra={counts.added - added.length} title="Added" />
      <ArticleList
        accent="orange"
        articles={removed}
        extra={counts.removed - removed.length}
        title="Removed"
      />
      <ArticleList
        accent="blue"
        articles={modified}
        extra={counts.modified - modified.length}
        title="Updated"
      />
    </li>
  );
}

function CountChip({ label, className }: { readonly label: string; readonly className: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[11px] tabular-nums",
        className,
      )}
    >
      {label}
    </span>
  );
}

function ArticleList({
  title,
  articles,
  extra,
  accent,
}: {
  readonly title: string;
  readonly articles: ArticleBrief[];
  readonly extra: number;
  readonly accent: "green" | "orange" | "blue";
}) {
  if (articles.length === 0) return null;
  const dot =
    accent === "green"
      ? "bg-clever-green"
      : accent === "orange"
        ? "bg-clever-orange"
        : "bg-clever-blue";
  const removed = accent === "orange";
  return (
    <div className="mt-3">
      <p className="mb-1 text-clever-black/40 text-[11px] uppercase tracking-wide">{title}</p>
      <ul className="space-y-1">
        {articles.map((a) => (
          <li className="flex items-start gap-2 text-sm" key={a.id}>
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dot)} />
            {removed ? (
              <span className="text-clever-black/55">{a.title || a.url}</span>
            ) : (
              <a
                className="inline-flex items-center gap-1 text-clever-navy hover:text-clever-blue hover:underline"
                href={a.url}
                rel="noreferrer"
                target="_blank"
              >
                {a.title || a.url}
                <Link2Icon className="size-3 shrink-0 text-clever-blue/50" />
              </a>
            )}
          </li>
        ))}
        {extra > 0 ? (
          <li className="text-clever-black/40 text-xs">+ {extra} more</li>
        ) : null}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-clever-light-blue bg-clever-light-blue/20 px-5 py-10 text-center">
      <BookOpenCheckIcon className="mx-auto size-6 text-clever-blue/50" />
      <p className="mt-3 font-medium text-clever-navy">No changes recorded yet</p>
      <p className="mt-1 text-clever-black/50 text-sm">
        The knowledge base is in sync. The next entry appears the first time the daily
        sync finds an added, removed, or updated article.
      </p>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="rounded-xl border border-clever-light-blue bg-clever-light-blue/20 px-5 py-10 text-center">
      <RefreshCwIcon className="mx-auto size-6 text-clever-blue/50" />
      <p className="mt-3 font-medium text-clever-navy">Changelog isn&apos;t available yet</p>
      <p className="mt-1 text-clever-black/50 text-sm">
        The first scheduled sync hasn&apos;t written its snapshot to storage yet. Check
        back after the daily refresh runs.
      </p>
    </div>
  );
}
