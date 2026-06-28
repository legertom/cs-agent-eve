import type { AnswerFeedbackKind } from "./answer-feedback";
import { getSql } from "./db";

// Persistence for answer-level feedback (thumbs + expert edits), backed by Neon
// Postgres. A separate table from `inquiries` because there can be multiple
// feedback events per turn (a thumb AND an edit), each tied to a specific chat
// message id, and a row must be accept-able even if the inquiry row hasn't been
// written yet (the eve hook and the client race). So: NO hard FK — correlate by
// (session_id, turn_id) with a LEFT JOIN at read time, tolerating either side
// missing. Mirrors lib/feedback-store.ts (memoized ensureSchema + try/catch).

export type AnswerFeedbackRecord = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly kind: AnswerFeedbackKind;
  // Only meaningful for kind='down' — a FeedbackReason id (nullable).
  readonly reason?: string;
  readonly note: string;
  readonly reporter?: string;
  readonly persona: string;
  readonly question: string;
  // The assistant's answer at the time of feedback.
  readonly originalAnswer: string;
  // For kind='edit' — "what I'd actually send" (nullable for up/down).
  readonly editedAnswer?: string;
};

// Per-turn roll-up of human signal, for the dashboard's LEFT JOIN (see §4.D-min).
export type AnswerFeedbackSignal = {
  readonly up: number;
  readonly down: number;
  readonly edit: number;
  // Most-recent down reason on the turn (a FeedbackReason id), if any.
  readonly topDownReason?: string;
};

// CREATE TABLE is idempotent and cheap; memoize so a warm instance runs it once.
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS answer_feedback (
          session_id      text NOT NULL,
          turn_id         text NOT NULL,
          message_id      text NOT NULL,
          kind            text NOT NULL,
          created_at      timestamptz NOT NULL DEFAULT now(),
          reason          text,
          note            text NOT NULL DEFAULT '',
          reporter        text,
          persona         text NOT NULL DEFAULT 'anyone',
          question        text NOT NULL DEFAULT '',
          original_answer text NOT NULL DEFAULT '',
          edited_answer   text,
          PRIMARY KEY (session_id, turn_id, message_id, kind)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS answer_feedback_created_at_idx ON answer_feedback (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS answer_feedback_lookup_idx ON answer_feedback (session_id, turn_id)`;
    })().catch((err) => {
      // Don't cache a failed init — let the next call retry.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// Exposed so the inquiries dashboard's LEFT JOIN can guarantee the table exists
// before querying it (the answer_feedback table may not have been touched yet on
// a cold instance).
export function ensureAnswerFeedbackSchema(): Promise<void> {
  return ensureSchema();
}

// Persist one answer-level feedback event. Idempotent per (session, turn, message,
// kind): clicking 👍 then 👎 writes two distinct kind rows; re-editing or
// re-thumbing updates the existing kind row (last write wins) — the answer-level
// analog of the inquiry table's ON CONFLICT.
export async function saveAnswerFeedback(record: AnswerFeedbackRecord): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO answer_feedback
      (session_id, turn_id, message_id, kind, reason, note, reporter, persona,
       question, original_answer, edited_answer)
    VALUES (
      ${record.sessionId}, ${record.turnId}, ${record.messageId}, ${record.kind},
      ${record.reason ?? null}, ${record.note}, ${record.reporter ?? null},
      ${record.persona}, ${record.question}, ${record.originalAnswer},
      ${record.editedAnswer ?? null}
    )
    ON CONFLICT (session_id, turn_id, message_id, kind) DO UPDATE SET
      created_at      = now(),
      reason          = EXCLUDED.reason,
      note            = EXCLUDED.note,
      reporter        = EXCLUDED.reporter,
      persona         = EXCLUDED.persona,
      question        = EXCLUDED.question,
      original_answer = EXCLUDED.original_answer,
      edited_answer   = EXCLUDED.edited_answer
  `;
}
