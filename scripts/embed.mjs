// Generate embeddings for the bundled KB so the agent can do semantic search.
//
// Reads  agent/data/kb.json
// Writes agent/data/kb-vectors.json  → number[][] aligned by index with kb.json
//
// Requires AI_GATEWAY_API_KEY (already in .env.local after `vercel link`).
// Run: node --env-file=.env.local scripts/embed.mjs
import { readFile, writeFile } from "node:fs/promises";
import { embedMany } from "ai";
import { gateway } from "@ai-sdk/gateway";

const MODEL = "openai/text-embedding-3-small";
const DIMS = 512; // keep bundle small; must match the runtime query embedding
const BATCH = 96;

const kb = JSON.parse(await readFile("agent/data/kb.json", "utf8"));
console.log(`Embedding ${kb.length} articles (${MODEL}, ${DIMS}d)…`);

// What we embed: title + body (truncated to stay well under the token limit).
const inputs = kb.map(
  (a) => `${a.title ?? ""}\n\n${a.text.slice(0, 6000)}`,
);

const vectors = [];
for (let i = 0; i < inputs.length; i += BATCH) {
  const batch = inputs.slice(i, i + BATCH);
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(MODEL),
    values: batch,
    providerOptions: { openai: { dimensions: DIMS } },
  });
  // Round to 6 decimals to shrink the JSON.
  for (const e of embeddings) vectors.push(e.map((n) => Number(n.toFixed(6))));
  console.log(`  …${Math.min(i + BATCH, inputs.length)}/${inputs.length}`);
}

await writeFile("agent/data/kb-vectors.json", JSON.stringify(vectors));
const bytes = Buffer.byteLength(JSON.stringify(vectors));
console.log(
  `Wrote ${vectors.length} vectors → agent/data/kb-vectors.json (${(bytes / 1e6).toFixed(2)} MB)`,
);
