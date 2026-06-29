"use client";

import type { EveMessage } from "eve/react";
import { FlagIcon } from "lucide-react";
import { useState } from "react";
import { FeedbackForm } from "./feedback-form";

// "Flag this thread" for a reconstructed inquiry conversation. Reuses the exact
// same form + /api/feedback queue as the live-chat flag, so a thread flagged
// from the inquiries log lands in the team's review queue alongside the rest.
export function InquiryFlag({
  messages,
  threadCost,
  retrievalCount,
  persona,
}: {
  readonly messages: readonly EveMessage[];
  readonly threadCost: number;
  readonly retrievalCount: number;
  readonly persona: string;
}) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <FeedbackForm
        inferenceByMessageId={{}}
        messages={messages}
        onClose={() => setOpen(false)}
        persona={persona}
        retrievalCount={retrievalCount}
        threadCost={threadCost}
      />
    );
  }

  return (
    <button
      className="inline-flex items-center gap-1.5 rounded-lg border border-clever-orange/40 bg-clever-orange/5 px-3 py-1.5 font-medium text-clever-orange text-sm transition-colors hover:bg-clever-orange/10"
      onClick={() => setOpen(true)}
      type="button"
    >
      <FlagIcon className="size-3.5" />
      Flag this thread
    </button>
  );
}
