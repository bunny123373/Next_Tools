"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Inbox, Settings2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const LINKS = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/tools", label: "Tools", icon: Wrench },
  { href: "/admin/requests", label: "Requests", icon: Inbox },
  { href: "/admin/settings", label: "Settings", icon: Settings2 },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text-ink)]">
            Admin
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Real data only. Nothing on this page is a placeholder number.
          </p>
        </div>
        <Link
          href="/"
          className="text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-ink)]"
        >
          Back to site →
        </Link>
      </div>

      <nav aria-label="Admin sections" className="mt-5 border-b border-[var(--surface-line)]">
        <ul className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors",
                    active
                      ? "text-[var(--text-ink)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-ink)]",
                  )}
                >
                  <link.icon className="size-3.5" aria-hidden="true" />
                  {link.label}
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500"
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
