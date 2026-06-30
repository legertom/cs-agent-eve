import {
  ArrowLeftIcon,
  CoinsIcon,
  GavelIcon,
  MessageSquareIcon,
  PencilIcon,
  SearchCheckIcon,
  ShieldAlertIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { EveMessage } from "eve/react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InquiryFlag } from "@/app/_components/inquiry-flag";
import { MessageBubbles } from "@/app/_components/message-bubbles";
import { formatFeedbackDate, formatUsd, reasonBadgeClass, reasonLabel } from "@/lib/feedback";
import {
  type InquiryTurnSearch,
  listSessionInquiries,
  type SessionInquiryTurn,
} from "@/lib/inquiry-store";
import { cn } from "@/lib/utils";

// Threads are reconstructed from live per-turn logs; always render fresh.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thread — Clever Support Agent",
  description: "The full conversation behind a logged inquiry, with each turn's retrieval trail.",
};

type Props = { readonly params: Promise<{ sessionId: string }> };

// Reconstruct a run of turns as chat messages so it can be flagged into the same
// review queue as a live-chat thread (text transcript; the retrieval trail stays
// visible on the inquiry thread itself).
function turnsToMessages(turns: ReadonlyArray<SessionInquiryTurn>): EveMessage[] {
  const messages: EveMessage[] = [];
  for (const t of turns) {
    if (t.question) {
      messages.push({ id: `${t.turnId}-user`, role: "user", parts: [{ type: "text", text: t.question }] });
    }
    messages.push({
      id: `${t.turnId}-assistant`,
      role: "assistant",
      parts: [{ type: "text", text: t.answer || "(no answer captured)" }],
    });
  }
  return messages;
}

// Group a session's turns into its distinct inquiries (contiguous runs sharing an
// inquiry_no). Until the Haiku batch has segmented the session every turn's
// inquiryNo is null, in which case the whole session is treated as one inquiry.
type InquiryGroup = {
  readonly inquiryNo: number;
  readonly title: string | null;
  readonly turns: SessionInquiryTurn[];
};
function groupByInquiry(turns: ReadonlyArray<SessionInquiryTurn>): InquiryGroup[] {
  const groups: InquiryGroup[] = [];
  for (const t of turns) {
    const no = t.inquiryNo ?? 1;
    const last = groups[groups.length - 1];
    if (last && last.inquiryNo === no) last.turns.push(t);
    else groups.push({ inquiryNo: no, title: t.inquiryTitle ?? null, turns: [t] });
  }
  return groups;
}

export default async function InquiryThreadPage({ params }: Props) {
  const { sessionId } = await params;
  const turns = await listSessionInquiries(sessionId);
  if (turns.length === 0) notFound();

  const totalCost = turns.reduce((sum, t) => sum + t.totalCost, 0);
  const retrievalCount = turns.reduce((sum, t) => sum + t.searchCount, 0);
  const channel = turns.find((t) => t.channel)?.channel ?? "";

  const groups = groupByInquiry(turns);
  // "Segmented" = the Haiku batch has split this session into >1 distinct
  // inquiry. A single-inquiry (or not-yet-segmented) session renders flat.
  const segmented = groups.length > 1;
  const messages = turnsToMessages(turns);

  return (
    <main className="bg-white text-clever-black">
      <section className="relative overflow-hidden px-6 pt-12 pb-8">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-44 w-44 bg-clever-blue/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <Link
            className="inline-flex items-center gap-1.5 text-clever-blue text-sm transition-colors hover:text-clever-navy"
            href="/inquiries"
          >
            <ArrowLeftIcon className="size-4" />
            All inquiries
          </Link>
          <p className="mt-6 inline-flex items-center gap-1.5 font-semibold text-clever-blue text-xs uppercase tracking-wider">
            <MessageSquareIcon className="size-3.5" />
            Conversation
          </p>
          <h1 className="mt-1 font-normal text-4xl text-clever-navy leading-[1.05] sm:text-5xl">
            Thread
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-clever-black/50 text-sm">
            <span>
              {turns.length} {turns.length === 1 ? "turn" : "turns"}
            </span>
            {segmented ? (
              <span>
                · {groups.length} {groups.length === 1 ? "inquiry" : "inquiries"}
              </span>
            ) : null}
            <span>· {channelLabel(channel)}</span>
            <span className="inline-flex items-center gap-1">
              ·<CoinsIcon className="size-3 text-clever-blue/60" /> {formatUsd(totalCost)} total
            </span>
            <span>· started {formatFeedbackDate(turns[0].createdAt)}</span>
          </p>
          <p className="mt-2 break-all font-mono text-clever-black/35 text-xs">session {sessionId}</p>
          {/* When segmented, flagging lives per-inquiry (below) so flagging one
              inquiry doesn't staple N unrelated ones into one review item. */}
          {segmented ? (
            <p className="mt-4 text-clever-black/45 text-sm">
              This session holds {groups.length} distinct inquiries — flag whichever one needs the team.
            </p>
          ) : (
            <div className="mt-5">
              <InquiryFlag
                messages={messages}
                persona="anyone"
                retrievalCount={retrievalCount}
                threadCost={totalCost}
              />
            </div>
          )}
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl space-y-8">
          {(() => {
            let turnIndex = 0;
            return groups.map((group) => {
              const start = turnIndex;
              turnIndex += group.turns.length;
              return (
                <InquirySection
                  group={group}
                  key={group.inquiryNo}
                  showHeader={segmented}
                  startIndex={start}
                />
              );
            });
          })()}
        </div>
      </section>
    </main>
  );
}

