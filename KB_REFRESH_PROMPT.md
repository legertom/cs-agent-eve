# Scheduled KB Refresh — Blob-backed KB + eve schedule

## 1. Context & orientation

This repo (`/Users/tomleger/vercel-hackathon`) is an **eve-framework** agent app deployed on Vercel — a Clever support assistant reachable via Discord and a web chat UI. Retrieval is a hybrid, reranked RAG pipeline in `lib/search.ts` (BM25 lexical + semantic embeddings fused with RRF, then a Cohere cross-encoder rerank). The knowledge base is built **offline**: `scripts/ingest.mjs` crawls `support.clever.com` into `agent/data/kb.json`, and `scripts/embed.mjs` embeds those articles into `agent/data/kb-vectors.json`. At runtime, `lib/search.ts` imports both files **statically** via the `#data/*` alias (`package.json` `imports`: `"#*": "./agent/*"`) and builds its BM25 / cosine indices once at module load. So today, a content change on Clever's docs reaches the agent only after a human re-runs both scripts, commits the regenerated JSON, and redeploys.

## 2. Goal

Add a **scheduled daily refresh** so new/changed `support.clever.com` articles flow into the agent's search automatically — **no manual rebuild, no redeploy**. The crawl + embed must run on Vercel, write the fresh KB to runtime storage, and `searchSupport` must serve from that storage.

## 3. The decision & the gotcha — build Approach A (Blob-backed KB + eve schedule)

**Implement Approach A. Do not leave this open-ended.**

**The gotcha you must not build into a no-op:** `lib/search.ts` imports the KB with `import kbData from "#data/kb.json" with { type: "json" }` and `import vectorData from "#data/kb-vectors.json" with { type: "json" }`. Node resolves these imports **at build time** and bundles the JSON into the deployed artifact, where it is **immutable**. A scheduled job that re-runs the scrape and writes `agent/data/*.json` at runtime changes **nothing the deployed search sees** — even a write to a writable path is **ephemeral** and invisible to those frozen static imports. The data must therefore move to **runtime storage** (Vercel Blob — already used here in `lib/blob-shares.ts`, usage-billed, no idle sleep) and be **read at runtime** by `lib/search.ts`.

**Fallback (NOT the chosen path — for context only):** A GitHub Actions cron could run `node scripts/ingest.mjs && node --env-file=.env.local scripts/embed.mjs`, commit the regenerated `agent/data/*.json` to `main`, and let Vercel's git integration auto-deploy. That works and keeps the static-import model, but it ties every KB refresh to a full rebuild + deploy, churns the git history with large generated JSON, and is slower to propagate. **Build Approach A instead.**

## 4. Current state (facts to rely on)

### Ingest pipeline — `scripts/ingest.mjs`
- `ORIGIN` = `https://support.clever.com`.
- `ARTICLE_SITEMAPS` = `[https://support.clever.com/s/sitemap-topicarticle-1.xml, https://support.clever.com/s/sitemap-topicarticle-weekly.xml]`.
- `TOPIC_SITEMAP` = `https://support.clever.com/s/sitemap-topic-1.xml`.
- Crawler User-Agent: `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` (Salesforce serves server-rendered HTML to crawler UAs — **no headless browser needed**).
- `CONCURRENCY` = 8; `MAX_ARTICLES` = 2000; inter-batch sleep = 120 ms (both topic-scan and BFS); retries = 2 (`attempt < 2`), backoff `500 * (attempt + 1)` ms.
- `articleUrl` shape: `${ORIGIN}/s/articles/${id}?language=en_US`; article-ID regex `/\/s\/articles\/(\d{6,})/g`; sitemap entries filtered to those containing `language=en_US`.
- The **sitemap is incomplete** — a BFS crawl follows article→article cross-links to find sitemap-missing articles. Dedup by `id` happens twice (BFS `seen` set + `byId` Map).
- Output KB: `agent/data/kb.json`; cache: `.cache/clever-articles.json`. KB item shape: `{ id, url, title, text }`, `text` sliced to **8000** chars; articles with `text.length < 40` are dropped; the SPA-shell title `Help Center` is treated as not-an-article (returns null).
- Invoked today as `node scripts/ingest.mjs` (no env file needed — crawl uses no API key).

