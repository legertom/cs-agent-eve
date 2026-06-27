# Clever Support Assistant — Feature Roadmap

eve-native feature ideas to help **Clever support agents — especially new ones** — get fast, accurate, well-cited answers and land on the right help articles. Generated from a multi-lens ideation panel (onboarding, accuracy/trust, eve power-features, daily workflow, knowledge ops).

> Use this as the build backlog. Each feature notes its **impact/effort**, the **eve primitives** it uses, why it helps **new agents**, and (where relevant) implementation hooks into the current codebase.

---

## Current app state (context for building)

- **What it is:** RAG assistant over **~525 Clever help-center articles**, built on Vercel **eve** (filesystem-first agent in `agent/`).
- **Retrieval** (`agent/tools/search_support.ts`): hybrid (BM25 + embeddings, fused with RRF) → Cohere cross-encoder rerank (`cohere/rerank-v4-fast` via AI Gateway) → blended with RRF. Query normalization (`home_language` → `home language`). Returns ranked results + cited article URLs. **Today it returns `method` + `rank` only — several features below need it to also expose numeric rerank/confidence scores.**
- **Knowledge base:** `agent/data/kb.json` (article text) + `agent/data/kb-vectors.json` (512-dim embeddings). Built by `scripts/ingest.mjs` (BFS crawl of help center) + `scripts/embed.mjs`.
- **Interfaces:** Discord bot (`/ask`, one-shot per command) + branded Next.js web chat (`app/`, durable multi-turn sessions, "New chat" reset). `/about` explainer page.
- **Other:** there's an eval harness referenced in a sibling `clever-dev-docs` repo (`eval/run-eval.ts`) that several features below build on.
- **Deployed:** `clever-support-agent.vercel.app`.

## eve primitives reference

| Primitive | What it gives you |
|---|---|
| **Tools** (`agent/tools/*.ts`) | typed functions the model can call |
| **Skills** (`agent/skills/*`) | on-demand markdown playbooks/procedures |
| **Subagents** (`agent/subagents/*`) | delegate subtasks to a child agent w/ its own tools/identity |
| **Channels** (`agent/channels/*`) | web/HTTP, Discord, Slack, Teams, Telegram, GitHub, Linear, Twilio SMS |
| **Schedules** (`agent/schedules/*`) | cron jobs (digests, syncs, nudges) |
| **Connections** | typed integrations + Vercel Connect OAuth (Zendesk, Salesforce, Slack…) |
| **Sandbox** | isolated bash/file compute |
| **Durable sessions** | resumable, long-running, survive restarts; pause/resume |
| **HITL** | agent asks the user to pick options / confirm before acting |
| **Observability (Agent Runs)** | session/turn/tool/token traces in the Vercel dashboard |
| **AI Gateway** | models + embeddings + reranking + image gen, no key management |
| **Eval harness** | run evals against the agent to measure quality over time |
| **Workflow DevKit** | durable multi-step orchestration w/ retries |

---

## 🥇 Top picks (highest leverage — build first)

1. Jargon Decoder + canonical-term query expansion
2. Confidence gate with HITL escalation to a senior
3. Paste-a-Ticket triage, draft & escalation packet
4. Guided Answer Mode (scaffolded reasoning)
5. Feedback loop → eval set + content-gap router

## ⚡ Quick wins (low effort, high value)

- Jargon Decoder + canonical-term query expansion
- "Show your work" trust panel
- Brand-voice reply drafter + macro locator

---

## 🗣️ Theme: Vocabulary & comprehension (close the jargon gap)

### Jargon Decoder + canonical-term query expansion — `high impact / low effort`
A `decode_jargon` tool plus an on-demand glossary Skill that (a) detects Clever-specific terms in the user's question or the draft answer (SFTP rostering, IdP/SP-initiated SSO, Secure Sync, OneRoster, share rules, district vs school admin), inlines a plain-language definition + the single best canonical KB article per term, and (b) **rewrites the new agent's casual phrasing into canonical terms BEFORE hybrid search so retrieval actually hits**. The Skill teaches WHEN to auto-decode (first occurrence of a term per session) vs stay terse for experts. Web toggle "Show me the jargon" and a `/decode <term>` Discord command. Definition/best-article resolution reuses the existing rerank pipeline on a single-term query.
- **eve:** Tools, Skills, AI Gateway (rerank), Channels, Durable sessions
- **Why new agents:** Not knowing the vocabulary is the #1 new-agent blocker — they type the customer's words, miss the right article, and silently guess at term meanings. Auto-decoding the first occurrence per session teaches vocabulary in context, and canonical-term expansion fixes the retrieval miss at its root (BM25/embeddings hit far better on official phrasing).

