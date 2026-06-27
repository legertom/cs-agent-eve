"use client";

import type { EveMessage } from "eve/react";
import { CheckIcon, ChevronDownIcon, CopyIcon, SearchCheckIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatRetrievalUsd,
  isSupportSearchOutput,
  type SearchOutput,
  SupportSearchPanel,
} from "./support-search-panel";

// A single "Show your work" pinned at the bottom of the thread. It records every
// retrieval (query, sources, scores, confidence, per-call cost) and the answer
// (inference) cost, accumulating as the thread grows — so for testing you can
// see and export the complete picture rather than per-message fragments.

type Retrieval = {
  readonly key: string;
  readonly output: SearchOutput;
  readonly inferenceCost?: number;
};

type ThreadRecord = {
  readonly retrievals: ReadonlyArray<{
    readonly query?: string;
    readonly method?: string;
    readonly confidence?: SearchOutput["confidence"];
    readonly cost?: SearchOutput["cost"];
    readonly answerCost?: number;
    readonly results?: SearchOutput["results"];
  }>;
  readonly costs: { readonly retrieval: number; readonly answer: number; readonly total: number };
};

declare global {
  interface Window {
    __cleverThreadRecord?: ThreadRecord;
  }
}

export function ThreadWorkPanel({
  messages,
  inferenceByMessageId,
}: {
  readonly messages: readonly EveMessage[];
  readonly inferenceByMessageId?: Readonly<Record<string, number>>;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { retrievals, retrievalCost, inferenceCost, totalCost, record } = useMemo(() => {
    const found: Retrieval[] = [];
    let retrieval = 0;
    let inference = 0;
    // Inference is billed per TURN, but one turn can span multiple messages — a
    // tool/search message plus a follow-up, or a human-in-the-loop input request
    // ("which setup are you looking for?"). inferenceByMessageId stamps the turn's
    // full cost on EACH of those messages, so we must add it once per turnId;
    // summing per message double-counts the answer cost.
    const countedTurns = new Set<string>();
    for (const message of messages) {
      const turnId = message.metadata?.turnId;
      const messageInference = inferenceByMessageId?.[message.id] ?? 0;
      if (turnId) {
        if (!countedTurns.has(turnId)) {
          inference += messageInference;
          countedTurns.add(turnId);
        }
      } else {
        inference += messageInference;
      }
      for (const part of message.parts) {
        if (
          part.type === "dynamic-tool" &&
          part.toolName === "search_support" &&
          isSupportSearchOutput(part.output)
        ) {
          found.push({
            key: part.toolCallId,
            output: part.output,
            inferenceCost: inferenceByMessageId?.[message.id],
          });
          retrieval += part.output.cost?.total ?? 0;
        }
      }
    }
    const total = retrieval + inference;
    const rec: ThreadRecord = {
      retrievals: found.map((r) => ({
        query: r.output.query,
        method: r.output.method,
        confidence: r.output.confidence,
        cost: r.output.cost,
        answerCost: r.inferenceCost,
        results: r.output.results,
      })),
      costs: { retrieval, answer: inference, total },
    };
    return {
      retrievals: found,
      retrievalCost: retrieval,
      inferenceCost: inference,
      totalCost: total,
      record: rec,
    };
  }, [messages, inferenceByMessageId]);

  // Expose the full record for test scripts (e.g. Playwright) to read.
  useEffect(() => {
    window.__cleverThreadRecord = record;
  }, [record]);

  if (retrievals.length === 0) return null;

  const copyRecord = () => {
    void navigator.clipboard
      .writeText(JSON.stringify(record, null, 2))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div className="not-prose w-full overflow-hidden rounded-lg border border-clever-light-blue/60 bg-white">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-clever-light-blue/20"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <SearchCheckIcon className="size-3.5 shrink-0 text-clever-blue/60" />
        <span className="font-medium text-clever-navy/70 text-xs">Show your work</span>
        <span className="text-[11px] text-clever-black/35">
          · {retrievals.length} search{retrievals.length === 1 ? "" : "es"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-clever-light-blue/40 px-2 py-0.5 font-medium text-[11px] text-clever-black/55 tabular-nums">
            {formatRetrievalUsd(totalCost)}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-clever-black/35 transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-clever-light-blue/60 border-t px-3 py-3">
          {/* Thread cost summary + export the full record for testing */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-clever-black/50">
              total <span className="font-medium text-clever-navy tabular-nums">{formatRetrievalUsd(totalCost)}</span>
              <span className="text-clever-black/35">
                {" "}
                · answer {formatRetrievalUsd(inferenceCost)} · retrieval {formatRetrievalUsd(retrievalCost)}
              </span>
            </span>
            <button
              className="inline-flex items-center gap-1 rounded-md border border-clever-light-blue px-2 py-1 font-medium text-clever-navy/70 transition-colors hover:bg-clever-light-blue/30"
              onClick={copyRecord}
              type="button"
            >
              {copied ? (
                <CheckIcon className="size-3 text-clever-green" />
              ) : (
                <CopyIcon className="size-3" />
              )}
              {copied ? "Copied" : "Copy record"}
            </button>
          </div>

          {/* Every retrieval in the thread, newest at the bottom (thread order) */}
          <div className="space-y-2">
            {retrievals.map((r) => (
              <SupportSearchPanel
                inferenceCost={r.inferenceCost}
                key={r.key}
                label={r.output.query || "Retrieval"}
                output={r.output}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