### Embed pipeline — `scripts/embed.mjs`
- Reads `agent/data/kb.json`, writes `agent/data/kb-vectors.json` as `number[][]` **index-aligned** with the KB (order + count must match exactly).
- `MODEL` = `openai/text-embedding-3-small`; `DIMS` = **512**; `BATCH` = 96.
- Embedding input = `${a.title ?? ""}\n\n${a.text.slice(0, 6000)}` (note: **6000**, not the 8000 stored in KB).
- Each number rounded via `Number(n.toFixed(6))`.
- API: `embedMany({ model: gateway.textEmbeddingModel(MODEL), values, providerOptions: { openai: { dimensions: DIMS } } })` from `ai` (the repo is on `ai@^7`) + `@ai-sdk/gateway`. Requires env `AI_GATEWAY_API_KEY`.
- Invoked today as `node --env-file=.env.local scripts/embed.mjs` (the `--env-file` flag loads `AI_GATEWAY_API_KEY`). **Plain `node scripts/embed.mjs` will fail with a missing key.**

### Runtime search — `lib/search.ts`
- Static imports at lines 4–5; `const KB = kbData as Article[]` (line 26), `const VECTORS = vectorData as number[][]` (line 27). `Article = { id: string; url: string; title?: string; text: string }`.
- `EMBED_MODEL = "openai/text-embedding-3-small"`; **`EMBED_DIMS = 512`** (line 30, "must match scripts/embed.mjs"); `RERANK_MODEL = "cohere/rerank-v4-fast"`; `RRF_K = 60`.
- Built **once at module load** from `KB`/`VECTORS`: `DOCS` (BM25 tf maps, title boost ×3, line 65), `IDF` (line 74), `AVG_LEN` (line 83), `NORMS = VECTORS.map((v) => Math.hypot(...v) || 1)` (line 105).
- Public entrypoint: **`export async function searchSupport(query: string, limit?: number): Promise<SearchResponse>`** (line 223). Guard at top (lines 224–226): returns an error response (`{ error: "Knowledge base not built. ..." }`) if `KB.length === 0 || VECTORS.length !== KB.length`. **Preserve this exact signature and guard.**
- `lib/search.ts` is **deliberately eve-free** (imports only `@ai-sdk/gateway`, `ai`, and local `./audience`). Per its own header comment it is shared by the eve tool `agent/tools/search_support.ts` and the MCP route at `app/api/[transport]/route.ts` (this is the real path — **not** `app/api/mcp/route.ts`). **Keep it eve-free.**

### Blob conventions — `lib/blob-shares.ts`
- `@vercel/blob@^2.5.0`; import `{ head, put }`.
- Write: `put(path, JSON.stringify(data), { access: "public", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: ... })`. **Token `BLOB_READ_WRITE_TOKEN` is read implicitly** by `@vercel/blob` — never reference it in code.
- Read: `const meta = await head(path); const res = await fetch(meta.url)` — `get({ access: "public" })` returns **403** against the public store; head + fetch is the reliable path. Wrap in try/catch and treat failure as "not found" (the existing `loadShare()` is the template).
- For the KB blobs, **do NOT** reuse the 1-year `cacheControlMaxAge` from shares (those are immutable). These objects change daily — set a short `cacheControlMaxAge` (e.g. `60`) so freshness propagates.

### Existing cron — `vercel.json` & `app/api/judge/batch/route.ts`
- One `crons` entry today: `{ "path": "/api/judge/batch", "schedule": "*/10 * * * *" }`. The cron-secret pattern lives in `app/api/judge/batch/route.ts` (`export const runtime = "nodejs"`, `export const maxDuration = 300`, `CRON_SECRET` checked at request time inside the handler). **You will not add a `crons` entry by hand** — eve generates the cron job (see below). **Leave `/api/judge/batch` and its `CRON_SECRET` untouched.**

### eve schedules API (`node_modules/eve/docs/schedules.mdx`)
- `import { defineSchedule } from "eve/schedules"`. `ScheduleDefinition = { cron: string; markdown?: string; run?: (args: ScheduleHandlerArgs) => Promise<void> | void }` — **exactly one of `markdown` or `run`** (compiler-enforced).
- Schedules are **root-only**, path-derived from `agent/schedules/` (e.g. `agent/schedules/refresh-kb.ts` → schedule id `refresh-kb`).
- On Vercel each `defineSchedule` becomes a Vercel Cron Job in `.vercel/output/config.json`; **cron is evaluated in UTC**.
- `eve dev` never auto-fires on cadence. **Dev dispatch:** `POST http://localhost:3000/eve/v1/dev/schedules/<scheduleId>` (no auth, dev-only) → returns `{ scheduleId, sessionIds }`. An unknown id returns `404` with `availableScheduleIds`.
- `ScheduleHandlerArgs = { receive, waitUntil, appAuth }`; `appAuth = { authenticator: "app", principalId: "eve:app", principalType: "runtime" }`. `markdown` task-mode **cannot park/wait**; `run` handler can. Vercel default function timeout ~300s — a 2–4 min crawl fits.
- **The eve runtime dispatches and authorizes schedules itself** (dev dispatch needs no auth; production cron is wired by eve into Vercel Cron). **Do NOT add a `CRON_SECRET`/`Authorization: Bearer` check inside the schedule handler** — that pattern belongs to the standalone `/api/judge/batch` Next.js route, not to eve schedules.

