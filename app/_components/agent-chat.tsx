"use client";

import { useEveAgent } from "eve/react";
import { AlertCircleIcon, CheckIcon, CoinsIcon, Share2Icon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { firstUserText } from "@/lib/shared-thread";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { formatRetrievalUsd, retrievalCostTotal } from "./support-search-panel";

const SUGGESTED_QUESTIONS = [
  "How do I set up Google SSO?",
  "Why do students get logged out on shared Chromebooks?",
  "How do I configure languages in Clever?",
  "Students can't see their apps — what should I check?",
];

// Sticky "answering for" persona. When set, it rides along with each message as
// ephemeral client context (model-facing, never shown in the transcript or
// persisted) so the agent prefers articles for that audience instead of asking.
const PERSONAS = [
  { id: "anyone", label: "Anyone", context: null },
  { id: "admin", label: "Admin", context: "a district or school admin" },
  { id: "teacher", label: "Teacher", context: "a classroom teacher" },
  { id: "family", label: "Family", context: "a parent or guardian (family)" },
  { id: "app-partner", label: "App partner", context: "an application/integration partner" },
] as const;

const PERSONA_STORAGE_KEY = "clever-persona";

export function AgentChat() {
  const agent = useEveAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  // Running cost across every retrieval in the thread, accumulated as the user
  // asks follow-ups. Derived from the search_support tool outputs on each turn.
  let threadCost = 0;
  let retrievalCount = 0;
  for (const message of agent.data.messages) {
    for (const part of message.parts) {
      if (part.type === "dynamic-tool" && part.toolName === "search_support") {
        const total = retrievalCostTotal(part.output);
        if (total != null) {
          threadCost += total;
          retrievalCount += 1;
        }
      }
    }
  }

  const [input, setInput] = useState("");
  const [persona, setPersona] = useState<string>("anyone");
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.data.messages]);

  // Restore the sticky persona on mount (set in an effect to avoid SSR mismatch).
  useEffect(() => {
    const saved = localStorage.getItem(PERSONA_STORAGE_KEY);
    if (saved && PERSONAS.some((p) => p.id === saved)) setPersona(saved);
  }, []);

  function changePersona(id: string) {
    setPersona(id);
    try {
      localStorage.setItem(PERSONA_STORAGE_KEY, id);
    } catch {
      // localStorage may be unavailable (private mode) — persona still works for the session.
    }
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    const ctx = PERSONAS.find((p) => p.id === persona)?.context;
    const clientContext = ctx
      ? `I'm helping ${ctx}. Prefer Clever help articles written for that audience and answer ` +
        "from their point of view; you don't need to ask me who it's for."
      : undefined;
    void agent.send(clientContext ? { message: trimmed, clientContext } : { message: trimmed });
    setInput("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(input);
  }

  function resetChat() {
    agent.reset();
    setInput("");
    setShareState("idle");
    setShareUrl(null);
  }

  // Snapshot the current thread to a shareable, read-only URL and copy it.
  async function shareThread() {
    if (isBusy || isEmpty || shareState === "sharing") return;
    setShareState("sharing");
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: agent.data.messages,
          persona,
          title: firstUserText(agent.data.messages),
          threadCost,
          retrievalCount,
        }),
      });
      if (!res.ok) throw new Error(`share failed: ${res.status}`);
      const { path } = (await res.json()) as { path: string };
      const url = `${window.location.origin}${path}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard can be blocked (insecure context / permissions) — the link
        // is still shown below the button so it can be copied manually.
      }
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 3000);
    } catch {
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 3000);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {isEmpty ? null : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
              {retrievalCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-lg border border-clever-light-blue bg-clever-light-blue/30 px-3 py-1.5 text-clever-navy text-sm"
                  title={`${retrievalCount} retrieval${retrievalCount === 1 ? "" : "s"} via Vercel AI Gateway this thread`}
                >
                  <CoinsIcon className="size-3.5 text-clever-blue" />
                  <span className="font-medium tabular-nums">{formatRetrievalUsd(threadCost)}</span>
                  <span className="text-clever-black/40">
                    · {retrievalCount} retrieval{retrievalCount === 1 ? "" : "s"} this thread
                  </span>
                </span>
              ) : (
                <span aria-hidden />
              )}
              <div className="flex items-center gap-2">
                <button
                  aria-label="Share this conversation"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-clever-light-blue bg-white px-3 py-1.5 font-medium text-clever-navy text-sm transition-colors hover:bg-clever-light-blue/50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isBusy || shareState === "sharing"}
                  onClick={shareThread}
                  type="button"
                >
                  {shareState === "copied" ? (
                    <CheckIcon className="size-3.5 text-clever-green" />
                  ) : (
                    <Share2Icon className="size-3.5" />
                  )}
                  {shareState === "sharing"
                    ? "Sharing…"
                    : shareState === "copied"
                      ? "Link copied"
                      : shareState === "error"
                        ? "Try again"
                        : "Share"}
                </button>
                <button
                  aria-label="Start a new conversation"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-clever-light-blue bg-white px-3 py-1.5 font-medium text-clever-navy text-sm transition-colors hover:bg-clever-light-blue/50"
                  onClick={resetChat}
                  type="button"
                >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M13.5 8a5.5 5.5 0 0 1-9.27 4.01l-.03-.03"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M2.5 8a5.5 5.5 0 0 1 9.27-4.01l.03.03"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M2.5 12.5v-3h3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M13.5 3.5v3h-3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                New chat
                </button>
              </div>
              </div>
              {shareUrl && shareState === "copied" ? (
                <p className="truncate text-center text-clever-black/40 text-xs">
                  Shareable link:{" "}
                  <a className="text-clever-blue underline" href={shareUrl}>
                    {shareUrl}
                  </a>
                </p>
              ) : null}
            </div>
          )}
          {isEmpty ? (
            <div className="relative py-16">
              {/* Decorative brand blobs */}
              <div
                aria-hidden="true"
                className="clever-blob-1 -top-4 -right-8 absolute h-32 w-32 bg-clever-yellow/30 blur-sm"
              />
              <div
                aria-hidden="true"
                className="clever-blob-2 -left-12 absolute bottom-8 h-24 w-24 bg-clever-green/20 blur-sm"
              />
              <div
                aria-hidden="true"
                className="clever-blob-3 absolute top-24 right-16 h-16 w-16 bg-clever-orange/20 blur-sm"
              />

              <div className="relative max-w-lg text-left">
                <h1 className="mb-4 font-normal text-4xl text-clever-navy leading-[0.95]">
                  How can I help with Clever?
                </h1>
                <p className="mb-8 text-clever-black/60 leading-relaxed">
                  I can answer questions about SSO, rostering, logins, shared
                  devices, and admin setup — grounded in the Clever help center.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    className="rounded-xl border border-clever-light-blue bg-clever-light-blue/30 px-4 py-2.5 text-clever-navy text-sm transition-all duration-200 hover:border-clever-blue/20 hover:bg-clever-light-blue disabled:opacity-50"
                    disabled={isBusy}
                    key={q}
                    onClick={() => submit(q)}
                    type="button"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {agent.data.messages.map((message, index) => (
            <AgentMessage
              canRespond={!isBusy}
              isStreaming={
                agent.status === "streaming" && index === agent.data.messages.length - 1
              }
              key={message.id}
              message={message}
              onInputResponses={(inputResponses) => agent.send({ inputResponses })}
            />
          ))}

          {agent.status === "submitted" ? (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-clever-light-blue bg-clever-light-blue/40 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="size-2 animate-bounce rounded-full bg-clever-blue/60 [animation-delay:-0.3s]" />
                    <span className="size-2 animate-bounce rounded-full bg-clever-blue/60 [animation-delay:-0.15s]" />
                    <span className="size-2 animate-bounce rounded-full bg-clever-blue/60" />
                  </span>
                  <span className="text-clever-black/60 text-sm">Searching the help center…</span>
                </div>
              </div>
            </div>
          ) : null}

          {agent.error ? (
            <div className="flex items-start gap-3 rounded-xl border border-clever-orange/40 bg-clever-orange/5 px-4 py-3 text-sm">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-clever-orange" />
              <div>
                <p className="font-medium text-clever-navy">Request failed</p>
                <p className="mt-0.5 text-clever-black/60">{agent.error.message}</p>
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="shrink-0 border-clever-light-blue border-t bg-white px-6 py-4">
        <div className="mx-auto mb-3 flex max-w-3xl flex-wrap items-center gap-2">
          <span className="text-clever-black/40 text-xs">Answering for</span>
          {PERSONAS.map((p) => (
            <button
              aria-pressed={persona === p.id}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                persona === p.id
                  ? "border-clever-blue bg-clever-blue text-white"
                  : "border-clever-light-blue bg-white text-clever-navy hover:bg-clever-light-blue/40",
              )}
              key={p.id}
              onClick={() => changePersona(p.id)}
              type="button"
            >
              {p.label}
            </button>
          ))}
          {persona !== "anyone" ? (
            <span className="text-clever-black/40 text-xs">· tailoring answers to this audience</span>
          ) : null}
        </div>
        <form className="mx-auto flex max-w-3xl gap-3" onSubmit={handleSubmit}>
          <input
            className="flex-1 rounded-xl border border-clever-light-blue bg-white px-4 py-3 text-clever-black placeholder:text-clever-black/40 focus:border-clever-blue focus:outline-none focus:ring-2 focus:ring-clever-blue/40 disabled:opacity-50"
            disabled={isBusy}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about SSO, rostering, logins, shared devices…"
            value={input}
          />
          <button
            className="rounded-xl bg-clever-blue px-6 py-3 font-medium text-white transition-colors hover:bg-clever-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isBusy || !input.trim()}
            type="submit"
          >
            Send
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-clever-black/40 text-xs">
          Answers are generated from Clever help-center articles. Always verify
          critical details in the official documentation.
        </p>
      </footer>
    </div>
  );
}
