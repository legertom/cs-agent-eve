import { NextResponse } from "next/server";
import {
  type AnswerFeedbackKind,
  isAnswerFeedbackId,
  isAnswerFeedbackKind,
  MAX_ANSWER_FEEDBACK_BYTES,
  MAX_ANSWER_LENGTH,
} from "@/lib/answer-feedback";
import { saveAnswerFeedback } from "@/lib/answer-feedback-store";
import { isFeedbackReason, MAX_NOTE_LENGTH, MAX_REPORTER_LENGTH } from "@/lib/feedback";

// Best-effort, per-instance rate limit for this public, unauthenticated endpoint.
// Mirrors /api/feedback: a Map shared across requests on a warm Fluid Compute
// instance — a speed bump against casual abuse, not a hard guarantee.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    if (hits.size > 5000) {
      for (const [key, value] of hits) {
        if (now > value.resetAt) hits.delete(key);
      }
    }
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

// POST /api/answer-feedback — per-answer human signal. Records a 👍/👎 (with an
// optional reason + note) or an expert inline edit on ONE assistant answer,
// keyed by (sessionId, turnId, messageId, kind) so it joins to the inquiry row
// the log-inquiry hook wrote for the same (sessionId, turnId). Distinct from
// /api/feedback, which flags a whole thread.
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  // Cheap first gate before reading the whole body into memory.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_ANSWER_FEEDBACK_BYTES) {
    return NextResponse.json({ error: "Feedback payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;

  // Correlation keys — must be present and within the safe charset, or the row
  // can't join back to an inquiry (and is untrusted public input).
  if (
    !isAnswerFeedbackId(input.sessionId) ||
    !isAnswerFeedbackId(input.turnId) ||
    !isAnswerFeedbackId(input.messageId)
  ) {
    return NextResponse.json({ error: "Missing or invalid identifiers" }, { status: 400 });
  }

  if (!isAnswerFeedbackKind(input.kind)) {
    return NextResponse.json({ error: "Invalid feedback kind" }, { status: 400 });
  }
  const kind: AnswerFeedbackKind = input.kind;

  // A reason only makes sense on a thumbs-down; when present it must be valid.
  let reason: string | undefined;
  if (kind === "down" && input.reason !== undefined && input.reason !== null) {
    if (!isFeedbackReason(input.reason)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }
    reason = input.reason;
  }

  const str = (value: unknown, fallback: string, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;

  const note = typeof input.note === "string" ? input.note.trim().slice(0, MAX_NOTE_LENGTH) : "";
  const reporter =
    typeof input.reporter === "string" && input.reporter.trim()
      ? input.reporter.trim().slice(0, MAX_REPORTER_LENGTH)
      : undefined;
  const persona = str(input.persona, "anyone", 40);
  const question = typeof input.question === "string" ? input.question.slice(0, MAX_ANSWER_LENGTH) : "";
  const originalAnswer =
    typeof input.originalAnswer === "string" ? input.originalAnswer.slice(0, MAX_ANSWER_LENGTH) : "";
  // Only persist an edited answer for an actual edit, and only if non-empty.
  const editedAnswer =
    kind === "edit" && typeof input.editedAnswer === "string" && input.editedAnswer.trim()
      ? input.editedAnswer.slice(0, MAX_ANSWER_LENGTH)
      : undefined;

  if (kind === "edit" && !editedAnswer) {
    return NextResponse.json({ error: "Nothing to save — the edit is empty" }, { status: 400 });
  }

  try {
    await saveAnswerFeedback({
      sessionId: input.sessionId,
      turnId: input.turnId,
      messageId: input.messageId,
      kind,
      reason,
      note,
      reporter,
      persona,
      question,
      originalAnswer,
      editedAnswer,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to save answer feedback", error);
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }
}
