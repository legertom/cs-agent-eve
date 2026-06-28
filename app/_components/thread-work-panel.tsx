"use client";

import type { EveMessage } from "eve/react";
import { CheckIcon, ChevronDownIcon, CopyIcon, SearchCheckIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  AnswerOnlyPanel,
  formatRetrievalUsd,
  isSupportSearchOutput,
  type SearchOutput,
  SupportSearchPanel,
} from "./support-search-panel";

// A single "Show your work" pinned at the bottom of the thread. It itemizes the
// whole thread by TURN — every turn that cost money gets its own row, whether it
// ran a help-center search or only inference (a clarifying question / HITL input
// request, or a direct answer). Because the headline total and the rows are both
// summed over the same turns, the rows always reconcile with the total — no step
// is folded into the total but hidden from the breakdown.

type TurnSearch = {
  readonly key: string;
  readonly output: SearchOutput;
};

type TurnEntry = {
  readonly key: string;
  // "search": ran ≥1 help-center search. "clarify": asked a HITL input request.
  // "answer": answered with no retrieval.
  readonly kind: "search" | "clarify" | "answer";
  readonly inferenceCost: number;
  readonly retrievalCost: number;
  readonly searches: readonly TurnSearch[];
  readonly clarifyPrompt?: string;
  readonly clarifyResponse?: string;
};

