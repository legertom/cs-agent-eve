// Pricing the agent's own LLM calls (the dominant cost), so the "cost" we show
// reflects true spend — not just the retrieval (embedding + rerank) pipeline.
//
// eve emits a `step.completed` stream event per model call, each carrying token
// usage. The agent runs anthropic/claude-sonnet-4.6 via AI Gateway, which bills
// at provider list price. Pure + client-safe (no eve/server imports) so both the
// live chat and the read-only share view can use it.

// Claude Sonnet 4.6 list price (USD per 1M tokens). Cache read = 0.1× input,
// cache write = 1.25× input (5-minute ephemeral) — the standard caching ratios.
const INPUT_PER_1M = 3.0;
const OUTPUT_PER_1M = 15.0;
const CACHE_READ_PER_1M = 0.3;
const CACHE_WRITE_PER_1M = 3.75;

export const ANSWER_MODEL = "anthropic/claude-sonnet-4.6";

export type StepUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
};

// USD for a single model call from its token usage.
export function priceInferenceUsage(usage: StepUsage | undefined | null): number {
  if (!usage) return 0;
  return (
    ((usage.inputTokens ?? 0) * INPUT_PER_1M +
      (usage.outputTokens ?? 0) * OUTPUT_PER_1M +
      (usage.cacheReadTokens ?? 0) * CACHE_READ_PER_1M +
      (usage.cacheWriteTokens ?? 0) * CACHE_WRITE_PER_1M) /
    1_000_000
  );
}

// Claude Haiku 4.5 list price (USD per 1M tokens) — the LLM-as-judge model
// (lib/judge.ts JUDGE_MODEL = "anthropic/claude-haiku-4.5"). AI Gateway passes
// provider list price through at zero markup. Verified live from the catalogue:
//   curl -s https://ai-gateway.vercel.sh/v1/models | jq '.data[] | select(.id=="anthropic/claude-haiku-4.5").pricing'
// NOTE: these rates assume a Haiku-class JUDGE_MODEL. If JUDGE_MODEL is ever
// swapped to a non-Haiku id, update these constants or judge cost will misbill.
// (JUDGE_MODEL is intentionally NOT imported here — judge.ts imports StepUsage
// from this module, and importing back would create a circular dependency.)
const JUDGE_INPUT_PER_1M = 1.0;
const JUDGE_OUTPUT_PER_1M = 5.0;
const JUDGE_CACHE_READ_PER_1M = 0.1;
const JUDGE_CACHE_WRITE_PER_1M = 1.25;

// USD for a single judge model call. Mirrors priceInferenceUsage exactly but at
// Haiku 4.5 rates. Cache terms are included for symmetry even though judge calls
// usually have zero cache tokens (?? 0 makes them harmless).
export function judgeInferenceCost(usage: StepUsage | undefined | null): number {
  if (!usage) return 0;
  return (
    ((usage.inputTokens ?? 0) * JUDGE_INPUT_PER_1M +
      (usage.outputTokens ?? 0) * JUDGE_OUTPUT_PER_1M +
      (usage.cacheReadTokens ?? 0) * JUDGE_CACHE_READ_PER_1M +
      (usage.cacheWriteTokens ?? 0) * JUDGE_CACHE_WRITE_PER_1M) /
    1_000_000
  );
}
