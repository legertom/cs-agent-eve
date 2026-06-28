// Ingest Clever's public Knowledge articles into the bundled KB for Eve.
//
// Thin CLI wrapper over crawlKb() in lib/kb-refresh.mjs — the single source of
// the crawl logic, shared with the daily refresh schedule (agent/schedules/
// refresh-kb.ts). This writes the KB to disk for the bundled fallback + the
// embed step; the schedule writes the same shape to Vercel Blob at runtime.
//
// Output: agent/data/kb.json  → [{ id, url, title, text }]
// Cache:  .cache/clever-articles.json
//
// Run: node scripts/ingest.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { crawlKb } from "../lib/kb-refresh.mjs";

const OUT = "agent/data/kb.json";
const CACHE = ".cache/clever-articles.json";

await mkdir(".cache", { recursive: true });
await mkdir("agent/data", { recursive: true });

const kb = await crawlKb();
await writeFile(OUT, JSON.stringify(kb));
await writeFile(CACHE, JSON.stringify(kb));
const bytes = Buffer.byteLength(JSON.stringify(kb));
console.log(`\nDone: ${kb.length} articles → ${OUT} (${(bytes / 1e6).toFixed(2)} MB)`);
