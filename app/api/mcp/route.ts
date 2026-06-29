import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { searchSupport } from "@/lib/search";

// Stateless Streamable-HTTP MCP server exposing Clever's support knowledge base
// as tools any MCP client (Claude, VS Code, Cursor, …) can call. Hand-rolled
// JSON-RPC so we carry zero extra deps and stay framework-agnostic; the
// retrieval core is shared with the eve agent via lib/search.ts.
//
// Endpoint: POST /api/mcp   (GET → 405, no server-initiated SSE; stateless)
// Auth:     set MCP_API_KEY to require `Authorization: Bearer <key>`.
//           Unset = public (the KB is public Clever help-center content).

export const runtime = "nodejs";
export const maxDuration = 60;

const SERVER_INFO = { name: "clever-support", version: "1.0.0" };
const DEFAULT_PROTOCOL = "2025-06-18";
const ANSWER_MODEL = "anthropic/claude-sonnet-4.6";

const ANSWER_SYSTEM = [
  "You are Clever's support agent. Answer questions about Clever using ONLY",
  "the provided help-center article excerpts. Be concise and give step-by-step",
  "guidance. Always cite the source article URL(s) you used. If the provided",
  "articles don't actually answer the question, say so plainly and suggest",
  "contacting Clever support — never fabricate steps or URLs. If confidence is",
  "low, say you're not fully certain and recommend verifying on the live page.",
].join(" ");

const TOOLS = [
  {
    name: "search_clever_kb",
    description:
      "Search Clever's support knowledge base (525 help-center articles) with a " +
      "hybrid (keyword + semantic) reranked pipeline. Returns ranked, cited " +
      "articles with excerpts and a calibrated confidence signal. Use for any " +
      "question about Clever: logins, SSO/SAML, rostering, admin setup, field " +
      "names, or error messages.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The support question or keywords." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          description: "Max results to return (default 5).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_clever_support",
    description:
      "Ask Clever's support agent a question and get a synthesized, " +
      "plain-language answer grounded ONLY in the help center, with cited source " +
      "URLs and a confidence level. Use when you want a written answer rather " +
      "than raw search results.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The support question, in plain language." },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
];

// --- JSON-RPC plumbing ---

type RpcId = string | number | null;
type RpcMessage = {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-session-id, mcp-protocol-version",
};

const result = (id: RpcId, value: unknown) => ({ jsonrpc: "2.0" as const, id, result: value });
const error = (id: RpcId, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message },
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extraHeaders },
  });
}

function checkAuth(req: Request): Response | null {
  const key = process.env.MCP_API_KEY;
  if (!key) return null; // public by default — KB is public help-center content
  if (req.headers.get("authorization") === `Bearer ${key}`) return null;
  return json(error(null, -32001, "Unauthorized: missing or invalid bearer token."), 401, {
    "WWW-Authenticate": 'Bearer realm="clever-support-mcp"',
  });
}

// A tool result envelope. `isError` reports tool-level failures to the model
// without breaking the JSON-RPC call.
const toolResult = (data: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  isError,
});

const str = (v: unknown) => (typeof v === "string" ? v : "");

async function callTool(id: RpcId, params: Record<string, unknown> | undefined) {
  const name = str(params?.name);
  const args = (params?.arguments as Record<string, unknown> | undefined) ?? {};

  if (name === "search_clever_kb") {
    const query = str(args.query).trim();
    if (!query) return result(id, toolResult("Missing required argument: query", true));
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    return result(id, toolResult(await searchSupport(query, limit)));
  }

  if (name === "ask_clever_support") {
    const question = str(args.question).trim();
    if (!question) return result(id, toolResult("Missing required argument: question", true));
    return result(id, toolResult(await answerQuestion(question)));
  }

  return error(id, -32602, `Unknown tool: ${name}`);
}

async function answerQuestion(question: string) {
  const search = await searchSupport(question, 5);
  if ("error" in search) return search;

  const sources = search.results
    .map((r) => `[${r.rank}] ${r.title ?? r.url}\nURL: ${r.url}\n${r.excerpt}`)
    .join("\n\n");

  try {
    const { text } = await generateText({
      model: gateway(ANSWER_MODEL),
      system: ANSWER_SYSTEM,
      prompt:
        `Question: ${question}\n\n` +
        `Retrieved Clever help-center articles (confidence: ${search.confidence.level}):\n\n` +
        `${sources}\n\n` +
        "Answer using ONLY these articles, and cite the URLs you used.",
    });
    return {
      question,
      answer: text,
      confidence: search.confidence.level,
      sources: search.results.map((r) => ({ title: r.title, url: r.url, score: r.score })),
    };
  } catch {
    // Model unavailable — still return the ranked, cited sources.
    return {
      question,
      answer: null,
      note: "Answer synthesis is unavailable right now; returning ranked sources.",
      confidence: search.confidence.level,
      sources: search.results,
    };
  }
}

async function handleMessage(msg: RpcMessage): Promise<object | null> {
  const id = msg.id ?? null;
  const method = msg.method;

  // Notifications (no response expected).
  if (typeof method === "string" && method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion:
          typeof msg.params?.protocolVersion === "string"
            ? msg.params.protocolVersion
            : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Search or ask Clever's support knowledge base. Answers are grounded in " +
          "public Clever help-center articles; always surface the cited source URLs.",
      });
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: TOOLS });
    case "tools/call":
      return await callTool(id, msg.params);
    default:
      return error(id, -32601, `Method not found: ${method ?? "(none)"}`);
  }
}

// --- HTTP methods ---

export async function POST(req: Request) {
  const unauthorized = checkAuth(req);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(error(null, -32700, "Parse error: invalid JSON."), 400);
  }

  // JSON-RPC batch (array) or a single message.
  if (Array.isArray(body)) {
    const responses = (await Promise.all((body as RpcMessage[]).map(handleMessage))).filter(
      Boolean,
    );
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS });
    return json(responses);
  }

  const response = await handleMessage(body as RpcMessage);
  if (response === null) return new Response(null, { status: 202, headers: CORS });
  return json(response);
}

// Stateless server: no server-initiated SSE stream on GET.
export function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { ...CORS, Allow: "POST, OPTIONS" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
