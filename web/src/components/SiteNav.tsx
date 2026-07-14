"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Fixed pill nav from the awake prototype: brand left, pill links, backdrop blur.
const LINKS = [
  { href: "/", label: "New campaign" },
  { href: "/wall", label: "Campaign Gallery" },
];

export function SiteNav() {
  const path = usePathname() || "/";
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-7">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <Image
            src="/campaign-factory-logo.png"
            alt="Campaign Factory"
            width={32}
            height={32}
            priority
            className="h-7 w-7 shrink-0 dark:invert"
          />
          <span className="text-base font-semibold tracking-tight sm:text-[1.05rem]">Campaign Factory</span>
          <span className="hidden text-xs font-normal text-muted-foreground md:inline">
            UK local &amp; public-policy campaigns
          </span>
        </Link>
        <nav className="flex shrink-0 gap-1 rounded-full bg-foreground/[0.05] p-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition-colors sm:px-4 sm:py-1.5 sm:text-sm ${
                  active ? "bg-foreground text-background" : "text-foreground hover:bg-foreground/[0.07]"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
