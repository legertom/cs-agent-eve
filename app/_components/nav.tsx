"use client";

import { MenuIcon, XIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState } from "react";
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

function NavLink({
  item,
  active,
  muted,
  variant,
  onNavigate,
}: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly muted: boolean;
  readonly variant: "bar" | "sheet";
  readonly onNavigate?: () => void;
}) {
  const color = active
    ? "text-clever-navy"
    : cn("hover:text-clever-navy", muted ? "text-clever-black/60" : "text-clever-blue");

  if (variant === "sheet") {
    // Full-width tap targets (≥44px) with a filled pill for the active row.
    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={cn(
          "block rounded-lg px-3 py-2.5 font-medium text-sm transition-colors",
          active ? "bg-clever-light-blue/60 text-clever-navy" : cn("hover:bg-clever-light-blue/40", color),
        )}
        href={item.href}
        onClick={onNavigate}
      >
        {item.label}
      </Link>
    );
  }

  // Inline bar link. Active underline via box-shadow: globals.css sets an
  // unlayered `* { border-color }` that would override any border-* utility.
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn("whitespace-nowrap pb-1 font-medium text-sm transition-colors", color)}
      href={item.href}
      style={active ? { boxShadow: "inset 0 -2px 0 0 var(--clever-blue)" } : undefined}
    >
      {item.label}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="shrink-0 border-b border-clever-light-blue bg-white px-6 py-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <Link className="flex items-center gap-3" href="/" onClick={close}>
          <Image
            alt="Clever"
            className="h-7 w-auto"
            height={34}
            priority
            src="/clever-wordmark.png"
            width={128}
          />
          <span aria-hidden="true" className="h-6 w-px bg-clever-light-blue" />
          <span className="text-clever-black/60 text-sm">Support Assistant</span>
        </Link>

        {/* Desktop: clustered single row */}
        <nav className="hidden items-center gap-x-4 lg:flex">
          {GROUPS.map((group, groupIndex) => (
            <Fragment key={group[0].href}>
              {groupIndex > 0 ? (
                <span aria-hidden="true" className="h-4 w-px bg-clever-light-blue" />
              ) : null}
              {group.map((item) => (
                <NavLink
                  active={isActive(pathname, item.href)}
                  item={item}
                  key={item.href}
                  muted={groupIndex === MUTED_GROUP}
                  variant="bar"
                />
              ))}
            </Fragment>
          ))}
        </nav>

        {/* Mobile: menu toggle */}
        <button
          aria-controls="mobile-nav"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex size-9 items-center justify-center rounded-lg text-clever-navy transition-colors hover:bg-clever-light-blue/50 lg:hidden"
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          {open ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
        </button>
      </div>

      {/* Mobile: collapsible menu */}
      {open ? (
        <nav className="mx-auto mt-3 max-w-5xl lg:hidden" id="mobile-nav">
          <ul className="flex flex-col gap-0.5">
            {GROUPS.map((group, groupIndex) => (
              <Fragment key={group[0].href}>
                {groupIndex > 0 ? (
                  <li aria-hidden="true" className="my-1 h-px bg-clever-light-blue" />
                ) : null}
                {group.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      active={isActive(pathname, item.href)}
                      item={item}
                      muted={groupIndex === MUTED_GROUP}
                      onNavigate={close}
                      variant="sheet"
                    />
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
