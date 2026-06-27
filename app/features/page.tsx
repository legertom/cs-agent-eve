import {
  ArrowRightIcon,
  BadgeCheckIcon,
  BotIcon,
  GaugeCircleIcon,
  GraduationCapIcon,
  HandIcon,
  LayersIcon,
  LineChartIcon,
  type LucideIcon,
  MessagesSquareIcon,
  PlugIcon,
  RefreshCwIcon,
  UsersIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TicketIcon,
} from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Features — Clever Support Assistant",
  description:
    "Everything the Clever Support Assistant can do at a glance — a hybrid + reranked RAG pipeline, a confidence gate that knows when to ask a human, and a live trust panel. Built on Vercel eve.",
};

// Distinct eve / Vercel primitives this build demonstrates — the platform flex.
const PRIMITIVES = [
  "AI Gateway",
  "Tools",
  "Human-in-the-loop",
  "Durable sessions",
  "Multi-channel",
  "Agent Runs",
  "MCP",
  "Skills",
  "Subagents",
];

type Feature = {
  icon: LucideIcon;
  title: string;
  blurb: string;
  tags: string[];
};

// Shipped and demoable right now.
const LIVE: Feature[] = [
  {
    icon: LayersIcon,
    title: "Hybrid + reranked retrieval",
    blurb:
      "BM25 keyword search and embedding semantic search are fused with Reciprocal Rank Fusion, then re-scored by a Cohere cross-encoder — three providers, one AI Gateway, zero key management.",
    tags: ["AI Gateway", "Tools"],
  },
  {
    icon: ScanSearchIcon,
    title: "“Show your work” trust panel",
    blurb:
      "Every web answer carries an inline panel: the calibrated confidence band, the exact ranked sources with their reranker scores, and the pipeline that produced them. The RAG internals, made visible.",
    tags: ["AI Gateway", "Agent Runs"],
  },
  {
    icon: HandIcon,
    title: "Confidence gate + ask-a-human",
    blurb:
      "On low confidence, a tight margin, a high-stakes topic (billing, data deletion, SSO security), or when articles target different audiences, the agent pauses and asks a clarifying question instead of guessing — durably, mid-turn.",
    tags: ["Human-in-the-loop", "Durable sessions"],
  },
  {
    icon: UsersIcon,
    title: "Browse by audience",
    blurb:
      "All 525 help articles, filtered by who they're written for — admins, teachers, app partners, families. New agents skim the lay of the land fast, and answers can be tailored to the right POV.",
    tags: ["Knowledge base"],
  },
  {
    icon: ShieldCheckIcon,
    title: "Grounded answers, honest gaps",
    blurb:
      "Answers are synthesized only from retrieved help-center articles and always cite their sources. When nothing relevant comes back, it says so and points to a person — it never fabricates steps.",
    tags: ["Tools"],
  },
  {
    icon: MessagesSquareIcon,
    title: "One brain, two channels",
    blurb:
      "The same agent, knowledge base, and voice answer in Discord and in a branded web chat. Durable sessions hold the thread across follow-ups and survive restarts.",
    tags: ["Multi-channel", "Durable sessions"],
  },
  {
    icon: GaugeCircleIcon,
    title: "Full observability",
    blurb:
      "Every session, tool call, and token is traced in Vercel's Agent Runs dashboard — so you can see exactly how any answer was reached and where to tune retrieval.",
    tags: ["Agent Runs"],
  },
  {
    icon: PlugIcon,
    title: "Use it inside Claude (MCP)",
    blurb:
      "The same retrieval pipeline is exposed as a remote MCP server, so colleagues can query Clever's KB from inside Claude, VS Code, or Cursor — one brain, many front doors.",
    tags: ["MCP", "AI Gateway"],
  },
];

// On the roadmap — from the feature backlog, sized for what's next.
const NEXT: Feature[] = [
  {
    icon: SparklesIcon,
    title: "Jargon decoder + query expansion",
    blurb:
      "Detect Clever-specific terms, inline a plain-language definition, and rewrite casual phrasing into canonical terms before search so retrieval actually hits.",
    tags: ["Tools", "Skills"],
  },
  {
    icon: BadgeCheckIcon,
    title: "Citation faithfulness verifier",
    blurb:
      "A second agent with its own identity checks each claim against the cited excerpt and strips anything not grounded in a source — independent of the writer.",
    tags: ["Subagents"],
  },
  {
    icon: TicketIcon,
    title: "Paste-a-ticket triage & draft",
    blurb:
      "Drop in a raw customer ticket and get a triage card — category, severity, the articles that apply — plus a ready-to-edit, fully cited draft reply.",
    tags: ["Tools", "Human-in-the-loop"],
  },
  {
    icon: GraduationCapIcon,
    title: "Practice mode with grading",
    blurb:
      "A simulated customer raises a realistic ticket; a grader subagent scores the trainee's reply against the ground-truth article and gives targeted feedback.",
    tags: ["Subagents", "Evals"],
  },
  {
    icon: RefreshCwIcon,
    title: "KB freshness audit",
    blurb:
      "A scheduled job re-crawls the live help center, diffs content hashes, and flags answers built on articles that changed since indexing — verify on the live page.",
    tags: ["Schedules", "Sandbox"],
  },
  {
    icon: BotIcon,
    title: "Product-area specialists",
    blurb:
      "A router fans out to focused subagents (SSO, Rostering, Admin, Integrations), each with scoped knowledge and tuned vocabulary, merging answers with per-area citations.",
    tags: ["Subagents"],
  },
  {
    icon: LineChartIcon,
    title: "Feedback loop → eval set",
    blurb:
      "Thumbs-down and “wrong article” signals flow into the eval harness as regression cases and a content-gap queue, so the bot improves where new agents struggle most.",
    tags: ["Evals", "Schedules"],
  },
];

