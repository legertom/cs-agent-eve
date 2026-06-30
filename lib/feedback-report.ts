import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { z } from "zod";
import { searchSupport } from "./search";

// The "Support QA Analyst" — turns the raw negative-signal log into a prioritized,
// evidence-linked report with concrete recommendations. This is the synthesis
// layer on top of log → judge → segment: those tell you WHAT happened; this tells
// you WHY it keeps happening and WHAT to change.
//
// Pipeline (all LLM calls go through the Vercel AI Gateway, same shape as
// lib/judge.ts / lib/inquiry-segment.ts):
//   1. gather    — every negative signal in the window, pulled deterministically
//                  from Neon (lib/feedback-report-store.ts). Flags + thumbs-down +
//                  expert edits + judge hallucinations/low-groundedness.
//   2. cluster   — a cheap Haiku pass groups the signals into recurring THEMES,
//                  referencing items by number (robust, like segmentation).
//   3. diagnose  — for each theme we run the SAME KB search the agent uses
//                  (lib/search.ts) so a recommendation can tell a missing article
//                  (KB gap) apart from a wrong/weak one (KB fix).
//   4. synthesize — a Sonnet pass writes the health summary + ranked
//                  recommendations, grounded in the themes, their KB coverage, and
//                  the deterministic window stats, with a trend vs the last report.
//
// Every model step is tolerant: a parse failure falls back to a deterministic
// result so a report is ALWAYS produced (never a blank page or a thrown route).

// Cheap clusterer; Sonnet (the answer model) writes the recommendations — the one
// step where reasoning quality is worth the spend.
export const CLUSTER_MODEL = "anthropic/claude-haiku-4.5";
export const SYNTH_MODEL = "anthropic/claude-sonnet-4.6";

// How far back each report looks. A rolling window (not "since last report") so
// every report is a full picture; "trend" compares headline numbers to the prior
// report instead.
export const REPORT_WINDOW_DAYS = 30;

// Bounds so the cluster prompt stays small and the KB-search fan-out stays cheap.
const MAX_ITEMS_PER_SOURCE = 60;
const MAX_THEMES = 8;
const MAX_RECOMMENDATIONS = 8;
const EVIDENCE_PER_THEME = 5;
const KB_ARTICLES_PER_THEME = 3;
const MAX_DETAIL = 240;
const MAX_QUESTION = 180;

// --- The five negative signals we mine -------------------------------------
export const SIGNAL_KINDS = [
  "flag",
  "thumbs_down",
  "expert_edit",
  "judge_hallucination",
  "judge_low_ground",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  flag: "Flagged thread",
  thumbs_down: "Thumbs down",
  expert_edit: "Expert edit",
  judge_hallucination: "Judge: hallucination",
  judge_low_ground: "Judge: weak grounding",
};

// One normalized negative signal, source-agnostic. `href`/`label` deep-link back
// to the real evidence (a flagged thread or an inquiry thread) so the report is
// auditable, not just assertive. `detail` is the short "why it's negative" text
// (flag note, down reason, judge verdict, edit marker) the clusterer reads.
export type SignalItem = {
  readonly kind: SignalKind;
  readonly createdAt: string;
  readonly question: string;
  readonly detail: string;
  readonly href: string;
  readonly label: string;
  readonly cost?: number;
  readonly topConfidence?: string;
};

export type KbRef = { readonly title: string; readonly url: string; readonly score: number | null };

export type EvidenceRef = { readonly href: string; readonly label: string; readonly kind: SignalKind };

// Deterministic window aggregates — computed in SQL, never by the model, so the
// dashboard numbers are always trustworthy (the model only narrates them).
export type ReportStats = {
  readonly windowDays: number;
  readonly since: string;
  readonly totalSignals: number;
  readonly byKind: Readonly<Record<SignalKind, number>>;
  readonly flagsByReason: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
  readonly thumbsUp: number;
  readonly thumbsDown: number;
  readonly expertEdits: number;
  readonly hallucinationCount: number;
  readonly avgGroundednessJudged: number | null;
  // Total spend on the inquiries that drew a judge-negative signal — the "what is
  // getting it wrong actually costing us" number.
  readonly negativeSignalCost: number;
};

