import { defineSchedule } from "eve/schedules";
import { head, put } from "@vercel/blob";
import { diffKb, refreshKb, summarizeKbChanges } from "../../lib/kb-refresh.mjs";
import {
  EMBED_DIMS,
  KB_BLOB_PATH,
  KB_CHANGELOG_BLOB_PATH,
  KB_MANIFEST_BLOB_PATH,
  KB_VECTORS_BLOB_PATH,
} from "../../lib/kb-config.mjs";
import type { ArticleBrief, ChangelogEntry, KbManifest } from "../../lib/kb-types";

type Article = { id: string; url: string; title?: string; text: string };

// Keep the changelog bounded (newest-first) and cap the per-entry article lists;
// `counts` always carries the true totals so the UI can show "+ N more".
const MAX_CHANGELOG_ENTRIES = 60;
const ENTRY_LIST_CAP = 50;

// Daily KB refresh. Crawl support.clever.com, embed the articles, and OVERWRITE
// the runtime KB snapshot in Vercel Blob. lib/search.ts lazily reads these exact
// blob keys (with a short TTL), so a refresh reaches live search with NO manual
// rebuild and NO redeploy — the whole point of this job.
//
// This is a mostly-deterministic data job (crawl → embed → diff → write Blob):
// no agent reasoning loop, no tool loop, no channel delivery, no parking — so it
// runs through a `run` handler that calls plain JS directly, not a markdown
// task-mode prompt (which would add an agent loop and nondeterminism for no
// benefit). The one LLM touch is a single generateText call that writes the
// changelog note, and only when the content actually changed (with a
// deterministic template fallback). eve dispatches and authorizes the schedule
// itself, so there is NO CRON_SECRET check here — that pattern belongs to the
// standalone /api/judge/batch Next.js route.
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

// Read a JSON blob (the previous snapshot/manifest/changelog) so we can diff
// against it. Returns null if absent (first run) or unreadable — same head+fetch
// pattern as lib/search.ts.
async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const meta = await head(pathname);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function refreshAndStore(): Promise<void> {
  // Snapshot the PREVIOUS KB + metadata BEFORE we overwrite, so we can diff the
  // fresh crawl against it and record what changed.
  const [prevKb, prevManifest, prevChangelog] = await Promise.all([
    readJson<Article[]>(KB_BLOB_PATH),
    readJson<KbManifest>(KB_MANIFEST_BLOB_PATH),
    readJson<ChangelogEntry[]>(KB_CHANGELOG_BLOB_PATH),
  ]);

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

  const syncedAt = new Date().toISOString();
  // Treat the first run under this feature as a baseline seed, not a diff: if
  // there's no previous KB, or the previous manifest predates this schedule (no
  // `syncedAt`), a diff against it would just surface crawl-coverage variance as
  // spurious adds/removes. Record "initial baseline" instead; real diffs start
  // from the next run, against a snapshot this schedule actually produced.
  const isInitial = !prevKb || prevKb.length === 0 || !prevManifest?.syncedAt;
  const diff: { added: ArticleBrief[]; removed: ArticleBrief[]; modified: ArticleBrief[] } =
    isInitial ? { added: [], removed: [], modified: [] } : diffKb(prevKb, kb);
  const changed =
    isInitial || diff.added.length + diff.removed.length + diff.modified.length > 0;

  // `changedAt` advances ONLY when content changed, so it can sit a week in the
  // past while daily syncs keep happening. `syncedAt` advances every run.
  // `lastChange` describes the change AT `changedAt`, so it must persist the same
  // way — a no-change run must NOT reset it to {0,0,0}.
  let changelog: ChangelogEntry[] = Array.isArray(prevChangelog) ? prevChangelog : [];
  let changedAt = prevManifest?.changedAt ?? prevManifest?.builtAt ?? syncedAt;
  let lastChange = prevManifest?.lastChange ?? { added: 0, removed: 0, modified: 0 };

  if (changed) {
    const summary = await summarizeKbChanges({
      added: diff.added,
      removed: diff.removed,
      modified: diff.modified,
      total: kb.length,
      isInitial,
    });
    const entry: ChangelogEntry = {
      at: syncedAt,
      counts: {
        added: diff.added.length,
        removed: diff.removed.length,
        modified: diff.modified.length,
        total: kb.length,
      },
      added: diff.added.slice(0, ENTRY_LIST_CAP),
      removed: diff.removed.slice(0, ENTRY_LIST_CAP),
      modified: diff.modified.slice(0, ENTRY_LIST_CAP),
      summary,
    };
    changelog = [entry, ...changelog].slice(0, MAX_CHANGELOG_ENTRIES);
    changedAt = syncedAt;
    lastChange = {
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
    };
  }

  const manifest: KbManifest = {
    count: kb.length,
    dims: EMBED_DIMS,
    syncedAt,
    changedAt,
    builtAt: syncedAt, // back-compat with the older manifest shape
    lastChange,
  };

  // Write the KB + vectors first (what search serves), then the changelog +
  // manifest (observability).
  await Promise.all([putJson(KB_BLOB_PATH, kb), putJson(KB_VECTORS_BLOB_PATH, vectors)]);
  await Promise.all([
    putJson(KB_CHANGELOG_BLOB_PATH, changelog),
    putJson(KB_MANIFEST_BLOB_PATH, manifest),
  ]);

  console.log(
    `[refresh-kb] synced ${kb.length} articles ` +
      (isInitial
        ? "(initial baseline)"
        : `(+${diff.added.length} / -${diff.removed.length} / ~${diff.modified.length})`) +
      `; changedAt=${changedAt}.`,
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
