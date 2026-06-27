import { eveChannel } from "eve/channels/eve";
import { none } from "eve/channels/auth";

export default eveChannel({
  // PUBLIC DEMO: anyone who can reach the URL can chat with the agent (and
  // spend model tokens). Fine for a hackathon. Before sharing widely, swap
  // none() for a real auth provider (Auth.js, Clerk, or vercelOidc()).
  auth: [none()],
});
