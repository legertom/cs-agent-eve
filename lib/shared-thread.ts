import type { EveMessage } from "eve/react";

// Shape of a persisted, read-only thread snapshot. Kept free of server-only
// imports so BOTH the client (the Share button) and the server (the API route
// and the /s/[id] page) can import it. The messages are the already-reduced eve
// messages — plain JSON, tool outputs + cost included — so the share view can
// re-render them with the same components as the live chat, with no eve runtime.
export type SharedThreadPayload = {
  readonly v: 1;
  readonly createdAt: string;
  readonly title: string;
  readonly persona: string;
  readonly threadCost: number;
  readonly retrievalCount: number;
  readonly messages: readonly EveMessage[];
};

// A share is one conversation, not a bulk dump — bound what we accept/persist.
export const MAX_SHARE_MESSAGES = 200;
export const MAX_SHARE_BYTES = 1_500_000; // ~1.5 MB serialized

// Best-effort human title: the first thing the user actually asked.
export function firstUserText(messages: readonly EveMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) {
        return part.text.trim().slice(0, 120);
      }
    }
  }
  return "Shared conversation";
}
