"use client";

import { ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { AUDIENCES, type AudienceId } from "@/lib/audience";
import { cn } from "@/lib/utils";

type Item = { title: string; url: string; audience: AudienceId };

const LABELS = Object.fromEntries(AUDIENCES.map((a) => [a.id, a.label])) as Record<
  AudienceId,
  string
>;

export function BrowseList({
  articles,
  counts,
}: {
  readonly articles: readonly Item[];
  readonly counts: Readonly<Record<AudienceId, number>>;
}) {
  const [audience, setAudience] = useState<AudienceId | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles
      .filter((a) => audience === "all" || a.audience === audience)
      .filter((a) => !q || a.title.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [articles, audience, query]);

  const activeBlurb =
    audience === "all" ? null : AUDIENCES.find((a) => a.id === audience)?.blurb;

  return (
    <div>
      {/* Audience filter */}
      <div className="flex flex-wrap gap-2">
        <Chip
          active={audience === "all"}
          count={articles.length}
          label="All"
          onClick={() => setAudience("all")}
        />
        {AUDIENCES.map((a) => (
          <Chip
            active={audience === a.id}
            count={counts[a.id] ?? 0}
            key={a.id}
            label={a.label}
            onClick={() => setAudience(a.id)}
          />
        ))}
      </div>
      {activeBlurb ? (
        <p className="mt-3 text-clever-black/50 text-sm">{activeBlurb}</p>
      ) : null}

      {/* Title filter */}
      <div className="relative mt-5">
        <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3.5 size-4 text-clever-black/40" />
        <input
          className="w-full rounded-xl border border-clever-light-blue bg-white py-3 pr-4 pl-10 text-clever-black placeholder:text-clever-black/40 focus:border-clever-blue focus:outline-none focus:ring-2 focus:ring-clever-blue/40"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title…"
          value={query}
        />
      </div>

      <p className="mt-4 mb-2 text-clever-black/40 text-sm">
        {filtered.length} {filtered.length === 1 ? "article" : "articles"}
      </p>

      {/* Results */}
      <ul className="divide-y divide-clever-light-blue/70 overflow-hidden rounded-xl border border-clever-light-blue">
        {filtered.map((a, i) => (
          <li key={`${a.url}-${i}`}>
            <a
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-clever-light-blue/30"
              href={a.url}
              rel="noreferrer"
              target="_blank"
            >
              <span className="min-w-0 flex-1 truncate text-clever-navy text-sm">{a.title}</span>
              <span className="hidden shrink-0 rounded-full bg-clever-light-blue/50 px-2.5 py-0.5 text-clever-navy/60 text-xs sm:inline">
                {LABELS[a.audience]}
              </span>
              <ExternalLinkIcon className="size-3.5 shrink-0 text-clever-black/30" />
            </a>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="px-4 py-8 text-center text-clever-black/40 text-sm">
            No articles match — try a different filter.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Chip({
  active,
  count,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly count: number;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium text-sm transition-colors",
        active
          ? "border-clever-blue bg-clever-blue text-white"
          : "border-clever-light-blue bg-white text-clever-navy hover:bg-clever-light-blue/40",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
          active ? "bg-white/20" : "bg-clever-light-blue/60 text-clever-black/50",
        )}
      >
        {count}
      </span>
    </button>
  );
}
