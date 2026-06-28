"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from "eve/react";
import { CheckCircleIcon, ExternalLinkIcon, KeyRoundIcon, XCircleIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AnswerFeedbackControls } from "./answer-feedback";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
  persona,
  question,
  sessionId,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  // Answer-level feedback context — supplied by AgentChat. `sessionId` is the eve
  // server session id (agent.session.sessionId); paired with the message's turn
  // id it joins each feedback row to the logged inquiry. Optional so read-only
  // views (shared transcripts, the flag detail page) can render without them.
  readonly persona?: string;
  readonly question?: string;
  readonly sessionId?: string;
}) {
  const isUser = message.role === "user";
  // All support-search rendering lives in the single ThreadWorkPanel pinned at
  // the bottom of the thread, so search tool parts are excluded from the message.
  const bodyParts = message.parts.filter((part) => !isSearchToolPart(part));
  const lastTextIndex = bodyParts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  // Does the body actually render anything? Skip the whole message otherwise
  // (e.g. a turn that was purely a search) — no empty bubble.
  const hasBody = bodyParts.some((part) => {
    if (part.type === "step-start") return false;
    if (part.type === "text") return Boolean(part.text?.trim());
    if (part.type === "reasoning") return part.state === "streaming" || Boolean(part.text?.trim());
    return true;
  });

  if (!hasBody) return null;

  // The assistant's answer text (its renderable text parts), used as the original
  // answer for the feedback footer and the prefill for an expert inline edit.
  const answerText = assistantAnswerText(bodyParts);
  // The eve turn id this message belongs to — pairs with sessionId to correlate
  // feedback back to the logged inquiry. Same turn id the cost itemization uses.
  const turnId = message.metadata?.turnId;
  // Show the per-answer feedback footer only on a completed assistant answer that
  // we can actually correlate (sessionId + turnId present, no longer streaming).
  const showFeedback = !isUser && !isStreaming && Boolean(sessionId) && Boolean(turnId);

  return (
    <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] space-y-2 rounded-2xl px-5 py-3 text-sm data-[optimistic=true]:opacity-70",
          isUser
            ? "bg-clever-blue text-white"
            : "border border-clever-light-blue bg-clever-light-blue/40 text-clever-black",
        )}
        data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      >
        {bodyParts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            isUser={isUser}
            key={partKey(part, index)}
            onInputResponses={onInputResponses}
            part={part}
            showCaret={isStreaming && !isUser && index === lastTextIndex}
          />
        ))}
      </div>
      {showFeedback && sessionId && turnId ? (
        <AnswerFeedbackControls
          messageId={message.id}
          originalAnswer={answerText}
          persona={persona ?? "anyone"}
          question={question ?? ""}
          sessionId={sessionId}
          turnId={turnId}
        />
      ) : null}
    </div>
  );
}

// The assistant's answer as plain text — the renderable text parts joined. Used
// as the "original answer" snapshot and the inline-edit prefill.
function assistantAnswerText(parts: readonly EveMessagePart[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text.trim()) out.push(part.text);
  }
  return out.join("\n\n").trim();
}

// Support-search tool parts (any state) are excluded from the message body and
// surfaced only in the bottom ThreadWorkPanel.
function isSearchToolPart(part: EveMessagePart): part is EveDynamicToolPart {
  return part.type === "dynamic-tool" && part.toolName === "search_support";
}

function AgentMessagePart({
  canRespond,
  isUser,
  onInputResponses,
  part,
  showCaret,
}: {
  readonly canRespond: boolean;
  readonly isUser: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      // User text is plain; assistant text renders markdown with a streaming caret.
      return isUser ? (
        <p className="whitespace-pre-wrap leading-relaxed">{part.text}</p>
      ) : (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      // Skip empty reasoning, and don't force it open — it stays collapsed once
      // the turn is done (and on replayed/shared transcripts) so it isn't noise.
      if (part.state !== "streaming" && !part.text?.trim()) {
        return null;
      }
      return (
        <Reasoning isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool":
      // A human-in-the-loop input request renders as a clean prompt + choices,
      // not the generic tool card with a raw-JSON "Parameters" dump.
      if (part.toolMetadata?.eve?.inputRequest) {
        return (
          <InputRequestActions
            canRespond={canRespond}
            onInputResponses={onInputResponses}
            part={part}
          />
        );
      }
      // Completed support searches are pulled out and rendered as trust panels
      // at the bottom of the message (see AgentMessage); other/in-flight tools
      // still show the generic tool card.
      return (
        <Tool
          defaultOpen={part.state === "approval-requested" || part.state === "approval-responded"}
        >
          <ToolHeader
            state={part.state}
            title={part.toolName}
            toolName={part.toolName}
            type="dynamic-tool"
          />
          <ToolContent>
            <ToolInput input={part.input} />
            <InputRequestActions
              canRespond={canRespond}
              onInputResponses={onInputResponses}
              part={part}
            />
            <ToolOutput errorText={part.errorText} output={part.output} />
          </ToolContent>
        </Tool>
      );
  }
}

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-md border bg-white/70 p-3",
        isAuthorized
          ? "border-clever-green/40"
          : isCompleted
            ? "border-clever-orange/40"
            : "border-clever-blue/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-clever-green/10 text-clever-green"
              : isCompleted
                ? "bg-clever-orange/10 text-clever-orange"
                : "bg-clever-blue/10 text-clever-blue",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-clever-black/60 text-sm">{authorizationDescription(part)}</p>
          {shouldShowInstructions ? (
            <p className="text-clever-black/60 text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-clever-black/60">Code</span>
              <code className="rounded-md bg-clever-light-blue/60 px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `Connect ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected`;
  }
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return part.description;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected.`;
  }
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
}

function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );

  return (
    <div className="space-y-3 rounded-md border border-clever-yellow/50 bg-clever-yellow/10 p-3">
      <p className="text-clever-black/60 text-sm">{inputRequest.prompt}</p>
      {inputResponse ? (
        <p className="font-medium text-sm">
          Responded: {selectedOption?.label ?? inputResponse.text ?? inputResponse.optionId}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