// What the store hands the orchestrator: the capped item list (for clustering +
// evidence) and the uncapped aggregates (for the dashboard).
export type GatheredSignals = {
  readonly items: ReadonlyArray<SignalItem>;
  readonly stats: ReportStats;
};

export type ReportTheme = {
  readonly title: string;
  readonly description: string;
  readonly count: number;
  readonly kinds: ReadonlyArray<SignalKind>;
  readonly evidence: ReadonlyArray<EvidenceRef>;
  readonly kbCoverage: { readonly confidence: string; readonly articles: ReadonlyArray<KbRef> };
};

export const RECOMMENDATION_TYPES = ["kb_gap", "kb_fix", "prompt", "retrieval", "process", "other"] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_TYPE_LABEL: Record<RecommendationType, string> = {
  kb_gap: "Write KB article",
  kb_fix: "Fix KB article",
  prompt: "Tune the prompt",
  retrieval: "Tune retrieval",
  process: "Process change",
  other: "Investigate",
};

export type Severity = "high" | "medium" | "low";

export type Recommendation = {
  readonly rank: number;
  readonly title: string;
  readonly type: RecommendationType;
  readonly severity: Severity;
  readonly rationale: string;
  readonly action: string;
  readonly themeTitle?: string;
  readonly evidence: ReadonlyArray<EvidenceRef>;
  readonly kbRefs: ReadonlyArray<KbRef>;
};

export type FeedbackReport = {
  readonly v: 1;
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly since: string;
  readonly model: string;
  readonly stats: ReportStats;
  readonly health: { readonly summary: string; readonly trend?: string };
  readonly themes: ReadonlyArray<ReportTheme>;
  readonly recommendations: ReadonlyArray<Recommendation>;
};

// Slim row for the report history list.
export type ReportSummary = {
  readonly id: string;
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly totalSignals: number;
  readonly recommendationCount: number;
};

function clip(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Shared tolerant JSON extractor — strips accidental code fences and slices to the
// outer object, exactly like parseJudge / parseSegmentation.
function extractJson(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

// --- 2. Cluster ------------------------------------------------------------

const CLUSTER_SYSTEM = [
  "You triage a customer-support AI agent's NEGATIVE feedback signals into recurring THEMES.",
  "You are given a numbered list of signals (1..N); each is one thing that went wrong:",
  "a human flag, a thumbs-down, an expert's correction, or an automated judge's hallucination/weak-grounding verdict.",
  "Group signals that share a ROOT CAUSE or TOPIC into a theme (e.g. 'SSO/rostering setup', 'billing & Clever Pass').",
  "A theme should be specific enough to act on. Prefer 2-6 themes; never exceed 8.",
  "Refer to signals by their NUMBER. A signal may belong to at most one theme; ignore one-off noise.",
  "Output ONLY a single minified JSON object — no prose, no markdown fences — of the form:",
  '{"themes":[{"title":<string <=60 chars>,"description":<string, one sentence>,"items":[<number>,...]},...]}.',
].join(" ");

const ClusterSchema = z.object({
  themes: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        items: z.array(z.coerce.number().int().positive()).min(1),
      }),
    )
    .min(1),
});

type RawTheme = { title: string; description: string; items: number[] };

export function parseClusters(text: string, itemCount: number): RawTheme[] {
  const parsed = ClusterSchema.parse(JSON.parse(extractJson(text)));
  const seen = new Set<number>();
  const themes: RawTheme[] = [];
  for (const t of parsed.themes) {
    const items = t.items.filter((n) => n >= 1 && n <= itemCount && !seen.has(n));
    if (items.length === 0) continue;
    for (const n of items) seen.add(n);
    themes.push({
      title: clip(t.title, 60) || `Theme ${themes.length + 1}`,
      description: clip(t.description, 200),
      items,
    });
    if (themes.length >= MAX_THEMES) break;
  }
  return themes;
}

