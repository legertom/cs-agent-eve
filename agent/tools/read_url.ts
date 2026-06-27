import { defineTool } from "eve/tools";
import { z } from "zod";

// Reads a web page and returns its readable content, so the agent can
// summarize or answer questions about a link someone drops in chat.
//
// Primary path uses Jina AI Reader (https://r.jina.ai), which renders
// JavaScript and returns clean, LLM-ready Markdown — so it works on dynamic
// SPA sites (help centers, dashboards) that a raw fetch can't read. Falls back
// to a plain fetch + HTML-strip when the reader is unavailable.
//
// No API key required. Set JINA_API_KEY for higher rate limits (optional).
const MAX_CHARS = 12_000;

function truncate(text: string) {
  const truncated = text.length > MAX_CHARS;
  return { truncated, text: truncated ? text.slice(0, MAX_CHARS) + "…" : text };
}

// JS-rendered Markdown via Jina Reader.
async function readRendered(url: string) {
  const headers: Record<string, string> = {
    // Ask the reader to return Markdown.
    "x-respond-with": "markdown",
    accept: "text/plain",
  };
  if (process.env.JINA_API_KEY) {
    headers.authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }
  const res = await fetch(`https://r.jina.ai/${url}`, { headers });
  if (!res.ok) throw new Error(`reader HTTP ${res.status}`);
  const markdown = (await res.text()).trim();
  if (!markdown) throw new Error("reader returned empty content");
  return markdown;
}

// Static fallback: fetch the URL directly and strip HTML to text.
async function readDirect(url: string) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "eve-discord-agent/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (!contentType.includes("html")) return { text: raw, url: res.url };

  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return { text, url: res.url };
}

export default defineTool({
  description:
    "Fetch a public web page and return its readable content as Markdown. " +
    "Renders JavaScript, so it works on dynamic sites. Use this to summarize " +
    "or answer questions about a link.",
  inputSchema: z.object({
    url: z.string().url().describe("The absolute http(s) URL to read."),
  }),
  async execute({ url }) {
    // Prefer the JS-rendering reader; fall back to a direct fetch.
    try {
      const markdown = await readRendered(url);
      return { url, source: "rendered", ...truncate(markdown) };
    } catch (renderErr) {
      try {
        const { text, url: finalUrl } = await readDirect(url);
        return { url: finalUrl, source: "direct", ...truncate(text) };
      } catch (directErr) {
        return {
          error:
            `Could not read the page. Reader: ${(renderErr as Error).message}. ` +
            `Direct fetch: ${(directErr as Error).message}.`,
        };
      }
    }
  },
});
