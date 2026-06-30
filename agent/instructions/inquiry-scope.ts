import type { ModelMessage } from "ai";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { detectNewInquiry } from "../../lib/inquiry-boundary";

// Dynamic instructions that fix the verified "stacked inquiries" problem at its
// source. Users (CS agents working a ticket queue) fire several unrelated
// questions into one chat instead of starting a new thread; eve replays the full
// session history every turn, so a new inquiry inherits the prior one's audience
// and topic, polluting retrieval and the answer.
//
// A hook can't help here — hooks are observe-only and can't inject model context.
// This resolver runs on `turn.started`, reads the conversation visible at that
// point (ctx.messages), and when the latest user message opens a NEW, unrelated
// inquiry, prepends a scope that tells the model to drop the stale context. When
// it's a genuine follow-up it injects nothing, so real follow-ups keep full
// context. Works on EVERY channel (web AND Discord, which has no reset button).
//
// The detection is advisory: a wrong guess only softly reshapes one turn's
// prompt, never deletes the transcript. Authoritative inquiry segmentation for
// analytics is a separate Haiku batch (lib/inquiry-segment.ts).

const NEW_INQUIRY_SCOPE = `# New inquiry — start fresh

The user's most recent message begins a NEW, unrelated support inquiry. It is NOT a follow-up to anything earlier in this conversation. Handle it on its own:

- IGNORE the audience, topic, ticket, and articles from earlier turns. Do not assume the previously chosen audience still applies — if this new question is audience-dependent and ambiguous, ask who it's for.
- Run \`search_support\` FRESH for this question; do not reuse or lean on earlier search results.
- Answer only this new question.`;

// Pull plain text out of a ModelMessage (content is a string or an array of parts).
function messageText(message: ModelMessage): string {
  const content = message.content as unknown;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && (part as { type?: unknown }).type === "text"
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join(" ")
      .trim();
  }
  return "";
}

export default defineDynamic({
  events: {
    async "turn.started"(_event, ctx) {
      try {
        const userTexts = ctx.messages
          .filter((m) => m.role === "user")
          .map(messageText)
          .filter(Boolean);
        // Need a current question AND something prior for there to be context to
        // pollute. The first inquiry of a session never triggers.
        if (userTexts.length < 2) return null;
        const current = userTexts[userTexts.length - 1];
        const prior = userTexts.slice(0, -1);
        const verdict = await detectNewInquiry(current, prior);
        return verdict.isNewInquiry ? defineInstructions({ markdown: NEW_INQUIRY_SCOPE }) : null;
      } catch {
        // Never let the resolver throw — fail open to "no extra instructions".
        return null;
      }
    },
  },
});
