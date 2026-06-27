"use client";

import {
  ChevronDownIcon,
  CoinsIcon,
  ExternalLinkIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// "Show your work" trust panel — renders the search_support tool result inline
// so a support agent (and a hackathon judge) can SEE how the answer was found:
// the retrieval pipeline, a calibrated confidence band, and the exact ranked
// sources with their reranker scores. Reads the output shape produced by
// agent/tools/search_support.ts.

type ConfidenceLevel = "high" | "medium" | "low" | "unscored";

type SearchResult = {
  rank: number;
  title?: string;
  url: string;
  excerpt: string;
  score: number | null;
};

type RetrievalCost = {
  total?: number;
  embedding?: number;
  rerank?: number;
  embeddingTokens?: number;
  rerankDocs?: number;
  models?: { embedding?: string; rerank?: string };
};

type SearchOutput = {
  query?: string;
  count?: number;
  method?: string;
  confidence?: {
    level?: ConfidenceLevel;
    topScore?: number | null;
    margin?: number | null;
    scored?: boolean;
  };
  cost?: RetrievalCost;
  results?: SearchResult[];
  error?: string;
};

// Type guard so we only divert known-good search results to this panel.
export function isSupportSearchOutput(output: unknown): output is SearchOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    Array.isArray((output as SearchOutput).results)
  );
}

// Format a tiny USD amount honestly: retrieval costs sit well below a cent, so
// fall back to "<$0.0001" rather than rounding a real charge down to "$0.00".
export function formatRetrievalUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0";
  if (n < 0.0001) return "<$0.0001";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// Pull this retrieval's billed cost out of a tool output, for the thread total.
export function retrievalCostTotal(output: unknown): number | null {
  if (!isSupportSearchOutput(output)) return null;
  const total = output.cost?.total;
  return typeof total === "number" ? total : null;
}

const LEVEL_META: Record<
  ConfidenceLevel,
  { label: string; dot: string; pill: string; bar: string }
> = {
  high: {
    label: "High confidence",
    dot: "bg-clever-green",
    pill: "border-clever-green/40 bg-clever-green/10 text-clever-navy",
    bar: "bg-clever-green",
  },
  medium: {
    label: "Medium confidence",
    dot: "bg-clever-yellow",
    pill: "border-clever-yellow/60 bg-clever-yellow/15 text-clever-navy",
    bar: "bg-clever-yellow",
  },
  low: {
    label: "Low confidence — verify",
    dot: "bg-clever-orange",
    pill: "border-clever-orange/50 bg-clever-orange/10 text-clever-navy",
    bar: "bg-clever-orange",
  },
  unscored: {
    label: "Unscored",
    dot: "bg-clever-black/30",
    pill: "border-clever-light-blue bg-clever-light-blue/40 text-clever-black/60",
    bar: "bg-clever-black/30",
  },
};

const pct = (n: number | null | undefined) =>
  n == null ? null : `${Math.round(n * 100)}%`;