---

## 🛡️ Theme: Trust & safety (never relay a confidently-wrong answer)

### Confidence gate with HITL escalation to a senior — `high impact / medium effort`
Surface a calibrated confidence signal from signals the pipeline already has (top rerank score, gap to #2, how many distinct articles agree, query-term coverage in excerpts). On low confidence or high-stakes topics (billing, data deletion, SSO/security), the agent does NOT free-form answer: it either uses HITL to ask the new agent a clarifying/disambiguation question, or returns a hedged "I'm not confident — here are the closest articles, verify" and offers a one-click "Escalate to a senior" that posts the question + retrieved candidates to a `#support-escalations` Slack channel, routing the verified answer back into the session.
- **Implementation hook:** requires exposing numeric rerank scores from `search_support` (today it only returns method + rank).
- **eve:** Tools, HITL, Channels (Slack), Connections, Durable sessions, Observability
- **Why new agents:** The biggest danger for a rookie is a confident wrong answer to a customer. Teaching the assistant to recognize uncertainty and visibly escalate models the exact judgment new agents lack ("know when you don't know") and gives a safe, fast path to a senior instead of inventing steps.

### Citation faithfulness verifier (anti-hallucination second pass) — `high impact / medium effort`
A `verify_citations` subagent with its own identity runs after the draft answer: it checks each claim/step against the exact cited excerpt sentence-by-sentence, flags or strips assertions not grounded in a source, and only ships claims that trace back. Independent of the writer and fully traced in Agent Runs. Also folds in **conflict detection**: when top articles disagree (e.g. legacy vs new admin UI), it surfaces both paths with their conditions instead of silently merging contradictory sources.
- **eve:** Subagents, Tools, Observability, AI Gateway
- **Why new agents:** New agents take the bot's word as ground truth and can't spot a fabricated step or a doc-vs-doc conflict (a very common rookie error: giving steps for the wrong UI version). Faithfulness checking guarantees what they forward is literally backed by a real article.

### "Show your work" trust panel — `medium impact / low effort`
On web chat, render an inline panel per response: confidence band, the exact retrieved excerpts the answer was built from (with match highlights), rerank scores, freshness badge, verifier result, and a one-line "why these sources." A read-out of signals the pipeline + verifier already compute, exposed via Agent Runs trace data.
- **eve:** Observability, Tools, AI Gateway
- **Why new agents:** New agents learn the product by seeing WHY an answer is right, not just the answer. The panel turns every query into a mini training moment and builds judgment about when to trust the bot vs verify the live article.

---

## 🎓 Theme: Active learning & ramp (build competence, not just deliver answers)

### Practice Mode: simulated tickets with grading — `high impact / high effort`
A "Customer Sim" subagent role-plays a realistic district admin / teacher / IT contact raising a ticket (with believable confusion and missing details) drawn from common KB topics. The trainee answers in-channel; a separate "Grader" subagent scores the reply against the ground-truth article(s) on accuracy, completeness, correct citation, and tone, gives targeted feedback, and shows the article they should have cited. Difficulty escalates with performance. The eval harness seeds the scenario bank and lets managers measure cohorts. Runs in a durable session so a run can pause and resume.
- **eve:** Subagents, Eval harness, Durable sessions, Tools, Channels, Observability
- **Why new agents:** Reading docs is passive; competence comes from handling tickets. A safe sandbox where mistakes are caught by a grader (not an angry customer) compresses weeks of supervised shadowing into self-paced reps, targeting exactly the topics that trip newcomers up.

### Guided Answer Mode (scaffolded reasoning) — `high impact / medium effort`
A "Teach me" toggle that switches the agent from terse production answers to a scaffolded format: how it interpreted the question, the exact search queries it ran and which articles ranked, the reasoning that turned excerpts into steps, the cited answer, plus "why these articles and not others." Implemented as an alternate Skill layered over the existing search trace. Mode persists in the durable session and is observable in Agent Runs.
- **eve:** Skills, Tools, Durable sessions, Observability, Channels
- **Why new agents:** New agents need to learn the PROCESS of finding answers so they can replicate retrieval-and-synthesis when off the tool with a live customer. Exposing the search-and-reason trace turns every query into a worked example.

### Article-grounded micro-quizzes with spaced repetition — `medium impact / medium effort`
After an answer, the agent offers a 2-3 question quiz generated strictly from the cited article text (no outside facts), grades it, and on a miss links the precise section. Spaced-repetition state in the durable session, surfaced days later via a scheduled nudge to the trainee's channel.
- **eve:** Tools, Schedules, Durable sessions, Channels, AI Gateway
- **Why new agents:** Active recall right after exposure beats re-reading for retention. Because questions come only from the cited article, the quiz reinforces the same source of truth they'll use in real tickets, and spaced repetition turns one-off lookups into durable knowledge.

---

## 🎫 Theme: Live-ticket copilot (meet new agents where they work)

### Paste-a-Ticket triage, draft & escalation packet — `high impact / high effort`
Agent pastes/forwards a raw customer ticket and gets a structured triage card + citable draft: detected category, severity, product area, the 2-3 KB articles that apply, and a ready-to-edit reply already citing those links. A `triage_ticket` tool runs classification over the same hybrid+rerank retrieval; HITL presents category/severity as confirmable options before finalizing. When it can't confidently solve, it auto-packages a structured escalation (summary, what was tried, candidate articles, customer context) for a senior/Linear queue. Optionally pulls real ticket text via a Zendesk Connection so the new agent never has to invent the query.
- **eve:** Tools, Skills (triage + escalation playbook), HITL, Channels (Slack/Teams/web), Connections (Zendesk)
- **Why new agents:** New agents struggle most with the first 30 seconds of a ticket: what IS this, how urgent, which article applies. This does the categorization a veteran does on instinct and shows its reasoning + sources, teaching the mental model instead of guessing — and enforces good escalation hygiene by auto-assembling context.

### Interactive walkthroughs (step-locked copilot) — `high impact / medium effort`
A `start_walkthrough` tool turns a multi-step KB procedure (set up district SSO, fix a failed nightly rostering sync) into an interactive checklist the agent drives one step at a time, pausing via HITL after each step to confirm the result before advancing and branching on outcomes ("did the sync log show error X or Y?"). Procedures live as Skills authored once and loaded on demand; state persists in the durable session so a long troubleshooting flow survives interruptions.
- **eve:** Skills, Tools, HITL, Durable sessions, Channels
- **Why new agents:** Complex Clever workflows (SSO, rostering) have branching failure modes a rookie can't hold in their head. A step-locked copilot stops them dumping all 12 steps on a customer or skipping one, and the branch-on-result logic teaches the diagnostic decision tree veterans have memorized.

### Brand-voice reply drafter + macro locator — `high impact / low effort`
Turns a correct-but-raw answer into a customer-ready reply in Clever's support voice (tone presets: apology/outage, declining a feature request, delivering a workaround), keeping cited links inline; a Skill holds the voice guidelines and macro-style templates. Pairs with a `find_macro` natural-language lookup over saved canned responses ("the one for a teacher who can't see their roster"), via Zendesk Connection, returning the right macro + variables + the backing KB article so the agent knows why it's right.
- **eve:** Tools (draft_reply, find_macro), Skills (brand voice + templates), Connections (Zendesk), AI Gateway (rerank)
- **Why new agents:** New agents sound robotic or accidentally over-promise, and don't know which macros exist or what they're named. A grounded drafter gives safe, on-brand wording they can ship with light edits; the macro locator removes a huge ramp barrier and enforces approved responses.

### Omnichannel + SMS quick-lookup with durable cross-channel sessions — `medium impact / medium effort`
One agent reachable from Slack, Teams, Discord, web, and Twilio SMS so a new agent mid-call can text a question and get the answer + article link on their phone in seconds. Durable sessions let a lookup started over SMS continue in web chat with full history. Same retrieval and voice everywhere.
- **eve:** Channels (Twilio SMS, Slack, Teams), Durable sessions, Tools
- **Why new agents:** New agents are often mid-call or away from their main screen when they hit a wall. SMS lookup is instant and low-friction, and cross-channel durable sessions let them pick the thread back up at their desk to study the full answer and sources.

---

## 🔄 Theme: KB freshness & quality (keep the ground truth trustworthy)

### Scheduled KB freshness audit + staleness flags — `medium impact / medium effort`
Add `lastUpdated`/`contentHash` to each KB record at ingest. A scheduled cron re-crawls the live help center (`read_url`) in a Sandbox, diffs hashes, and marks articles whose source changed since indexing as "stale", triggering re-embed of changed ones. The search tool surfaces a freshness badge per citation ("Updated 3 weeks ago" vs "Source changed since indexed — verify on live page"); answers built on stale articles carry a caveat. A short "What changed in the KB this week" digest posts to a Slack/Discord channel.
- **eve:** Schedules, Sandbox, Tools (read_url), Connections, Channels, AI Gateway (re-embedding)
- **Why new agents:** New agents have no instinct for which docs are current — they'll quote an outdated SSO flow with confidence. A freshness flag tells them exactly when to trust the cached answer vs click through to verify, and the weekly digest passively keeps them current without monitoring anything.

### Feedback loop → eval set + content-gap router — `high impact / medium effort`
Every answer (web + Discord/Slack) gets thumbs up/down with optional "wrong article" tag via HITL/reactions. A post-turn classifier (reusing rerank scores) tags results "well-covered / thin / no good article". A scheduled job aggregates thumbs-down + "no good article" events into the eval harness's `questions.json` as regression cases AND a hard-negatives list for tuning RRF/rerank, while a "Gap Triage" subagent dedupes/clusters genuine gaps and files ready-to-write article stubs to docs via Linear/Slack. **Crucially it distinguishes retrieval failure (article exists but wasn't surfaced → eng queue) from true content gap (→ docs).**
- **eve:** HITL, Channels, Schedules, Eval harness, Subagents, Connections (Linear), Observability
- **Why new agents:** New agents disproportionately hit the questions the bot is worst at (basic-but-phrased-oddly) and either guess or escalate. Their thumbs-down becomes a graded eval case and a tracked KB gap, so the system gets measurably better precisely at rookie-level questions instead of failing the next new hire the same way.

