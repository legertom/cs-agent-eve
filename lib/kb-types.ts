// Shared shapes for the KB freshness/changelog feature, written by the refresh
// schedule (agent/schedules/refresh-kb.ts) into Vercel Blob and read by
// lib/kb-status.ts + the /changelog page. Kept tiny and dependency-free.

// A help-center article, trimmed to what the changelog needs to render a link.
export type ArticleBrief = { id: string; title: string; url: string };

// One daily-sync entry: what changed, plus an AI-written one/two-sentence note.
// The added/removed/modified arrays are capped for size; `counts` carries the
// true totals so the UI can show "+ N more".
export type ChangelogEntry = {
  at: string; // ISO timestamp of the sync that produced this entry
  counts: { added: number; removed: number; modified: number; total: number };
  added: ArticleBrief[];
  removed: ArticleBrief[];
  modified: ArticleBrief[];
  summary: string;
};

// The KB manifest written alongside the snapshot. `syncedAt` advances every run;
// `changedAt` advances only when the content actually changed (so it can sit a
// week in the past while syncs keep happening). `builtAt` is kept for back-compat.
export type KbManifest = {
  count: number;
  dims: number;
  syncedAt: string;
  changedAt: string;
  builtAt?: string;
  lastChange?: { added: number; removed: number; modified: number };
};
