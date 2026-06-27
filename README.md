# Discord Assistant (eve)

A team assistant for Discord, built on [eve](https://eve.dev). It chats, answers
questions, reads/summarizes links, and reports the time in any timezone.

## What's here

```
agent/
├── agent.ts                  # model + runtime config (Claude Sonnet 4.6)
├── instructions.md           # system prompt / persona
├── channels/
│   ├── eve.ts                # built-in HTTP channel (local dev / TUI)
│   └── discord.ts            # Discord Interactions channel
└── tools/
    ├── get_current_time.ts   # timezone-aware clock
    └── read_url.ts           # fetch + read a web page (no API key)
```

## Run locally

```bash
npm run dev      # starts the eve dev server + TUI
```

Model strings resolve through Vercel AI Gateway. For local dev, either link the
project (`vercel link` then `vercel env pull`) or set `AI_GATEWAY_API_KEY`.
See `.env.example`.

Test without Discord via the HTTP channel:

```bash
curl -X POST http://127.0.0.1:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"What time is it in Tokyo?"}'
```

## Connect Discord

1. Create an app at <https://discord.com/developers/applications>.
2. Copy these into `.env` (see `.env.example`):
   - **Public Key** → `DISCORD_PUBLIC_KEY`
   - **Application ID** → `DISCORD_APPLICATION_ID`
   - **Bot → Token** → `DISCORD_BOT_TOKEN`
3. Register a slash command (use a guild command in dev for instant propagation;
   the `message` option name is what eve reads as the prompt):

   ```bash
   curl -X PUT "https://discord.com/api/v10/applications/$DISCORD_APPLICATION_ID/guilds/$GUILD_ID/commands" \
     -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H "Content-Type: application/json" \
     -d '[{"name":"ask","description":"Ask the assistant","type":1,
       "options":[{"name":"message","description":"What should the agent do?","type":3,"required":true}]}]'
   ```

4. Deploy (`vercel deploy`), then set the deployment's
   `https://<your-app>/eve/v1/discord` as the **Interactions Endpoint URL** in the
   Developer Portal. Discord must be able to reach a public URL, so use a
   deployment (or a tunnel like `ngrok` over local dev) — not bare localhost.

Then in Discord: `/ask message: summarize https://vercel.com/eve`
