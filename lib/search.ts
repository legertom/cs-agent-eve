import { gateway } from "@ai-sdk/gateway";
import { embed, rerank } from "ai";
import { audienceLabel, audienceOf } from "./audience";
import kbData from "#data/kb.json" with { type: "json" };
import vectorData from "#data/kb-vectors.json" with { type: "json" };

// Hybrid + reranked search over Clever's support knowledge base.
//
// This is the framework-agnostic core: no eve imports, so it is shared by both
// the eve tool (agent/tools/search_support.ts) and the MCP server route
// (app/api/[transport]/route.ts) without dragging the agent runtime into the
// Next.js bundle.
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

// Approximate AI Gateway list prices (USD) for the retrieval models, used to
// surface a per-search cost in the "Show your work" panel. AI Gateway passes
// provider list price through at zero markup; update these if the models change.
const EMBED_USD_PER_1M_TOKENS = 0.02; // openai/text-embedding-3-small
const RERANK_USD_PER_SEARCH = 0.002; // cohere rerank — one query vs ≤100 docs

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

// Cross-encoder rerank of candidate doc indices.
//  • order  — candidates reordered by relevance (input order on failure)
//  • scores — docIndex → reranker relevance (0–1), for the confidence signal
//  • ok     — whether the reranker actually ran (false → lexical/hybrid only)
type RerankResult = { order: number[]; scores: Map<number, number>; ok: boolean };

async function rerankCandidates(query: string, candidates: number[]): Promise<RerankResult> {
  if (candidates.length <= 1) return { order: candidates, scores: new Map(), ok: false };
  try {
    const documents = candidates.map(
      (i) => `${KB[i].title ?? ""}\n\n${KB[i].text.slice(0, RERANK_DOC_CHARS)}`,
    );
    const { ranking } = await rerank({
      model: gateway.rerankingModel(RERANK_MODEL),
      query,
      documents,
    });
    const scores = new Map<number, number>();
    for (const r of ranking) {
      const docIndex = candidates[r.originalIndex];
      if (typeof r.score === "number") scores.set(docIndex, r.score);
    }
    return { order: ranking.map((r) => candidates[r.originalIndex]), scores, ok: true };
  } catch {
    return { order: candidates, scores: new Map(), ok: false };
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// Calibrated band from the reranker's top relevance score (Cohere v4 → 0–1).
function confidenceLevel(top: number | null): "high" | "medium" | "low" | "unscored" {
  if (top == null) return "unscored";
  if (top >= 0.72) return "high";
  if (top >= 0.42) return "medium";
  return "low";
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

export type SearchResultItem = {
  rank: number;
  title?: string;
  url: string;
  excerpt: string;
  score: number | null;
  // Who this article is written for (Admins / Teachers / Families / …),
  // derived from the title. Lets the agent disambiguate by POV.
  audience: string;
};

// What this single retrieval cost to run through AI Gateway, itemized by stage
// so the "Show your work" panel can display a transparent breakdown and the UI
// can sum a running total across the thread.
export type RetrievalCost = {
  total: number; // USD, embedding + rerank
  embedding: number; // USD, query embedding
  rerank: number; // USD, cross-encoder rerank
  // Raw usage behind the numbers, so the panel can show "8 tok" / "20 docs".
  embeddingTokens: number;
  rerankDocs: number;
  models: { embedding: string; rerank: string };
};

export type SearchResponse =
  | {
      query: string;
      count: number;
      method: "hybrid+rerank" | "hybrid" | "lexical-fallback";
      confidence: {
        level: "high" | "medium" | "low" | "unscored";
        topScore: number | null;
        margin: number | null;
        scored: boolean;
      };
      cost: RetrievalCost;
      results: SearchResultItem[];
    }
  | { error: string };

// Run the full hybrid + reranked search and return ranked, cited results with a
// calibrated confidence signal. Shared by the eve tool and the MCP server.
export async function searchSupport(query: string, limit?: number): Promise<SearchResponse> {
  if (KB.length === 0 || VECTORS.length !== KB.length) {
    return { error: "Knowledge base not built. Run scripts/ingest.mjs + scripts/embed.mjs." };
  }

  const lexical = bm25Ranking(query);

  let semantic: number[] = [];
  let embeddingTokens = 0;
  try {
    const { embedding, usage } = await embed({
      model: gateway.textEmbeddingModel(EMBED_MODEL),
      value: normalize(query),
      providerOptions: { openai: { dimensions: EMBED_DIMS } },
    });
    embeddingTokens = usage.tokens;
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
  const { order: reranked, scores, ok: didRerank } = await rerankCandidates(query, candidates);
  const blended = didRerank ? rrf(candidates, reranked) : hybrid;
  const final = blended.slice(0, limit ?? 5);

  const results: SearchResultItem[] = final.map((i, rank) => ({
    rank: rank + 1,
    title: KB[i].title,
    url: KB[i].url,
    excerpt: excerpt(KB[i].text, query),
    // Reranker relevance for this article (0–1), or null when unscored.
    score: scores.has(i) ? round3(scores.get(i) as number) : null,
    audience: audienceLabel(audienceOf(KB[i].title)),
  }));

  // Confidence signal from scores the pipeline already computes:
  // the top article's relevance and its lead over the runner-up.
  const topScore = results[0]?.score ?? null;
  const secondScore = results[1]?.score ?? null;
  const margin = topScore != null && secondScore != null ? round3(topScore - secondScore) : null;
  const scored = scores.size > 0;

  // Itemize what this retrieval cost: embedding is per-token, reranking is
  // billed per search (one query against up to 100 docs). Stages that fell back
  // (no embedding / no rerank) contribute $0.
  const rerankDocs = didRerank ? candidates.length : 0;
  const embeddingCost = (embeddingTokens / 1_000_000) * EMBED_USD_PER_1M_TOKENS;
  const rerankCost = rerankDocs > 0 ? Math.ceil(rerankDocs / 100) * RERANK_USD_PER_SEARCH : 0;
  const cost: RetrievalCost = {
    total: round6(embeddingCost + rerankCost),
    embedding: round6(embeddingCost),
    rerank: round6(rerankCost),
    embeddingTokens,
    rerankDocs,
    models: { embedding: EMBED_MODEL, rerank: RERANK_MODEL },
  };

  return {
    query,
    count: final.length,
    method: didRerank ? "hybrid+rerank" : semantic.length ? "hybrid" : "lexical-fallback",
    confidence: {
      level: scored ? confidenceLevel(topScore) : "unscored",
      topScore,
      margin,
      scored,
    },
    cost,
    results,
  };
}
