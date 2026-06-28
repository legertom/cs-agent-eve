import { defineSchedule } from "eve/schedules";
import { put } from "@vercel/blob";
import { refreshKb } from "../../lib/kb-refresh.mjs";
import {
  EMBED_DIMS,
  KB_BLOB_PATH,
  KB_MANIFEST_BLOB_PATH,
  KB_VECTORS_BLOB_PATH,
} from "../../lib/kb-config.mjs";

// Daily KB refresh. Crawl support.clever.com, embed the articles, and OVERWRITE
// the runtime KB snapshot in Vercel Blob. lib/search.ts lazily reads these exact
// blob keys (with a short TTL), so a refresh reaches live search with NO manual
// rebuild and NO redeploy — the whole point of this job.
//
// This is a deterministic data job (crawl → embed → write Blob): no agent
// reasoning, no tool loop, no channel delivery, no parking. So it runs through a
// `run` handler that calls plain JS directly, not a markdown task-mode prompt
// (which would burn LLM tokens and add nondeterminism for zero benefit). eve
// dispatches and authorizes the schedule itself, so there is NO CRON_SECRET check
// here — that pattern belongs to the standalone /api/judge/batch Next.js route.
//
// Cadence: 08:00 UTC (~midnight US Pacific, off-peak). Clever publishes a weekly
// article sitemap, so daily already runs ahead of their cadence; a full run is
// ~2 min of mostly-I/O and ~2¢ of embeddings, so freshness — not cost — is the
// only real constraint, and daily maximizes it.

// Overwrite the same stable pathname each run. @vercel/blob v2 refuses to
// clobber an existing object unless allowOverwrite:true is set — without it the
// FIRST refresh would succeed and every subsequent daily run would throw
// "blob already exists", silently freezing the KB. Short cacheControlMaxAge so a
// fresh snapshot propagates (these objects change daily, unlike the immutable
// 1-year share snapshots in lib/blob-shares.ts).
function putJson(pathname: string, data: unknown) {
  return put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

async function refreshAndStore(): Promise<void> {
  const { kb, vectors } = await refreshKb();

  // Guard against writing a degenerate KB: a bad crawl (zero articles) or an
  // index misalignment must NOT overwrite a good snapshot. Skip the write and
  // keep the previous Blob (or the bundled fallback) intact.
  if (kb.length === 0 || vectors.length !== kb.length) {
    console.error(
      `[refresh-kb] refusing to write degenerate KB (kb=${kb.length}, vectors=${vectors.length}) — keeping previous snapshot.`,
    );
    return;
  }

  // Write the KB + vectors first; the manifest is observability only.
  await Promise.all([
    putJson(KB_BLOB_PATH, kb),
    putJson(KB_VECTORS_BLOB_PATH, vectors),
  ]);
  await putJson(KB_MANIFEST_BLOB_PATH, {
    count: kb.length,
    dims: EMBED_DIMS,
    builtAt: new Date().toISOString(),
  });

  console.log(
    `[refresh-kb] wrote ${kb.length} articles + ${vectors.length} vectors (${EMBED_DIMS}d) to Blob.`,
  );
}

export default defineSchedule({
  cron: "0 8 * * *", // daily 08:00 UTC
  run: ({ waitUntil }) => {
    // Wrap the in-flight crawl/embed/Blob writes in waitUntil so they settle
    // before the cron task ends. Swallow errors so a failed run logs and exits
    // cleanly without leaving an unhandled rejection.
    waitUntil(
      refreshAndStore().catch((err) => {
        console.error("[refresh-kb] refresh failed:", err);
      }),
    );
  },
});