// One distinct inquiry within the session, rendered as the conversation it
// originally was: a titled heading (when segmented) + its own scoped flag, the
// chat bubbles (same look as the live chat and the flagged-thread view), and a
// collapsed "Show your work" panel holding each turn's retrieval trail + auto-eval
// so the analytics stay one click away without cluttering the conversation.
function InquirySection({
  group,
  startIndex,
  showHeader,
}: {
  readonly group: InquiryGroup;
  readonly startIndex: number;
  readonly showHeader: boolean;
}) {
  const cost = group.turns.reduce((s, t) => s + t.totalCost, 0);
  const retrievalCount = group.turns.reduce((s, t) => s + t.searchCount, 0);
  const messages = turnsToMessages(group.turns);
  return (
    <div className="space-y-4">
      {showHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-clever-light-blue/70 border-b pb-2">
          <h2 className="flex min-w-0 items-center gap-2 font-medium text-clever-navy">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-clever-blue/10 font-semibold text-[11px] text-clever-blue tabular-nums">
              {group.inquiryNo}
            </span>
            <span className="truncate">{group.title ?? `Inquiry ${group.inquiryNo}`}</span>
          </h2>
          <InquiryFlag
            messages={messages}
            persona="anyone"
            retrievalCount={retrievalCount}
            threadCost={cost}
          />
        </div>
      ) : null}

      {/* The conversation as chat bubbles, one anchor per turn so the inquiries
          log's #turn-<id> deep links still land. */}
      {group.turns.map((turn) => (
        <div className="scroll-mt-6" id={`turn-${turn.turnId}`} key={turn.turnId}>
          <MessageBubbles messages={turnsToMessages([turn])} />
        </div>
      ))}

      <WorkTrail startIndex={startIndex} turns={group.turns} />
    </div>
  );
}

// Collapsed-by-default work panel for one inquiry: each turn's cost, retrieval
// confidence, signals, the full retrieval trail, and the judge's auto-eval.
function WorkTrail({
  turns,
  startIndex,
}: {
  readonly turns: ReadonlyArray<SessionInquiryTurn>;
  readonly startIndex: number;
}) {
  const cost = turns.reduce((s, t) => s + t.totalCost, 0);
  const searchCount = turns.reduce((s, t) => s + t.searchCount, 0);
  return (
    <details className="group overflow-hidden rounded-xl border border-clever-light-blue bg-clever-light-blue/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-clever-black/55 text-xs hover:bg-clever-light-blue/20">
        <SearchCheckIcon className="size-3.5 text-clever-blue/60" />
        <span className="font-medium">Show the work</span>
        <span className="text-clever-black/40">
          · {searchCount === 0 ? "no search" : `${searchCount} search${searchCount === 1 ? "" : "es"}`}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-clever-black/45 tabular-nums">
          <CoinsIcon className="size-3 text-clever-blue/60" />
          {formatUsd(cost)}
        </span>
      </summary>
      <div className="space-y-5 border-clever-light-blue/70 border-t px-4 py-4">
        {turns.map((turn, i) => (
          <TurnWork index={startIndex + i + 1} key={turn.turnId} turn={turn} />
        ))}
      </div>
    </details>
  );
}

// One turn's analytics inside the work panel: meta line + retrieval trail + eval.
function TurnWork({ turn, index }: { readonly turn: SessionInquiryTurn; readonly index: number }) {
  const weak =
    turn.searchCount > 0 && (turn.topConfidence === "low" || turn.topConfidence === "unscored");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-clever-black/45 text-xs">
        <span className="font-medium text-clever-navy/70">Turn {index}</span>
        <span>· {formatFeedbackDate(turn.createdAt)}</span>
        <span className="inline-flex items-center gap-1">
          ·<CoinsIcon className="size-3 text-clever-blue/60" /> {formatUsd(turn.totalCost)}
        </span>
        {turn.searchCount > 0 ? (
          <span>
            · {turn.searchCount} search{turn.searchCount === 1 ? "" : "es"} · {turn.topConfidence}{" "}
            confidence
          </span>
        ) : (
          <span>· no search</span>
        )}
        {weak ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-clever-orange/10 px-2 py-0.5 font-medium text-[10px] text-clever-orange">
            <ShieldAlertIcon className="size-3" />
            low confidence
          </span>
        ) : null}
        <span className="ml-auto">
          <SignalChips turn={turn} />
        </span>
      </div>

      {turn.searches.length > 0 ? <RetrievalTrail searches={turn.searches} /> : null}
      {turn.judged ? <JudgeNote turn={turn} /> : null}
    </div>
  );
}

