"use client";

import { ArrowRightIcon, CoinsIcon } from "lucide-react";
import Link from "next/link";
import type { AgentInputResponse } from "./agent-message";
import { AgentMessage } from "./agent-message";
import { formatRetrievalUsd } from "./support-search-panel";
import type { SharedThreadPayload } from "@/lib/shared-thread";

// Read-only replay of a shared thread. AgentMessage is purely presentational, so
// the saved messages render with the exact same answer formatting, trust panels,
// and per-retrieval cost as the live chat — no eve runtime, no input box.
const NOOP = (_responses: readonly AgentInputResponse[]) => {};

export function SharedThread({ payload }: { readonly payload: SharedThreadPayload }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Read-only banner + CTA back into the live assistant */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-clever-light-blue bg-clever-light-blue/30 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium text-clever-navy text-sm">Shared conversation · read-only</p>
              <p className="truncate text-clever-black/50 text-xs">{payload.title}</p>
            </div>
            <div className="flex items-center gap-2">
              {payload.retrievalCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-lg border border-clever-light-blue bg-white px-3 py-1.5 text-clever-navy text-sm"
                  title={`${payload.retrievalCount} retrieval${payload.retrievalCount === 1 ? "" : "s"} via Vercel AI Gateway`}
                >
                  <CoinsIcon className="size-3.5 text-clever-blue" />
                  <span className="font-medium tabular-nums">
                    {formatRetrievalUsd(payload.threadCost)}
                  </span>
                  <span className="text-clever-black/40">
                    · {payload.retrievalCount} retrieval{payload.retrievalCount === 1 ? "" : "s"}
                  </span>
                </span>
              ) : null}
              <Link
                className="inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy"
                href="/"
              >
                Ask your own question
                <ArrowRightIcon className="size-3.5" />
              </Link>
            </div>
          </div>

          {payload.messages.map((message) => (
            <AgentMessage
              canRespond={false}
              isStreaming={false}
              key={message.id}
              message={message}
              onInputResponses={NOOP}
            />
          ))}

          <p className="pt-2 text-center text-clever-black/40 text-xs">
            Shared from the Clever Support Assistant · answers are generated from
            Clever help-center articles. Always verify critical details.
          </p>
        </div>
      </main>
    </div>
  );
}
