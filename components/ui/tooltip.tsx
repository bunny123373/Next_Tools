"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  /** Delay before showing on hover, ms. */
  delay?: number;
  className?: string;
}

const SIDES = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
} as const;

/**
 * CSS-only tooltip driven by `data-tooltip` + group hover/focus. The bubble is
 * hidden from assistive tech (the accessible name comes from `aria-label` on
 * the trigger, which callers should set for icon-only buttons).
 */
export function Tooltip({ content, children, side = "top", delay = 200, className }: TooltipProps) {
  if (!content) return children;

  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="presentation"
        className={cn(
          "pointer-events-none absolute z-50 w-max max-w-[min(20rem,90vw)]",
          "rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)]",
          "px-2.5 py-1.5 text-[12px] leading-snug text-[var(--text-ink)] shadow-xl",
          "opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
          "group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          SIDES[side],
        )}
        style={{ transitionDelay: `${delay}ms` }}
      >
        {content}
      </span>
    </span>
  );
}