function RetrievalTrail({ searches }: { readonly searches: ReadonlyArray<InquiryTurnSearch> }) {
  return (
    <div>
      <p className="mb-2 inline-flex items-center gap-1.5 font-medium text-clever-black/40 text-[11px] uppercase tracking-wide">
        <SearchCheckIcon className="size-3.5" />
        Retrieval trail
      </p>
      <div className="space-y-3">
        {searches.map((s, i) => (
          <div
            className="rounded-xl border border-clever-light-blue/70 bg-clever-light-blue/10 p-3"
            // biome-ignore lint/suspicious/noArrayIndexKey: searches have no stable id
            key={i}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {s.query ? (
                <span className="font-mono text-clever-navy/70">“{s.query}”</span>
              ) : null}
              {s.confidence?.level ? (
                <span className="rounded-full bg-clever-light-blue/60 px-2 py-0.5 font-medium text-[10px] text-clever-navy/70">
                  {s.confidence.level} confidence
                </span>
              ) : null}
              {s.method ? <span className="text-clever-black/35">{s.method}</span> : null}
            </div>
            {s.sources && s.sources.length > 0 ? (
              <ol className="mt-2 space-y-1">
                {s.sources.map((src) => (
                  <li
                    className="flex items-baseline gap-2 text-sm"
                    key={`${src.rank}-${src.url ?? src.title}`}
                  >
                    <span className="w-4 shrink-0 text-right text-clever-black/35 text-xs tabular-nums">
                      {src.rank ?? "·"}
                    </span>
                    {src.url ? (
                      <a
                        className="min-w-0 flex-1 truncate text-clever-blue hover:text-clever-navy hover:underline"
                        href={src.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {src.title ?? src.url}
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-clever-navy">
                        {src.title ?? "(untitled)"}
                      </span>
                    )}
                    {typeof src.score === "number" ? (
                      <span className="shrink-0 text-clever-black/40 text-xs tabular-nums">
                        {src.score.toFixed(2)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function JudgeNote({ turn }: { readonly turn: SessionInquiryTurn }) {
  const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
  return (
    <div className="rounded-xl border border-clever-light-blue/70 bg-white p-3">
      <p className="inline-flex items-center gap-1.5 font-medium text-clever-black/40 text-[11px] uppercase tracking-wide">
        <GavelIcon className="size-3.5" />
        Auto-eval
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {turn.judgeHallucination ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-clever-orange/50 bg-clever-orange/10 px-2 py-0.5 font-medium text-[10px] text-clever-orange">
            <TriangleAlertIcon className="size-3" />
            possible hallucination
          </span>
        ) : null}
        <span className="rounded-full border border-clever-light-blue bg-clever-light-blue/30 px-2 py-0.5 font-medium text-[10px] text-clever-navy/70 tabular-nums">
          Grounded {pct(turn.judgeGroundedness)} · Relevant {pct(turn.judgeRelevance)}
        </span>
      </div>
      {turn.judgeVerdict ? (
        <p className="mt-2 text-clever-black/55 text-sm leading-relaxed">{turn.judgeVerdict}</p>
      ) : null}
      <p className="mt-1.5 text-clever-black/35 text-xs">
        Groundedness is a strong signal — the judge reads the full article bodies of the retrieved sources.
      </p>
    </div>
  );
}

function SignalChips({ turn }: { readonly turn: SessionInquiryTurn }) {
  const up = turn.up ?? 0;
  const down = turn.down ?? 0;
  const edits = turn.edits ?? 0;
  if (up === 0 && down === 0 && edits === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {up > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-clever-blue/30 bg-clever-blue/10 px-2 py-0.5 font-medium text-[10px] text-clever-blue tabular-nums">
          <ThumbsUpIcon className="size-3" />
          {up}
        </span>
      ) : null}
      {down > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-clever-orange/50 bg-clever-orange/10 px-2 py-0.5 font-medium text-[10px] text-clever-orange tabular-nums">
          <ThumbsDownIcon className="size-3" />
          {down}
        </span>
      ) : null}
      {turn.downReason ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-[10px]",
            reasonBadgeClass(turn.downReason),
          )}
        >
          {reasonLabel(turn.downReason)}
        </span>
      ) : null}
      {edits > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-clever-green/40 bg-clever-green/10 px-2 py-0.5 font-medium text-[10px] text-clever-green tabular-nums">
          <PencilIcon className="size-3" />
          {edits}
        </span>
      ) : null}
    </span>
  );
}

// "channel:eve" → "Web", "channel:discord" → "Discord", else best-effort.
function channelLabel(kind: string): string {
  const k = kind.replace(/^channel:/, "");
  if (k === "eve") return "Web";
  if (!k || k === "unknown") return "Unknown";
  return k.charAt(0).toUpperCase() + k.slice(1);
}