async function clusterSignals(items: ReadonlyArray<SignalItem>): Promise<RawTheme[]> {
  const list = items
    .map((it, i) => `${i + 1}. [${SIGNAL_LABEL[it.kind]}] ${it.question || "(no question)"}${it.detail ? ` — ${it.detail}` : ""}`)
    .join("\n");
  const prompt = [
    "Negative feedback signals:",
    list,
    "\nReturn ONLY the minified JSON object described in the system prompt.",
  ].join("\n");
  const { text } = await generateText({ model: gateway(CLUSTER_MODEL), system: CLUSTER_SYSTEM, prompt });
  return parseClusters(text, items.length);
}

// --- 3. Diagnose: KB coverage for a theme ----------------------------------

async function kbCoverageFor(theme: RawTheme, items: ReadonlyArray<SignalItem>): Promise<ReportTheme["kbCoverage"]> {
  const firstQuestion = items[theme.items[0] - 1]?.question ?? "";
  const query = clip(`${theme.title} ${firstQuestion}`, 200);
  try {
    const res = await searchSupport(query, KB_ARTICLES_PER_THEME);
    if ("error" in res) return { confidence: "unscored", articles: [] };
    return {
      confidence: res.confidence.level,
      articles: res.results.map((r) => ({ title: r.title ?? "(untitled)", url: r.url, score: r.score })),
    };
  } catch {
    return { confidence: "unscored", articles: [] };
  }
}

function buildTheme(theme: RawTheme, items: ReadonlyArray<SignalItem>, kbCoverage: ReportTheme["kbCoverage"]): ReportTheme {
  const members = theme.items.map((n) => items[n - 1]).filter((x): x is SignalItem => Boolean(x));
  const kinds = [...new Set(members.map((m) => m.kind))];
  const evidence: EvidenceRef[] = members
    .slice(0, EVIDENCE_PER_THEME)
    .map((m) => ({ href: m.href, label: m.label, kind: m.kind }));
  return {
    title: theme.title,
    description: theme.description,
    count: members.length,
    kinds,
    evidence,
    kbCoverage,
  };
}

// --- 4. Synthesize ----------------------------------------------------------

const SYNTH_SYSTEM = [
  "You are a support-quality analyst. You are given THEMES of negative feedback about an AI support agent,",
  "each theme's knowledge-base (KB) coverage, and the period's aggregate stats.",
  "Write a concise health summary and a RANKED list of concrete, actionable recommendations (most important first).",
  "Use the KB coverage to choose each recommendation's type:",
  "- kb_gap: the topic recurs but the KB has no strong article (low/unscored confidence, no relevant title).",
  "- kb_fix: a relevant KB article exists but answers were still wrong/incomplete — the article needs correcting.",
  "- prompt: the agent answered without searching, ignored good sources, or was confidently wrong — a system-prompt/behavior change.",
  "- retrieval: good articles exist but ranked poorly / low confidence — a retrieval or confidence-threshold change.",
  "- process: needs a human/process change (e.g. escalation path).",
  "- other: anything else.",
  "Each recommendation needs a one-sentence rationale grounded in the evidence and a specific next-step action.",
  "Reference the theme by its NUMBER. Keep it to the few highest-leverage items; never exceed 8.",
  "If a previous period's numbers are given, note the trend in one short sentence.",
  "Output ONLY a single minified JSON object — no prose, no markdown fences — of the form:",
  '{"health":{"summary":<string>,"trend":<string>},"recommendations":[{"theme":<number>,"title":<string <=80 chars>,"type":<one of kb_gap|kb_fix|prompt|retrieval|process|other>,"severity":<high|medium|low>,"rationale":<string>,"action":<string>},...]}.',
].join(" ");

