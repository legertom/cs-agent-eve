// Reusable, eve-free KB build pipeline: crawl support.clever.com into an article
// KB, then embed it. This is the SINGLE SOURCE of the crawl + embed behavior,
// shared by BOTH the CLI scripts (scripts/ingest.mjs, scripts/embed.mjs — run as
// plain `node`) AND the eve refresh schedule (agent/schedules/refresh-kb.ts).
//
// Authored as plain ESM (.mjs) so Node imports it natively from the .mjs scripts
// and TypeScript imports it from the .ts schedule with no loader/transpile step.
// Like lib/search.ts, this module is deliberately eve-free.
//
// Discovery is a breadth-first crawl, because the sitemap is INCOMPLETE — it
// omits many published articles (e.g. "Supported home languages"). We seed from
// the sitemap + topic pages, then follow article→article cross-links until no new
// articles are found. Salesforce serves server-rendered HTML to crawler UAs, so
// no headless browser is needed.

import { embedMany, generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { EMBED_DIMS, EMBED_MODEL } from "./kb-config.mjs";

// --- Crawl config (support.clever.com) ---
const ORIGIN = "https://support.clever.com";
const ARTICLE_SITEMAPS = [
  `${ORIGIN}/s/sitemap-topicarticle-1.xml`,
  `${ORIGIN}/s/sitemap-topicarticle-weekly.xml`,
];
const TOPIC_SITEMAP = `${ORIGIN}/s/sitemap-topic-1.xml`;
const UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CONCURRENCY = 8;
const MAX_ARTICLES = 2000; // safety cap
const KB_TEXT_CHARS = 8000; // body cap stored in the KB

// --- Embed config ---
const EMBED_BATCH = 96;
const EMBED_INPUT_CHARS = 6000; // body chars fed to the embedder (≤ KB_TEXT_CHARS)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const articleUrl = (id) => `${ORIGIN}/s/articles/${id}?language=en_US`;

async function getText(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Article ids are 6+ digit numbers (e.g. 000001634, 115002711943).
function extractArticleIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\/s\/articles\/(\d{6,})/g)) ids.add(m[1]);
  return ids;
}

async function getSitemapIds() {
  const ids = new Set();
  for (const sm of ARTICLE_SITEMAPS) {
    try {
      const xml = await getText(sm);
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        if (!/language=en_US/.test(m[1])) continue;
        const id = m[1].match(/\/articles\/(\d{6,})/)?.[1];
        if (id) ids.add(id);
      }
    } catch (err) {
      console.warn(`  sitemap ${sm}: ${err.message}`);
    }
  }
  return ids;
}

async function getTopicUrls() {
  try {
    const xml = await getText(TOPIC_SITEMAP);
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1])
      .filter((u) => u.includes("/s/topic/"));
  } catch {
    return [];
  }
}

