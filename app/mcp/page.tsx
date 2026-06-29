import {
  ArrowRightIcon,
  CheckCircle2Icon,
  PlugIcon,
  SearchCheckIcon,
  SparklesIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { CopyBlock } from "@/app/_components/copy-block";

export const metadata = {
  title: "Use in VS Code (MCP) — Clever Support Assistant",
  description:
    "Connect the Clever Support knowledge base to VS Code over MCP — search and cited answers from inside Copilot agent mode, plus a copy-paste prompt that sets it up for you.",
};

const MCP_URL = "https://clever-support-agent.vercel.app/api/mcp";

const WORKSPACE_CONFIG = `{
  "servers": {
    "clever-support": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`;

const CLI_ONELINER = `code --add-mcp '{"name":"clever-support","type":"http","url":"${MCP_URL}"}'`;

const SETUP_PROMPT = `Add an MCP server named "clever-support" to this project so I can query Clever's
support knowledge base from VS Code.

1. Create or merge .vscode/mcp.json with an HTTP server entry:
   {
     "servers": {
       "clever-support": {
         "type": "http",
         "url": "${MCP_URL}"
       }
     }
   }
2. The server is public — no auth header is needed.
3. It exposes two tools: search_clever_kb (ranked, cited help-center articles
   with a confidence score) and ask_clever_support (a synthesized, cited answer).
   Both answer Clever questions — SSO, rostering, logins, admin setup.
4. After writing the file, tell me exactly how to enable the server in Copilot
   agent mode, then verify it connected and list its tools.`;

const TEST_PROMPT = `Using the clever-support tools, how do I set up Google SSO in Clever?
Give me the steps and cite the help-center article you used.`;

function StepLabel({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="mb-1 font-semibold text-clever-blue text-xs uppercase tracking-wider">
      {children}
    </p>
  );
}

export default function McpPage() {
  return (
    <main className="bg-white text-clever-black">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-16 pb-8">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-44 w-44 bg-clever-blue/20 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="inline-flex items-center gap-1.5 font-semibold text-clever-blue text-xs uppercase tracking-wider">
            <PlugIcon className="size-3.5" />
            Model Context Protocol
          </p>
          <h1 className="mt-1 font-normal text-4xl text-clever-navy leading-[1.05] sm:text-5xl">
            Use Clever Support inside VS Code
          </h1>
          <p className="mt-4 max-w-xl text-clever-black/60 leading-relaxed">
            The same retrieval brain behind this assistant is exposed as a remote{" "}
            <span className="text-clever-navy">MCP server</span>. Connect it once and query
            Clever&apos;s help center — ranked search and cited answers — without leaving your
            editor, right alongside the code you&apos;re working on.
          </p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl space-y-10">
          {/* Heads-up: not cleared for Claude Desktop */}
          <div className="rounded-xl border border-clever-orange/40 bg-clever-orange/10 px-5 py-4">
            <p className="inline-flex items-center gap-1.5 font-semibold text-clever-orange text-sm">
              <TriangleAlertIcon className="size-4" />
              VS Code only for now
            </p>
            <p className="mt-1.5 text-clever-black/70 text-sm leading-relaxed">
              This server is approved for internal testing in <span className="font-medium">VS
              Code</span> only. Clever hasn&apos;t signed it off for the{" "}
              <span className="font-medium">Claude desktop app</span>{" "}yet — please don&apos;t add
              it as a connector there until it&apos;s been reviewed. We&apos;ll update this page
              the moment it&apos;s cleared.
            </p>
          </div>

          {/* The endpoint */}
          <div className="space-y-3">
            <StepLabel>The server</StepLabel>
            <CopyBlock code={MCP_URL} label="Endpoint" />
            <ul className="space-y-1.5 text-clever-black/60 text-sm">
              <li className="flex gap-2">
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-clever-green" />
                <span>
                  Transport: Streamable HTTP (stateless, <span className="font-mono text-xs">POST</span>).
                  Public — no API key needed.
                </span>
              </li>
              <li className="flex gap-2">
                <SearchCheckIcon className="mt-0.5 size-4 shrink-0 text-clever-blue" />
                <span>
                  <span className="font-mono text-xs">search_clever_kb</span> — ranked, cited
                  articles with a calibrated confidence signal.
                </span>
              </li>
              <li className="flex gap-2">
                <SparklesIcon className="mt-0.5 size-4 shrink-0 text-clever-blue" />
                <span>
                  <span className="font-mono text-xs">ask_clever_support</span> — a synthesized,
                  plain-language answer grounded only in the help center, with sources.
                </span>
              </li>
            </ul>
          </div>

          {/* Add to VS Code */}
          <div className="space-y-5">
            <div>
              <StepLabel>Add it to VS Code</StepLabel>
              <p className="text-clever-black/60 text-sm leading-relaxed">
                VS Code 1.102+ has native MCP support in Copilot agent mode. Pick whichever
                option you like — they all end up at the same place.
              </p>
            </div>

            <div className="space-y-2.5">
              <p className="font-medium text-clever-navy text-sm">
                Option A — workspace config{" "}
                <span className="font-normal text-clever-black/45">(recommended)</span>
              </p>
              <p className="text-clever-black/60 text-sm leading-relaxed">
                Drop this in at <span className="font-mono text-xs">.vscode/mcp.json</span> in any
                project, then open <span className="font-medium">Copilot Chat → Agent mode</span>,
                click the tools <span aria-hidden="true">🔧</span> icon, and enable{" "}
                <span className="font-mono text-xs">clever-support</span>.
              </p>
              <CopyBlock code={WORKSPACE_CONFIG} label=".vscode/mcp.json" />
            </div>

            <div className="space-y-2.5">
              <p className="font-medium text-clever-navy text-sm">Option B — Command Palette</p>
              <p className="text-clever-black/60 text-sm leading-relaxed">
                <span className="font-mono text-xs">MCP: Add Server…</span> → <span className="font-medium">HTTP</span>{" "}
                → paste the endpoint above → name it{" "}
                <span className="font-mono text-xs">clever-support</span> → choose Workspace or Global.
              </p>
            </div>

            <div className="space-y-2.5">
              <p className="inline-flex items-center gap-1.5 font-medium text-clever-navy text-sm">
                <TerminalIcon className="size-4" />
                Option C — one-liner
              </p>
              <CopyBlock code={CLI_ONELINER} label="terminal" />
            </div>
          </div>

          {/* Let your agent set it up */}
          <div className="space-y-3">
            <div>
              <StepLabel>Or let your agent set it up</StepLabel>
              <p className="text-clever-black/60 text-sm leading-relaxed">
                Paste this into <span className="font-medium">Copilot Chat (agent mode)</span> or
                Claude Code. It writes the config and tells you how to switch it on.
              </p>
            </div>
            <CopyBlock code={SETUP_PROMPT} label="Setup prompt" />
          </div>

          {/* Try it */}
          <div className="space-y-3">
            <div>
              <StepLabel>Try it</StepLabel>
              <p className="text-clever-black/60 text-sm leading-relaxed">
                Once <span className="font-mono text-xs">clever-support</span>{" "}is enabled, ask your
                editor&apos;s agent something real:
              </p>
            </div>
            <CopyBlock code={TEST_PROMPT} label="Test prompt" />
            <p className="text-clever-black/45 text-sm leading-relaxed">
              You should see it call <span className="font-mono text-xs">search_clever_kb</span> or{" "}
              <span className="font-mono text-xs">ask_clever_support</span> and answer with a cited
              Clever help-center link.
            </p>
          </div>

          {/* Footer CTA back to the assistant */}
          <div className="rounded-xl border border-clever-light-blue bg-clever-light-blue/20 px-5 py-4">
            <p className="text-clever-black/60 text-sm leading-relaxed">
              Prefer to just chat? The same answers are one click away in the browser.
            </p>
            <Link
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-clever-blue px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-clever-navy"
              href="/"
            >
              Open the assistant <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
