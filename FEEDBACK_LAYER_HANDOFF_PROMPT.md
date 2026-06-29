# HANDOFF PROMPT — "Answer-Level Feedback Intelligence Layer" for the Clever Support Agent

You are an autonomous **Opus 4.8 "ultracode"** coding agent. Read this entire prompt before touching anything. It is fully self-contained: you have no access to the conversation that produced it. Every file path, schema, and API fact below was verified against the live repo, but where a fact is marked **VERIFY-FIRST**, you MUST confirm it in code/at runtime before relying on it — do not trust it blindly, and do not invent paths or APIs that aren't named here.

---

## 1. Mission & Role

Ship, end-to-end and correctly, an "answer-level feedback intelligence layer" on top of an existing, deployed Clever customer-support RAG agent. There are three parts, but **A and B are one vertical slice** (same table, same route, same UI footer, three "kinds") and are the **must-ship core**; **C is a stretch** that is strictly gated behind A+B passing verification.

- **A. Per-answer human feedback** — thumbs up / thumbs down on each assistant answer in the web chat, with an optional one-tap reason and note on 👎. Persisted to Neon, keyed to the already-logged inquiry by `(session_id, turn_id)` plus the chat `message.id`. This is **distinct** from the existing thread-level "Flag".
- **B. Expert inline-edit capture** — a CS-agent clicks "edit answer", edits the assistant's answer text inline, and submits "this is what I'd actually send." Store BOTH the original answer and the corrected text. (This is the highest-value eval/training signal — treat it with care.) **B reuses A's table, route, and footer with `kind: 'edit'`.**
- **C. LLM-as-judge auto-eval (STRETCH)** — score every logged inquiry for **groundedness/faithfulness**, **answer-relevance**, and a **hallucination flag**, using a CHEAP model through the Vercel AI Gateway, mirroring exactly how the repo already calls the gateway. Persist scores on the inquiry row. Then surface signals in the existing `/inquiries` dashboard.

### Binding scope contract (read carefully)

- **Do A+B first, fully, and verify them** against the full §7 protocol (typecheck + dev-server compile-log + real-Neon SQL + the §7.5 correlation round-trip), then **commit and push A+B**.
- **Do NOT begin C until A+B verification is green and committed.** If A+B verification cannot be made green, **ship A+B alone and stop** — do not start C.
- Within C, the **mandatory** surface is the minimum that delivers signal: the judge columns on `inquiries`, the batch route that scores rows, and the **simplest per-row presence chips** on `/inquiries` (see §4.D-min). **Cron config and the full aggregate analytics tiles are explicitly "C-stretch, only if time"** — a judged-but-manually-triggered C with presence chips is a complete, shippable C.

Definition of success: the shipped scope works against the real Neon database and (for C) the real AI Gateway, `npm run typecheck` is clean, the dev server compiles each new route with no errors, and the change is committed and pushed to `main` (which auto-deploys to prod). Do not break the existing turn-itemization, the inquiry-logging hook, or the turn pipeline.

---

## 2. Product Context, Stack & Current State

**The app:** a Clever customer-support RAG agent built on the Vercel **eve** framework. It answers questions about Clever (SSO, rostering, logins, shared devices, admin setup) grounded in the Clever help center. It has a **web chat UI** and a **Discord channel**. Audience: a handful of internal Clever CS-agent testers. **No PII expected** (internal tool) — but public HTTP routes must still be rate-limited and sanitized, exactly as the existing ones are.

