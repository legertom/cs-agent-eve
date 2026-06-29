// Single source of truth for the constants that BOTH the KB writer (the refresh
// schedule + the ingest/embed CLI scripts) and the KB reader (lib/search.ts)
// must agree on. Kept as plain ESM with ZERO heavy imports so the runtime search
// path can pull these constants in without dragging the crawl/embed deps into
// the Next.js bundle, and so the .mjs scripts can import them with no transpile.

// Embedding model + dimensionality. The query embedding (lib/search.ts) MUST use
// the exact same model and dims as the document embeddings (lib/kb-refresh.mjs /
// scripts/embed.mjs), or cosine similarity is silently meaningless. Single-source
// these here so the writer and reader can never drift.
export const EMBED_MODEL = "openai/text-embedding-3-small";
export const EMBED_DIMS = 512;

// Vercel Blob pathnames for the runtime-refreshable KB snapshot. Stable keys +
// addRandomSuffix:false mean each refresh OVERWRITES the previous snapshot, and
// lib/search.ts reads from these exact keys. Bumping a path here updates both the
// writer (schedule) and the reader (search) at once.
export const KB_BLOB_PATH = "kb/kb.json";
export const KB_VECTORS_BLOB_PATH = "kb/kb-vectors.json";
export const KB_MANIFEST_BLOB_PATH = "kb/manifest.json";
// Append-only (bounded) log of what each daily sync added/removed/updated, with
// an AI-written summary per entry. Written by the refresh schedule, read by the
// /changelog page.
export const KB_CHANGELOG_BLOB_PATH = "kb/changelog.json";
