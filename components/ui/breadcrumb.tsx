"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  className?: string;
  /** `aria-label` for the nav landmark. */
  label?: string;
}

/** Renders a nav + ordered list so the trail is announced as a hierarchy. */
export function Breadcrumb({ items, className, label = "Breadcrumb" }: BreadcrumbProps) {
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ol className="scrollbar-none flex items-center gap-1.5 overflow-x-auto text-[13px] text-[var(--text-muted)]">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex shrink-0 items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden="true" className="text-[var(--text-ink-dim)]">
                  /
                </span>
              )}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="rounded transition-colors hover:text-[var(--text-ink)]"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(isLast && "truncate font-medium text-[var(--text-ink)]")}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