const SynthSchema = z.object({
  health: z.object({ summary: z.string(), trend: z.string().optional() }),
  recommendations: z
    .array(
      z.object({
        theme: z.coerce.number().int().nonnegative().optional(),
        title: z.string(),
        type: z.string(),
        severity: z.string(),
        rationale: z.string(),
        action: z.string(),
      }),
    )
    .default([]),
});

function asType(v: string): RecommendationType {
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (RECOMMENDATION_TYPES as readonly string[]).includes(t) ? (t as RecommendationType) : "other";
}
function asSeverity(v: string): Severity {
  const s = v.trim().toLowerCase();
  return s === "high" || s === "low" ? s : "medium";
}

export function parseSynthesis(
  text: string,
  themes: ReadonlyArray<ReportTheme>,
): { health: FeedbackReport["health"]; recommendations: Recommendation[] } {
  const parsed = SynthSchema.parse(JSON.parse(extractJson(text)));
  const recommendations: Recommendation[] = parsed.recommendations.slice(0, MAX_RECOMMENDATIONS).map((r, i) => {
    const theme = r.theme && r.theme >= 1 && r.theme <= themes.length ? themes[r.theme - 1] : undefined;
    return {
      rank: i + 1,
      title: clip(r.title, 80),
      type: asType(r.type),
      severity: asSeverity(r.severity),
      rationale: clip(r.rationale, 400),
      action: clip(r.action, 400),
      themeTitle: theme?.title,
      evidence: theme ? theme.evidence.slice(0, 4) : [],
      kbRefs: theme ? theme.kbCoverage.articles : [],
    };
  });
  return {
    health: { summary: clip(parsed.health.summary, 600), trend: parsed.health.trend ? clip(parsed.health.trend, 280) : undefined },
    recommendations,
  };
}

async function synthesize(
  themes: ReadonlyArray<ReportTheme>,
  stats: ReportStats,
  prev: ReportStats | null,
): Promise<{ health: FeedbackReport["health"]; recommendations: Recommendation[] }> {
  const themeBlock = themes
    .map((t, i) => {
      const kb = t.kbCoverage.articles.length
        ? `${t.kbCoverage.confidence} confidence; top articles: ${t.kbCoverage.articles.map((a) => a.title).join("; ")}`
        : "no relevant KB article found";
      return `Theme ${i + 1}: ${t.title} (${t.count} signals; kinds: ${t.kinds.map((k) => SIGNAL_LABEL[k]).join(", ")})\n  ${t.description}\n  KB coverage: ${kb}`;
    })
    .join("\n");

  const statsBlock = [
    `Window: last ${stats.windowDays} days. Total negative signals: ${stats.totalSignals}.`,
    `By kind: ${SIGNAL_KINDS.map((k) => `${SIGNAL_LABEL[k]}=${stats.byKind[k]}`).join(", ")}.`,
    stats.flagsByReason.length ? `Flag reasons: ${stats.flagsByReason.map((r) => `${r.reason}=${r.count}`).join(", ")}.` : "",
    `Thumbs: ${stats.thumbsUp} up / ${stats.thumbsDown} down; expert edits: ${stats.expertEdits}.`,
    stats.avgGroundednessJudged != null ? `Judge avg groundedness: ${stats.avgGroundednessJudged.toFixed(2)}.` : "",
    `Spend on judge-negative inquiries: $${stats.negativeSignalCost.toFixed(4)}.`,
    prev ? `Previous report: ${prev.totalSignals} signals, ${prev.hallucinationCount} hallucinations.` : "No previous report.",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    "THEMES:",
    themeBlock,
    "\nSTATS:",
    statsBlock,
    "\nReturn ONLY the minified JSON object described in the system prompt.",
  ].join("\n");

  const { text } = await generateText({ model: gateway(SYNTH_MODEL), system: SYNTH_SYSTEM, prompt });
  return parseSynthesis(text, themes);
}