## 5. Work to do (ordered)

### (a) Extract crawl + embed into a reusable, eve-free module — as plain ESM JS (`.mjs`)
- Create a new module that exports pure async functions, e.g. `crawlKb(): Promise<Article[]>` and `embedKb(kb: Article[]): Promise<number[][]>`, plus a `refreshKb()` that runs both and returns `{ kb, vectors }`. **Author it as plain ESM JavaScript** (suggested: `lib/kb-refresh.mjs`, or a small `lib/kb/` dir of `.mjs` files), **not `.ts`.**
  - **Why `.mjs`, not `.ts`:** the CLI scripts run as plain `node scripts/*.mjs` with **no `tsx`/`ts-node`/loader and no transpile step**, and Node 24 cannot `import` a `.ts` file in this setup. A `.mjs` shared module can be imported with zero ceremony by **both** the `.mjs` CLI scripts (Node imports `.mjs` natively) **and** the TypeScript eve schedule (TS imports `.mjs` fine). If you have a strong reason to write the shared logic in `.ts`, you **must** add a build/transpile step the scripts consume — but `.mjs` is the default and recommended path; do not introduce a Node type-stripping/loader dependency.
- Lift the actual logic out of `scripts/ingest.mjs` and `scripts/embed.mjs` into this module: all the constants and behaviors from §4 must be preserved **byte-for-byte in effect** — `ORIGIN`, `ARTICLE_SITEMAPS`, `TOPIC_SITEMAP`, the Googlebot UA, `CONCURRENCY=8`, `MAX_ARTICLES=2000`, 120 ms sleeps, 2-retry / `500*(attempt+1)` backoff, the `/\/s\/articles\/(\d{6,})/g` regex, `language=en_US` filter, BFS cross-link discovery, the `text.slice(0, 8000)` KB cap, the `text.length < 40` drop, the `Help Center` shell rejection, and the dual `id` dedup. Embedding must keep `MODEL`, `DIMS=512`, `BATCH=96`, the `${title ?? ""}\n\n${text.slice(0, 6000)}` input, and the `Number(n.toFixed(6))` rounding — **index-aligned** with the KB.
- This module must be **eve-free** (same constraint as `lib/search.ts`) and importable from both the CLI scripts and the eve schedule. It uses `embedMany` from `ai` + `gateway.textEmbeddingModel` from `@ai-sdk/gateway`; it relies on `AI_GATEWAY_API_KEY`.
- **Single source of truth for shared constants:** define the two Blob pathnames (suggested `kb/kb.json`, `kb/kb-vectors.json`) **and** `EMBED_DIMS = 512` **once** in this shared module (or a tiny adjacent `.mjs`) and import them from both the schedule writer and `lib/search.ts`, so the writer and reader can never drift.
- **Keep the existing scripts working** as thin wrappers: `scripts/ingest.mjs` calls `crawlKb()` and writes `agent/data/kb.json` (+ `.cache/clever-articles.json`); `scripts/embed.mjs` calls `embedKb()` and writes `agent/data/kb-vectors.json`. Do **not** fork the constants into two places — both consume the shared module.