export function SupportSearchPanel({ output }: { readonly output: SearchOutput }) {
  // Collapsed by default — this lives at the bottom of the answer as optional
  // "proof", not something the reader has to scroll past to get to the answer.
  const [open, setOpen] = useState(false);
  const results = output.results ?? [];
  const confidence = output.confidence;
  const level: ConfidenceLevel = confidence?.level ?? "unscored";
  const meta = LEVEL_META[level];
  const topScore = confidence?.topScore ?? null;
  const reranked = output.method === "hybrid+rerank";
  const cost = output.cost;

  return (
    <div className="not-prose w-full overflow-hidden rounded-xl border border-clever-light-blue bg-white">
      {/* Header doubles as the toggle; the cost stays visible even when closed. */}
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-clever-light-blue/30 px-4 py-2.5 text-left transition-colors hover:bg-clever-light-blue/50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <SearchCheckIcon className="size-4 shrink-0 text-clever-blue" />
        <span className="font-medium text-clever-navy text-sm">Show your work</span>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
        <span className="ml-auto flex items-center gap-2">
          {cost?.total != null ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-clever-light-blue bg-white px-2 py-0.5 font-medium text-clever-navy text-xs tabular-nums">
              <CoinsIcon className="size-3 text-clever-blue/70" />
              {formatRetrievalUsd(cost.total)}
            </span>
          ) : null}
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-clever-black/40 transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {open ? (
        <div className="space-y-4 border-clever-light-blue border-t px-4 py-3.5">
          {/* Confidence band */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs",
                  meta.pill,
                )}
              >
                <ShieldCheckIcon className="size-3.5" />
                {meta.label}
              </span>
              {pct(topScore) ? (
                <span className="text-clever-black/50 text-xs">
                  top match <span className="font-medium text-clever-navy">{pct(topScore)}</span>
                  {pct(confidence?.margin) ? (
                    <span className="text-clever-black/40">
                      {" "}
                      · leads #2 by {pct(confidence?.margin)}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-clever-light-blue bg-white px-2.5 py-0.5 font-medium text-clever-blue text-xs">
                {reranked ? "hybrid + rerank" : (output.method ?? "search")}
              </span>
            </div>
            {topScore != null ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-clever-light-blue/60">
                <div
                  className={cn("h-full rounded-full", meta.bar)}
                  style={{ width: `${Math.max(4, Math.round(topScore * 100))}%` }}
                />
              </div>
            ) : null}
          </div>

          {/* Pipeline — the AI Gateway multi-provider flex */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-clever-black/45">
            <Stage>BM25</Stage>
            <span aria-hidden>+</span>
            <Stage>embeddings</Stage>
            <Arrow />
            <Stage>RRF fusion</Stage>
            <Arrow />
            <Stage>Cohere rerank</Stage>
            <span className="ml-1 rounded-full bg-clever-navy/5 px-2 py-0.5 text-clever-navy/60">
              via Vercel AI Gateway
            </span>
          </div>

          {/* Sources */}
          {results.length > 0 ? (
            <div className="space-y-1.5">
              <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">
                {results.length} source{results.length === 1 ? "" : "s"}
              </p>
              <ol className="space-y-1.5">
                {results.map((r) => (
                  <SourceRow barClass={meta.bar} key={r.url} result={r} />
                ))}
              </ol>
            </div>
          ) : output.error ? (
            <p className="text-clever-orange text-sm">{output.error}</p>
          ) : null}

          {/* Cost — itemized for this single retrieval */}
          {cost ? <CostBreakdown cost={cost} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function CostBreakdown({ cost }: { readonly cost: RetrievalCost }) {
  return (
    <div className="space-y-1.5 border-clever-light-blue/70 border-t pt-3">
      <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">
        Retrieval cost
      </p>
      <div className="space-y-1 text-xs">
        <CostRow
          label="Query embedding"
          model={cost.models?.embedding}
          note={cost.embeddingTokens != null ? `${cost.embeddingTokens} tok` : undefined}
          value={formatRetrievalUsd(cost.embedding)}
        />
        <CostRow
          label="Rerank"
          model={cost.models?.rerank}
          note={cost.rerankDocs ? `${cost.rerankDocs} docs` : undefined}
          value={formatRetrievalUsd(cost.rerank)}
        />
        <div className="flex items-center justify-between border-clever-light-blue/70 border-t pt-1.5 font-medium text-clever-navy">
          <span>This retrieval</span>
          <span className="tabular-nums">{formatRetrievalUsd(cost.total)}</span>
        </div>
      </div>
    </div>
  );
}

function CostRow({
  label,
  model,
  note,
  value,
}: {
  readonly label: string;
  readonly model?: string;
  readonly note?: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-clever-black/50">
      <span className="min-w-0 truncate">
        {label}
        {model ? <span className="text-clever-black/30"> · {model}</span> : null}
        {note ? <span className="text-clever-black/30"> · {note}</span> : null}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

function Stage({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="rounded bg-clever-light-blue/50 px-1.5 py-0.5 text-clever-navy/70">
      {children}
    </span>
  );
}

function Arrow() {
  return <span aria-hidden>→</span>;
}

function SourceRow({
  barClass,
  result,
}: {
  readonly barClass: string;
  readonly result: SearchResult;
}) {
  const [open, setOpen] = useState(false);
  const scorePct = result.score == null ? null : Math.round(result.score * 100);

  return (
    <li className="rounded-lg border border-clever-light-blue/70 bg-clever-light-blue/15">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-clever-blue/10 font-medium text-[11px] text-clever-blue">
          {result.rank}
        </span>
        <a
          className="min-w-0 flex-1 truncate font-medium text-clever-navy text-sm hover:text-clever-blue hover:underline"
          href={result.url}
          rel="noreferrer"
          target="_blank"
          title={result.title ?? result.url}
        >
          {result.title ?? result.url}
        </a>
        <ExternalLinkIcon className="size-3 shrink-0 text-clever-black/30" />
        {scorePct != null ? (
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="h-1 w-12 overflow-hidden rounded-full bg-clever-light-blue/70">
              <span
                className={cn("block h-full rounded-full", barClass)}
                style={{ width: `${Math.max(4, scorePct)}%` }}
              />
            </span>
            <span className="w-8 text-right font-medium text-[11px] text-clever-black/50 tabular-nums">
              {scorePct}%
            </span>
          </span>
        ) : null}
        <button
          aria-label={open ? "Hide excerpt" : "Show excerpt"}
          className="shrink-0 rounded p-0.5 text-clever-black/40 transition-colors hover:bg-clever-light-blue/60 hover:text-clever-navy"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          <ChevronDownIcon
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>
      {open ? (
        <p className="border-clever-light-blue/70 border-t px-2.5 py-2 text-clever-black/60 text-xs leading-relaxed">
          {result.excerpt}
        </p>
      ) : null}
    </li>
  );
}