export default function FeaturesPage() {
  return (
    <main className="bg-white text-clever-black">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-20 pb-14">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-48 w-48 bg-clever-yellow/30 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="clever-blob-2 absolute top-16 left-0 h-40 w-40 bg-clever-green/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-clever-light-blue bg-clever-light-blue/40 px-3 py-1 text-clever-navy text-xs">
            <SparklesIcon className="size-3.5" />
            Built on Vercel eve
          </span>
          <h1 className="mt-5 font-normal text-5xl text-clever-navy leading-[1.05] sm:text-6xl">
            Not a chatbot. A support agent that knows when it&apos;s sure.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-clever-black/60 text-lg leading-relaxed">
            A retrieval pipeline spanning three AI providers, a confidence gate
            that stops and asks a human instead of guessing, and a trust panel
            that shows its work on every answer — all on one agent framework.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {PRIMITIVES.map((p) => (
              <span
                key={p}
                className="rounded-full border border-clever-navy/15 bg-white px-3 py-1 text-clever-navy/70 text-xs"
              >
                {p}
              </span>
            ))}
          </div>
          <Link
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-clever-blue px-6 py-3 font-medium text-white transition-colors hover:bg-clever-navy"
            href="/"
          >
            Try it now <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </section>

      {/* Live now */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="Live now"
            title="Shipped and demoable"
            sub="Everything below is running in this app today."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LIVE.map((f) => (
              <FeatureCard feature={f} key={f.title} live />
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="px-6 pb-16">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="On the roadmap"
            title="Where it goes next"
            sub="High-leverage features from the backlog, each built on eve primitives."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NEXT.map((f) => (
              <FeatureCard feature={f} key={f.title} />
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative overflow-hidden bg-clever-navy px-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="clever-blob-3 absolute top-4 right-10 h-32 w-32 bg-clever-blue/30 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="clever-blob-1 absolute bottom-0 left-10 h-28 w-28 bg-clever-green/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-xl">
          <h2 className="font-normal text-3xl text-white">See it think.</h2>
          <p className="mt-4 text-clever-light-blue leading-relaxed">
            Ask a real Clever question and watch the confidence band, the ranked
            sources, and — on a tricky one — the agent stop to ask before it
            answers.
          </p>
          <Link
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-clever-blue px-6 py-3 font-medium text-white transition-colors hover:bg-white hover:text-clever-navy"
            href="/"
          >
            Open the assistant <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly sub: string;
}) {
  return (
    <div className="mb-6">
      <p className="font-semibold text-clever-blue text-xs uppercase tracking-wider">{eyebrow}</p>
      <h2 className="mt-1 font-normal text-3xl text-clever-navy">{title}</h2>
      <p className="mt-1 text-clever-black/50">{sub}</p>
    </div>
  );
}

function FeatureCard({
  feature,
  live,
}: {
  readonly feature: Feature;
  readonly live?: boolean;
}) {
  const Icon = feature.icon;
  return (
    <div className="group relative flex flex-col rounded-2xl border border-clever-light-blue bg-white p-5 transition-colors hover:border-clever-blue/30">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-xl bg-clever-light-blue/50 text-clever-blue">
          <Icon className="size-5" />
        </span>
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-clever-green/10 px-2 py-0.5 font-medium text-clever-green text-xs">
            <span className="size-1.5 rounded-full bg-clever-green" />
            Live
          </span>
        ) : (
          <span className="rounded-full bg-clever-black/5 px-2 py-0.5 font-medium text-clever-black/40 text-xs">
            Roadmap
          </span>
        )}
      </div>
      <h3 className="font-medium text-clever-navy">{feature.title}</h3>
      <p className="mt-1.5 flex-1 text-clever-black/60 text-sm leading-relaxed">{feature.blurb}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {feature.tags.map((t) => (
          <span
            key={t}
            className="rounded-md bg-clever-light-blue/40 px-2 py-0.5 text-clever-navy/60 text-xs"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
