"use client";

import { CheckIcon, SquarePenIcon, ThumbsDownIcon, ThumbsUpIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type FeedbackReason, FEEDBACK_REASONS, reasonLabel } from "@/lib/feedback";
import { cn } from "@/lib/utils";

// Per-answer feedback footer: 👍 / 👎 (with an optional one-tap reason + note) and
// an expert "edit answer" inline capture. Distinct from the thread-level Flag.
// Posts to /api/answer-feedback, keyed by (sessionId, turnId, messageId, kind),
// which joins to the inquiry the log-inquiry hook wrote for (sessionId, turnId).
// Attached below each assistant bubble by AgentMessage.

const REPORTER_STORAGE_KEY = "clever-reporter";

type SaveStatus = "idle" | "saving" | "saved" | "error";

// What the footer sends; the caller supplies the correlation keys + context.
type AnswerFeedbackBody = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly kind: "up" | "down" | "edit";
  readonly reason?: FeedbackReason;
  readonly note?: string;
  readonly reporter?: string;
  readonly persona: string;
  readonly question: string;
  readonly originalAnswer: string;
  readonly editedAnswer?: string;
};

export function AnswerFeedbackControls({
  sessionId,
  turnId,
  messageId,
  persona,
  question,
  originalAnswer,
}: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly persona: string;
  readonly question: string;
  readonly originalAnswer: string;
}) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [voteStatus, setVoteStatus] = useState<SaveStatus>("idle");
  const [showDown, setShowDown] = useState(false);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState<SaveStatus>("idle");

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(originalAnswer);
  const [editStatus, setEditStatus] = useState<SaveStatus>("idle");
  // The last correction the expert actually submitted — so reopening the editor
  // refines their saved edit instead of reverting to the assistant's original.
  const [savedEdit, setSavedEdit] = useState<string | null>(null);
  const [reporter, setReporter] = useState("");

  // Remember who's giving feedback across sessions (beta testers do it repeatedly).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REPORTER_STORAGE_KEY);
      if (saved) setReporter(saved);
    } catch {
      // localStorage may be unavailable (private mode) — name just won't persist.
    }
  }, []);

  async function post(body: Omit<AnswerFeedbackBody, "sessionId" | "turnId" | "messageId" | "persona" | "question" | "originalAnswer">): Promise<boolean> {
    try {
      const res = await fetch("/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          turnId,
          messageId,
          persona,
          question,
          originalAnswer,
          reporter: reporter.trim() || undefined,
          ...body,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function castVote(kind: "up" | "down") {
    // Optimistic: reflect the choice immediately, then persist.
    setVote(kind);
    setVoteStatus("saving");
    if (kind === "down") setShowDown(true);
    // Carry the current reason + note when re-affirming 👎: it writes the SAME
    // (session,turn,message,'down') row via ON CONFLICT DO UPDATE, so omitting
    // them would silently wipe an already-saved reason/note.
    const ok = await post(
      kind === "down"
        ? { kind, reason: reason ?? undefined, note: note.trim() || undefined }
        : { kind },
    );
    setVoteStatus(ok ? "saved" : "error");
  }

  async function pickReason(r: FeedbackReason) {
    setReason(r);
    setNoteStatus("saving");
    const ok = await post({ kind: "down", reason: r, note: note.trim() || undefined });
    setNoteStatus(ok ? "saved" : "error");
  }

  async function saveNote() {
    setNoteStatus("saving");
    const ok = await post({ kind: "down", reason: reason ?? undefined, note: note.trim() || undefined });
    setNoteStatus(ok ? "saved" : "error");
  }

  async function submitEdit() {
    if (editStatus === "saving") return;
    const edited = editText.trim();
    if (!edited) return;
    setEditStatus("saving");
    const ok = await post({ kind: "edit", editedAnswer: edited, note: note.trim() || undefined });
    if (ok) {
      try {
        if (reporter.trim()) localStorage.setItem(REPORTER_STORAGE_KEY, reporter.trim());
      } catch {
        // Non-fatal — the correction is already saved.
      }
      setSavedEdit(edited);
      setEditStatus("saved");
      setEditing(false);
    } else {
      setEditStatus("error");
    }
  }

  const btnBase =
    "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50";
  const btnIdle = "border-clever-light-blue bg-white text-clever-navy hover:bg-clever-light-blue/50";

  // Inline-edit mode replaces the action row with the correction textarea.
  if (editing) {
    return (
      <div className="w-full max-w-[85%] space-y-2 rounded-xl border border-clever-blue/30 bg-white px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <SquarePenIcon className="size-3.5 text-clever-blue" />
          <p className="font-medium text-clever-navy text-xs">Edit — what you'd actually send</p>
          <button
            aria-label="Cancel edit"
            className="ml-auto rounded p-0.5 text-clever-black/40 transition-colors hover:bg-clever-light-blue/50 hover:text-clever-navy"
            onClick={() => setEditing(false)}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        <textarea
          className="min-h-[120px] w-full resize-y rounded-lg border border-clever-light-blue bg-white px-3 py-2 text-clever-black text-sm placeholder:text-clever-black/40 focus:border-clever-blue focus:outline-none focus:ring-2 focus:ring-clever-blue/30"
          onChange={(e) => setEditText(e.target.value)}
          placeholder="Rewrite the answer the way it should have been…"
          value={editText}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-clever-light-blue bg-white px-3 py-1.5 text-clever-black text-sm placeholder:text-clever-black/40 focus:border-clever-blue focus:outline-none focus:ring-2 focus:ring-clever-blue/30"
            onChange={(e) => setReporter(e.target.value)}
            placeholder="Your name (optional)"
            value={reporter}
          />
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={editStatus === "saving" || !editText.trim()}
            onClick={submitEdit}
            type="button"
          >
            {editStatus === "saving" ? "Saving…" : "Submit correction"}
          </button>
          <button
            className="text-clever-black/40 text-xs hover:text-clever-navy"
            onClick={() => setEditing(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
        {editStatus === "error" ? (
          <p className="text-clever-orange text-xs">Couldn't save — try again.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          aria-label="This answer was helpful"
          aria-pressed={vote === "up"}
          className={cn(
            btnBase,
            vote === "up"
              ? "border-clever-blue bg-clever-blue/10 text-clever-blue"
              : btnIdle,
          )}
          onClick={() => castVote("up")}
          type="button"
        >
          <ThumbsUpIcon className="size-3.5" />
        </button>
        <button
          aria-label="This answer was not helpful"
          aria-pressed={vote === "down"}
          className={cn(
            btnBase,
            vote === "down"
              ? "border-clever-orange/60 bg-clever-orange/10 text-clever-orange"
              : btnIdle,
          )}
          onClick={() => castVote("down")}
          type="button"
        >
          <ThumbsDownIcon className="size-3.5" />
        </button>
        {originalAnswer.trim() ? (
          <button
            aria-label="Edit this answer with what you'd actually send"
            className={cn(btnBase, btnIdle)}
            onClick={() => {
              // Refine the last saved correction if there is one; otherwise start
              // from the assistant's original answer.
              setEditText(savedEdit ?? originalAnswer);
              setEditStatus("idle");
              setEditing(true);
            }}
            type="button"
          >
            <SquarePenIcon className="size-3.5" />
            Edit answer
          </button>
        ) : null}
        {voteStatus === "saved" ? (
          <span className="inline-flex items-center gap-1 text-clever-green text-xs">
            <CheckIcon className="size-3.5" />
            {vote === "up" ? "Thanks!" : "Noted"}
          </span>
        ) : null}
        {voteStatus === "error" ? (
          <span className="text-clever-orange text-xs">Couldn't save</span>
        ) : null}
        {editStatus === "saved" && !editing ? (
          <span className="inline-flex items-center gap-1 text-clever-green text-xs">
            <CheckIcon className="size-3.5" />
            Saved your correction
          </span>
        ) : null}
      </div>

      {/* 👎 disclosure: optional one-tap reason + note. */}
      {showDown && vote === "down" ? (
        <div className="max-w-[85%] space-y-2 rounded-xl border border-clever-light-blue bg-white px-3 py-2.5 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_REASONS.map((r) => (
              <button
                aria-pressed={reason === r.id}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs transition-colors",
                  reason === r.id
                    ? "border-clever-blue bg-clever-blue text-white"
                    : "border-clever-light-blue bg-white text-clever-navy hover:bg-clever-light-blue/40",
                )}
                key={r.id}
                onClick={() => pickReason(r.id)}
                title={r.hint}
                type="button"
              >
                {reasonLabel(r.id)}
              </button>
            ))}
          </div>
          <textarea
            className="min-h-[56px] w-full resize-y rounded-lg border border-clever-light-blue bg-white px-3 py-2 text-clever-black text-sm placeholder:text-clever-black/40 focus:border-clever-blue focus:outline-none focus:ring-2 focus:ring-clever-blue/30"
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was wrong? (optional)"
            value={note}
          />
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-clever-light-blue bg-white px-3 py-1 font-medium text-clever-navy text-xs transition-colors hover:bg-clever-light-blue/50 disabled:opacity-50"
              disabled={noteStatus === "saving"}
              onClick={saveNote}
              type="button"
            >
              {noteStatus === "saving" ? "Saving…" : "Save"}
            </button>
            {noteStatus === "saved" ? (
              <span className="inline-flex items-center gap-1 text-clever-green text-xs">
                <CheckIcon className="size-3.5" />
                Saved
              </span>
            ) : null}
            {noteStatus === "error" ? (
              <span className="text-clever-orange text-xs">Couldn't save</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
