import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SharedThread } from "@/app/_components/shared-thread";
import { loadShare } from "@/lib/blob-shares";

// Dedupe the blob read across generateMetadata + the page render in one request.
const getShare = cache(loadShare);

type Props = { readonly params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const share = await getShare(id);
  if (!share) return { title: "Shared conversation · Clever Support" };
  return {
    title: `${share.title} · Clever Support`,
    description: "A shared Clever Support conversation.",
  };
}

export default async function SharedThreadPage({ params }: Props) {
  const { id } = await params;
  const share = await getShare(id);
  if (!share) notFound();
  return <SharedThread payload={share} />;
}
