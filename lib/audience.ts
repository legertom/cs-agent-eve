// Clever's help-center articles are written for specific audiences, encoded as a
// "For <Audience>:" prefix in the title (~83% of articles carry a prefix). This
// derives a canonical audience from the title so the search tool, the confidence
// gate, and the /browse page all agree on who an article is for. No new data
// needed — it's read straight from the existing titles.

export type AudienceId =
  | "admins"
  | "teachers"
  | "app-partners"
  | "tech-leads"
  | "families"
  | "staff"
  | "students"
  | "general";

export const AUDIENCES: { id: AudienceId; label: string; blurb: string }[] = [
  { id: "admins", label: "Admins", blurb: "District & school administrators" },
  { id: "teachers", label: "Teachers", blurb: "Classroom teachers" },
  { id: "app-partners", label: "App Partners", blurb: "Application & integration partners" },
  { id: "tech-leads", label: "School Tech Leads", blurb: "School & district IT" },
  { id: "families", label: "Families", blurb: "Parents & guardians" },
  { id: "staff", label: "Staff", blurb: "School & district staff" },
  { id: "students", label: "Students", blurb: "Students" },
  { id: "general", label: "General & Reference", blurb: "Cross-audience topics — SSO, syncing, roles…" },
];

const LABELS: Record<AudienceId, string> = Object.fromEntries(
  AUDIENCES.map((a) => [a.id, a.label]),
) as Record<AudienceId, string>;

// Map the "For <X>:" prefix to a canonical audience. Order matters: check the
// most specific signals first.
export function audienceOf(title: string | undefined): AudienceId {
  const match = /^For ([^:]+):/i.exec(title ?? "");
  if (match) {
    const a = match[1].toLowerCase();
    if (a.includes("admin")) return "admins";
    if (a.includes("teacher")) return "teachers";
    if (a.includes("app") || a.includes("application") || a.includes("partner"))
      return "app-partners";
    if (a.includes("tech") || a.includes("it lead")) return "tech-leads";
    if (a.includes("famil") || a.includes("parent") || a.includes("guardian"))
      return "families";
    if (a.includes("student")) return "students";
    if (a.includes("staff")) return "staff";
  }
  return "general";
}

export const audienceLabel = (id: AudienceId): string => LABELS[id];
