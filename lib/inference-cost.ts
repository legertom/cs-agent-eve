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