function extractArticle(html) {
  const rawTitle =
    html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim().replace(/\s+/g, " ") || "";
  // The empty SPA shell renders "Help Center" — treat that as not-an-article.
  if (!rawTitle || rawTitle === "Help Center") return null;

  const openRe = /<div[^>]*class="[^"]*slds-rich-text[^"]*"[^>]*>/gi;
  const blocks = [];
  let m;
  while ((m = openRe.exec(html))) {
    let depth = 1;
    const tagRe = /<(\/?)div\b[^>]*>/gi;
    tagRe.lastIndex = openRe.lastIndex;
    let t;
    let end = html.length;
    while ((t = tagRe.exec(html))) {
      if (t[1] === "/") {
        if (--depth === 0) {
          end = t.index;
          break;
        }
      } else depth++;
    }
    blocks.push(html.slice(openRe.lastIndex, end));
  }

  const text = blocks
    .join("\n\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length < 40) return null;
  return { title: rawTitle, text };
}

// Fetch an article; returns { article|null, links:Set }.
async function fetchArticle(id, attempt = 0) {
  try {
    const html = await getText(articleUrl(id));
    const links = extractArticleIds(html);
    const parsed = extractArticle(html);
    return {
      article: parsed ? { id, url: articleUrl(id), ...parsed } : null,
      links,
    };
  } catch (err) {
    if (attempt < 2) {
      await sleep(500 * (attempt + 1));
      return fetchArticle(id, attempt + 1);
    }
    return { article: null, links: new Set() };
  }
}

// Crawl Clever's support center → KB array of { id, url, title, text } with the
// body capped at KB_TEXT_CHARS. Pure: performs network I/O only, no file writes.
export async function crawlKb() {
  console.log("Seeding from sitemaps + topic pages…");
  const seed = await getSitemapIds();
  console.log(`  ${seed.size} article ids from sitemaps`);

  const topics = await getTopicUrls();
  console.log(`  ${topics.length} topic pages — scanning for article links`);
  for (let i = 0; i < topics.length; i += CONCURRENCY) {
    const batch = topics.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((u) => getText(u).then(extractArticleIds).catch(() => new Set())),
    );
    for (const set of results) for (const id of set) seed.add(id);
    await sleep(120);
  }
  console.log(`  ${seed.size} article ids after topic expansion`);

  // BFS crawl: follow article→article links to find sitemap-missing articles.
  const seen = new Set();
  const queue = [...seed];
  const articles = [];
  let processed = 0;

  while (queue.length > 0 && articles.length < MAX_ARTICLES) {
    const batch = [];
    while (batch.length < CONCURRENCY && queue.length > 0) {
      const id = queue.shift();
      if (!seen.has(id)) {
        seen.add(id);
        batch.push(id);
      }
    }
    if (batch.length === 0) break;

    const results = await Promise.all(batch.map((id) => fetchArticle(id)));
    for (const { article, links } of results) {
      if (article) articles.push(article);
      for (const id of links) if (!seen.has(id)) queue.push(id);
    }
    processed += batch.length;
    if (processed % 40 === 0 || queue.length === 0) {
      console.log(
        `  crawled ${processed} (kept ${articles.length}, frontier ${queue.length})`,
      );
    }
    await sleep(120);
  }

  // Dedup by id (BFS already dedups via `seen`, but be safe).
  const byId = new Map();
  for (const a of articles) if (!byId.has(a.id)) byId.set(a.id, a);
  const final = [...byId.values()];

  return final.map(({ id, url, title, text }) => ({
    id,
    url,
    title,
    text: text.slice(0, KB_TEXT_CHARS),
  }));
}

// Embed a KB array into number[][] aligned by index with the KB (order + count
// match exactly). Requires gateway auth (AI_GATEWAY_API_KEY or the Vercel OIDC
// token in env). Pure: no file I/O.
export async function embedKb(kb) {
  console.log(`Embedding ${kb.length} articles (${EMBED_MODEL}, ${EMBED_DIMS}d)…`);

  // What we embed: title + body (truncated to stay well under the token limit).
  const inputs = kb.map((a) => `${a.title ?? ""}\n\n${a.text.slice(0, EMBED_INPUT_CHARS)}`);

  const vectors = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    const batch = inputs.slice(i, i + EMBED_BATCH);
    const { embeddings } = await embedMany({
      model: gateway.textEmbeddingModel(EMBED_MODEL),
      values: batch,
      providerOptions: { openai: { dimensions: EMBED_DIMS } },
    });
    // Round to 6 decimals to shrink the JSON.
    for (const e of embeddings) vectors.push(e.map((n) => Number(n.toFixed(6))));
    console.log(`  …${Math.min(i + EMBED_BATCH, inputs.length)}/${inputs.length}`);
  }
  return vectors;
}

// Full refresh: crawl + embed. Returns the canonical KB and its index-aligned
// vectors so the caller can persist them together (the schedule writes Blob).
export async function refreshKb() {
  const kb = await crawlKb();
  const vectors = await embedKb(kb);
  return { kb, vectors };
}

// --- Changelog: diff two KB snapshots + summarize the change ---------------