**Stack (verified from `package.json`):**
- `eve` ^0.16.2 (Vercel's agent framework)
- Next.js `16.2.6`, App Router, React 19
- AI SDK `ai` ^7.0.0, `@ai-sdk/gateway` (Vercel AI Gateway)
- Neon Postgres (via Vercel integration; `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in `.env.local`)
- Vercel Blob (used by share/feedback persistence for blobs)
- Node 24.x
- TypeScript, `moduleResolution: Bundler`, path alias `@/*` → project root
- No linter/formatter config exists; match the existing code style (double quotes, 2-space indent, `cn()` for class merging).

**What already exists and works (do not regress):**
- Hybrid + reranked retrieval with a confidence band (`high`/`medium`/`low`/`unscored`) and per-turn cost ("Show your work"), itemized per turn. Retrieval pricing lives in `lib/search.ts`; inference pricing in `lib/inference-cost.ts`.
- **Recent fixes you must not undo:** turn-itemized cost is computed by grouping `step.completed` stream events by `turnId` into `inferenceByTurn`, then mapping each `message.id` → its turn's inference cost via `message.metadata?.turnId` (see `app/_components/agent-chat.tsx`). The thread record is a single bottom-pinned panel (`ThreadWorkPanel`), and the doubled-answer-cost bug was fixed. Treat this accounting as load-bearing.
- **Thread-level "Flag"** (the existing feedback flow): client `app/_components/feedback-form.tsx` → POST `app/api/feedback/route.ts` → `lib/feedback-store.ts` → Neon table `flagged_threads`. Reviewed at `/feedback` (the top-nav label for this is **"Flagged"** — note the label→route mismatch; review pages are `app/feedback/page.tsx` and `app/feedback/[id]/page.tsx`).
- **Inquiry logging (just added):** a server-side eve hook `agent/hooks/log-inquiry.ts` logs EVERY turn (web AND Discord) to Neon table `inquiries` via `lib/inquiry-store.ts`. An analytics dashboard lives at `app/inquiries/page.tsx`.

---

## 3. Exact Codebase Map (real paths, patterns, schemas — cite these, mirror these)

> Before writing any eve code, READ the installed eve docs at `node_modules/eve/docs/` — especially `node_modules/eve/docs/guides/hooks.md` and `node_modules/eve/docs/guides/state.md`. They are authoritative for this eve version. Fall back to https://eve.dev/docs only if a doc is missing.

### Client (web chat) — `app/_components/` (all `"use client"`)
- `agent-chat.tsx` — top-level chat. Uses `const agent = useEveAgent()` (from `"eve/react"`). Computes `threadCost`, `retrievalCount`, `inferenceByTurn` (Map of `turnId`→USD from `step.completed` events), and `inferenceByMessageId` (Record `message.id`→USD). Renders `agent.data.messages.map((message, index) => <AgentMessage ... message={message} .../>)`. `isBusy = agent.status === "submitted" || agent.status === "streaming"`. Has a sticky persona selector (localStorage key `clever-persona`) that rides as ephemeral `clientContext` on `agent.send(...)`.
- `agent-message.tsx` — renders ONE message. **Type origins (verified):** `EveMessage` and `EveMessagePart` are imported from `"eve/react"` (agent-message.tsx:6–7); `AgentInputResponse` is a **LOCAL** type declared in agent-message.tsx:22 (it is NOT exported from `eve/react` — do not try to import it). Current props type (verified):
  ```ts
  // props type is declared inline/locally in agent-message.tsx
  {
    readonly canRespond: boolean;
    readonly isStreaming: boolean;
    readonly message: EveMessage;            // from "eve/react"
    readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>; // AgentInputResponse is local
  }
  ```
  Assistant text renders inside a `rounded-2xl` bubble: `border border-clever-light-blue bg-clever-light-blue/40 text-clever-black`. `isUser = message.role === "user"`. `bodyParts = message.parts.filter(part => !isSearchToolPart(part))`. Returns `null` when there's no renderable body. **The footer row below the assistant bubble is your attachment point for the thumbs/edit controls.** Add your new props (`sessionId?`, `persona?`, `question?`) to this **local** props type — do not import them from anywhere.
- `feedback-form.tsx` — the existing thread-level flag form. POSTs `{ messages, reason, note, reporter?, persona, title, threadCost, retrievalCount, inferenceByMessageId, retrievals }` to `/api/feedback`. Uses `FeedbackReason` state (default `"hallucination"`), remembers reporter in localStorage (key `clever-reporter`). **NOTE (verified): it does NOT currently send `sessionId`.** Mirror its structure for your new forms.
- `feedback-detail.tsx` — read-only investigation view (renders a `FeedbackPayload` via `AgentMessage` + `ThreadWorkPanel`).
- `thread-work-panel.tsx`, `support-search-panel.tsx` (exports `retrievalCostTotal`), `nav.tsx` (top nav: Chat→`/`, Browse→`/browse`, Inquiries→`/inquiries`, **Flagged→`/feedback`**, Features→`/features`, How it works→`/about`).

### Shared, pure libs — `lib/` (no eve/server-only AND no client-only imports; safe both sides)
- `lib/inference-cost.ts` — **pure & client-safe.** Exports `ANSWER_MODEL = "anthropic/claude-sonnet-4.6"` (the dot form is correct here, not hyphenated), `type StepUsage`, and `priceInferenceUsage(usage)`. **REUSE this for any pricing; do NOT hardcode prices.** Sonnet 4.6 list price encoded here: input $3.00/1M, output $15.00/1M, cache-read $0.30/1M, cache-write $3.75/1M.
- `lib/feedback.ts` — pure. Exports `FEEDBACK_REASONS` (ids: `hallucination`, `wrong`, `incomplete`, `bad-source`, `other`, each `{id,label,hint}`), `type FeedbackReason`, `isFeedbackReason(v)`, `reasonLabel(id)`, `reasonBadgeClass(id)`, `formatUsd(n)`, `formatFeedbackDate(iso)` (UTC, hydration-safe), and constants `MAX_NOTE_LENGTH = 4000`, `MAX_REPORTER_LENGTH = 120`, `MAX_FEEDBACK_MESSAGES = 200`, `MAX_FEEDBACK_BYTES = 1_500_000`. **REUSE `FEEDBACK_REASONS`/`isFeedbackReason` for part A's reason taxonomy.**
- `lib/db.ts` — exports `getSql()` (lazy Neon client from `process.env.DATABASE_URL ?? process.env.POSTGRES_URL`). All DB code goes through this.
- `lib/inquiry-store.ts` — **the core file you extend for C.** See its DDL and functions below.
- `lib/feedback-store.ts` — the pattern to mirror for a new store: memoized `ensureSchema()`, `newId()` (9 random bytes → base64url, 12 chars), `ID_RE = /^[A-Za-z0-9_-]{1,64}$/`, `saveFeedback`, `loadFeedback`, `listFeedback`, `feedbackAnalytics`, all wrapped in try/catch with graceful fallback.
- `lib/search.ts` — retrieval core; shows the gateway usage pattern (`gateway`, `embed`, `rerank` from `ai`/`@ai-sdk/gateway`).

### Server — eve hook & API routes
- `agent/hooks/log-inquiry.ts` — **observe-only** eve hook, auto-discovered. Aggregates a turn via `defineState("clever.inquiry-log", () => emptyTurn(""))` with a rebasing `onTurn(turnId, mutate)` that resets the accumulator when `turnId` changes. Captures `message.received`, `action.result`, `step.completed`, `message.completed`, and `turn.completed`. **Every handler is wrapped in try/catch** — a thrown hook surfaces as `turn.failed` and breaks the user's turn. On `turn.completed` it calls `logInquiry({ sessionId: ctx.session.id, turnId: acc.turnId, channel: ctx.channel.kind ?? "", question, answer, searchCount, topConfidence, retrievalCost, answerCost, totalCost, inputTokens, outputTokens, model: ANSWER_MODEL, payload: { searches, usage, model } })`. **You do NOT need to modify this hook.**
  - **CRITICAL FACT about the logged payload (verified):** each entry in `payload.searches[].sources` is exactly `{ rank, title, url, score }` (see the hook mapping in `agent/hooks/log-inquiry.ts` and the `InquirySearchLog` type in `lib/inquiry-store.ts`). **There is NO article body, excerpt, snippet, or content text persisted anywhere in the inquiry payload.** This is load-bearing for the judge (§4.C): the only grounding material available from the stored payload is `question`, `answer`, and `{rank,title,url,score}` per source.
- `app/api/feedback/route.ts` — the gold-standard public POST route to mirror. Verified specifics to copy:
  - **Rate limit:** in-memory `Map<string,{count,resetAt}>`, `RATE_LIMIT = 20`, `RATE_WINDOW_MS = 60_000`, IP from `request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"`, prune when `hits.size > 5000`. On limit: `429` with `retry-after: 60`. (Per-warm-instance on Fluid Compute — acceptable.)
  - **Size guards:** `MAX_FEEDBACK_BYTES = 1_500_000` (check `content-length` → `413`), plus `MAX_NOTE_LENGTH`, `MAX_REPORTER_LENGTH` (from `lib/feedback.ts`).
  - **Validation order:** rate-limit → content-length → `request.json()` (catch → `400`) → field validation → `isFeedbackReason(reason)` → sanitize → persist. Uses `str(value, fallback, max)` and `num(value)` helper lambdas (trim + slice; finite-number check). `createdAt` set in the route via `new Date().toISOString()`.
- `app/api/mcp/route.ts` — **the gateway inference pattern to mirror for part C.** Verified:
  ```ts
  import { generateText } from "ai";
  import { gateway } from "@ai-sdk/gateway";
  const { text } = await generateText({ model: gateway(MODEL_ID), system, prompt });
  ```
  `generateObject` is NOT used in this repo. **For structured JSON output, instruct the model to emit JSON in the system prompt and parse `text` yourself with a Zod-or-manual safety layer.**
- `app/api/share/` — another public route (10/min rate limit) using Vercel Blob.

### The existing `inquiries` table — VERIFIED DDL (from `lib/inquiry-store.ts`)
```sql
CREATE TABLE IF NOT EXISTS inquiries (
  session_id     text NOT NULL,
  turn_id        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  channel        text NOT NULL DEFAULT '',
  question       text NOT NULL DEFAULT '',
  answer         text NOT NULL DEFAULT '',
  search_count   integer NOT NULL DEFAULT 0,
  top_confidence text NOT NULL DEFAULT 'unscored',
  retrieval_cost double precision NOT NULL DEFAULT 0,
  answer_cost    double precision NOT NULL DEFAULT 0,
  total_cost     double precision NOT NULL DEFAULT 0,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  model          text NOT NULL DEFAULT '',
  payload        jsonb NOT NULL,
  PRIMARY KEY (session_id, turn_id)
);
CREATE INDEX IF NOT EXISTS inquiries_created_at_idx ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_channel_idx ON inquiries (channel);
```
Existing functions in `lib/inquiry-store.ts`: `logInquiry(record)` (INSERT ... `ON CONFLICT (session_id, turn_id) DO NOTHING`), `listInquiries(limit=100)`, `inquiryAnalytics()`, plus types `InquiryRecord`, `InquirySummary`, `InquiryAnalytics`, `InquirySearchLog`, and helper `bestConfidence(levels)`. `ensureSchema()` is memoized in a module-level `schemaReady` Promise that nulls itself on failure to allow retry.

---

## 4. Detailed Spec for A, B, C

### Data model — DECISION (follow this exactly)

Two design choices, already decided based on the table layout:

1. **Judge results (C): add columns directly to `inquiries`** (1:1 with an inquiry, nullable). Do NOT make a separate judge table. This keeps the dashboard a single-table query.
2. **Human feedback (A) and edits (B): one new table `answer_feedback`**, keyed by `(session_id, turn_id, message_id, kind)`. A separate table (not columns on `inquiries`) because: there can be multiple feedback events per turn (a thumb AND an edit, or a thumb that's later changed), it correlates to a specific chat `message.id`, and **it must accept rows even if the inquiry row hasn't been written yet** (the hook and the client race) — so do NOT use a hard FK. Correlate by `(session_id, turn_id)` in queries via LEFT JOIN, and the join MUST tolerate (a) inquiry rows with no matching feedback and (b) feedback rows with no matching inquiry, rendering "no signal" rather than dropping/erroring on either side.

**New table `answer_feedback`** — create in a new memoized `ensureSchema()` inside a new file `lib/answer-feedback-store.ts` (mirror `lib/feedback-store.ts`):
```sql
CREATE TABLE IF NOT EXISTS answer_feedback (
  session_id      text NOT NULL,
  turn_id         text NOT NULL,
  message_id      text NOT NULL,
  kind            text NOT NULL,          -- 'up' | 'down' | 'edit'
  created_at      timestamptz NOT NULL DEFAULT now(),
  reason          text,                   -- nullable; only for 'down', a FeedbackReason id
  note            text NOT NULL DEFAULT '',
  reporter        text,
  persona         text NOT NULL DEFAULT 'anyone',
  question        text NOT NULL DEFAULT '',
  original_answer text NOT NULL DEFAULT '',  -- the assistant's answer at time of feedback
  edited_answer   text,                    -- nullable; for kind='edit', "what I'd actually send"
  PRIMARY KEY (session_id, turn_id, message_id, kind)
);
CREATE INDEX IF NOT EXISTS answer_feedback_created_at_idx ON answer_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS answer_feedback_lookup_idx ON answer_feedback (session_id, turn_id);
```
Persist with `INSERT ... ON CONFLICT (session_id, turn_id, message_id, kind) DO UPDATE SET ...` so a user can flip 👍↔👎 (different `kind` rows) or re-edit idempotently (last write wins for that kind). This is the answer-level analog of the existing `ON CONFLICT` idempotency.

**Judge columns (C only) — `ALTER` idempotently inside the EXISTING memoized `ensureSchema()` in `lib/inquiry-store.ts`** (Postgres supports `ADD COLUMN IF NOT EXISTS`):
```sql
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_groundedness  double precision;  -- 0..1, faithfulness to sources
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_relevance     double precision;  -- 0..1, answer-relevance to question
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_hallucination boolean;           -- true = unsupported claims present
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_verdict       text;              -- short human-readable summary / reasoning
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_model         text;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judged_at           timestamptz;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS judge_attempts      integer NOT NULL DEFAULT 0;  -- poison-row guard, see §4.C
CREATE INDEX IF NOT EXISTS inquiries_judged_at_idx ON inquiries (judged_at DESC) WHERE judged_at IS NOT NULL;
```
> **WARNING (regression risk):** `logInquiry()` awaits this same `ensureSchema()`. If an `ALTER` errors, the memoized promise rejects and inquiry logging silently stops (the hook's try/catch keeps the turn alive, but rows stop being written). The `ADD COLUMN IF NOT EXISTS` form is idempotent and should not error on re-run; nonetheless you MUST verify in §7.3 that **a fresh `logInquiry()` still writes a row end-to-end after the migration**. Keep the ALTERs in the same memoized block (run once, reset-on-failure to match existing behavior).

### A. Per-answer thumbs up/down — UI + route

**UI placement:** add a small footer action row that renders only for **assistant** messages with a body, inside `agent-message.tsx`, directly under the `rounded-2xl` bubble (in the negative space below it). Controls:
- A `ThumbsUp` and `ThumbsDown` icon button (from `lucide-react`, `className="size-3.5"`), styled like existing icon buttons: `inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors`, default `border-clever-light-blue bg-white text-clever-navy hover:bg-clever-light-blue/50`, active state in `clever-blue` (up) / `clever-orange` (down). Add `hover:opacity-80`.
- On 👎, reveal an inline one-tap reason picker built from `FEEDBACK_REASONS` (reuse `reasonLabel`) plus an optional `<textarea>` note. Keep it compact (a popover/disclosure under the buttons), not a full modal.
- Optimistic local state per message (e.g. `idle | up | down | saving | saved | error`); show a tiny check on success, mirroring the `CheckIcon` success affordance used elsewhere.

**Wiring `agent-message.tsx` → needs `sessionId`:** `AgentMessage` does not currently receive `sessionId` or the persona. **Add three new optional props** to `AgentMessage`'s local props type: `sessionId?: string`, `persona?: string`, and `question?: string`, and pass them down from `agent-chat.tsx`'s `.map(...)`. Get `turnId` from `message.metadata?.turnId` and `messageId` from `message.id` (both already available). Get the user question for context from the preceding user message — pass it in from `agent-chat.tsx` (it has the full `messages` array) rather than reconstructing it in `agent-message.tsx`.

> **VERIFY-FIRST — how to obtain `sessionId` on the client (this is the load-bearing correlation key).** The fact base claims `agent.session.sessionId` exists, but the eve client type `SessionState` declares it **optional** (`readonly sessionId?: string`, `node_modules/eve/dist/src/client/types.d.ts`) and **no current client code reads it** (`grep -rn "session.sessionId" app/` returns nothing). Note the two distinct shapes: the snapshot `SessionState.sessionId` is optional, while the per-turn payload (client `types.d.ts`, the per-turn entry) declares a **required** `sessionId` that is "always populated". Before building on it:
> 1. Read `node_modules/eve/dist/src/react/use-eve-agent.d.ts` (`UseEveAgentSnapshot` exposes `session: SessionState`) and confirm the snapshot shape.
> 2. At runtime, log `agent.session?.sessionId` in `agent-chat.tsx` after a turn and confirm it is populated (these controls only render once there is an assistant message, i.e. after at least one turn).
> 3. **If `agent.session.sessionId` is reliably populated once a turn exists, use it** and document the decision in a code comment.
> 4. **Acceptable fallbacks IF AND ONLY IF step 3 fails** (in priority order):
>    - Read the per-turn `sessionId` off the stream events in `agent.events` (the type doc says per-turn `sessionId` is always populated).
>    - Use any documented eve client API that returns the server session id (e.g. off the `send` response), if one exists.
>    **DO NOT** mint a synthetic client id and stuff it into `clientContext`. `clientContext` is **ephemeral, model-facing prompt text** (it is injected into the LLM's context) and does **NOT** flow into the server hook's `ctx.session.id` — doing this would corrupt the model's prompt with a UUID AND silently fail to correlate. The whole point is correlation by `(session_id, turn_id)`; an id that won't match the inquiry row is worse than useless.
> 5. **If you cannot obtain a server `sessionId` that matches `ctx.session.id` by any safe means, STOP and surface the blocker** rather than shipping a non-correlating key. The §7.5 round-trip is a HARD gate: if feedback rows don't join to inquiry rows, the sessionId approach is wrong and must be fixed before A is "done".

**Route:** add `app/api/answer-feedback/route.ts`, mirroring `app/api/feedback/route.ts` exactly (rate-limit Map 20/60s, `x-forwarded-for` IP, content-length guard → 413, JSON parse guard → 400, `str`/`num` sanitizers, graceful 4xx/5xx). Accept body `{ sessionId, turnId, messageId, kind: 'up'|'down'|'edit', reason?, note?, reporter?, persona?, question?, originalAnswer?, editedAnswer? }`. Validate: `sessionId`/`turnId`/`messageId` are non-empty strings matching a safe charset — note `turnId` is like `"turn_0"` and `messageId` may contain other safe chars, so use `/^[A-Za-z0-9_\-:.]{1,128}$/`; `kind` ∈ the three values; if `kind==='down'` and `reason` present, require `isFeedbackReason(reason)`; cap `note` (reuse `MAX_NOTE_LENGTH`), `reporter` (reuse `MAX_REPORTER_LENGTH`), and `editedAnswer`/`originalAnswer` (cap at e.g. 20_000 chars). Call a new `saveAnswerFeedback(...)` in `lib/answer-feedback-store.ts`. Return `{ ok: true }`.

### B. Expert inline-edit capture — UI + route

Reuse the SAME `answer_feedback` table and the SAME `/api/answer-feedback` route with `kind: 'edit'`.

**UI:** add an "Edit answer" affordance (a `Pencil`/`SquarePen` lucide icon button) in the same footer row. On click, swap the rendered answer text into an editable `<textarea>` prefilled with the assistant's current answer text (concatenate the `text` parts of `bodyParts`). Show "Submit correction" / "Cancel". On submit, POST `{ kind: 'edit', originalAnswer, editedAnswer, sessionId, turnId, messageId, question, persona, reporter? }`. Store BOTH `original_answer` and `edited_answer`. After submit, show a subtle "Saved your correction" confirmation; do NOT mutate the live transcript or trigger a new agent turn (this is data capture, not a re-ask). Remember the reporter name in localStorage as `feedback-form.tsx` does (key `clever-reporter`).

### C. LLM-as-judge auto-eval — model, prompt, run strategy (STRETCH; do only after A+B are green and committed)

**Run strategy — DECISION: a batch route, NOT inline in the eve hook.** Justification: (1) judge calls add ~2–5s latency; running them inline in `turn.completed` would slow the user's turn or risk a thrown hook → `turn.failed`; (2) batching N unjudged rows per run amortizes cost; (3) decouples judge reliability from agent SLA; (4) the inquiry payload already has what the judge can use, so no hook change is required.

> **Mandatory C surface vs. C-stretch:** the **mandatory** part of C is the judge columns, the batch route, `updateInquiryJudgment`, defensive parsing, the cost guards below, and the §4.D-min presence chips. **Cron config (`vercel.json crons`) is C-stretch** — if cron setup is blocked or time-constrained, ship the **authenticated manual POST route you can `curl`** and stop; that is a complete C. Aggregate analytics tiles (§4.D-stretch) are also C-stretch.

**CRITICAL grounding limitation (verified):** the stored `payload.searches[].sources` contains only `{ rank, title, url, score }` — **NO article body/excerpt/snippet**. Therefore the judge can ground only against `question`, `answer`, and the source `title`+`url`+`rank`. **Do NOT instruct the model to use "excerpt/text" from sources — none exists.** Choose ONE and document it in a code comment:
- (a) **Accept the limitation (recommended for the stretch):** judge groundedness/relevance using `question` + `answer` + the source list (`rank`, `title`, `url`). State explicitly in `JUDGE_SYSTEM` that the model sees only source titles/URLs (not full article bodies) and must judge whether the answer's claims are *plausibly consistent with and attributable to* those titled sources, scoring conservatively when it cannot tell. Note in your verdict/UI that groundedness here is a *weak* signal.
- (b) **Re-retrieve bodies at judge time (larger change, only if time):** call `lib/search.ts` to re-fetch source text by URL/query for the judge. Heavier; do not attempt unless (a) is shipped and verified first.

**Model — VERIFY-FIRST (do NOT use a model id from memory).** Use a CHEAP Anthropic model via the gateway, mirroring `app/api/mcp/route.ts`. Before coding, fetch the current gateway model list and pick the newest cheapest Haiku-class id:
```
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("anthropic/")) | .id] | reverse | .[]'
```
Pick the newest Haiku-tier id. Store it as a `JUDGE_MODEL` constant. If no Haiku-class id exists, fall back to the cheapest available Anthropic id and note the cost assumption changes. Call exactly like the MCP route: `generateText({ model: gateway(JUDGE_MODEL), system: JUDGE_SYSTEM, prompt })`. Locally the gateway needs `vercel link` / `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN` (the repo already has `VERCEL_OIDC_TOKEN` in `.env.local`).

**Judge prompt design:**
- `JUDGE_SYSTEM`: "You are a strict evaluator of a customer-support assistant's answer. You are given the user's question, the assistant's answer, and the LIST OF SOURCES the assistant retrieved — each source is only a title and URL (you do NOT have the article bodies). Judge whether the answer's claims are attributable to and consistent with those titled sources; when you cannot verify a claim from the available titles, treat it as unsupported and score conservatively. Never use outside knowledge. Output ONLY a single minified JSON object, no prose, no markdown fences." Define the exact schema and rubric in the system prompt:
  - `groundedness` (number 0–1): degree to which the answer's claims are attributable to the listed sources (weak signal given titles-only — score conservatively).
  - `relevance` (number 0–1): how well the answer addresses the user's question.
  - `hallucination` (boolean): true if the answer states specific facts/steps/URLs not plausibly attributable to the listed sources.
  - `verdict` (string, ≤ 280 chars): one-sentence reason.
- `prompt` (user): the `question`, then the numbered sources (`rank`, `title`, `url` only — there is no excerpt), then the `answer`. **Skip judging clarifying-only turns** (those with `search_count === 0`) to save cost — leave them unjudged (selection already filters them; see batch SELECT).
- **Parse defensively:** strip any accidental code fences, `JSON.parse`, validate with a small Zod schema or manual type guards, clamp numbers to `[0,1]`, coerce `hallucination` to boolean, truncate `verdict`. On parse/model failure, do NOT throw the whole batch — see poison-row guard below.

**Cost guards (mandatory):**
- Process the batch **sequentially or with a small concurrency cap (≤ 3)** — do NOT fire 20 concurrent gateway calls. State which you chose.
- Keep `LIMIT` small (e.g. 20).
- **Poison-row guard:** do NOT leave a failed row eternally `judged_at IS NULL` so it gets re-selected and re-billed every run. On judge/parse failure, increment `judge_attempts` and write a marker; select with `WHERE judged_at IS NULL AND judge_attempts < 3 AND search_count > 0`. After 3 failed attempts a row is skipped permanently. (Successful rows set `judged_at = now()` and are never reselected.)

**Batch route:** `app/api/judge/batch/route.ts`. On POST: auth-gate (see §5 #7), `ensureSchema()`, `SELECT ... FROM inquiries WHERE judged_at IS NULL AND judge_attempts < 3 AND search_count > 0 ORDER BY created_at ASC LIMIT 20`, judge each (sequential / cap ≤3), then `updateInquiryJudgment(sessionId, turnId, {...})` (new exported fn in `lib/inquiry-store.ts`):
- on success: `UPDATE inquiries SET judge_groundedness=..., judge_relevance=..., judge_hallucination=..., judge_verdict=..., judge_model=..., judged_at=now() WHERE session_id=$ AND turn_id=$`.
- on failure: `UPDATE inquiries SET judge_attempts = judge_attempts + 1, judge_verdict = 'error: <reason>' WHERE session_id=$ AND turn_id=$` (leave `judged_at` NULL until attempts exhausted).
Return a `{ judged, errors, skipped }` summary.

**Cron config (C-stretch):** add a `crons` entry to `vercel.json` (it currently has none) pointing at `/api/judge/batch` on a sensible interval (e.g. every 10 minutes). **VERIFY-FIRST:** `vercel.json` here uses an unusual `experimentalServices` block (a `web` Next.js service at `/` and an `eve` service at `/_eve_internal/eve`). Use `search_vercel_documentation` to confirm that a top-level `crons` array targets the `web` service's route and that the cron path resolves to the Next.js route under this multi-service layout; adjust scoping if required. Cron cannot be exercised in `next dev` — for the cron path, the verification is compile-only + the manual `curl`.

**Surface in `/inquiries`:**

**§4.D-min (mandatory C surface) — per-row presence chips via a single LEFT JOIN.** Extend `listInquiries` (or add `listInquiriesWithSignals`) to LEFT JOIN `answer_feedback` aggregates on `(session_id, turn_id)` and include the judge columns. The LEFT JOIN MUST tolerate the documented race: an inquiry with no `answer_feedback` rows renders "no signal" (not an error), and `answer_feedback` rows with no matching inquiry are simply not shown on the inquiry list (they still exist for later analytics). Render, per row in `app/inquiries/page.tsx`:
- a hallucination flag chip (orange) when `judge_hallucination` is true,
- a tiny groundedness/relevance score when judged,
- human-signal presence chips: 👍 / 👎 (with top reason via `reasonLabel`/`reasonBadgeClass`) / ✎ when an expert edit exists.
Reuse existing row styling, `reasonBadgeClass`/`reasonLabel`, `formatUsd`/`formatFeedbackDate`.

**§4.D-stretch (only if time) — aggregate analytics tiles.** Extend `inquiryAnalytics()` (keep the existing `Promise.all` concurrent-query style and try/catch fallback returning zeros) with: avg groundedness, avg relevance, hallucination rate, % of inquiries judged, count of thumbs-down, count of expert edits. Render as header tiles. Defer this entirely if A+B+C-min are not comfortably done and verified.

---

## 5. Hard Constraints & Gotchas (read twice)

1. **eve hooks are observe-only and a thrown hook fails the turn.** You should NOT need to modify `agent/hooks/log-inquiry.ts` at all. If you do touch any hook, wrap EVERY handler body in `try { ... } catch { /* never throw from a hook */ }` exactly as the existing code does.
2. **Server/client module split.** `app/_components/*` are `"use client"` and may import from `lib/feedback.ts`, `lib/inference-cost.ts` (pure). They must NOT import server-only DB code. New API routes and stores (`lib/answer-feedback-store.ts`, `lib/inquiry-store.ts` additions, `app/api/**`) are server-side and import `getSql()` from `lib/db.ts`. **Do not import `eve` server runtime or `lib/db.ts` into any `"use client"` file.** Keep shared types/constants for both sides in a pure `lib/` module (e.g. a new pure `lib/answer-feedback.ts` with `type AnswerFeedbackKind = 'up'|'down'|'edit'`, payload type, validators).
3. **`lib/inference-cost.ts` is the single source of pricing.** Reuse it; never hardcode token prices.
4. **No PII, but still rate-limit + sanitize the public routes** exactly like `/api/feedback` (20/60s in-memory Map, content-length guard, trim+slice all strings, validate enums, JSON-parse guard). The judge batch route is NOT public input — auth-gate it (see #7).
5. **Idempotency via `ON CONFLICT`.** `answer_feedback` uses `ON CONFLICT (session_id, turn_id, message_id, kind) DO UPDATE` (last write wins per kind). The judge update is a plain `UPDATE ... WHERE` guarded by `judged_at IS NULL AND judge_attempts < 3` in the batch SELECT (so a second batch run judges zero already-judged rows — no re-billing).
6. **`sessionId` on the client is the load-bearing correlation key — treat it as VERIFY-FIRST (see §4.A).** If you cannot guarantee the client `sessionId` equals the hook's `ctx.session.id`, the dashboard join silently won't match. The `clientContext`-mint fallback is FORBIDDEN (it's ephemeral model-facing prompt text and does not reach `ctx.session.id`). Verify with a real round trip before declaring done; if no safe id is obtainable, STOP and surface the blocker.
7. **Auth-gate the judge batch route.** Vercel Cron sends an `Authorization: Bearer ${CRON_SECRET}` header when `CRON_SECRET` is set. There is currently NO `CRON_SECRET` in `.env.local`. Add a check: if `process.env.CRON_SECRET` is set, require the header to match (return `401` on mismatch); if unset (local dev), allow but log a warning. Read `process.env` at request time. Add `CRON_SECRET` to the Vercel project env (and `.env.local` for local testing) — VERIFY the exact header convention via `search_vercel_documentation` ("cron jobs securing"). **A `401`/`Bearer ` from this route during the §7.2 compile-curl is EXPECTED, not a failure — for this route judge "compiled OK" by the absence of compile errors in the dev log, not by HTTP status.**
8. **Do NOT break turn-itemization or the turn pipeline.** The `inferenceByTurn` / `inferenceByMessageId` computation and `ThreadWorkPanel` accounting in `agent-chat.tsx` must remain untouched in behavior. Your new props/footer must not alter cost math, the `messages.map` keying (`key={message.id}`), or the `null`-when-empty-body short-circuit in `AgentMessage`.
9. **Do NOT break inquiry logging with the C migration.** The judge-column `ALTER`s share the memoized `ensureSchema()` that `logInquiry()` awaits — a verification step (§7.3) must confirm logging still writes rows after the migration.
10. **Match existing style:** double quotes, `cn()` for classes, `clever-*` Tailwind tokens (`clever-blue`, `clever-orange`, `clever-navy`, `clever-light-blue`, `clever-green`, `clever-yellow`, `clever-black`), `lucide-react` icons at `size-3.5`, `formatUsd`/`formatFeedbackDate` for display. `/inquiries` already has `export const dynamic = "force-dynamic"`; keep it.

---

## 6. Phased Implementation Plan

**Phase 0 — Orient (no writes).** Read `node_modules/eve/docs/guides/hooks.md` and `state.md`. Read in full: `lib/inquiry-store.ts`, `lib/feedback-store.ts`, `app/api/feedback/route.ts`, `app/_components/agent-chat.tsx`, `app/_components/agent-message.tsx`, `app/_components/feedback-form.tsx`, `app/api/mcp/route.ts`, `app/inquiries/page.tsx`. Resolve the **VERIFY-FIRST `sessionId`** question with a real dev-server round trip (§4.A). Confirm `payload.searches[].sources` is `{rank,title,url,score}` only (it is).

**Phase 1 — A+B data layer.** Create pure `lib/answer-feedback.ts` (types: `AnswerFeedbackKind`, payload type, validators) and server `lib/answer-feedback-store.ts` (memoized `ensureSchema`, `saveAnswerFeedback`, `listAnswerFeedbackForTurns`/aggregate query, `newId`/`ID_RE` mirrored). Test the DDL + insert against real Neon (§7.3).

**Phase 2 — A+B API route.** Add `app/api/answer-feedback/route.ts` mirroring `/api/feedback`. Compile-check (§7.2). `curl` it with a fake payload and confirm a row lands in Neon.

**Phase 3 — A+B UI.** Add the footer controls to `agent-message.tsx` (new local `sessionId?`/`persona?`/`question?` props), wire them in `agent-chat.tsx`. Implement thumbs (with 👎 reason/note disclosure) and the inline-edit textarea. Confirm in the browser that clicking writes the correct `(session_id, turn_id, message_id, kind)` row.

**Phase 4 — VERIFY + SHIP A+B.** Run the FULL §7 protocol for A+B including the §7.5 correlation test. **If green: commit and push A+B to `main`.** **If not green: fix, or ship A+B minus the broken piece and STOP — do not start C.**

**Phase 5 — C judge (only after Phase 4 green & committed).** VERIFY the cheap model id (live). Add `JUDGE_MODEL`, `JUDGE_SYSTEM`, the judge call + defensive parse + cost guards, `updateInquiryJudgment` in `lib/inquiry-store.ts`, the `ALTER ... ADD COLUMN IF NOT EXISTS` + `judge_attempts` + partial index in the existing `ensureSchema()`, and `app/api/judge/batch/route.ts` (auth-gated, poison-row guard). Cheap-test the judge (§7.4). Then C-min dashboard (§4.D-min).

**Phase 6 — C-stretch (only if time).** Cron config in `vercel.json` (verify multi-service targeting) and aggregate analytics tiles (§4.D-stretch).

**Phase 7 — Final verify + ship the rest (§7, §8).**

---

## 7. Verification Protocol (do all that apply to shipped scope; do not declare done on typecheck alone)

1. **Typecheck:** `npm run typecheck` (= `tsc --noEmit -p tsconfig.json`). Must be clean.
2. **Compile check via dev server + logs:** start `npm run dev` (background), then `curl` each new/changed route to force compilation:
   - `curl -s -X POST http://localhost:3000/api/answer-feedback -H 'content-type: application/json' -d '{"sessionId":"s_test","turnId":"turn_0","messageId":"m_test","kind":"up"}'`
   - (C) `curl -s -X POST http://localhost:3000/api/judge/batch -H "authorization: Bearer testsecret"` — **a `401` here is EXPECTED if `CRON_SECRET` is set/mismatched; judge success by absence of compile errors in the log, not HTTP status.**
   - `curl -s http://localhost:3000/inquiries`
   Then read `.next/dev/logs/next-development.log` and confirm no compile/runtime errors for those routes.
3. **Real Neon SQL test:** write a throwaway script in the scratchpad that loads `.env.local` and uses `getSql()` from `lib/db.ts` to: (a) run your new `ensureSchema()`s, (b) `SELECT` the `answer_feedback` row you just curled in, (c) **(C) confirm the new `inquiries` judge columns exist** (`SELECT column_name FROM information_schema.columns WHERE table_name='inquiries'`), and (d) **(regression) confirm a fresh `logInquiry()` still writes a row end-to-end after the migration** (insert a test inquiry via the real path, then SELECT it). Load env with `node --env-file=.env.local script.mjs` (Node 24). Clean up test rows afterward.
4. **(C) Cheap judge test:** call the judge function (or `POST /api/judge/batch` with the correct secret) against a SMALL `LIMIT` (1–3 rows) and confirm: valid clamped JSON; `updateInquiryJudgment` writes `judged_at`; a malformed model response does NOT crash the batch (simulate by feeding garbage → row gets `judge_attempts+1` and `judge_verdict='error...'`, batch continues); **idempotency: run the batch TWICE and confirm the second run judges zero already-judged rows (no re-billing)**; cost is trivial.
5. **(A+B) Correlation acceptance test (HARD gate):** in the browser, ask the agent a question, click 👍 then 👎-with-reason then "edit answer", and verify three correctly-keyed rows in Neon whose `(session_id, turn_id)` matches the corresponding `inquiries` row written by the hook. **If this fails, the §4.A sessionId decision is wrong — fix it (without the forbidden `clientContext` hack) before declaring A done.**
6. **Regression:** confirm the bottom `ThreadWorkPanel` cost itemization is unchanged, the existing `/feedback` flag flow still works, and `/inquiries` still lists rows.

---

## 8. Definition of Done

**For the must-ship core (A+B):**
- Per-answer 👍/👎 (+reason/note) and expert inline edits persist to `answer_feedback`, correctly keyed by `(session_id, turn_id, message_id, kind)` and joinable to `inquiries`.
- `/api/answer-feedback` mirrors `/api/feedback` safeguards.
- Footer controls render only on assistant messages with a body.
- `npm run typecheck` clean; dev-server compile-log clean; real-Neon SQL test passes; the §7.5 correlation test passes.
- No regression to turn-itemization, the logging hook, or existing routes.
- **Committed and pushed to `main`** (auto-deploys to prod — this repo's convention; do not ask for deploy confirmation).

**For the stretch (C), only if A+B green & committed:**
- Judge columns added to `inquiries` via `ADD COLUMN IF NOT EXISTS` (incl. `judge_attempts`) without breaking inquiry logging; batch route scores unjudged rows with a live-verified cheap gateway model, defensive parsing, cost guards (concurrency ≤3, poison-row guard), and persists groundedness/relevance/hallucination/verdict/judged_at; route auth-gated via `CRON_SECRET`.
- `/inquiries` shows per-row presence chips (judge hallucination flag + score; human 👍/👎/✎) via a race-tolerant LEFT JOIN (§4.D-min).
- (C-stretch) cron configured & verified for the `experimentalServices` layout; aggregate analytics tiles added.

**Commit message** ends with:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Acceptance checklist:**
- [ ] `answer_feedback` table + indexes created idempotently; `up`/`down`/`edit` all insert with `ON CONFLICT DO UPDATE`.
- [ ] `/api/answer-feedback` mirrors `/api/feedback` (rate-limit 20/60s, content-length, JSON guard, sanitize, enum validation).
- [ ] Footer controls render only on assistant messages with a body; thumbs, 👎 reason/note, and inline edit all work and confirm visually.
- [ ] Client `sessionId` decision verified against a real round trip and documented in a comment; NO `clientContext` hack; feedback rows join to inquiry rows (§7.5).
- [ ] A+B typecheck + compile-log + real-Neon + correlation tests pass; A+B committed and pushed to `main`.
- [ ] (C) Judge model id fetched live (not from memory); judge JSON parsed defensively; batch never crashes on a bad response; second run judges zero already-judged rows.
- [ ] (C) Judge prompt does NOT reference nonexistent source excerpts; grounds only on question+answer+source titles/URLs; limitation documented.
- [ ] (C) `inquiries` judge columns + `judge_attempts` + partial index added via `ADD COLUMN IF NOT EXISTS`; `updateInquiryJudgment` works; inquiry logging still writes rows after migration (§7.3d).
- [ ] (C) batch route auth-gated via `CRON_SECRET`; cost guards in place.
- [ ] (C-min) `/inquiries` surfaces judge + human presence chips via race-tolerant LEFT JOIN.
- [ ] (C-stretch) `crons` entry added & verified for `experimentalServices` layout; aggregate analytics tiles added.

---

## 9. Working Style (ultracode)

- **Use Workflow orchestration for the substantive parts** (the A+B data/route/UI vertical slice; then, only if A+B ship green, the C judge+batch+dashboard slice) — plan, parallelize independent reads, and checkpoint after each phase in §6.
- **READ the installed eve docs before writing any eve-adjacent code** (`node_modules/eve/docs/guides/`). Do not write hook/state code from memory.
- **Adversarially verify every claim** marked VERIFY-FIRST and anything you'd otherwise assume: the client `sessionId` (and the forbidden-fallback rule), the current cheap model id (fetch it live), the `crons` targeting under `experimentalServices`, the `CRON_SECRET` header convention, and the fact that NO source body text exists in the payload. When a fact and the code disagree (as with `sessionId`), trust the code and a live round trip.
- Prefer reusing the existing helpers (`isFeedbackReason`, `reasonBadgeClass`, `reasonLabel`, `formatUsd`, `formatFeedbackDate`, `priceInferenceUsage`, `newId`/`ID_RE` pattern, the rate-limit Map) over re-implementing.
- Run `npm run typecheck` after each phase, not just at the end. Keep changes minimal and consistent with the existing style. Respect the binding scope contract in §1: A+B first and verified before any C work.