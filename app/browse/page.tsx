import { AUDIENCES, type AudienceId, audienceOf } from "@/lib/audience";
import kbData from "#data/kb.json" with { type: "json" };
import { BrowseList } from "./browse-list";

export const metadata = {
  title: "Browse the help center — Clever Support Assistant",
  description:
    "Browse every Clever help-center article, filtered by who it's written for — admins, teachers, app partners, families, and more.",
};

type Article = { id: string; url: string; title?: string; text: string };
const KB = kbData as Article[];

export default function BrowsePage() {
  // Derive audience per article (from the title prefix) on the server, and pass
  // a slim list (no article text) to the client filter.
  const articles = KB.map((a) => ({
    title: a.title ?? a.url,
    url: a.url,
    audience: audienceOf(a.title),
  }));

  const counts = Object.fromEntries(AUDIENCES.map((a) => [a.id, 0])) as Record<AudienceId, number>;
  for (const a of articles) counts[a.audience] += 1;

  return (
    <main className="bg-white text-clever-black">
      <section className="relative overflow-hidden px-6 pt-16 pb-8">
        <div
          aria-hidden="true"
          className="clever-blob-1 -right-10 absolute top-0 h-44 w-44 bg-clever-yellow/30 blur-2xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="font-semibold text-clever-blue text-xs uppercase tracking-wider">
            Knowledge base
          </p>
          <h1 className="mt-1 font-normal text-4xl text-clever-navy leading-[1.05] sm:text-5xl">
            Browse the help center
          </h1>
          <p className="mt-4 max-w-xl text-clever-black/60 leading-relaxed">
            All {KB.length} articles, filtered by who they&apos;re written for. New to
            support? This is the fastest way to learn the lay of the land — pick the
            audience you&apos;re helping and skim what exists.
          </p>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-3xl">
          <BrowseList articles={articles} counts={counts} />
        </div>
      </section>
    </main>
  );
}
