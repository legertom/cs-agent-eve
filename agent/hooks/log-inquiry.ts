import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";
import { toolResultFrom } from "eve/tools";
import { ANSWER_MODEL, priceInferenceUsage } from "../../lib/inference-cost";
import {
  bestConfidence,
  type InquirySearchLog,
  logInquiry,
} from "../../lib/inquiry-store";
import searchSupport from "../tools/search_support";

// Log EVERY completed turn (web + Discord) to Neon — the analytics denominator
// for "what are people asking, how well are we answering, what does it cost?".
// Flags capture the wrong answers; this captures all of them.
//
// Observe-only hook: it aggregates a turn's stream events into one row. CRITICAL:
// a thrown hook surfaces as `turn.failed` and breaks the user's turn, so every
// handler is wrapped — logging must never take the agent down.

type TurnAccumulator = {
  turnId: string;
  question: string;
  answers: string[];
  searches: InquirySearchLog[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
};

function emptyTurn(turnId: string): TurnAccumulator {
  return {
    turnId,
    question: "",
    answers: [],
    searches: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

// Durable, per-session slot. Each event re-bases on the current turnId, so a new
// turn starts fresh without depending on event ordering, and the accumulator
// survives step boundaries (including HITL pause/resume mid-turn).
const turnLog = defineState("clever.inquiry-log", (): TurnAccumulator => emptyTurn(""));

// Re-base onto `turnId` (fresh slate when the turn changes), then apply `mutate`.
function onTurn(turnId: string, mutate: (acc: TurnAccumulator) => TurnAccumulator): void {
  turnLog.update((acc) => mutate(acc.turnId === turnId ? acc : emptyTurn(turnId)));
}

export default defineHook({
  events: {
    // The user's question (also the input-response text on a resumed turn).
    "message.received"(event) {
      try {
        const { turnId, message } = event.data;
        if (typeof message !== "string") return;
        onTurn(turnId, (acc) => ({ ...acc, question: message }));
      } catch {
        // never throw from a hook
      }
    },

    // Capture search_support results (typed via toolResultFrom).
    "action.result"(event) {
      try {
        const hit = toolResultFrom(event.data.result, searchSupport);
        if (!hit) return;
        const out = hit.output;
        if ("error" in out) return; // failed/empty search — nothing to log
        const logged: InquirySearchLog = {
          query: out.query,
          method: out.method,
          count: out.count,
          confidence: {
            level: out.confidence.level,
            topScore: out.confidence.topScore,
            margin: out.confidence.margin,
          },
          retrievalCost: out.cost.total,
          sources: out.results.slice(0, 5).map((r) => ({
            rank: r.rank,
            title: r.title,
            url: r.url,
            score: r.score,
          })),
        };
        onTurn(event.data.turnId, (acc) => ({ ...acc, searches: [...acc.searches, logged] }));
      } catch {
        // never throw from a hook
      }
    },

    // Per-step token usage → the answer (inference) cost.
    "step.completed"(event) {
      try {
        const { turnId, usage } = event.data;
        if (!usage) return;
        onTurn(turnId, (acc) => ({
          ...acc,
          usage: {
            inputTokens: acc.usage.inputTokens + (usage.inputTokens ?? 0),
            outputTokens: acc.usage.outputTokens + (usage.outputTokens ?? 0),
            cacheReadTokens: acc.usage.cacheReadTokens + (usage.cacheReadTokens ?? 0),
            cacheWriteTokens: acc.usage.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
          },
        }));
      } catch {
        // never throw from a hook
      }
    },

    // Assistant text (narration + final answer). Collect all non-empty parts.
    "message.completed"(event) {
      try {
        const { turnId, message } = event.data;
        if (!message) return;
        onTurn(turnId, (acc) => ({ ...acc, answers: [...acc.answers, message] }));
      } catch {
        // never throw from a hook
      }
    },

    // Turn finished — compute cost and persist one row.
    async "turn.completed"(event, ctx) {
      try {
        const acc = turnLog.get();
        if (acc.turnId !== event.data.turnId) return; // nothing captured for this turn
        const answerCost = priceInferenceUsage(acc.usage);
        const retrievalCost = acc.searches.reduce((sum, s) => sum + (s.retrievalCost ?? 0), 0);
        await logInquiry({
          sessionId: ctx.session.id,
          turnId: acc.turnId,
          channel: ctx.channel.kind ?? "",
          question: acc.question,
          answer: acc.answers.join("\n\n"),
          searchCount: acc.searches.length,
          topConfidence: bestConfidence(acc.searches.map((s) => s.confidence?.level)),
          retrievalCost,
          answerCost,
          totalCost: answerCost + retrievalCost,
          inputTokens: acc.usage.inputTokens,
          outputTokens: acc.usage.outputTokens,
          model: ANSWER_MODEL,
          payload: { searches: acc.searches, usage: acc.usage, model: ANSWER_MODEL },
        });
        // Clear the slot so the durable state doesn't carry a finished turn forward.
        turnLog.update(() => emptyTurn(""));
      } catch (err) {
        console.error("[log-inquiry] failed to log turn", err);
      }
    },
  },
});
