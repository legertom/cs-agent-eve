import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  CheckCircle2Icon,
  CodeIcon,
  FingerprintIcon,
  GaugeCircleIcon,
  HandIcon,
  LayersIcon,
  Link2Icon,
  type LucideIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";

export const metadata = {
  title: "How it works — Clever Support Assistant",
  description:
    "Follow a real question from the moment it's typed to a plain-language answer with cited sources — then go under the hood: hybrid retrieval, a confidence gate, and the Vercel eve agent framework it's built on.",
};

// Number of help-center articles in the knowledge base.
const ARTICLE_COUNT = "525";
const GITHUB_URL = "https://github.com/legertom/cs-agent-eve";

const TOC = [
  { href: "#how-it-answers", label: "How it answers" },
  { href: "#under-the-hood", label: "Under the hood" },
  { href: "#built-on-eve", label: "Built on Vercel eve" },
];

// The real pipeline, one rung deeper than the friendly walkthrough.
const INTERNALS: { icon: LucideIcon; term: string; body: React.ReactNode }[] = [
  {
    icon: LayersIcon,
    term: "Hybrid, reranked retrieval",
    body: (
      <>
        Two searches run at once — classic keyword matching (BM25) and
        meaning-based semantic search — and their results are fused with{" "}
        <em>Reciprocal Rank Fusion</em>. A dedicated reranker (a Cohere
        cross-encoder) then re-scores the finalists for true relevance. Three AI
        providers cooperate behind a single Vercel AI Gateway, so the best of
        keyword precision and semantic recall both count.
      </>
    ),
  },
  {
    icon: HandIcon,
    term: "A confidence gate that asks a human",
    body: (
      <>
        Retrieval returns a calibrated confidence band, not just results. When
        confidence is low, the top two articles are too close to call, or the
        topic is high-stakes (billing, data deletion, SSO security), the agent{" "}
        <strong className="text-clever-navy">pauses mid-answer and asks a
        clarifying question</strong>{" "}
        instead of guessing — and it can hold that pause durably, picking the
        thread back up when you reply.
      </>
    ),
  },
  {
    icon: ScanSearchIcon,
    term: "It shows its work",
    body: (
      <>
        Every web answer carries an inline trust panel: the confidence band, the
        exact ranked sources, and the reranker scores that chose them. Nothing
        about the retrieval is hidden — you can see precisely what an answer was
        built on.
      </>
    ),
  },
  {
    icon: RefreshCwIcon,
    term: "Knowledge that stays fresh",
    body: (
      <>
        A scheduled job re-crawls and re-embeds Clever&apos;s help center every
        day and hot-swaps it into live search through Vercel Blob — new and
        updated articles show up the next day with no rebuild and no redeploy.{" "}
        <Link className="text-clever-blue underline hover:text-clever-navy" href="/changelog">
          See what&apos;s changed
        </Link>
        .
      </>
    ),
  },
  {
    icon: GaugeCircleIcon,
    term: "Everything is traced",
    body: (
      <>
        Every session, tool call, and token is recorded — so any answer can be
        replayed end to end, and the team can see exactly where to tune
        retrieval or close a knowledge gap.
      </>
    ),
  },
];

function StepLabel({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="mb-1 font-semibold text-clever-blue text-xs uppercase tracking-wider">
      {children}
    </p>
  );
}

function Bracket({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="mb-6 flex justify-center">
      <span className="rounded-full border border-clever-light-blue bg-white px-3 py-1 text-clever-black/50 text-xs">
        {children}
      </span>
    </div>
  );
}

