"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

// A small, Clever-branded code surface with a copy button — for config and
// prompt snippets on the docs pages. Long lines scroll inside the block so the
// page itself never overflows on mobile.
export function CopyBlock({ code, label }: { readonly code: string; readonly label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context / permissions) — no-op.
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-clever-navy/15 bg-clever-navy">
      <div className="flex items-center justify-between gap-3 border-white/10 border-b px-4 py-2">
        <span className="truncate font-medium font-mono text-[11px] text-white/50">
          {label ?? ""}
        </span>
        <button
          aria-label="Copy to clipboard"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-medium text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          onClick={copy}
          type="button"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-sm leading-relaxed">
        <code className="font-mono text-clever-light-blue">{code}</code>
      </pre>
    </div>
  );
}
