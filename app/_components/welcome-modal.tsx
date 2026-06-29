"use client";

import { FlagIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Shown once per browser on first load. Bump the version to re-show it after a
// meaningful change to the message.
const SEEN_KEY = "clever-welcome-seen-v1";

export function WelcomeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Only read on the client — starting closed avoids any hydration mismatch.
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      // localStorage blocked (private mode) — just skip the splash.
    }
  }, []);

  // Any close (button, X, Esc, overlay) marks it seen so it won't return.
  const onOpenChange = (next: boolean) => {
    if (!next) {
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        // ignore — worst case it shows again next load
      }
    }
    setOpen(next);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="border-clever-light-blue sm:max-w-md">
        <DialogHeader>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-clever-light-blue/60 px-3 py-1 font-medium text-clever-navy text-xs">
            <SparklesIcon className="size-3.5" />
            Beta
          </span>
          <DialogTitle className="mt-2 font-normal text-2xl text-clever-navy">
            Thanks for testing the Support Agent
          </DialogTitle>
          <DialogDescription className="text-clever-black/60 text-sm leading-relaxed">
            You&apos;re trying an early beta. Every answer is grounded in Clever&apos;s help
            center and cites its sources — but it&apos;s still learning, and it can get things
            wrong.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 rounded-xl border border-clever-orange/30 bg-clever-orange/10 px-4 py-3">
          <FlagIcon className="mt-0.5 size-4 shrink-0 text-clever-orange" />
          <p className="text-clever-black/70 text-sm leading-relaxed">
            See a thread that looks off or suspicious? Please hit{" "}
            <span className="font-medium text-clever-navy">Flag</span> on it — those flags go
            straight to our review queue and are the single best way to help us improve.
          </p>
        </div>

        <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-medium text-clever-blue text-sm transition-colors hover:bg-clever-light-blue/40"
            href="/about"
            onClick={() => onOpenChange(false)}
          >
            How it works
          </Link>
          <button
            className="inline-flex items-center justify-center rounded-lg bg-clever-blue px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-clever-navy"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Start testing
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