export default function AboutPage() {
  return (
    <main className="bg-white text-clever-black">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-20 pb-10">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-48 w-48 bg-clever-yellow/30 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="clever-blob-2 absolute top-16 left-0 h-40 w-40 bg-clever-green/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <h1 className="font-normal text-5xl text-clever-navy leading-[1.05] sm:text-6xl">
            Watch a question find its answer.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-clever-black/60 text-lg leading-relaxed">
            Meet the Clever Support Assistant — a friendly helper that has read
            every article in Clever&apos;s help center, so you don&apos;t have to. Ask
            in plain words, right here in the browser, and follow your question step
            by step, all the way to a clear answer with the sources to prove it.{" "}
            <span className="text-clever-navy">No guessing.</span>
          </p>
          <Link
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-clever-blue px-6 py-3 font-medium text-white transition-colors hover:bg-clever-navy"
            href="/"
          >
            Try it now <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </section>

      {/* Mini table of contents */}
      <nav
        aria-label="On this page"
        className="mx-auto mb-12 flex max-w-2xl flex-wrap items-center justify-center gap-2 px-6"
      >
        <span className="text-clever-black/40 text-xs uppercase tracking-wider">On this page</span>
        {TOC.map((t) => (
          <a
            className="rounded-full border border-clever-light-blue bg-clever-light-blue/30 px-3 py-1 font-medium text-clever-navy text-sm transition-colors hover:border-clever-blue/40 hover:bg-clever-light-blue/60"
            href={t.href}
            key={t.href}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {/* The journey, threaded by a dotted spine */}
      <section className="scroll-mt-6 px-6 pb-8" id="how-it-answers">
        <div className="mx-auto max-w-2xl space-y-12 border-clever-navy/20 border-l-2 border-dashed pl-8">
          {/* Step 1 */}
          <Step n={1}>
            <StepLabel>Step 1 · You ask</StepLabel>
            <h2 className="mb-3 font-normal text-2xl text-clever-navy">
              A real question, asked like you&apos;d ask a colleague
            </h2>
            <p className="mb-5 text-clever-black/70 leading-relaxed">
              It starts the way every good answer does: with a question. Picture a
              teacher typing,{" "}
              <em>“Why do students keep getting logged out on shared Chromebooks?”</em>{" "}
              No special wording, no menus to dig through — just ask like you&apos;d
              ask the knowledgeable colleague down the hall.
            </p>
            <div className="-rotate-1 inline-flex max-w-md items-start gap-3 rounded-2xl bg-clever-blue px-5 py-3 text-white shadow-sm">
              <MessageSquareTextIcon className="mt-0.5 size-5 shrink-0 opacity-80" />
              <span>Why do students keep getting logged out on shared Chromebooks?</span>
            </div>
          </Step>

          {/* Step 2 */}
          <Step n={2}>
            <Bracket>Done ahead of time</Bracket>
            <StepLabel>Step 2 · It did its homework</StepLabel>
            <h2 className="mb-3 font-normal text-2xl text-clever-navy">
              Long before you asked, it read the whole library
            </h2>
            <p className="mb-5 text-clever-black/70 leading-relaxed">
              Behind the scenes, the assistant automatically read{" "}
              <strong className="text-clever-navy">{ARTICLE_COUNT} articles</strong>{" "}
              across Clever&apos;s official help center. Then it turned each one into
              a kind of “meaning fingerprint” — a way of remembering what an article
              is <em>about</em>, not just which exact words it uses. Think of a
              librarian who shows up early, reads every manual, and knows the gist of
              each before the doors open. And it doesn&apos;t read once and forget —
              every day it quietly re-reads the help center, so its answers keep up as
              Clever&apos;s docs change.{" "}
              <Link className="text-clever-blue underline hover:text-clever-navy" href="/changelog">
                See what&apos;s changed
              </Link>
              .
            </p>
            <div className="rounded-2xl bg-clever-light-blue/40 p-5">
              <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
                {Array.from({ length: 36 }).map((_, i) => {
                  const accent =
                    i === 5
                      ? "bg-clever-green"
                      : i === 14
                        ? "bg-clever-orange"
                        : i === 27
                          ? "bg-clever-blue"
                          : "border border-clever-light-blue bg-white";
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static decorative grid
                    <span key={i} className={`aspect-square rounded-md ${accent}`} />
                  );
                })}
              </div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-clever-navy px-3 py-1 text-white text-xs">
                <BookOpenCheckIcon className="size-3.5" />
                {ARTICLE_COUNT} articles, read and remembered
              </div>
            </div>
          </Step>

          {/* Step 3 */}
          <Step n={3}>
            <Bracket>When you ask</Bracket>
            <StepLabel>Step 3 · It matches meaning</StepLabel>
            <h2 className="mb-3 font-normal text-2xl text-clever-navy">
              Your question becomes a fingerprint too
            </h2>
            <p className="mb-5 text-clever-black/70 leading-relaxed">
              When you hit send, your question gets the same “meaning fingerprint”
              treatment. Now it&apos;s apples to apples: the assistant scans its whole
              memory and pulls out the handful of articles whose meaning sits closest
              to what you&apos;re really asking — even if you never used the words the
              article does.{" "}
              <span className="text-clever-black/50">
                (Tech people call this <em>semantic search</em>. You can just call it:
                it gets the gist.)
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-clever-light-blue p-5">
              <FingerprintIcon className="size-8 text-clever-blue" />
              <div className="flex flex-wrap gap-2">
                {["logout", "password", "Chromebook"].map((k) => (
                  <span
                    key={k}
                    className="rounded-full bg-clever-black/5 px-3 py-1 text-clever-black/40 text-sm line-through"
                  >
                    {k}
                  </span>
                ))}
              </div>
              <p className="w-full rounded-lg bg-clever-light-blue/50 px-3 py-2 text-clever-navy text-sm">
                Matched by <strong>meaning</strong>, not just keywords.
              </p>
            </div>
          </Step>

          {/* Step 4 */}
          <Step n={4}>
            <StepLabel>Step 4 · It answers — with receipts</StepLabel>
            <h2 className="mb-3 font-normal text-2xl text-clever-navy">
              A clear answer, with sources you can click
            </h2>
            <p className="mb-5 text-clever-black/70 leading-relaxed">
              With the top articles in hand, it writes back in plain language — the
              way a patient colleague would explain it, not a wall of documentation.
              And it never asks you to just take its word for it: every answer{" "}
              <strong className="text-clever-navy">cites the exact help articles</strong>{" "}
              it used, with links, so you can verify in one tap.
            </p>
            <div className="rounded-2xl border border-clever-light-blue bg-white p-5 shadow-sm">
              <p className="text-clever-black/80 leading-relaxed">
                On a shared Chromebook, each student needs to fully sign out of all
                three layers — the app, Clever, and the Google/Chromebook account —
                before the next student logs in.
              </p>
              <div className="mt-4 border-clever-light-blue border-t pt-3">
                <p className="mb-2 text-clever-black/40 text-xs">Sources</p>
                <div className="flex flex-wrap gap-2">
                  {["Troubleshooting: shared devices", "SSO on Chromebooks"].map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 rounded-full bg-clever-light-blue px-3 py-1 text-clever-blue text-sm"
                    >
                      <Link2Icon className="size-3.5" />
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5 text-clever-green text-xs">
                <CheckCircle2Icon className="size-3.5" />
                Grounded in real Clever docs
              </div>
            </div>
          </Step>

          {/* Step 5 */}
          <Step last n={5}>
            <StepLabel>Step 5 · It&apos;s honest</StepLabel>
            <h2 className="mb-3 font-normal text-2xl text-clever-navy">
              And when it doesn&apos;t know? It says so
            </h2>
            <p className="mb-5 text-clever-black/70 leading-relaxed">
              This is the promise that makes everything above trustworthy: if it
              can&apos;t find a relevant article, it tells you plainly instead of
              inventing an answer — and points you to a person or the help center. Its
              knowledge comes from Clever&apos;s public help articles, not your private
              school records. An honest “I&apos;m not sure, here&apos;s where to ask
              next” is a feature, not a failure.
            </p>
            <div className="rounded-2xl bg-clever-yellow/25 p-5">
              <p className="mb-4 text-clever-navy italic">
                “I couldn&apos;t find a Clever article on that — here&apos;s who to ask
                next.”
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { icon: BookOpenCheckIcon, label: "Grounded in real docs" },
                  { icon: Link2Icon, label: "Always cites sources" },
                  { icon: ShieldCheckIcon, label: "Won't make things up" },
                ].map(({ icon: Icon, label }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-clever-navy/15 bg-white px-3 py-1 text-clever-navy text-sm"
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </Step>
        </div>
      </section>

      {/* Under the hood */}
      <section className="scroll-mt-6 px-6 py-12" id="under-the-hood">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8">
            <StepLabel>Under the hood</StepLabel>
            <h2 className="font-normal text-3xl text-clever-navy">
              The friendly version, one rung deeper
            </h2>
            <p className="mt-2 text-clever-black/60 leading-relaxed">
              The walkthrough above is the honest gist. If you want the real
              mechanics — the parts that make the answers trustworthy — here&apos;s
              what&apos;s actually happening each time you ask.
            </p>
          </div>
          <ul className="space-y-5">
            {INTERNALS.map(({ icon: Icon, term, body }) => (
              <li
                className="flex gap-4 rounded-2xl border border-clever-light-blue bg-white p-5"
                key={term}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-clever-light-blue/50 text-clever-blue">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-medium text-clever-navy">{term}</h3>
                  <p className="mt-1 text-clever-black/60 text-sm leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Built on Vercel eve */}
      <section className="scroll-mt-6 px-6 pb-16" id="built-on-eve">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-clever-light-blue bg-clever-light-blue/20 p-7 sm:p-9">
            <p className="inline-flex items-center gap-1.5 font-semibold text-clever-blue text-xs uppercase tracking-wider">
              <SparklesIcon className="size-3.5" />
              The foundation
            </p>
            <h2 className="mt-2 font-normal text-3xl text-clever-navy">
              Built on the Vercel eve agent framework
            </h2>
            <p className="mt-3 text-clever-black/70 leading-relaxed">
              All of this runs on{" "}
              <strong className="text-clever-navy">Vercel eve</strong> — an agent
              framework that handles the hard parts so the assistant can focus on good
              answers. eve is why it can hold the thread of a conversation across
              follow-ups and survive restarts (durable sessions), pause to ask a human
              and resume later (human-in-the-loop), call retrieval as a tool, re-crawl
              the help center on a schedule, and expose that same retrieval brain over
              MCP so it works inside your editor too. One framework, one knowledge base,
              one voice — wherever you meet it.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {[
                "Durable sessions",
                "Human-in-the-loop",
                "Tools",
                "Schedules",
                "AI Gateway",
                "MCP",
                "Agent Runs",
              ].map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-clever-navy/15 bg-white px-3 py-1 text-clever-navy/70 text-xs"
                >
                  {p}
                </span>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                className="inline-flex items-center gap-2 rounded-full bg-clever-navy px-5 py-2.5 font-medium text-sm text-white transition-colors hover:bg-clever-blue"
                href={GITHUB_URL}
                rel="noreferrer"
                target="_blank"
              >
                <CodeIcon className="size-4" />
                Read the source on GitHub
              </a>
              <Link
                className="inline-flex items-center gap-2 rounded-full border border-clever-navy/20 px-5 py-2.5 font-medium text-clever-navy text-sm transition-colors hover:bg-white"
                href="/features"
              >
                See every feature <ArrowRightIcon className="size-4" />
              </Link>
            </div>
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
          <h2 className="font-normal text-3xl text-white">Still curious?</h2>
          <p className="mt-4 text-clever-light-blue leading-relaxed">
            The best way to trust it is to test it. Throw a real Clever question at it
            — logins, rostering, app access, whatever&apos;s stuck on your plate today
            — and watch it answer with sources you can check.
          </p>
          <Link
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-clever-blue px-6 py-3 font-medium text-white transition-colors hover:bg-white hover:text-clever-navy"
            href="/"
          >
            Ask the assistant a question <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function Step({
  children,
  last,
}: {
  readonly children: React.ReactNode;
  readonly last?: boolean;
  readonly n: number;
}) {
  return (
    <div className="relative">
      {/* Node on the spine */}
      <span
        className={`-left-[41px] absolute top-1 size-4 rounded-full border-2 border-white ${
          last ? "bg-clever-green" : "bg-clever-blue"
        } ring-2 ring-clever-light-blue`}
      />
      {children}
    </div>
  );
}
