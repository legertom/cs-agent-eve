import { head } from "@vercel/blob";
import { KB_CHANGELOG_BLOB_PATH, KB_MANIFEST_BLOB_PATH } from "./kb-config.mjs";
import type { ArticleBrief, ChangelogEntry, KbManifest } from "./kb-types";

// Reads the KB freshness manifest + changelog from Vercel Blob for the /changelog
// page. Server-side only, eve-free (uses @vercel/blob, same head+fetch pattern as
// lib/search.ts / lib/blob-shares.ts). Degrades gracefully: if Blob is absent or
// unreadable (e.g. before the first scheduled sync), returns an "unavailable"
// status instead of throwing.

export type KbStatus = {
  available: boolean;
  syncedAt: string | null;
  changedAt: string | null;
  count: number | null;
  dims: number | null;
  entries: ChangelogEntry[];
};

async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const meta = await head(pathname);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Object absent (BlobNotFoundError) or a transient read error.
    return null;
  }
}

// The changelog is read from Blob, which is effectively untrusted input (a
// corrupted, manually edited, or version-skewed entry could be missing fields).
// A TypeScript cast does nothing at runtime, so normalize every entry to a safe
// shape here — the page can then render without defensive guards on every field.
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function briefs(v: unknown): ArticleBrief[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .map((a) => ({ id: str(a.id), title: str(a.title), url: str(a.url) }));
}

function normalizeEntry(e: unknown): ChangelogEntry | null {
  if (!e || typeof e !== "object") return null;
  const r = e as Record<string, unknown>;
  const c = (r.counts ?? {}) as Record<string, unknown>;
  return {
    at: str(r.at),
    counts: { added: num(c.added), removed: num(c.removed), modified: num(c.modified), total: num(c.total) },
    added: briefs(r.added),
    removed: briefs(r.removed),
    modified: briefs(r.modified),
    summary: str(r.summary),
  };
}

export async function getKbStatus(): Promise<KbStatus> {
  const [manifest, changelog] = await Promise.all([
    readJson<KbManifest>(KB_MANIFEST_BLOB_PATH),
    readJson<unknown[]>(KB_CHANGELOG_BLOB_PATH),
  ]);

  const entries = Array.isArray(changelog)
    ? changelog.map(normalizeEntry).filter((e): e is ChangelogEntry => e !== null)
    : [];

  return {
    available: Boolean(manifest),
    // Older manifests only had builtAt; fall back to it for syncedAt.
    syncedAt: manifest?.syncedAt ?? manifest?.builtAt ?? null,
    changedAt: manifest?.changedAt ?? null,
    count: manifest?.count ?? null,
    dims: manifest?.dims ?? null,
    entries,
  };
}