### (b) Create the eve schedule `agent/schedules/refresh-kb.ts`
- `import { defineSchedule } from "eve/schedules"`. `export default defineSchedule({ cron: "0 8 * * *", run: async ({ waitUntil }) => { ... } })`.
- **Use the `run` handler form, not `markdown`.** Justification: this is a deterministic data job (crawl → embed → write Blob) with **no agent reasoning, no tool loop, no channel delivery, and no parking** — running it through a markdown task-mode prompt would burn LLM tokens and add nondeterminism for zero benefit. The handler calls plain JS/TS directly and wraps the in-flight work in `waitUntil(...)` so the crawl/embed/Blob writes settle before the cron task ends. (Do not call `receive()` — there's no channel hand-off. Do not add a CRON_SECRET check — eve dispatches and authorizes the schedule.)
- The handler: `const { kb, vectors } = await refreshKb();` then write **two deterministic Blob objects** at the shared `kb/kb.json` and `kb/kb-vectors.json` pathnames via `put(key, JSON.stringify(...), { access: "public", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 })`. Stable keys + `addRandomSuffix: false` mean each run **overwrites** the previous snapshot. Optionally also write a tiny `kb/manifest.json` (`{ count, dims: 512, builtAt }`) for observability. Log counts. **Guard against writing a degenerate KB:** if `kb.length === 0` (or `vectors.length !== kb.length`), log and skip the overwrite so a bad crawl can't wipe a good KB.

### (c) Refactor `lib/search.ts` to load KB + vectors from Blob, lazily and cached (with TTL)
- Replace the **module-load** coupling to the static imports with a **lazy, cached async loader** — e.g. `async function ensureIndex()` that, on first `searchSupport` call (memoized for the warm instance, like the lazy-init pattern in `lib/db.ts`), fetches `kb/kb.json` and `kb/kb-vectors.json` from Blob via `head()` + `fetch()`, then **rebuilds `DOCS`, `IDF`, `AVG_LEN`, and `NORMS`** from the loaded data. Move `KB`, `VECTORS`, and those four indices into mutable module state populated by the loader rather than import-time `const`s.
- **Use an explicit TTL, not memoize-forever.** Cache the loaded index with a module-level timestamp and re-read Blob when the cache is older than a short TTL (suggest **5–15 min**; the Blob is overwritten at most daily, so any sub-day TTL guarantees a long-lived warm instance picks up the daily overwrite without a redeploy). **Memoize-forever is NOT acceptable** — it silently recreates the original staleness bug on warm instances.
- **Preserve `searchSupport(query, limit?)` exactly** — same signature, same `SearchResponse` return type. Add `await ensureIndex()` at the top of `searchSupport` (before the empty/mismatch guard), so callers (`agent/tools/search_support.ts`, `app/api/[transport]/route.ts`) need **zero changes**.
- **Keep the bundled `#data/*.json` as a fallback.** If the Blob read fails or the objects don't exist yet (first deploy before the schedule has ever run, or a transient Blob error), fall back to the statically-imported `kbData`/`vectorData` so the app never serves an empty KB.
- **Keep `lib/search.ts` eve-free** — Blob loading uses only `@vercel/blob`. Do not import `eve`.
- `EMBED_DIMS` stays **512**, imported from the single shared constant, and must match the Blob vectors' dimensionality; keep the constant and the comment.

### (d) Keep the guard
- Retain the `KB.length === 0 || VECTORS.length !== KB.length` guard inside `searchSupport`. After the loader runs (Blob or fallback), this guard must still catch an empty or index-misaligned KB and return the error response — never throw/crash the endpoint. A Blob load failure must **degrade gracefully** to the bundled fallback, exactly as embedding/rerank failures already degrade gracefully today.

## 6. Constraints & caveats

- **Do not change** the retrieval algorithm (BM25 / RRF / rerank, `RRF_K=60`, k1=1.5, b=0.75, title boost ×3), the `searchSupport` signature, or any UI.
- `lib/search.ts` **and** the new refresh module must stay **eve-free**.
- `EMBED_DIMS` (runtime) must stay equal to `DIMS` (build/embed) = **512**; a mismatch silently corrupts cosine similarity. Both now derive from the **single shared constant** — keep them in one place.
- Respect the **~300 s Vercel function timeout**. A full crawl is ~2–4 min of mostly I/O and should fit, but if it risks the limit, set `maxDuration` appropriately for the schedule's generated function and/or adopt the **incremental** path: crawl only `sitemap-topicarticle-weekly.xml` daily, diff against a stored content hash, and re-embed only changed articles — full crawl weekly. Don't prematurely add this; measure first.
- Do **not** touch auth or channel config. (The public channel + bash/web_fetch hardening is a **separate, optional** concern and is **out of scope** here.)
- Do not hand-edit `vercel.json` `crons` for this job — eve emits the cron entry from `defineSchedule`. Leave the existing `/api/judge/batch` cron untouched.

## 7. Cadence

Use **`cron: "0 8 * * *"`** — a daily full crawl at **08:00 UTC** (~midnight US Pacific, off-peak). Justification: Clever's support content changes slowly and they publish a **weekly** article sitemap, so daily is already ahead of their publish cadence; a full run costs **~2¢ in embeddings** and **~2–4 min** of mostly-I/O wall time, so **freshness, not cost, is the only real constraint** — daily maximizes freshness at negligible expense. **Conservative alternative:** `"0 8 * * 1"` (weekly, Mondays 08:00 UTC). **Optional hybrid:** cheap **daily incremental** off `sitemap-topicarticle-weekly.xml` + a content hash, with a **weekly full** crawl — only adopt if the daily full crawl ever bumps the timeout.

## 8. Acceptance criteria (testable)

1. `npm run typecheck` passes (`tsc --noEmit -p tsconfig.json`).
2. The eve **dev dispatch route** fires the schedule and the two Blob objects (`kb/kb.json`, `kb/kb-vectors.json`) get **written/overwritten** (requires `BLOB_READ_WRITE_TOKEN` and `AI_GATEWAY_API_KEY` in the dev env).
3. A search **after** a Blob update reflects the Blob data — **prove freshness changes with no redeploy/rebuild**, including on a **warm instance after the TTL elapses** (see §10's adversarial test).
4. `searchSupport(query, limit?)` signature and `SearchResponse` shape are **unchanged**; `agent/tools/search_support.ts` and `app/api/[transport]/route.ts` are untouched (or trivially so).
5. With Blob **empty/absent**, `searchSupport` still returns results from the **bundled `#data/*.json` fallback** (no crash, guard intact).
6. The existing CLI scripts still **run unmodified** — `node scripts/ingest.mjs` and `node --env-file=.env.local scripts/embed.mjs` — and produce valid, schema-shaped `agent/data/kb.json` (array of `{id,url,title,text}`) and `agent/data/kb-vectors.json` (index-aligned `number[][]`, dim 512). (Byte-identical output is not required — crawl/embed are nondeterministic.)

## 9. Verification steps (exact)

- `npm run typecheck`.
- Start dev (eve dev / `npm run dev`) with the dev env loaded (`vercel env pull` → `.env.local`, so `BLOB_READ_WRITE_TOKEN` and `AI_GATEWAY_API_KEY` are present). Then dispatch the schedule:
  `curl -X POST http://localhost:3000/eve/v1/dev/schedules/refresh-kb` → expect `{ "scheduleId": "refresh-kb", "sessionIds": [...] }`.
- Confirm the Blob objects exist: in a throwaway `.mjs` script run with `node --env-file=.env.local`, `import { head } from "@vercel/blob"; const m = await head("kb/kb.json"); const r = await fetch(m.url);` returns the JSON; repeat for `kb/kb-vectors.json`; optionally check `kb/manifest.json` has `count` and `dims: 512`.
- Run a search through both consumers — the eve tool `agent/tools/search_support.ts` (via the agent in dev) and the MCP route `app/api/[transport]/route.ts` — and confirm results come from Blob data.
- Confirm the bundled CLI path still works: `node scripts/ingest.mjs` then `node --env-file=.env.local scripts/embed.mjs` regenerate valid `agent/data/*.json`.
- Confirm the **"Show your work"** cost panel still renders (the per-search `cost` / `confidence` / `method` fields in `SearchResponse` are unchanged).

## 10. Process directive for the implementer

- **Author your own implementation workflow** (understand → implement → verify). Read the actual files before editing — `lib/search.ts`, `scripts/ingest.mjs`, `scripts/embed.mjs`, `lib/blob-shares.ts`, `lib/db.ts` (for the lazy-init pattern), `node_modules/eve/docs/schedules.mdx`, and `app/api/judge/batch/route.ts`. Do **not** invent APIs — use the exact identifiers above. The repo is on `ai@^7`; reuse the existing `embed`/`embedMany`/`rerank` call shapes already present in the codebase rather than recalling signatures from memory.
- **Adversarially verify the gotcha is actually resolved.** This is the whole point. After the schedule has written Blob, mutate the Blob KB **out of band** (e.g. write a `kb/kb.json` containing a single sentinel article with a unique nonsense token like `ZZZ_BLOB_FRESHNESS_PROBE`, plus a matching single-vector `kb/kb-vectors.json`), then — **without rebuilding or redeploying** — run `searchSupport("ZZZ_BLOB_FRESHNESS_PROBE")` and confirm the sentinel comes back. Run this in **two conditions**: (1) a cold/refreshed instance, and (2) a **warm instance after the loader's TTL has elapsed** (or force a re-read). If a stale bundled result comes back in either case, the loader/caching is wrong — fix it until a Blob-only data change demonstrably changes search output with no redeploy. Then restore a real KB.
- Also verify the **fallback** direction: with Blob unreadable/absent, `searchSupport` still answers from `#data/*.json` and the guard never throws.
- When green (typecheck + both freshness conditions + fallback all pass), **commit and push to `main`** — this user always ships to `main`, and `main` auto-deploys to prod. Don't ask for deploy confirmation. After deploy, optionally confirm in Vercel → Settings → Cron Jobs that the `refresh-kb` entry appears with schedule `0 8 * * *`.
