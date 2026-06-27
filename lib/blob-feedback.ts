import { head, list, put } from "@vercel/blob";
import type { FeedbackPayload, FeedbackSummary } from "./feedback";

// Persistence for flagged ("log thread with feedback") threads, backed by the
// same public Vercel Blob store as shares but under a separate prefix. One
// immutable JSON blob per flag at a deterministic, unguessable pathname. All
// access is server-side; BLOB_READ_WRITE_TOKEN is read from the environment.

const PREFIX = "feedback/";
// Only ever interpolate clean ids into the blob pathname — guards path traversal.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function newId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url"); // 12 url-safe chars, 72 bits
}

export async function saveFeedback(payload: FeedbackPayload): Promise<string> {
  const id = newId();
  await put(`${PREFIX}${id}.json`, JSON.stringify(payload), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60, // low volume; keep the review list fresh-ish
  });
  return id;
}

export async function loadFeedback(id: string): Promise<FeedbackPayload | null> {
  if (!ID_RE.test(id)) return null;
  try {
    // Resolve the blob's public URL via the API (token-auth), then fetch it.
    // We avoid get({ access: "public" }) — it 403s when fetching public content
    // on this store. head() + a plain fetch of the public URL is reliable.
    const meta = await head(`${PREFIX}${id}.json`);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as FeedbackPayload;
  } catch {
    // Unknown id (BlobNotFoundError) or a transient read error → treat as 404.
    return null;
  }
}

// List flagged threads for the team's review page. Beta volume is low, so we read
// each record and return slim summaries, newest first. Best-effort: a single
// unreadable blob is skipped rather than failing the whole list.
export async function listFeedback(limit = 100): Promise<FeedbackSummary[]> {
  try {
    const { blobs } = await list({ prefix: PREFIX, limit });
    const summaries = await Promise.all(
      blobs.map(async (blob): Promise<FeedbackSummary | null> => {
        try {
          const res = await fetch(blob.url, { cache: "no-store" });
          if (!res.ok) return null;
          const p = (await res.json()) as FeedbackPayload;
          return {
            id: blob.pathname.slice(PREFIX.length).replace(/\.json$/, ""),
            createdAt: p.createdAt,
            title: p.title,
            reason: p.reason,
            note: p.note,
            reporter: p.reporter,
            retrievalCount: p.retrievalCount,
          };
        } catch {
          return null;
        }
      }),
    );
    return summaries
      .filter((s): s is FeedbackSummary => s !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
