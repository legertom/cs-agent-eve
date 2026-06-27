import type { EveMessage } from "eve/react";

// Shape of a flagged thread — saved when a support agent (in beta) hits "Flag
// this thread" because the assistant got something wrong (e.g. made something
// up). Kept free of server-only and client-only imports so the Flag button, the
// API route, and the /feedback pages can all import it.
//
// We freeze the whole picture an investigator needs: the transcript, the trust
// record (every retrieval's query, confidence, sources + reranker scores, cost),
// and the reporter's note — so "why did it make that up?" can be answered later
// without re-running anything.

export const FEEDBACK_REASONS = [
  { id: "hallucination", label: "Made something up", hint: "Stated facts that aren't in the sources" },
  { id: "wrong", label: "Wrong answer", hint: "Contradicts the help center" },
  { id: "incomplete", label: "Missing / incomplete", hint: "Left out key steps or caveats" },
  { id: "bad-source", label: "Wrong sources", hint: "Cited irrelevant or wrong articles" },
  { id: "other", label: "Something else", hint: "Anything else worth investigating" },
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["id"];

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return typeof value === "string" && FEEDBACK_REASONS.some((r) => r.id === value);
}

export function reasonLabel(id: string): string {
  return FEEDBACK_REASONS.find((r) => r.id === id)?.label ?? id;
}

// Tailwind classes for a reason badge — "made stuff up" / "wrong" read as the
// most serious, so they wear the orange alarm color. Shared by the review list
// and the detail page so the queue is scannable at a glance.
export function reasonBadgeClass(id: string): string {
  switch (id) {
    case "hallucination":
    case "wrong":
      return "border-clever-orange/50 bg-clever-orange/10 text-clever-orange";
    case "incomplete":
      return "border-clever-yellow/60 bg-clever-yellow/15 text-clever-navy";
    case "bad-source":
      return "border-clever-blue/40 bg-clever-blue/10 text-clever-blue";
    default:
      return "border-clever-light-blue bg-clever-light-blue/50 text-clever-navy";
  }
}

// Deterministic date format (fixed to UTC) so server and client render the same
// string — avoids hydration mismatches on the review pages.
export function formatFeedbackDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} UTC`;
}

// One captured retrieval ("show your work"), frozen at flag time. `output` is the
// raw search_support tool output — kept as `unknown` and guarded with
// isSupportSearchOutput at render time, exactly like the live trust panel does.
export type LoggedRetrieval = {
  readonly output: unknown;
  readonly inferenceCost?: number;
};

export type FeedbackPayload = {
  readonly v: 1;
  readonly kind: "feedback";
  readonly createdAt: string;
  // First user question — the human-readable title for the review list.
  readonly title: string;
  readonly reason: FeedbackReason;
  // The reporter's description of what went wrong (optional but encouraged).
  readonly note: string;
  // Who flagged it — beta testers on the support team. Optional, remembered locally.
  readonly reporter?: string;
  readonly persona: string;
  // True total spend (retrieval + answer inference) at flag time.
  readonly threadCost: number;
  readonly retrievalCount: number;
  // Per-message answer (LLM) cost, keyed by message id — inference cost isn't in
  // the messages themselves, so it's frozen here for the trust panels.
  readonly inferenceByMessageId?: Readonly<Record<string, number>>;
  readonly messages: readonly EveMessage[];
  // The trust record: every retrieval the thread ran, with confidence + sources.
  readonly retrievals: readonly LoggedRetrieval[];
};

// Slim summary for the review index — avoids shipping every full transcript.
export type FeedbackSummary = {
  readonly id: string;
  readonly createdAt: string;
  readonly title: string;
  readonly reason: string;
  readonly note: string;
  readonly reporter?: string;
  readonly retrievalCount: number;
};

// Bounds for the public, unauthenticated flag endpoint — one thread, not a dump.
export const MAX_FEEDBACK_MESSAGES = 200;
export const MAX_FEEDBACK_BYTES = 1_500_000; // ~1.5 MB serialized
export const MAX_NOTE_LENGTH = 4000;
export const MAX_REPORTER_LENGTH = 120;
