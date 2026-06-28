// Generate embeddings for the bundled KB so the agent can do semantic search.
//
// Thin CLI wrapper over embedKb() in lib/kb-refresh.mjs — the single source of
// the embed logic, shared with the daily refresh schedule. Reads the on-disk KB
// and writes the index-aligned vectors for the bundled fallback.
//
// Reads  agent/data/kb.json
// Writes agent/data/kb-vectors.json  → number[][] aligned by index with kb.json
//
// Requires gateway auth (AI_GATEWAY_API_KEY or the Vercel OIDC token in env;
// `vercel env pull` populates the OIDC token in .env.local).
// Run: node --env-file=.env.local scripts/embed.mjs
import { readFile, writeFile } from "node:fs/promises";
import { embedKb } from "../lib/kb-refresh.mjs";

const kb = JSON.parse(await readFile("agent/data/kb.json", "utf8"));
const vectors = await embedKb(kb);

await writeFile("agent/data/kb-vectors.json", JSON.stringify(vectors));
const bytes = Buffer.byteLength(JSON.stringify(vectors));
console.log(
  `Wrote ${vectors.length} vectors → agent/data/kb-vectors.json (${(bytes / 1e6).toFixed(2)} MB)`,
);
