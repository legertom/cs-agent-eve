"use client";

import type { EveMessage } from "eve/react";
import { CheckCircleIcon, FlagIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type FeedbackReason, FEEDBACK_REASONS } from "@/lib/feedback";
import { firstUserText } from "@/lib/shared-thread";
import { cn } from "@/lib/utils";
import { isSupportSearchOutput } from "./support-search-panel";

// "Flag this thread" form — a support agent (in beta) reports a thread that got
// something wrong so the team can investigate. It snapshots the transcript plus
// the trust record (every retrieval's confidence + sources) to /api/feedback.

const REPORTER_STORAGE_KEY = "clever-reporter";

type SubmitState = "idle" | "submitting" | "error";

export function FeedbackForm({
  messages,
  inferenceByMessageId,
  persona,
  threadCost,
  retrievalCount,
  onClose,
}: {
  readonly messages: readonly EveMessage[];
  readonly inferenceByMessageId: Readonly<Record<string, number>>;
  readonly persona: string;
  readonly threadCost: number;
  readonly retrievalCount: number;
  readonly onClose: () => void;
}) {
  // Default to the headline case ("made something up") so flagging is one click.
  const [reason, setReason] = useState<FeedbackReason>("hallucination");
  const [note, setNote] = useState("");
  const [reporter, setReporter] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  // Remember who's flagging across sessions (beta testers flag repeatedly).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REPORTER_STORAGE_KEY);
      if (saved) setReporter(saved);
    } catch {
      // localStorage may be unavailable (private mode) — name just won't persist.
    }
  }, []);

  async function submit() {
    if (state === "submitting") return;
    setState("submitting");
    setError(null);

    // Capture the trust record from the live messages — every search_support
    // result with its confidence + sources + per-turn answer cost.
    const retrievals: { output: unknown; inferenceCost?: number }[] = [];
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type === "dynamic-tool" &&
          part.toolName === "search_support" &&
          isSupportSearchOutput(part.output)
        ) {
          retrievals.push({
            output: part.output,
            inferenceCost: inferenceByMessageId[message.id],
          });
        }
      }
    }

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages,
          reason,
          note,
          reporter: reporter.trim() || undefined,
          persona,
          title: firstUserText(messages),
          threadCost,
          retrievalCount,
          inferenceByMessageId,
          retrievals,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Request failed: ${res.status}`);
      }
      const { path } = (await res.json()) as { path: string };
      try {
        localStorage.setItem(REPORTER_STORAGE_KEY, reporter.trim());
      } catch {
        // Non-fatal — the flag is already saved.
      }
      setSavedPath(path);
      setState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log this thread");
      setState("error");
    }
  }

  // Success — the thread is logged; offer the saved record + the review queue.
  if (savedPath) {
    return (
      <div className="rounded-xl border border-clever-green/40 bg-clever-green/5 px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-clever-green" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-medium text-clever-navy text-sm">Thread flagged for the team</p>
            <p className="text-clever-black/60 text-xs leading-relaxed">
              Saved with the full transcript and the retrieval trail (confidence + sources),
              so we can see what it based the answer on.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <a
                className="inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy"
                href={savedPath}
                rel="noreferrer"
                target="_blank"
              >
                Open the flagged thread
              </a>
              <a
                className="inline-flex items-center gap-1.5 rounded-lg border border-clever-light-blue bg-white px-3 py-1.5 font-medium text-clever-navy text-sm transition-colors hover:bg-clever-light-blue/40"
                href="/feedback"
              >
                Review queue
              </a>
              <button
                className="ml-auto text-clever-black/40 text-xs hover:text-clever-navy"
                onClick={onClose}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-clever-light-blue bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-center gap-2">
        <FlagIcon className="size-3.5 text-clever-orange" />
        <p className="font-medium text-clever-navy text-sm">Flag this thread for the team</p>
        <button
          aria-label="Close"
          className="ml-auto rounded p-0.5 text-clever-black/40 transition-colors hover:bg-clever-light-blue/50 hover:text-clever-navy"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* What went wrong */}
      <div className="space-y-1.5">
        <p className="font-medium text-clever-black/40 text-xs uppercase tracking-wide">
          What went wrong?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_REASONS.map((r) => (
            <button
              aria-pressed={reason === r.id}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                reason === r.id
                  ? "border-clever-blue bg-clever-blue text-white"
                  : "border-clever-light-blue bg-white text-clever-navy hover:bg-clever-light-blue/40",
              )}
              key={r.id}
              onClick={() => setReason(r.id)}
              title={r.hint}
              type="button"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Note */}
      <textarea
        className="min-h-[72px] w-full resize-y rounded-lg border border-clever-light-blue bg-white px-3 py-2 text-clever-black text-sm placeholder:text-clever-black/40 focus:border-clever-blue focus:outline-none focus:ring-2 focus:ring-clever-blue/30"
        onChange={(e) => setNote(e.target.value)}
        placeholder="What did it get wrong? If you can, paste the made-up claim or the right answer."
        value={note}
      />

      {/* Reporter + submit */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-clever-light-blue bg-white px-3 py-1.5 text-clever-black text-sm placeholder:text-clever-black/40 focus:border-clever-blue focus:outline-none focus:ring-2 focus:ring-clever-blue/30"
          onChange={(e) => setReporter(e.target.value)}
          placeholder="Your name (optional)"
          value={reporter}
        />
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-clever-orange px-4 py-1.5 font-medium text-sm text-white transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={state === "submitting"}
          onClick={submit}
          type="button"
        >
          <FlagIcon className="size-3.5" />
          {state === "submitting" ? "Logging…" : "Log for the team"}
        </button>
      </div>

      {error ? <p className="text-clever-orange text-xs">{error}</p> : null}
      <p className="text-clever-black/40 text-xs">
        Saves the full thread plus what it retrieved (sources + confidence) so the
        team can investigate.
      </p>
    </div>
  );
}
