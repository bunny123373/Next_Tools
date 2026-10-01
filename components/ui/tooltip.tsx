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

const SIDES: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
  left: "right-full mr-2 top-1/2 -translate-y-1/2",
  right: "left-full ml-2 top-1/2 -translate-y-1/2",
};

/** Keep the bubble this far from the viewport edge, in px. */
const VIEWPORT_MARGIN = 8;

/**
 * Tooltip for icon-only controls.
 *
 * Two things here are deliberate and both were bugs first:
 *
 * 1. **The bubble is not rendered until it is shown.** The previous version
 *    kept it in the DOM and hid it with `opacity: 0`, then later with
 *    `visibility: hidden`. Neither works: an absolutely positioned `w-max`
 *    element still occupies layout space either way, and still contributes to
 *    the page's scrollable width. Measured at a 375px viewport, every tool
 *    card's favourite tooltip laid out from x=277 to x=397 — putting 22px of
 *    the page outside the screen, from a bubble that is invisible and, on a
 *    touch device, never appears at all. Not rendering it is the only version
 *    that cannot overflow.
 *
 * 2. **It is clamped to the viewport.** `side="top"` used to centre the bubble
 *    on the trigger with `left-1/2 -translate-x-1/2`. For a trigger near the
 *    right edge — which is exactly where a card's favourite button sits — that
 *    pushes the bubble past the screen. Its position is measured once shown and
 *    nudged back inside, so a tooltip can appear at any trigger position on
 *    any viewport.
 *
 * The accessible name still comes from `aria-label` on the trigger, which
 * callers should set for icon-only buttons. This is a visual affordance only.
 */
export function Tooltip({ content, children, side = "top", delay = 200, className }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const bubbleRef = React.useRef<HTMLSpanElement>(null);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = React.useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const hide = React.useCallback(() => {
    clearTimer();
    setOpen(false);
  }, []);

  React.useEffect(() => clearTimer, []);

  // Nudge the bubble back inside the viewport once it exists and is measured.
  React.useLayoutEffect(() => {
    if (!open) return;
    const bubble = bubbleRef.current;
    if (!bubble) return;

    bubble.style.left = "";
    bubble.style.right = "";
    bubble.style.transform = "";

    const rect = bubble.getBoundingClientRect();
    const limit = document.documentElement.clientWidth;
    if (rect.width >= limit) return;

    if (rect.right > limit - VIEWPORT_MARGIN) {
      // Too far right: pin it to the trigger's right edge and let it run left.
      const anchor = wrapperRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const shift = rect.right - (anchor.right - VIEWPORT_MARGIN);
      bubble.style.left = `${-shift}px`;
    } else if (rect.left < VIEWPORT_MARGIN) {
      const shift = VIEWPORT_MARGIN - rect.left;
      bubble.style.left = `${shift}px`;
    }
  }, [open, side]);

  if (!content) return children;

  const horizontal = side === "left" || side === "right";

  return (
    <span
      ref={wrapperRef}
      className={cn("group/tt relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {open ? (
        <span
          ref={bubbleRef}
          role="presentation"
          className={cn(
            "pointer-events-none absolute z-50 w-max max-w-[min(20rem,90vw)]",
            "rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)]",
            "px-2.5 py-1.5 text-[12px] leading-snug text-[var(--text-ink)] shadow-xl",
            "animate-fade-in",
            // Centred by default; the layout effect above overrides `left` when
            // the bubble would cross an edge.
            horizontal ? SIDES[side] : cn("left-1/2 -translate-x-1/2", SIDES[side]),
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}