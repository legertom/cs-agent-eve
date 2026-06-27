import { defineTool } from "eve/tools";
import { z } from "zod";
import { embed, rerank } from "ai";
import { gateway } from "@ai-sdk/gateway";
import kbData from "#data/kb.json" with { type: "json" };
import vectorData from "#data/kb-vectors.json" with { type: "json" };

// Hybrid + reranked search over Clever's support knowledge base.
//
// 1. Two base retrievers, fused with Reciprocal Rank Fusion (RRF):
//      • semantic — query embedding vs bundled article embeddings (meaning)
//      • lexical (BM25) — keyword/term overlap (exact field names like
//        "home_language", which embeddings underweight)
// 2. A cross-encoder reranker (Cohere via AI Gateway) re-scores the top
//    candidates against the full query, then we BLEND its order with the hybrid
//    order (RRF again) — so the reranker refines precision without overriding
//    the strong base ranking when it drifts.
// Queries are normalized (home_language / camelCase → "home language") so the
// retrievers see clean tokens.
type Article = { id: string; url: string; title?: string; text: string };

const KB = kbData as Article[];
const VECTORS = vectorData as number[][];

const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_DIMS = 512; // must match scripts/embed.mjs
const RERANK_MODEL = "cohere/rerank-v4-fast";
const RERANK_CANDIDATES = 20; // how many hybrid hits to rerank
const RERANK_DOC_CHARS = 4000; // context per doc given to the reranker
const RRF_K = 60; // standard RRF constant

// --- Text normalization + tokenization (shared by query + index) ---
const STOP = new Set(
  "the a an and or of to in for on is are be with how do i my you your can what when where why this that it as at from by".split(
    " ",
  ),
);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/[_\-]+/g, " ") // home_language → home language
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return (normalize(s).match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOP.has(t),
  );
}

// --- BM25 index (built once at module load) ---
const DOCS = KB.map((a) => {
  const tf = new Map<string, number>();
  for (const t of tokenize(a.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const t of tokenize(a.title ?? "")) tf.set(t, (tf.get(t) ?? 0) + 3); // title boost
  let len = 0;
  for (const c of tf.values()) len += c;
  return { tf, len: len + 1 };
});

const IDF = (() => {
  const df = new Map<string, number>();
  for (const d of DOCS) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = DOCS.length || 1;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log(1 + n / (1 + c)));
  return idf;
})();

const AVG_LEN = DOCS.reduce((s, d) => s + d.len, 0) / (DOCS.length || 1);

function bm25Ranking(query: string): number[] {
  const terms = tokenize(query);
  const k1 = 1.5;
  const b = 0.75;
  return DOCS.map((d, i) => {
    let score = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = IDF.get(t) ?? 0;
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + b * (d.len / AVG_LEN)));
    }
    return { i, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);
}

// --- Semantic ---
const NORMS = VECTORS.map((v) => Math.hypot(...v) || 1);

function semanticRanking(qvec: number[]): number[] {
  const qn = Math.hypot(...qvec) || 1;
  return VECTORS.map((v, i) => {
    let dot = 0;
    for (let k = 0; k < v.length; k++) dot += qvec[k] * v[k];
    return { i, score: dot / (qn * NORMS[i]) };
  })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);
}

// Reciprocal Rank Fusion of ranked id lists → ids ordered by fused score desc.
function rrf(...lists: number[][]): number[] {
  const fused = new Map<number, number>();
  for (const list of lists) {
    list.forEach((docIndex, rank) => {
      fused.set(docIndex, (fused.get(docIndex) ?? 0) + 1 / (RRF_K + rank));
    });
  }
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
}

// Cross-encoder rerank of candidate doc indices; returns them reordered.
// Falls back to the input order if the reranker is unavailable.
async function rerankCandidates(query: string, candidates: number[]): Promise<number[]> {
  if (candidates.length <= 1) return candidates;
  try {
    const documents = candidates.map(
      (i) => `${KB[i].title ?? ""}\n\n${KB[i].text.slice(0, RERANK_DOC_CHARS)}`,
    );
    const { ranking } = await rerank({
      model: gateway.rerankingModel(RERANK_MODEL),
      query,
      documents,
    });
    return ranking.map((r) => candidates[r.originalIndex]);
  } catch {
    return candidates;
  }
}

function excerpt(text: string, query: string, max = 1100): string {
  const terms = tokenize(query);
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  const start = at === -1 ? 0 : Math.max(0, at - 150);
  const slice = text.slice(start, start + max).trim();
  return (start > 0 ? "…" : "") + slice + (start + max < text.length ? "…" : "");
}

export default defineTool({
  description:
    "Search Clever's support knowledge base for relevant help articles. Use " +
    "this for any question about Clever (logins, SSO, rostering, admin setup, " +
    "field names, errors, etc). Hybrid search — matches both meaning and exact " +
    "keywords/field names. Returns the most relevant articles with excerpts and " +
    "links; answer from these and cite the URL.",
  inputSchema: z.object({
    query: z.string().min(2).describe("The user's support question or keywords."),
    limit: z.number().int().min(1).max(8).optional().describe("Max results (default 5)."),
  }),
  async execute({ query, limit }) {
    if (KB.length === 0 || VECTORS.length !== KB.length) {
      return { error: "Knowledge base not built. Run scripts/ingest.mjs + scripts/embed.mjs." };
    }

    const lexical = bm25Ranking(query);

    let semantic: number[] = [];
    try {
      const { embedding } = await embed({
        model: gateway.textEmbeddingModel(EMBED_MODEL),
        value: normalize(query),
        providerOptions: { openai: { dimensions: EMBED_DIMS } },
      });
      semantic = semanticRanking(embedding);
    } catch {
      // If embeddings are unavailable, fall back to lexical only.
      semantic = [];
    }

    // Fuse base retrievers. Cap each list so deep semantic noise doesn't dilute.
    const hybrid = rrf(semantic.slice(0, 50), lexical.slice(0, 50));

    // Rerank the top hybrid candidates, then BLEND rerank order with hybrid
    // order so the reranker sharpens precision without overriding a strong base.
    const candidates = hybrid.slice(0, RERANK_CANDIDATES);
    const reranked = await rerankCandidates(query, candidates);
    const blended = reranked === candidates ? hybrid : rrf(candidates, reranked);
    const final = blended.slice(0, limit ?? 5);

    return {
      query,
      count: final.length,
      method:
        reranked === candidates
          ? semantic.length
            ? "hybrid"
            : "lexical-fallback"
          : "hybrid+rerank",
      results: final.map((i, rank) => ({
        rank: rank + 1,
        title: KB[i].title,
        url: KB[i].url,
        excerpt: excerpt(KB[i].text, query),
      })),
    };
  },
});
