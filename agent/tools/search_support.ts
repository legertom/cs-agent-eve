import { defineTool } from "eve/tools";
import { z } from "zod";
import { searchSupport } from "../../lib/search";

// Hybrid + reranked search over Clever's support KB. The retrieval core lives in
// lib/search.ts so it can be shared with the MCP server (app/api/[transport])
// without pulling the eve runtime into the Next.js bundle.

export default defineTool({
  description:
    "Search Clever's support knowledge base for relevant help articles. Use " +
    "this for any question about Clever (logins, SSO, rostering, admin setup, " +
    "field names, errors, etc). Hybrid search — matches both meaning and exact " +
    "keywords/field names. Returns the most relevant articles with excerpts and " +
    "links; answer from these and cite the URL.",
  inputSchema: z.object({
    query: z.string().min(2).describe("The user's support question or keywords."),
    limit: z.number().int().min(1).max(8).optional().describe("Max results (default 5)."),
  }),
  async execute({ query, limit }) {
    return searchSupport(query, limit);
  },
});