// Deterministic fallback recommendations — used when synthesis can't be parsed, so
// a report still ships. One per theme: KB-confident → fix, otherwise → gap.
function fallbackRecommendations(themes: ReadonlyArray<ReportTheme>): Recommendation[] {
  return themes.slice(0, MAX_RECOMMENDATIONS).map((t, i) => {
    const weakKb = t.kbCoverage.articles.length === 0 || t.kbCoverage.confidence === "low" || t.kbCoverage.confidence === "unscored";
    const type: RecommendationType = weakKb ? "kb_gap" : "kb_fix";
    return {
      rank: i + 1,
      title: clip(t.title, 80),
      type,
      severity: t.count >= 4 ? "high" : t.count >= 2 ? "medium" : "low",
      rationale: `${t.count} negative signal${t.count === 1 ? "" : "s"} clustered here${weakKb ? " with weak KB coverage" : ""}.`,
      action: weakKb
        ? `Write a KB article covering "${t.title}".`
        : `Review and correct the KB article(s) for "${t.title}".`,
      themeTitle: t.title,
      evidence: t.evidence.slice(0, 4),
      kbRefs: t.kbCoverage.articles,
    };
  });
}

function fallbackHealth(stats: ReportStats, prev: ReportStats | null): FeedbackReport["health"] {
  const trend = prev ? `${stats.totalSignals - prev.totalSignals >= 0 ? "+" : ""}${stats.totalSignals - prev.totalSignals} vs last report.` : undefined;
  return {
    summary: `${stats.totalSignals} negative signals in the last ${stats.windowDays} days across ${SIGNAL_KINDS.filter((k) => stats.byKind[k] > 0).length} signal types.`,
    trend,
  };
}

// --- Orchestrator -----------------------------------------------------------

// Build a complete report from gathered signals + the previous report's stats (for
// trend). Pure-ish: it runs the model + KB steps but does NOT persist — the route
// owns persistence. Resilient at every model boundary.
export async function buildReport(
  gathered: GatheredSignals,
  prevStats: ReportStats | null,
  generatedAt: string,
): Promise<FeedbackReport> {
  const { items, stats } = gathered;

  // Empty window → a valid "all clear" report, no model calls.
  if (items.length === 0) {
    return {
      v: 1,
      generatedAt,
      windowDays: stats.windowDays,
      since: stats.since,
      model: `${CLUSTER_MODEL} + ${SYNTH_MODEL}`,
      stats,
      health: { summary: `No negative signals in the last ${stats.windowDays} days. Nothing to review.` },
      themes: [],
      recommendations: [],
    };
  }

  // 2. Cluster (fall back to one catch-all theme if the model output won't parse).
  let rawThemes: RawTheme[];
  try {
    rawThemes = await clusterSignals(items);
    if (rawThemes.length === 0) throw new Error("no themes");
  } catch (err) {
    console.error("[feedback-report] cluster failed; using catch-all theme", err);
    rawThemes = [{ title: "All negative signals", description: "Uncategorized — clustering unavailable.", items: items.map((_, i) => i + 1) }];
  }

  // 3. Diagnose: KB coverage per theme (concurrent — each is one cheap search).
  const coverages = await Promise.all(rawThemes.map((t) => kbCoverageFor(t, items)));
  const themes = rawThemes.map((t, i) => buildTheme(t, items, coverages[i]));

  // 4. Synthesize (fall back to deterministic recs if the model output won't parse).
  let health: FeedbackReport["health"];
  let recommendations: Recommendation[];
  try {
    const out = await synthesize(themes, stats, prevStats);
    health = out.health;
    recommendations = out.recommendations.length ? out.recommendations : fallbackRecommendations(themes);
  } catch (err) {
    console.error("[feedback-report] synthesis failed; using deterministic recommendations", err);
    health = fallbackHealth(stats, prevStats);
    recommendations = fallbackRecommendations(themes);
  }

  return {
    v: 1,
    generatedAt,
    windowDays: stats.windowDays,
    since: stats.since,
    model: `${CLUSTER_MODEL} + ${SYNTH_MODEL}`,
    stats,
    health,
    themes,
    recommendations,
  };
}
