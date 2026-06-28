import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Shared Neon serverless (HTTP) client — ideal for serverless/Fluid Compute.
// Backed by the pooled DATABASE_URL provisioned by the Vercel Neon Marketplace
// integration. Initialized lazily so importing this module never crashes a build
// where the DB env isn't present; the first query throws a clear error instead.

let client: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — add the Neon integration (vercel integration add neon) and pull env.",
      );
    }
    client = neon(url);
  }
  return client;
}
