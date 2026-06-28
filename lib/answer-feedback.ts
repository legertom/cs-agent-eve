// Answer-level feedback vocabulary — the per-answer analog of lib/feedback.ts
// (which is thread-level). Kept pure and free of server-only AND client-only
// imports so the footer controls (a "use client" component), the API route, and
// the store can all share these types + validators.
//
// Three kinds of signal, all keyed to a single assistant answer:
//   up   — thumbs up
//   down — thumbs down (with an optional FeedbackReason + note)
//   edit — an expert's inline correction ("this is what I'd actually send")
// They correlate to the already-logged inquiry by (sessionId, turnId) and to the
// specific chat answer by messageId. See lib/inquiry-store.ts for the inquiry row.

export const ANSWER_FEEDBACK_KINDS = ["up", "down", "edit"] as const;
export type AnswerFeedbackKind = (typeof ANSWER_FEEDBACK_KINDS)[number];

export function isAnswerFeedbackKind(value: unknown): value is AnswerFeedbackKind {
  return typeof value === "string" && (ANSWER_FEEDBACK_KINDS as readonly string[]).includes(value);
}

// The correlation keys come from the eve client/runtime (sessionId, turnId) and
// the chat message id — not free user text — but they're echoed back through a
// public POST, so constrain them to a safe charset. turnId looks like "turn_0";
// a messageId may carry other safe punctuation (":", "."), hence a wider set than
// flagged_threads' ID_RE.
export const ANSWER_FEEDBACK_ID_RE = /^[A-Za-z0-9_\-:.]{1,128}$/;

export function isAnswerFeedbackId(value: unknown): value is string {
  return typeof value === "string" && ANSWER_FEEDBACK_ID_RE.test(value);
}

// An original/edited answer is one chat answer, not a transcript dump — bound it.
export const MAX_ANSWER_LENGTH = 20_000;

// Bound the public, unauthenticated endpoint's body — one answer + a short note,
// not a bulk upload. Generous headroom over two MAX_ANSWER_LENGTH bodies.
export const MAX_ANSWER_FEEDBACK_BYTES = 200_000;