type ThreadRecord = {
  readonly turns: ReadonlyArray<{
    readonly kind: TurnEntry["kind"];
    readonly answerCost: number;
    readonly retrievalCost: number;
    readonly totalCost: number;
    readonly prompt?: string;
    readonly response?: string;
    readonly searches: ReadonlyArray<{
      readonly query?: string;
      readonly method?: string;
      readonly confidence?: SearchOutput["confidence"];
      readonly cost?: SearchOutput["cost"];
      readonly results?: SearchOutput["results"];
    }>;
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

  const { turns, retrievalCost, inferenceCost, totalCost, searchCount, record } = useMemo(() => {
    // Group every message into its turn. Inference is billed per TURN, but one
    // turn can span multiple messages (a tool/search message plus the answer, or
    // an input-request message). inferenceByMessageId stamps the turn's full cost
    // on EACH message, so we add it once per turnId; messages without a turnId
    // (rare) each count on their own.
    const order: string[] = [];
    const map = new Map<
      string,
      {
        inference: number;
        searches: TurnSearch[];
        hasInputRequest: boolean;
        clarifyPrompt?: string;
        clarifyResponse?: string;
      }
    >();
    const ensure = (key: string) => {
      let entry = map.get(key);
      if (!entry) {
        entry = { inference: 0, searches: [], hasInputRequest: false };
        map.set(key, entry);
        order.push(key);
      }
      return entry;
    };

    const countedTurns = new Set<string>();
    for (const message of messages) {
      const turnId = message.metadata?.turnId;
      const key = turnId ?? `msg:${message.id}`;
      const entry = ensure(key);
      const messageInference = inferenceByMessageId?.[message.id] ?? 0;
      if (turnId) {
        if (!countedTurns.has(turnId)) {
          entry.inference += messageInference;
          countedTurns.add(turnId);
        }
      } else {
        entry.inference += messageInference;
      }
      for (const part of message.parts) {
        if (part.type !== "dynamic-tool") continue;
        if (part.toolName === "search_support" && isSupportSearchOutput(part.output)) {
          entry.searches.push({ key: part.toolCallId, output: part.output });
        }
        // A clarifying question (human-in-the-loop input request) — label the turn
        // and capture the prompt + the user's choice for the record.
        const inputRequest = part.toolMetadata?.eve?.inputRequest;
        if (inputRequest) {
          entry.hasInputRequest = true;
          entry.clarifyPrompt = inputRequest.prompt ?? entry.clarifyPrompt;
          const response = part.toolMetadata?.eve?.inputResponse;
          if (response) {
            const option = inputRequest.options?.find((o) => o.id === response.optionId);
            entry.clarifyResponse =
              option?.label ?? response.text ?? response.optionId ?? entry.clarifyResponse;
          }
        }
      }
    }

    const built: TurnEntry[] = [];
    let retrieval = 0;
    let inference = 0;
    let searches = 0;
    for (const key of order) {
      const entry = map.get(key);
      if (!entry) continue;
      const turnRetrieval = entry.searches.reduce((sum, s) => sum + (s.output.cost?.total ?? 0), 0);
      retrieval += turnRetrieval;
      inference += entry.inference;
      searches += entry.searches.length;
      // Drop turns with nothing to show (e.g. a bare user message: no search, no
      // inference, no input request) so the breakdown stays honest and uncluttered.
      if (entry.searches.length === 0 && entry.inference === 0 && !entry.hasInputRequest) {
        continue;
      }
      const kind: TurnEntry["kind"] =
        entry.searches.length > 0 ? "search" : entry.hasInputRequest ? "clarify" : "answer";
      built.push({
        key,
        kind,
        inferenceCost: entry.inference,
        retrievalCost: turnRetrieval,
        searches: entry.searches,
        clarifyPrompt: entry.clarifyPrompt,
        clarifyResponse: entry.clarifyResponse,
      });
    }
    const total = retrieval + inference;

    const rec: ThreadRecord = {
      turns: built.map((t) => ({
        kind: t.kind,
        answerCost: t.inferenceCost,
        retrievalCost: t.retrievalCost,
        totalCost: t.inferenceCost + t.retrievalCost,
        prompt: t.clarifyPrompt,
        response: t.clarifyResponse,
        searches: t.searches.map((s) => ({
          query: s.output.query,
          method: s.output.method,
          confidence: s.output.confidence,
          cost: s.output.cost,
          results: s.output.results,
        })),
      })),
      costs: { retrieval, answer: inference, total },
    };

    return {
      turns: built,
      retrievalCost: retrieval,
      inferenceCost: inference,
      totalCost: total,
      searchCount: searches,
      record: rec,
    };
  }, [messages, inferenceByMessageId]);

  // Expose the full record for test scripts (e.g. Playwright) to read.
  useEffect(() => {
    window.__cleverThreadRecord = record;
  }, [record]);

  if (turns.length === 0) return null;

  const copyRecord = () => {
    void navigator.clipboard
      .writeText(JSON.stringify(record, null, 2))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  // Headline subtitle: "N steps" — and when every step ran a search, the friendlier
  // "N searches". The two only diverge when a turn answered without searching.
  const allSearches = searchCount === turns.length;
  const countLabel = allSearches
    ? `${searchCount} search${searchCount === 1 ? "" : "es"}`
    : `${turns.length} step${turns.length === 1 ? "" : "s"}`;

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
        <span className="text-[11px] text-clever-black/35">· {countLabel}</span>
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

          {/* Every billed turn in the thread, in thread order (newest at the bottom).
              Search turns render the trust panel; no-search turns (clarifying
              questions / direct answers) render their answer-only cost so the rows
              sum to the headline total. */}
          <div className="space-y-2">
            {turns.map((turn) => {
              if (turn.kind === "search") {
                return turn.searches.map((s, i) => (
                  <SupportSearchPanel
                    // The answer cost is a whole-turn cost — attribute it once (to
                    // the turn's first search) so a multi-search turn can't
                    // double-count it across panels.
                    inferenceCost={i === 0 ? turn.inferenceCost : undefined}
                    key={s.key}
                    label={s.output.query || "Retrieval"}
                    output={s.output}
                  />
                ));
              }
              const subtitle =
                turn.kind === "clarify"
                  ? [
                      turn.clarifyPrompt,
                      turn.clarifyResponse ? `you chose "${turn.clarifyResponse}"` : null,
                    ]
                      .filter(Boolean)
                      .join(" — ") || undefined
                  : undefined;
              return (
                <AnswerOnlyPanel
                  inferenceCost={turn.inferenceCost}
                  key={turn.key}
                  kind={turn.kind === "clarify" ? "clarify" : "answer"}
                  label={turn.kind === "clarify" ? "Clarifying question" : "Answer (no retrieval)"}
                  subtitle={subtitle}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
