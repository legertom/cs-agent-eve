import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { z } from "zod";
import type { SegmentAssignment, SegmentTurn } from "./inquiry-store";

// Authoritative inquiry segmentation. A single chat session is often N unrelated
// support inquiries stacked in one thread (a CS agent working a ticket queue);
// this Haiku pass groups a session's ordered turns into distinct inquiries and
// titles each, so the /inquiries dashboard can show real inquiries instead of
// treating the whole session as one conversation.
//
// Cheap model through the Vercel AI Gateway, same call shape as lib/judge.ts.
// Runs off the hot path from the batch route — never inside an eve turn hook.
// This is the SOURCE OF TRUTH; the live in-chat detector (lib/inquiry-boundary.ts)
// is only advisory, so a live mistake never corrupts the record here.

export const SEGMENT_MODEL = "anthropic/claude-haiku-4.5";

const SEGMENT_SYSTEM = [
  "You group a support chat session into its distinct INQUIRIES.",
  "An inquiry is one self-contained question/topic; its follow-ups and clarifications belong to the SAME inquiry.",
  "A turn that switches to an unrelated topic (often a different ticket) starts a NEW inquiry.",
  "You are given the session's turns in order, numbered 1..N, each with the user's message and the turn's top search query + source.",
  "Group consecutive turns into inquiries IN ORDER (an inquiry is a contiguous run of turns).",
  "Give each inquiry a short, specific title (<= 60 chars), e.g. 'Google SSO setup' or 'Reset Classroom MFA'.",
  "Refer to turns by their NUMBER (1, 2, 3, …).",
  "Output ONLY a single minified JSON object — no prose, no markdown fences — of the form:",
  '{"inquiries":[{"title":<string>,"turns":[<turn number>,...]},...]}.',
  "Every turn number 1..N must appear exactly once, in order.",
].join(" ");

const SegSchema = z.object({
  inquiries: z
    .array(
      z.object({
        title: z.string(),
        turns: z.array(z.coerce.number().int().positive()).min(1),
      }),
    )
    .min(1),
});

// Parse + normalize the model output into per-turn assignments. Lenient on
// coverage: any input turn the model didn't place is carried into the most
// recent inquiry, and unknown turn_ids it invented are dropped — so a slightly
// sloppy response still yields a complete, valid segmentation rather than
// throwing away the whole session. Throws only on unparseable output (the batch
// route's poison-session guard catches it).
export function parseSegmentation(text: string, turns: ReadonlyArray<SegmentTurn>): SegmentAssignment[] {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const parsed = SegSchema.parse(JSON.parse(t));

  // The model references turns by 1-based number; map those back to turn ids.
  const titleByTurn = new Map<string, string>();
  const noByTurn = new Map<string, number>();
  let inquiryNo = 0;
  for (const inq of parsed.inquiries) {
    const known = inq.turns
      .map((n) => turns[n - 1]?.turnId)
      .filter((id): id is string => Boolean(id) && !noByTurn.has(id));
    if (known.length === 0) continue; // skip an all-invalid group without burning an inquiry number
    inquiryNo += 1;
    const title = inq.title.trim().slice(0, 120) || `Inquiry ${inquiryNo}`;
    for (const id of known) {
      noByTurn.set(id, inquiryNo);
      titleByTurn.set(id, title);
    }
  }

  // Carry any unplaced turns (in order) into the most recent inquiry; if the very
  // first turns were unplaced, open inquiry 1 for them.
  let lastNo = 0;
  let lastTitle = "";
  return turns.map((turn) => {
    let no = noByTurn.get(turn.turnId);
    let title = titleByTurn.get(turn.turnId);
    if (no == null) {
      if (lastNo === 0) {
        lastNo = 1;
        lastTitle = turn.question.trim().slice(0, 60) || "Inquiry 1";
      }
      no = lastNo;
      title = lastTitle;
    } else {
      lastNo = no;
      lastTitle = title ?? "";
    }
    return { turnId: turn.turnId, inquiryNo: no, inquiryTitle: title ?? lastTitle };
  });
}

export async function segmentSession(turns: ReadonlyArray<SegmentTurn>): Promise<SegmentAssignment[]> {
  // A single-turn session is trivially one inquiry — skip the model call.
  if (turns.length <= 1) {
    const only = turns[0];
    return only
      ? [{ turnId: only.turnId, inquiryNo: 1, inquiryTitle: only.question.trim().slice(0, 60) || "Inquiry 1" }]
      : [];
  }

  const turnList = turns
    .map((t, i) => {
      const parts = [`turn ${i + 1}: ${t.question?.trim() || "(no message — clarification reply)"}`];
      if (t.topQuery) parts.push(`   search: "${t.topQuery}"`);
      if (t.topSource) parts.push(`   top source: ${t.topSource}`);
      return parts.join("\n");
    })
    .join("\n");

  const prompt = [
    "Session turns, in order:",
    turnList,
    "\nReturn ONLY the minified JSON object described in the system prompt.",
  ].join("\n");

  const { text } = await generateText({ model: gateway(SEGMENT_MODEL), system: SEGMENT_SYSTEM, prompt });
  return parseSegmentation(text, turns);
}
