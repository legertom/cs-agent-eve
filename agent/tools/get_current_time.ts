import { defineTool } from "eve/tools";
import { z } from "zod";

// Returns the current date and time, optionally in a specific IANA timezone
// (e.g. "America/New_York", "Europe/London", "Asia/Tokyo"). Useful for
// scheduling across a distributed team in chat.
export default defineTool({
  description:
    "Get the current date and time. Optionally pass an IANA timezone " +
    "(e.g. 'Asia/Tokyo', 'America/New_York') to get the local time there.",
  inputSchema: z.object({
    timeZone: z
      .string()
      .optional()
      .describe(
        "IANA timezone name, e.g. 'Europe/London'. Defaults to UTC.",
      ),
  }),
  async execute({ timeZone }) {
    const tz = timeZone ?? "UTC";
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);
      return { timeZone: tz, localTime: formatted, iso: now.toISOString() };
    } catch {
      return {
        error: `Unknown timezone: "${tz}". Use an IANA name like 'America/New_York'.`,
      };
    }
  },
});
