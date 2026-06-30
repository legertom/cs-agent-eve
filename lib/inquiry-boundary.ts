import { gateway } from "@ai-sdk/gateway";
import { embed } from "ai";
import { EMBED_DIMS, EMBED_MODEL } from "./kb-config.mjs";

// Shared "is this turn a NEW, unrelated inquiry, or a follow-up?" detector.
//
// Why this exists: users (Clever CS agents working a ticket queue) fire several
// unrelated questions into one long chat instead of starting a new thread. eve
// replays the full session history every turn, so a new inquiry inherits the
// prior one's audience/topic — polluting retrieval and the answer. This decides,
// cheaply, when a turn opens a new inquiry so the agent can be told to ignore the
// stale context (see agent/instructions/inquiry-scope.ts).
//
// Used live by the dynamic-instructions resolver (advisory — a wrong guess only
// softly changes one turn's prompt). The /inquiries dashboard's authoritative
// segmentation is a separate Haiku pass (lib/inquiry-segment.ts); the two share
// the concept, not the code, exactly so a live mistake never corrupts the record.

// If the current question's MAX cosine similarity to any recent prior question
// is below this, treat it as a NEW inquiry. We compare against the max over
// recent priors (not just the immediately previous turn) because a genuine
// follow-up resembles one of its parents strongly, while a new inquiry stays low
// against all of them — which lets this cutoff sit high enough to also catch
// domain-adjacent new inquiries (calibrated on real data: distinct Clever
// "student-data" questions land ~0.45–0.53 against unrelated priors, while real
// follow-ups exceed it) without false-splitting follow-ups. Fails toward
// "follow-up". Tune against the inquiry_no the Haiku batch produces over time.
const NEW_INQUIRY_COSINE_MAX = 0.5;
// How many recent prior substantive questions to compare against.
const PRIOR_WINDOW = 6;

// Anaphora / continuation openers: if the question clearly refers back to the
// prior turn, it's a follow-up — short-circuit before spending an embedding call.
const FOLLOWUP_OPENERS = [
  "and ", "also ", "but ", "or ", "so ", "then ", "plus ", "additionally",
  "furthermore", "what about", "how about", "what if", "and what", "and how",
  "ok ", "okay ", "thanks", "thank you", "instead", "as well", "the same",
  "same ", "it ", "it's", "its ", "that ", "that's", "this ", "these ",
  "those ", "they ", "them ", "their ", "he ", "she ", "why not",
];

function isAnaphoric(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (!q) return true; // empty / structured-reply turn — always a follow-up
  if (q.split(/\s+/).length <= 2) return true; // a bare "and Canvas?" continuation
  return FOLLOWUP_OPENERS.some((opener) => q.startsWith(opener));
}

async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: gateway.textEmbeddingModel(EMBED_MODEL),
    value: text.slice(0, 512),
    providerOptions: { openai: { dimensions: EMBED_DIMS } },
  });
  return embedding;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type BoundaryVerdict = {
  readonly isNewInquiry: boolean;
  readonly reason: string;
  readonly similarity?: number;
};

// Decide whether `question` (the current turn's user message) starts a new
// inquiry given `priorUserQuestions` (earlier user messages this session, oldest
// first). Fails OPEN to "follow-up" on anything unexpected — we never want a
// detector hiccup to wrongly tell the model to drop context.
export async function detectNewInquiry(
  question: string,
  priorUserQuestions: readonly string[],
): Promise<BoundaryVerdict> {
  try {
    const q = question.trim();
    // First inquiry of the session — nothing prior to pollute it.
    if (priorUserQuestions.length === 0) return { isNewInquiry: false, reason: "first turn" };
    // Clear back-reference to the previous turn — keep the context.
    if (isAnaphoric(q)) return { isNewInquiry: false, reason: "anaphoric/continuation" };

    // Compare against the most recent *substantive* prior questions (skip short
    // clarification replies that carry no standalone topic). A new inquiry is one
    // that's dissimilar to ALL of them.
    const anchors = priorUserQuestions
      .filter((p) => p.trim().split(/\s+/).length >= 3)
      .slice(-PRIOR_WINDOW);
    if (anchors.length === 0) return { isNewInquiry: false, reason: "no substantive anchor" };

    const [qVec, anchorVecs] = await Promise.all([
      embedText(q),
      Promise.all(anchors.map(embedText)),
    ]);
    const maxSimilarity = Math.max(...anchorVecs.map((v) => cosine(qVec, v)));
    const isNew = maxSimilarity < NEW_INQUIRY_COSINE_MAX;
    return {
      isNewInquiry: isNew,
      reason: isNew ? "topic shift" : "same topic",
      similarity: maxSimilarity,
    };
  } catch {
    // Embeddings unavailable / any failure => never split.
    return { isNewInquiry: false, reason: "detector error (fail-open)" };
  }
}
