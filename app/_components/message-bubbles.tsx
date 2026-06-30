"use client";

import type { EveMessage } from "eve/react";
import { AgentMessage, type AgentInputResponse } from "./agent-message";

// Read-only chat-bubble replay of a reconstructed thread. AgentMessage is purely
// presentational, so logged turns render with the exact same bubble styling and
// answer formatting as the live chat (and the flagged-thread view) — no eve
// runtime, no input box. A thin client wrapper so a server page can render the
// bubbles without passing AgentMessage's (non-serializable) callback across the
// RSC boundary.
const NOOP = (_responses: readonly AgentInputResponse[]) => {};

export function MessageBubbles({ messages }: { readonly messages: readonly EveMessage[] }) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <AgentMessage
          canRespond={false}
          isStreaming={false}
          key={message.id}
          message={message}
          onInputResponses={NOOP}
        />
      ))}
    </div>
  );
}
