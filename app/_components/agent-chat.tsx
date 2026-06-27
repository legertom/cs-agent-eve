"use client";

import { useEveAgent } from "eve/react";
import { AlertCircleIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AgentMessage } from "./agent-message";

const SUGGESTED_QUESTIONS = [
  "How do I set up Google SSO?",
  "Why do students get logged out on shared Chromebooks?",
  "How do I configure languages in Clever?",
  "Students can't see their apps — what should I check?",
];

export function AgentChat() {
  const agent = useEveAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.data.messages]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    void agent.send({ message: trimmed });
    setInput("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(input);
  }

  function resetChat() {
    agent.reset();
    setInput("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {isEmpty ? null : (
            <div className="flex justify-end">
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
