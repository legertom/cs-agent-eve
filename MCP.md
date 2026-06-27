# Use Clever Support inside Claude & VS Code (MCP)

The assistant's retrieval pipeline is exposed as a **remote MCP server**, so you
can use Clever's support knowledge base from inside any MCP client — Claude
(Desktop / web / Enterprise), VS Code (Copilot agent mode), Cursor, Claude Code,
and more. One retrieval brain, many front doors.

## Endpoint

| | URL |
|---|---|
| **Production** | `https://clever-support-agent.vercel.app/api/mcp` |
| **Local dev** | `http://localhost:3000/api/mcp` |

- **Transport:** Streamable HTTP (stateless). `POST` only; `GET` returns `405`.
- Source: [`app/api/mcp/route.ts`](app/api/mcp/route.ts), retrieval core in
  [`lib/search.ts`](lib/search.ts) (shared with the eve agent).

> ⚠️ The production route ships when you next deploy (`vercel deploy`). Until
> then, use the local URL with `npm run dev` running.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `search_clever_kb` | `query` (string), `limit?` (1–8) | Ranked, cited articles + excerpts + a calibrated **confidence** signal. The client's model synthesizes the answer. |
| `ask_clever_support` | `question` (string) | A synthesized, plain-language answer grounded **only** in the help center, with cited source URLs + confidence. |

Use `search_clever_kb` inside a capable client (Claude, Copilot) and let the
client write the answer; use `ask_clever_support` when you just want the answer
text back.

## Auth

**Public by default** — the knowledge base is public Clever help-center content,
so there's nothing sensitive to gate. To lock it down (e.g. to control AI Gateway
token spend):

1. Set `MCP_API_KEY=<some-secret>` on the deployment (`vercel env add MCP_API_KEY`).
2. Clients then send `Authorization: Bearer <some-secret>` (shown per client below).

---

## Add to Claude

### Claude Desktop / claude.ai (Pro, Max, Team, Enterprise)

1. **Settings → Connectors → Add custom connector** (exact label may vary by version).
2. Name: `Clever Support`. URL: `https://clever-support-agent.vercel.app/api/mcp`.
3. Save, then enable it in a chat from the tools/connectors menu.

> **Enterprise:** an org admin adds it once under **Settings → Connectors** and
> can enable it org-wide, so everyone in the company gets it. Remote custom
> connectors require a paid plan.
>
> The connector UI is built around OAuth. If you set `MCP_API_KEY` (static bearer
> token), connect via the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote)
> bridge instead, or leave the server public.

### Claude Code (CLI)

```bash
claude mcp add --transport http clever-support https://clever-support-agent.vercel.app/api/mcp
# with auth:
claude mcp add --transport http clever-support https://clever-support-agent.vercel.app/api/mcp \
  --header "Authorization: Bearer <your-key>"
```

---

## Add to VS Code (Copilot agent mode)

VS Code 1.102+ has native MCP support.

### Option A — workspace config (recommended)

This repo already ships [`.vscode/mcp.json`](.vscode/mcp.json). Open the repo in
VS Code, open **Copilot Chat → Agent mode**, click the tools 🔧 icon, and enable
**clever-support**. To add it to *another* project, drop this file in at
`.vscode/mcp.json`:

```json
{
  "servers": {
    "clever-support": {
      "type": "http",
      "url": "https://clever-support-agent.vercel.app/api/mcp"
    }
  }
}
```

With a bearer key, prompt for it securely instead of hardcoding:

```json
{
  "inputs": [
    { "id": "clever-key", "type": "promptString", "description": "Clever MCP API key", "password": true }
  ],
  "servers": {
    "clever-support": {
      "type": "http",
      "url": "https://clever-support-agent.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer ${input:clever-key}" }
    }
  }
}
```

### Option B — Command Palette

`MCP: Add Server…` → **HTTP** → paste the URL → name it `clever-support` →
choose Workspace or Global.

### Option C — CLI one-liner

```bash
code --add-mcp '{"name":"clever-support","type":"http","url":"https://clever-support-agent.vercel.app/api/mcp"}'
```

---

## 📋 Copy-paste prompt — let your AI agent set it up

Paste this into **Copilot Chat (agent mode)**, **Claude Code**, or any in-editor
AI agent. It will create the config and tell you how to turn it on:

```text
Add an MCP server named "clever-support" to this project so I can query Clever's
support knowledge base from the editor.

1. Create (or merge into) .vscode/mcp.json with an HTTP server entry:
   {
     "servers": {
       "clever-support": {
         "type": "http",
         "url": "https://clever-support-agent.vercel.app/api/mcp"
       }
     }
   }
2. The server is public — no auth header is needed.
3. It exposes two tools: `search_clever_kb` (ranked, cited articles + a confidence
   score) and `ask_clever_support` (a synthesized, cited answer). Both answer
   questions about Clever (SSO, rostering, logins, admin setup) from the official
   help center.
4. After writing the file, tell me exactly how to enable the server in Copilot
   agent mode (or my editor's MCP UI), then verify it connected and list its tools.
```

---

## Cursor & other clients

Cursor uses a slightly different shape (`mcpServers` + `url`) in
`~/.cursor/mcp.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "clever-support": { "url": "https://clever-support-agent.vercel.app/api/mcp" }
  }
}
```

Any MCP client that speaks Streamable HTTP works — point it at the endpoint URL.

---

## Verify it manually

```bash
URL=http://localhost:3000/api/mcp   # or the production URL

# List the tools
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_clever_kb","arguments":{"query":"set up Google SSO","limit":3}}}'
```

A healthy `search_clever_kb` call returns `method: "hybrid+rerank"`, a
`confidence` block, and ranked results each with a 0–1 `score`.
