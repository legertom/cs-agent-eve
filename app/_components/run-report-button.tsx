"use client";

import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

// "Run now" trigger for the Support QA report. POSTs to /api/feedback-report
// (debounced server-side) and refreshes the server component to show the result.
// The whole app is an internal beta tool with no auth, so the button is plain; the
// route's debounce is what bounds repeated clicks.
export function RunReportButton({ hasReport }: { readonly hasReport: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const running = busy || pending;

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/feedback-report", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { reused?: boolean; error?: string };
      if (!res.ok) {
        setNote(data.error ?? "Generation failed — try again.");
        return;
      }
      setNote(data.reused ? "Reused the report from the last couple of minutes." : "Fresh report generated.");
      startTransition(() => router.refresh());
    } catch {
      setNote("Couldn't reach the report service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy",
          running && "cursor-not-allowed opacity-70",
        )}
        disabled={running}
        onClick={run}
        type="button"
      >
        {running ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
        {running ? "Analyzing…" : hasReport ? "Re-run review" : "Run review"}
      </button>
      {note ? <span className="text-clever-black/50 text-xs">{note}</span> : null}
    </div>
  );
}
