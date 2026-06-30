import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { z } from "zod";
import type { StepUsage } from "@/lib/inference-cost";

// LLM-as-judge auto-eval. Scores a logged inquiry for groundedness, answer
// relevance, and a hallucination flag, using a CHEAP model through the Vercel AI
// Gateway — exactly how app/api/mcp/route.ts calls the gateway (generateText +
// gateway(id)). Called from the batch route, never from the eve turn hook.

// Cheapest current Haiku-class id on the Gateway, fetched LIVE (not from memory):
//   curl -s https://ai-gateway.vercel.sh/v1/models | jq '.data[].id'
// Sonnet 4.6 answers; Haiku 4.5 judges (~10x cheaper input/output).
export const JUDGE_MODEL = "anthropic/claude-haiku-4.5";

// GROUNDING (load-bearing): the stored inquiry payload keeps only
// {rank,title,url,score} per source — no article body is persisted. So at judge
// time the batch route (app/api/judge/batch/route.ts) fetches each source's full
// article body LIVE from the KB via getArticleByUrl, capped per source and
// overall (see the MAX_BODY_* caps in that route), and feeds those bodies to the
// judge. Bodies are NEVER persisted onto the inquiry — they are read fresh each
// run. Groundedness is therefore now a STRONG, body-backed signal, with a
// title-only fallback when a body is missing (KB miss / rotated URL).
export const JUDGE_SYSTEM = [
  "You are a strict evaluator of a customer-support agent's answer.",
  "You are given the user's question, the assistant's answer, and the LIST OF SOURCES the assistant retrieved.",
  "For each source you are given its title, its URL, and — when available — the article body/excerpt (the excerpt may be truncated).",
  "Ground your evaluation STRICTLY against the provided source content: judge whether the answer's claims are attributable to and consistent with the source bodies.",
  "When a source provides only a title and URL with no body, evaluate that source on its title and URL alone; a single missing body must NOT force conservative scoring of the whole answer.",
  "Never use outside knowledge.",
  "If the answer's key claims are not attributable to the provided source bodies, set hallucination to true and keep groundedness low; do not report hallucination:false alongside a near-zero groundedness.",
  "Output ONLY a single minified JSON object — no prose, no markdown fences — with exactly these keys:",
  '{"groundedness":<number 0..1>,"relevance":<number 0..1>,"hallucination":<boolean>,"verdict":<string>}.',
  "groundedness = degree to which the answer's claims are attributable to the provided sources.",
  "relevance = how well the answer addresses the user's question (0..1).",
  "hallucination = true if the answer states specific facts/steps/URLs not plausibly attributable to the listed sources.",
  "verdict = one short sentence (<= 280 chars) explaining the scores; you MAY briefly note if grounding was limited by a missing body, but do not enumerate which sources lacked bodies.",
].join(" ");

export type JudgeResult = {
  readonly groundedness: number;
  readonly relevance: number;
  readonly hallucination: boolean;
  readonly verdict: string;
};

const JudgeSchema = z.object({
  groundedness: z.number(),
  relevance: z.number(),
  // Coerce the stringy/numeric truthiness models sometimes emit ("true", 1) —
  // but NOT z.coerce.boolean(), which maps the string "false" to true. Unknown
  // shapes fall through and still fail z.boolean() (thrown + caught per-row).
  hallucination: z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "yes" || s === "1") return true;
      if (s === "false" || s === "no" || s === "0") return false;
    }
    return v;
  }, z.boolean()),
  verdict: z.string(),
});

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// Parse the model's text into a validated, clamped result. Strips accidental code
// fences and slices to the outer JSON object before parsing. Throws on
// unrecoverable output — the batch route catches it as a per-row failure (the
// poison-row guard), so one bad response never takes down the batch.
export function parseJudge(text: string): JudgeResult {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const parsed = JudgeSchema.parse(JSON.parse(t));
  return {
    groundedness: clamp01(parsed.groundedness),
    relevance: clamp01(parsed.relevance),
    hallucination: parsed.hallucination,
    verdict: parsed.verdict.trim().slice(0, 280),
  };
}

export async function judgeAnswer(input: {
  readonly question: string;
  readonly answer: string;
  readonly sources: ReadonlyArray<{ rank?: number; title?: string; url?: string; body?: string }>;
}): Promise<{ result: JudgeResult; usage?: StepUsage }> {
  // Collapse CR/LF runs to a single space so a field's own newlines can't
  // fabricate extra source rows in the \n-joined list below (bodies, and also
  // titles/urls, for safety). Bodies are already char-capped by the caller.
  const oneLine = (s: string): string => s.replace(/[\r\n]+/g, " ");
  const sourceList = input.sources.length
    ? input.sources
        .map((s, i) => {
          const head = `${s.rank ?? i + 1}. ${oneLine(s.title?.trim() || "(untitled)")} — ${oneLine(s.url?.trim() || "(no url)")}`;
          const body = s.body?.trim();
          // Only emit a Body line for a non-empty body (empty == title-only).
          return body ? `${head}\n   Body: ${oneLine(body)}` : head;
        })
        .join("\n")
    : "(no sources retrieved)";

  const prompt = [
    `Question:\n${input.question || "(none captured)"}`,
    `\nRetrieved sources (title, URL, and article body/excerpt when available):\n${sourceList}`,
    `\nAssistant answer:\n${input.answer || "(empty)"}`,
    "\nReturn ONLY the minified JSON object described in the system prompt.",
  ].join("\n");

  const { text, usage } = await generateText({ model: gateway(JUDGE_MODEL), system: JUDGE_SYSTEM, prompt });
  // Map the AI SDK LanguageModelUsage onto StepUsage for cost accounting. Cache
  // tokens are nested under inputTokenDetails, not top-level.
  const stepUsage: StepUsage = {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
  };
  // parseJudge still throws on unrecoverable JSON — judgeAnswer throws before
  // returning, exactly as before; the batch route's catch handles it.
  return { result: parseJudge(text), usage: stepUsage };
}
