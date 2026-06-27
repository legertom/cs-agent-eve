# 🏆 Clever Support Assistant — Brag Sheet

A support-knowledge agent built on **Vercel eve**, deployed at
**[clever-support-agent.vercel.app](https://clever-support-agent.vercel.app)**.
This is the cheat sheet for talking to judges — especially Vercel ones.

---

## 🥇 Lead with this: one AI Gateway, three providers, zero keys

Retrieval spans **three model providers through one Vercel AI Gateway**, with
**no API keys in production** (authenticated via Vercel OIDC):

- **OpenAI** `text-embedding-3-small` — semantic embeddings
- **Cohere** `rerank-v4-fast` — cross-encoder rerank
- **Anthropic** `claude-sonnet-4.6` — answer synthesis

> *"Three providers, one gateway, zero keys. Swapping a model is a one-line
> string change."*

---

## 🤖 An agent, not a chatbot wrapper

- **Confidence gate + human-in-the-loop.** Every search returns a calibrated
  confidence signal (top reranker score + margin to #2). On low confidence, a
  tight margin, or a high-stakes topic (billing, data deletion, SSO security),
  the agent **pauses mid-turn and asks a human** via eve's `ask_question` — a
  *durable* pause that survives restarts. *It knows when it doesn't know.*
- **"Show your work" trust panel.** Every web answer renders the confidence
  band, the exact ranked sources **with their reranker scores**, and the
  retrieval pipeline. RAG internals made visible.
- **Honest gaps.** When nothing's on-topic it says so and points to a human —
  never fabricates steps or URLs.

---

## 🔌 It runs *inside Claude* (MCP)

- The retrieval pipeline is exposed as a **remote MCP server** (`/api/mcp`) — a
  stateless Streamable-HTTP JSON-RPC server, **zero added dependencies**, running
  as a Vercel Function.
- Two tools: `search_clever_kb` (ranked + cited + confidence) and
  `ask_clever_support` (synthesized answer).
- Works in **Claude (incl. Enterprise org-wide connector), VS Code Copilot,
  Cursor, Claude Code**. Ships with a **copy-paste prompt** that wires it into
  any VS Code project (see [MCP.md](MCP.md)).

> *"Because retrieval is a clean tool, the same brain drops into Claude
> Enterprise as a connector — the whole company uses it without leaving Claude."*

One retrieval core ([lib/search.ts](lib/search.ts)) feeds the web app, Discord,
**and** MCP.

---

## 🧠 Retrieval engineering that isn't a toy

- **Hybrid search:** BM25 (catches exact field names like `home_language`) +
  512-dim embeddings (catches meaning), fused with **Reciprocal Rank Fusion**.
- Then a **cross-encoder rerank**, blended back with the hybrid order via RRF so
  the reranker sharpens precision without overriding a strong base.
- Query normalization so `home_language` / camelCase actually hit.
- Over **525 real Clever help-center articles**, ingested by a BFS crawler.

---

## 🎯 Thoughtful product touches

- **Audience-aware answers.** 83% of articles target a specific audience (Admins,
  Teachers, App Partners, Families…). We derive that from the data and surface it
  per result — so when "configure languages" returns *both* the Teacher and Admin
  version, the agent **asks whose POV it is** instead of guessing.
- **Sticky persona selector.** Pick "Answering for: Teacher" and it rides along
  as **ephemeral per-turn client context** — model-facing, never shown in the
  transcript, never persisted. Sticky across reloads.
- **Browse-by-audience** page: skim all 525 articles filtered by who they're for
  — a real ramp tool for new support agents.

---

## 📋 eve / Vercel primitives demonstrated

**AI Gateway · Vercel Functions (Fluid Compute) · Human-in-the-loop · Durable
sessions · Multi-channel (Discord + web) · MCP server · Agent Runs observability
· Next.js 16 on Vercel · OIDC auth**

- **Multi-channel from one brain:** Discord bot *and* a branded Next.js web chat
  — same agent, same KB, same voice.
- **Durable sessions:** multi-turn memory that survives restarts.
- **Observability:** every session / tool / token is traced in Vercel's **Agent
  Runs** dashboard — open it at the end of the demo for free points.

---

## 🎤 Soundbites

1. *"Zero AI keys in production — AI Gateway authenticates with Vercel OIDC."*
2. *"It stops and asks a human before giving a confidently-wrong answer."*
3. *"Same retrieval brain, four front doors: web, Discord, and any MCP client
   like Claude Enterprise or VS Code."*

## ⏱️ 90-second demo arc

1. Ask a question → show the **trust panel** (confidence + scores = AI Gateway, 3
   providers).
2. Flip persona to **Teacher**, re-ask → watch it tailor the answer.
3. Ask a **high-stakes** question → watch it **pause and ask** a human.
4. Paste the **MCP setup prompt** into VS Code → call the tool live.
5. Open **Agent Runs** → show the full trace.
