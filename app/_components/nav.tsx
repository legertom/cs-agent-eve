import Image from "next/image";
import Link from "next/link";

export function Nav() {
  return (
    <header className="shrink-0 border-b border-clever-light-blue bg-white px-6 py-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
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
        <nav className="flex items-center gap-4">
          <Link
            href="/"
            className="font-medium text-clever-blue text-sm transition-colors hover:text-clever-navy"
          >
            Chat
          </Link>
          <Link
            href="/browse"
            className="font-medium text-clever-blue text-sm transition-colors hover:text-clever-navy"
          >
            Browse
          </Link>
          <Link
            href="/feedback"
            className="font-medium text-clever-blue text-sm transition-colors hover:text-clever-navy"
          >
            Flagged
          </Link>
          <Link
            href="/features"
            className="font-medium text-clever-blue text-sm transition-colors hover:text-clever-navy"
          >
            Features
          </Link>
          <Link
            href="/about"
            className="font-medium text-clever-blue text-sm transition-colors hover:text-clever-navy"
          >
            How it works
          </Link>
        </nav>
      </div>
    </header>
  );
}
