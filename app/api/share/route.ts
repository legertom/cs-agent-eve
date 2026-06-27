import { BlobServiceRateLimited } from "@vercel/blob";
import { NextResponse } from "next/server";
import { saveShare } from "@/lib/blob-shares";
import { MAX_SHARE_BYTES, MAX_SHARE_MESSAGES, type SharedThreadPayload } from "@/lib/shared-thread";

// Best-effort, per-instance rate limit for this public, unauthenticated endpoint.
// On Fluid Compute this Map is shared across requests on a warm instance — a
// speed bump against casual abuse, not a hard guarantee (no external store).
const RATE_LIMIT = 10;
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

// POST /api/share — persist a read-only snapshot of the current thread and
// return a short id. The client builds the shareable URL (/s/<id>) from it.
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many share requests. Please wait a moment." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  // Cheap first gate before reading the whole body into memory.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_SHARE_BYTES) {
    return NextResponse.json({ error: "Conversation too large to share" }, { status: 413 });
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
    return NextResponse.json({ error: "Nothing to share yet" }, { status: 400 });
  }
  if (messages.length > MAX_SHARE_MESSAGES) {
    return NextResponse.json({ error: "Conversation too long to share" }, { status: 413 });
  }
  if (!messages.every(isMessageShaped)) {
    return NextResponse.json({ error: "Invalid message format" }, { status: 400 });
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
            .slice(0, MAX_SHARE_MESSAGES),
        ) as Record<string, number>)
      : undefined;

  const payload: SharedThreadPayload = {
    v: 1,
    createdAt: new Date().toISOString(),
    title: str(input.title, "Shared conversation", 120),
    persona: str(input.persona, "anyone", 40),
    threadCost: num(input.threadCost),
    retrievalCount: num(input.retrievalCount),
    inferenceByMessageId,
    messages: messages as SharedThreadPayload["messages"],
  };

  if (JSON.stringify(payload).length > MAX_SHARE_BYTES) {
    return NextResponse.json({ error: "Conversation too large to share" }, { status: 413 });
  }

  try {
    const id = await saveShare(payload);
    return NextResponse.json({ id, path: `/s/${id}` });
  } catch (error) {
    if (error instanceof BlobServiceRateLimited) {
      return NextResponse.json(
        { error: "Storage is busy. Try again shortly." },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
    console.error("Failed to save share", error);
    return NextResponse.json({ error: "Could not create share link" }, { status: 500 });
  }
}