const SUMMARY_MODEL = "anthropic/claude-sonnet-4.6"; // same gateway model the app uses for answers

/**
 * @typedef {{ id: string, title: string, url: string }} ArticleBrief
 * @typedef {{ id: string, url: string, title?: string, text: string }} KbArticle
 * @typedef {{ added: ArticleBrief[], removed: ArticleBrief[], modified: ArticleBrief[] }} KbDiff
 */

const brief = (a) => ({ id: a.id, title: a.title ?? "", url: a.url });

// Diff a previous KB snapshot against a new one, by article id. An id only in
// the new KB is `added`; only in the old is `removed`; in both with a different
// title/body is `modified`. Pure — no I/O. (Compares stored text directly, which
// is already the 8000-char-capped KB body, so it's stable run-to-run.)
/**
 * @param {KbArticle[] | null | undefined} prevKb
 * @param {KbArticle[] | null | undefined} nextKb
 * @returns {KbDiff}
 */
export function diffKb(prevKb, nextKb) {
  const prev = prevKb ?? [];
  const next = nextKb ?? [];
  const prevById = new Map(prev.map((a) => [a.id, a]));
  const nextById = new Map(next.map((a) => [a.id, a]));

  const added = [];
  const modified = [];
  for (const a of next) {
    const p = prevById.get(a.id);
    if (!p) added.push(brief(a));
    else if ((p.title ?? "") !== (a.title ?? "") || p.text !== a.text) modified.push(brief(a));
  }

  const removed = [];
  for (const p of prev) if (!nextById.has(p.id)) removed.push(brief(p));

  return { added, removed, modified };
}

// Deterministic, dependency-free summary — used as the fallback when the LLM is
// unavailable, and directly for the initial seed (no point spending a token to
// say "525 articles indexed").
function templateSummary({ added, removed, modified, total, isInitial }) {
  if (isInitial) return `Initial knowledge base — ${total} help-center articles indexed.`;
  const parts = [];
  if (added.length) parts.push(`${added.length} added`);
  if (removed.length) parts.push(`${removed.length} removed`);
  if (modified.length) parts.push(`${modified.length} updated`);
  return parts.length ? `Help center sync: ${parts.join(", ")}.` : "No changes.";
}

// AI-written changelog note for a diff. One/two factual sentences. Falls back to
// the deterministic template on any LLM error (or for the initial seed), so the
// schedule never fails because the summarizer hiccuped.
/**
 * @param {{ added?: ArticleBrief[], removed?: ArticleBrief[], modified?: ArticleBrief[], total?: number, isInitial?: boolean }} change
 * @returns {Promise<string>}
 */
export async function summarizeKbChanges({
  added = [],
  removed = [],
  modified = [],
  total = 0,
  isInitial = false,
}) {
  const fallback = templateSummary({ added, removed, modified, total, isInitial });
  if (isInitial || added.length + removed.length + modified.length === 0) return fallback;

  const list = (arr) =>
    arr.slice(0, 30).map((a) => `- ${a.title || a.url || a.id}`).join("\n") || "(none)";

  try {
    const { text } = await generateText({
      model: gateway(SUMMARY_MODEL),
      system:
        "You write terse, factual changelog notes for a Clever support knowledge base " +
        "that re-syncs daily from support.clever.com. One or two plain-language sentences, " +
        "no preamble, no marketing fluff, no bullet lists. When only a few articles changed, " +
        "name them by title; when many, summarize by theme and count. Never invent details.",
      prompt:
        "The daily sync changed the knowledge base. Write the changelog note.\n\n" +
        `ADDED (${added.length}):\n${list(added)}\n\n` +
        `REMOVED (${removed.length}):\n${list(removed)}\n\n` +
        `UPDATED (${modified.length}):\n${list(modified)}`,
    });
    return text.trim() || fallback;
  } catch (err) {
    console.warn("[kb-refresh] changelog summary LLM failed, using template:", err?.message ?? err);
    return fallback;
  }
}
