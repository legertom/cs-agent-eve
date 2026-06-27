"use client";

import { ArrowRightIcon, CoinsIcon, FlagIcon } from "lucide-react";
import Link from "next/link";
import {
  type FeedbackPayload,
  formatFeedbackDate,
  reasonBadgeClass,
  reasonLabel,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";
import type { AgentInputResponse } from "./agent-message";
import { AgentMessage } from "./agent-message";
import {
  formatRetrievalUsd,
  isSupportSearchOutput,
  SupportSearchPanel,
} from "./support-search-panel";

// Read-only investigation view for one flagged thread. Shows the reporter's note,
// the full transcript, and — crucially for "why did it make that up?" — every
// retrieval's trust panel (confidence band + ranked sources + reranker scores).
const NOOP = (_responses: readonly AgentInputResponse[]) => {};

export function FeedbackDetail({ payload }: { readonly payload: FeedbackPayload }) {
  const retrievals = payload.retrievals.filter((r) => isSupportSearchOutput(r.output));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Flag header — what was reported and by whom */}
          <div className="space-y-3 rounded-xl border border-clever-orange/30 bg-clever-orange/5 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-clever-orange text-sm">
                <FlagIcon className="size-3.5" />
                Flagged thread
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium text-xs",
                  reasonBadgeClass(payload.reason),
                )}
              >
                {reasonLabel(payload.reason)}
              </span>
              <Link
                className="ml-auto inline-flex items-center gap-1 text-clever-blue text-xs hover:text-clever-navy hover:underline"
                href="/feedback"
              >
                ← Review queue
              </Link>
            </div>

            <p className="font-medium text-clever-navy">{payload.title}</p>

            {payload.note ? (
              <div className="rounded-lg border border-clever-light-blue/70 bg-white px-3 py-2.5">
                <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">
                  Reporter note
                </p>
                <p className="mt-1 whitespace-pre-wrap text-clever-black/70 text-sm leading-relaxed">
                  {payload.note}
                </p>
              </div>
            ) : (
              <p className="text-clever-black/40 text-sm italic">No note left.</p>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-clever-black/45 text-xs">
              {payload.reporter ? (
                <span>
                  by <span className="font-medium text-clever-navy/70">{payload.reporter}</span>
                </span>
              ) : null}
              <span>{formatFeedbackDate(payload.createdAt)}</span>
              {payload.persona && payload.persona !== "anyone" ? (
                <span>· answering for {payload.persona}</span>
              ) : null}
              {payload.threadCost > 0 ? (
                <span className="inline-flex items-center gap-1">
                  · <CoinsIcon className="size-3 text-clever-blue/60" />
                  {formatRetrievalUsd(payload.threadCost)}
                </span>
              ) : null}
            </div>
          </div>

          {/* Transcript */}
          <div className="space-y-6">
            {payload.messages.map((message) => (
              <AgentMessage
                canRespond={false}
                isStreaming={false}
                key={message.id}
                message={message}
                onInputResponses={NOOP}
              />
            ))}
          </div>

          {/* The retrieval trail — what the answer was actually based on */}
          {retrievals.length > 0 ? (
            <div className="space-y-2">
              <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">
                What it retrieved ({retrievals.length})
              </p>
              {retrievals.map((r, i) =>
                isSupportSearchOutput(r.output) ? (
                  <SupportSearchPanel
                    inferenceCost={r.inferenceCost}
                    key={`${r.output.query ?? "retrieval"}-${i}`}
                    label={r.output.query || "Retrieval"}
                    output={r.output}
                  />
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-clever-black/40 text-sm">
              No searches were recorded for this thread — the answer may not have
              been grounded in a retrieval at all.
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <Link
              className="inline-flex items-center gap-1.5 text-clever-blue text-sm hover:text-clever-navy"
              href="/feedback"
            >
              ← All flagged threads
            </Link>
            <Link
              className="inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy"
              href="/"
            >
              Open the assistant
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
