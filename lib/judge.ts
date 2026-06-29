import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { z } from "zod";

// LLM-as-judge auto-eval. Scores a logged inquiry for groundedness, answer
// relevance, and a hallucination flag, using a CHEAP model through the Vercel AI
// Gateway — exactly how app/api/mcp/route.ts calls the gateway (generateText +
// gateway(id)). Called from the batch route, never from the eve turn hook.

// Cheapest current Haiku-class id on the Gateway, fetched LIVE (not from memory):
//   curl -s https://ai-gateway.vercel.sh/v1/models | jq '.data[].id'
// Sonnet 4.6 answers; Haiku 4.5 judges (~10x cheaper input/output).
export const JUDGE_MODEL = "anthropic/claude-haiku-4.5";

// GROUNDING LIMITATION (load-bearing): the stored inquiry payload keeps only
// {rank,title,url,score} per source — there is NO article body/excerpt/snippet
// persisted anywhere. We accept that (option a): the judge grounds ONLY against
// the question, the answer, and the source TITLES + URLs, and is told to score
// conservatively when a claim can't be verified from titles alone. Groundedness
// is therefore a WEAK signal — surfaced as such in the dashboard.
export const JUDGE_SYSTEM = [
  "You are a strict evaluator of a customer-support agent's answer.",
  "You are given the user's question, the assistant's answer, and the LIST OF SOURCES the assistant retrieved.",
  "Each source is ONLY a title and a URL — you do NOT have the article bodies.",
  "Judge whether the answer's claims are attributable to and consistent with those titled sources;",
  "when you cannot verify a claim from the available titles/URLs, treat it as unsupported and score conservatively.",
  "Never use outside knowledge.",
  "Output ONLY a single minified JSON object — no prose, no markdown fences — with exactly these keys:",
  '{"groundedness":<number 0..1>,"relevance":<number 0..1>,"hallucination":<boolean>,"verdict":<string>}.',
  "groundedness = degree to which the answer's claims are attributable to the listed sources",
  "(a WEAK signal given titles-only — score conservatively).",
  "relevance = how well the answer addresses the user's question (0..1).",
  "hallucination = true if the answer states specific facts/steps/URLs not plausibly attributable to the listed sources.",
  "verdict = one short sentence (<= 280 chars) explaining the scores.",
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
  readonly sources: ReadonlyArray<{ rank?: number; title?: string; url?: string }>;
}): Promise<JudgeResult> {
  const sourceList = input.sources.length
    ? input.sources
        .map((s, i) => `${s.rank ?? i + 1}. ${s.title?.trim() || "(untitled)"} — ${s.url?.trim() || "(no url)"}`)
        .join("\n")
    : "(no sources retrieved)";

  const prompt = [
    `Question:\n${input.question || "(none captured)"}`,
    `\nRetrieved sources (title + URL only — you do NOT have the article bodies):\n${sourceList}`,
    `\nAssistant answer:\n${input.answer || "(empty)"}`,
    "\nReturn ONLY the minified JSON object described in the system prompt.",
  ].join("\n");

  const { text } = await generateText({ model: gateway(JUDGE_MODEL), system: JUDGE_SYSTEM, prompt });
  return parseJudge(text);
}
