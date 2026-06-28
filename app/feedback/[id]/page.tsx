import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { FeedbackDetail } from "@/app/_components/feedback-detail";
import { loadFeedback } from "@/lib/feedback-store";
import { reasonLabel } from "@/lib/feedback";

// Flag records are read on demand and are short-lived in cache; never prerender.
export const dynamic = "force-dynamic";

// Dedupe the blob read across generateMetadata + the page render in one request.
const getFeedback = cache(loadFeedback);

type Props = { readonly params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const fb = await getFeedback(id);
  if (!fb) return { title: "Flagged thread · Clever Support" };
  return {
    title: `${reasonLabel(fb.reason)}: ${fb.title} · Clever Support`,
    description: "A flagged Clever Support thread under review.",
  };
}

export default async function FeedbackDetailPage({ params }: Props) {
  const { id } = await params;
  const fb = await getFeedback(id);
  if (!fb) notFound();
  return <FeedbackDetail payload={fb} />;
}
