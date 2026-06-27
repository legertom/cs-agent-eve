// Side-by-side retrieval comparison: BM25 (lexical) vs embeddings (semantic).
// Run: node scripts/compare-retrieval.mjs
import { readFile } from "node:fs/promises";
import { embed } from "ai";
import { gateway } from "@ai-sdk/gateway";

const kb = JSON.parse(await readFile("agent/data/kb.json", "utf8"));
const vectors = JSON.parse(await readFile("agent/data/kb-vectors.json", "utf8"));

// --- BM25 ---
const STOP = new Set(
  "the a an and or of to in for on is are be with how do i my you your can what when where why this that it as at from by".split(" "),
);
const tok = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1 && !STOP.has(t));
const DOCS = kb.map((a) => {
  const tt = tok(a.title || ""), bt = tok(a.text), tf = new Map();
  for (const t of bt) tf.set(t, (tf.get(t) || 0) + 1);
  for (const t of tt) tf.set(t, (tf.get(t) || 0) + 3);
  return { a, tf, len: bt.length + 1 };
});
const df = new Map();
for (const d of DOCS) for (const t of new Set(d.tf.keys())) df.set(t, (df.get(t) || 0) + 1);
const N = DOCS.length, IDF = new Map();
for (const [t, c] of df) IDF.set(t, Math.log(1 + N / (1 + c)));
const avg = DOCS.reduce((s, d) => s + d.len, 0) / N, k1 = 1.5, b = 0.75;
function bm25(q) {
  const terms = tok(q);
  return DOCS.map((d) => {
    let s = 0;
    for (const t of terms) {
      const f = d.tf.get(t); if (!f) continue;
      s += (IDF.get(t) * (f * (k1 + 1))) / (f + k1 * (1 - b + b * (d.len / avg)));
    }
    return { title: d.a.title, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
}

// --- Semantic ---
const NORMS = vectors.map((v) => Math.hypot(...v) || 1);
async function semantic(q) {
  const { embedding } = await embed({
    model: gateway.textEmbeddingModel("openai/text-embedding-3-small"),
    value: q,
    providerOptions: { openai: { dimensions: 512 } },
  });
  const qn = Math.hypot(...embedding) || 1;
  return kb.map((a, i) => {
    let dot = 0; const v = vectors[i];
    for (let k = 0; k < v.length; k++) dot += embedding[k] * v[k];
    return { title: a.title, s: dot / (qn * NORMS[i]) };
  }).sort((a, b) => b.s - a.s).slice(0, 3);
}

const QUERIES = [
  "kids keep getting kicked out after they log in",
  "students can't see their apps on the dashboard",
  "bulk upload student data",
  "rostering",
  "set up google sso",
  "parent account access",
];

for (const q of QUERIES) {
  console.log(`\n\x1b[1mQ: ${q}\x1b[0m`);
  const [bm, se] = [bm25(q), await semantic(q)];
  console.log("  BM25 (lexical):");
  bm.forEach((r) => console.log(`    ${r.s.toFixed(1).padStart(5)}  ${r.title}`));
  if (!bm.length) console.log("    (no keyword matches)");
  console.log("  Semantic (embeddings):");
  se.forEach((r) => console.log(`    ${r.s.toFixed(3)}  ${r.title}`));
}
