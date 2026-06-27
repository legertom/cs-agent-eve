// Ingest Clever's public Knowledge articles into a bundled KB for Eve.
//
// Discovery is a breadth-first crawl, because the sitemap is INCOMPLETE — it
// omits many published articles (e.g. "Supported home languages"). We seed from
// the sitemap + topic pages, then follow article→article cross-links until no
// new articles are found. Salesforce serves server-rendered HTML to crawler
// UAs, so no headless browser is needed.
//
// Output: agent/data/kb.json  → [{ id, url, title, text }]
// Cache:  .cache/clever-articles.json
//
// Run: node scripts/ingest.mjs
import { mkdir, writeFile } from "node:fs/promises";

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
const OUT = "agent/data/kb.json";
const CACHE = ".cache/clever-articles.json";

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

async function main() {
  await mkdir(".cache", { recursive: true });
  await mkdir("agent/data", { recursive: true });

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

  await writeFile(CACHE, JSON.stringify(final));
  const kb = final.map(({ id, url, title, text }) => ({
    id,
    url,
    title,
    text: text.slice(0, 8000),
  }));
  await writeFile(OUT, JSON.stringify(kb));
  const bytes = Buffer.byteLength(JSON.stringify(kb));
  console.log(
    `\nDone: ${kb.length} articles → ${OUT} (${(bytes / 1e6).toFixed(2)} MB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
