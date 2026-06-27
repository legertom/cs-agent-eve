import { discordChannel } from "eve/channels/discord";

// Discord Interactions channel.
//
// Reads credentials from environment variables by default:
//   DISCORD_PUBLIC_KEY      verifies inbound interaction signatures
//   DISCORD_APPLICATION_ID  edits the deferred reply + sends followups
//   DISCORD_BOT_TOKEN       proactive messages, fallbacks, typing indicator
//
// Inbound route: POST /eve/v1/discord  (set this as your app's
// "Interactions Endpoint URL" in the Discord Developer Portal).
export default discordChannel();
