import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "info" | "outline";

const TONES: Record<BadgeTone, string> = {
  neutral:
    "bg-[var(--surface-card-2)] text-[var(--text-muted)] border-[var(--surface-line)]",
  brand: "bg-brand-500/12 text-brand-500 border-brand-500/25",
  success: "bg-emerald-500/12 text-emerald-500 border-emerald-500/25",
  warning: "bg-amber-500/12 text-amber-500 border-amber-500/25",
  info: "bg-sky-500/12 text-sky-500 border-sky-500/25",
  outline: "bg-transparent text-[var(--text-muted)] border-[var(--surface-line-strong)]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Small uppercase eyebrow, e.g. "Popular" or "New". */
  uppercase?: boolean;
}

export function Badge({ className, tone = "neutral", uppercase, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        uppercase && "uppercase tracking-[0.06em]",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
