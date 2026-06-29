"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

// Three clusters, read left-to-right as the agent's mental model:
//   1. Do the job        — the daily operator tools (full weight)
//   2. Watch the job      — QA / observability, one click away
//   3. About the tool     — onboarding / demo / freshness (de-emphasized)
// A divider separates each group so the operator pair reads on its own.
const GROUPS: readonly (readonly NavItem[])[] = [
  [
    { href: "/", label: "Chat" },
    { href: "/browse", label: "Browse" },
  ],
  [
    { href: "/inquiries", label: "Inquiries" },
    { href: "/feedback", label: "Flagged" },
  ],
  [
    { href: "/about", label: "How it works" },
    { href: "/features", label: "Features" },
    { href: "/changelog", label: "Changelog" },
  ],
];

// The about-the-tool group recedes; everything else carries operator weight.
const MUTED_GROUP = 2;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="shrink-0 border-b border-clever-light-blue bg-white px-6 py-4">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/clever-wordmark.png"
            alt="Clever"
            width={128}
            height={34}
            priority
            className="h-7 w-auto"
          />
          <span aria-hidden="true" className="h-6 w-px bg-clever-light-blue" />
          <span className="text-clever-black/60 text-sm">Support Assistant</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {GROUPS.map((group, groupIndex) => (
            <Fragment key={group[0].href}>
              {groupIndex > 0 ? (
                <span aria-hidden="true" className="h-4 w-px bg-clever-light-blue" />
              ) : null}
              {group.map((item) => {
                const active = isActive(pathname, item.href);
                const muted = groupIndex === MUTED_GROUP;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "pb-1 font-medium text-sm transition-colors",
                      active
                        ? "text-clever-navy"
                        : cn(
                            "hover:text-clever-navy",
                            muted ? "text-clever-black/60" : "text-clever-blue",
                          ),
                    )}
                    // Active underline via box-shadow: globals.css sets an unlayered
                    // `* { border-color }` that would override any border-* utility.
                    href={item.href}
                    key={item.href}
                    style={active ? { boxShadow: "inset 0 -2px 0 0 var(--clever-blue)" } : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </Fragment>
          ))}
        </nav>
      </div>
    </header>
  );
}