### Eval-backed regression gate on KB & prompt changes — `medium impact / medium effort`
Promote the existing `eval/run-eval.ts` into a CI gate (runs in Sandbox via Workflow DevKit): any change to `instructions.md`, the search tool, RRF/rerank params, or a KB re-ingest must clear a minimum retrieval@k + answer-faithfulness score before deploy. Grow the eval set automatically — every confidently-answered question with its cited article becomes a regression case — so a doc edit or re-ingest that silently drops an article or worsens an answer blocks the release. Results posted to a channel.
- **eve:** Eval harness, Sandbox, Workflow DevKit, Channels, AI Gateway, Schedules
- **Why new agents:** New agents are least able to notice a silent quality regression — they assume the tool is always right. A gate guarantees the answers they depend on never quietly degrade between deploys; correctness can't slide backward under them.

---

## 🧭 Theme: Specialists & manager visibility

### Product-area specialist subagents (SSO / Rostering / Admin / Integrations) — `high impact / medium effort`
A router delegates to focused subagents, each with its own identity, scoped KB filter, and tuned instructions/jargon (e.g. an "SSO Specialist" that knows SAML/OIDC and the SSO articles deeply). The router fans out in parallel when a question spans areas ("SSO breaks after rostering sync") and merges answers with per-area citations.
- **eve:** Subagents (parallel specialists), Tools (scoped search_support), AI Gateway
- **Why new agents:** New agents don't know which product area a question belongs to or its jargon. A specialist answers in the right vocabulary and surfaces area-specific gotchas a generalist misses, and parallel fan-out handles the cross-area questions that confuse newcomers most.

