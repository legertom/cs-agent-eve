import { get, put } from "@vercel/blob";
import type { SharedThreadPayload } from "./shared-thread";

// Persistence for shared thread snapshots, backed by a public Vercel Blob store
// (clever-shares). One immutable JSON blob per share at a deterministic,
// unguessable pathname. All access is server-side; the BLOB_READ_WRITE_TOKEN is
// read from the environment by @vercel/blob.

const PREFIX = "shares/";
// Only ever interpolate clean ids into the blob pathname — guards path traversal.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function newId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url"); // 12 url-safe chars, 72 bits
}

export async function saveShare(payload: SharedThreadPayload): Promise<string> {
  const id = newId();
  await put(`${PREFIX}${id}.json`, JSON.stringify(payload), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60 * 60 * 24 * 365, // snapshots never change
  });
  return id;
}

export async function loadShare(id: string): Promise<SharedThreadPayload | null> {
  if (!ID_RE.test(id)) return null;
  try {
    const result = await get(`${PREFIX}${id}.json`, { access: "public" });
    if (!result || result.statusCode !== 200) return null;
    return (await new Response(result.stream).json()) as SharedThreadPayload;
  } catch {
    // Unknown id (BlobNotFoundError) or a transient read error → treat as 404.
    return null;
  }
}
