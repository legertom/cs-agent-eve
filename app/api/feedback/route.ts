import { BlobServiceRateLimited } from "@vercel/blob";
import { NextResponse } from "next/server";
import { saveFeedback } from "@/lib/blob-feedback";
import {
  type FeedbackPayload,
  isFeedbackReason,
  type LoggedRetrieval,
  MAX_FEEDBACK_BYTES,
  MAX_FEEDBACK_MESSAGES,
  MAX_NOTE_LENGTH,
  MAX_REPORTER_LENGTH,
} from "@/lib/feedback";

// Best-effort, per-instance rate limit for this public, unauthenticated endpoint.
// On Fluid Compute this Map is shared across requests on a warm instance — a
// speed bump against casual abuse, not a hard guarantee (no external store).
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

// Shallow structural check — persisted messages are later handed straight to the
// presentational <AgentMessage>, so reject anything that isn't message-shaped.
function isMessageShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    Array.isArray(m.parts)
  );
}

// Keep only well-formed { output, inferenceCost? } entries. `output` is stored
// opaquely and guarded at render time, so we only require it to be present.
function sanitizeRetrievals(value: unknown): LoggedRetrieval[] {
  if (!Array.isArray(value)) return [];
  const out: LoggedRetrieval[] = [];
  for (const item of value.slice(0, MAX_FEEDBACK_MESSAGES)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (!("output" in r)) continue;
    out.push({
      output: r.output,
      inferenceCost:
        typeof r.inferenceCost === "number" && Number.isFinite(r.inferenceCost)
          ? r.inferenceCost
          : undefined,
    });
  }
  return out;
}

// POST /api/feedback — flag a thread for the support team to investigate. Persists
// the transcript, the trust record (retrievals + confidence + sources), and the
// reporter's note, returning a short id. The client builds /feedback/<id> from it.
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
  if (declaredLength > MAX_FEEDBACK_BYTES) {
    return NextResponse.json({ error: "Conversation too large to flag" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;

  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Nothing to flag yet" }, { status: 400 });
  }
  if (messages.length > MAX_FEEDBACK_MESSAGES) {
    return NextResponse.json({ error: "Conversation too long to flag" }, { status: 413 });
  }
  if (!messages.every(isMessageShaped)) {
    return NextResponse.json({ error: "Invalid message format" }, { status: 400 });
  }

  if (!isFeedbackReason(input.reason)) {
    return NextResponse.json({ error: "Pick what went wrong" }, { status: 400 });
  }

  const num = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const str = (value: unknown, fallback: string, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;

  // Keep only finite numeric entries from the per-message inference map.
  const rawInference = input.inferenceByMessageId;
  const inferenceByMessageId =
    rawInference && typeof rawInference === "object" && !Array.isArray(rawInference)
      ? (Object.fromEntries(
          Object.entries(rawInference as Record<string, unknown>)
            .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
            .slice(0, MAX_FEEDBACK_MESSAGES),
        ) as Record<string, number>)
      : undefined;

  const payload: FeedbackPayload = {
    v: 1,
    kind: "feedback",
    createdAt: new Date().toISOString(),
    title: str(input.title, "Flagged conversation", 120),
    reason: input.reason,
    note: typeof input.note === "string" ? input.note.trim().slice(0, MAX_NOTE_LENGTH) : "",
    reporter: typeof input.reporter === "string" && input.reporter.trim()
      ? input.reporter.trim().slice(0, MAX_REPORTER_LENGTH)
      : undefined,
    persona: str(input.persona, "anyone", 40),
    threadCost: num(input.threadCost),
    retrievalCount: num(input.retrievalCount),
    inferenceByMessageId,
    messages: messages as FeedbackPayload["messages"],
    retrievals: sanitizeRetrievals(input.retrievals),
  };

  if (JSON.stringify(payload).length > MAX_FEEDBACK_BYTES) {
    return NextResponse.json({ error: "Conversation too large to flag" }, { status: 413 });
  }

  try {
    const id = await saveFeedback(payload);
    return NextResponse.json({ id, path: `/feedback/${id}` });
  } catch (error) {
    if (error instanceof BlobServiceRateLimited) {
      return NextResponse.json(
        { error: "Storage is busy. Try again shortly." },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
    console.error("Failed to save feedback", error);
    return NextResponse.json({ error: "Could not log this thread" }, { status: 500 });
  }
}