### Support-lead observability dashboard + weekly topic digest — `medium impact / medium effort`
A web dashboard on Agent Runs trace data + the question log: answer-confidence distribution over time, deflection vs escalation rate, top failing questions, avg sources cited, and a "new-agent cohort" filter (questions from accounts/channels tagged as new hires), with drill-down into the actual traced session. Paired with a weekly cron that clusters the week's questions (reusing the embedding model) into a "most-asked + emerging topics" digest ("+140% on SSO certificate renewal", new clusters never seen) posted to Slack/Discord, each cluster linked to its best article and flagged if that article scores poorly.
- **eve:** Observability, Schedules, Tools (metrics/cluster query), AI Gateway (embeddings), Channels (web dashboard + Slack/Discord), Durable sessions
- **Why new agents:** Closes the loop for the humans coaching new agents: a lead can see which topics their new hires (and the bot) struggle with and target training there, and spot a rookie over-relying on low-confidence answers before it reaches a customer. The digest gives new agents an instant "what's hot now" ramp signal so study time maps to real ticket volume.

---

## Suggested build order

1. **Jargon Decoder** (quick win, also lifts retrieval) — then expose numeric scores from `search_support` while you're in there.
2. **"Show your work" trust panel** (quick win, reuses the scores from step 1).
3. **Confidence gate + HITL escalation** (depends on scores from step 1).
4. **Brand-voice reply drafter + macro locator** (quick win, high value for live tickets).
5. **Feedback loop → eval + gap router** (compounding: makes everything else measurably better).
6. Then larger bets: **Guided Answer Mode**, **Interactive walkthroughs**, **Specialist subagents**, **Paste-a-Ticket**, **Practice Mode**.
