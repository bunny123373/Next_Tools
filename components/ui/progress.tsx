"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { clamp } from "@/lib/utils/format";

/* ------------------------------------------------------------------ */
/*  Stage machine                                                      */
/* ------------------------------------------------------------------ */

/** The four steps every long-running tool reports, in order. */
export type ProcessingStage = "preparing" | "processing" | "finalizing" | "complete";

export const PROCESSING_STAGE_ORDER: readonly ProcessingStage[] = [
  "preparing",
  "processing",
  "finalizing",
  "complete",
] as const;

export const PROCESSING_STAGE_LABEL: Record<ProcessingStage, string> = {
  preparing: "Preparing…",
  processing: "Processing…",
  finalizing: "Finalizing…",
  complete: "Complete",
};

export function isTerminalStage(stage: ProcessingStage): boolean {
  return stage === "complete";
}

/* ------------------------------------------------------------------ */
/*  Bar                                                                */
/* ------------------------------------------------------------------ */

export interface ProgressProps {
  /** 0–100. Omit (or pass `null`) for an indeterminate bar. */
  value?: number | null;
  label?: React.ReactNode;
  /** Right-aligned secondary text, e.g. "3 / 10 files". */
  meta?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
  tone?: "brand" | "success";
}

export function Progress({
  value,
  label,
  meta,
  size = "md",
  className,
  tone = "brand",
}: ProgressProps) {
  const indeterminate = value === null || value === undefined || Number.isNaN(value);
  const pct = indeterminate ? null : clamp(value, 0, 100);

  const heights = { sm: "h-1", md: "h-1.5", lg: "h-2.5" } as const;

  return (
    <div className={cn("w-full", className)}>
      {label || meta ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
          <span
            className={cn(
              "truncate font-medium",
              tone === "success" ? "text-emerald-500" : "text-[var(--text-ink)]",
            )}
          >
            {label}
          </span>
          {meta ? (
            <span className="shrink-0 font-mono tabular-nums text-[var(--text-muted)]">{meta}</span>
          ) : null}
        </div>
      ) : null}

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(pct ?? 0)}
        aria-valuetext={indeterminate ? "In progress" : `${Math.round(pct ?? 0)}%`}
        aria-label={typeof label === "string" ? label : "Progress"}
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-[var(--surface-card-2)]",
          heights[size],
        )}
      >
        {indeterminate ? (
          <>
            {/* Unknown duration: an honest, continuous sweep. No fake number. */}
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-1/3 rounded-full",
                tone === "success" ? "bg-emerald-500" : "bg-brand-500",
              )}
              style={{ animation: "shimmer 1.4s ease-in-out infinite" }}
            />
            <span
              className="absolute inset-y-0 w-1/3 rounded-full bg-white/10"
              style={{ animation: "shimmer 1.4s ease-in-out 0.2s infinite" }}
            />
          </>
        ) : (
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-300 ease-out",
              tone === "success" ? "bg-emerald-500" : "bg-brand-500",
            )}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Staged progress — the shared "preparing → complete" component      */
/* ------------------------------------------------------------------ */

export interface StagedProgressProps {
  stage: ProcessingStage;
  /** 0–100, or null when the duration cannot be known. */
  percent?: number | null;
  /** e.g. "3 / 10 files completed" for batch work. */
  detail?: React.ReactNode;
  className?: string;
  /** Rendered under the bar, e.g. the current filename. */
  caption?: React.ReactNode;
}

/**
 * Progress UI used by every tool. When the real completion ratio is unknown we
 * render an indeterminate bar rather than animating a fabricated number.
 */
export function StagedProgress({
  stage,
  percent,
  detail,
  caption,
  className,
}: StagedProgressProps) {
  const done = isTerminalStage(stage);

  return (
    <div className={cn("w-full", className)} aria-live="polite">
      <Progress
        size="lg"
        value={done ? 100 : (percent ?? null)}
        tone={done ? "success" : "brand"}
        label={
          <span className="inline-flex items-center gap-2">
            {done ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" /> : null}
            {PROCESSING_STAGE_LABEL[stage]}
          </span>
        }
        meta={detail}
      />
      {caption ? <p className="mt-2 truncate text-xs text-[var(--text-muted)]">{caption}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step rail — shows the whole stage sequence at once                  */
/* ------------------------------------------------------------------ */

export function StageSteps({
  stage,
  className,
}: {
  stage: ProcessingStage;
  className?: string;
}) {
  const currentIndex = PROCESSING_STAGE_ORDER.indexOf(stage);

  return (
    <ol className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
      {PROCESSING_STAGE_ORDER.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "todo";
        return (
          <li key={step} className="flex items-center gap-2">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-4",
                  state === "todo" ? "bg-[var(--surface-line)]" : "bg-brand-500/50",
                )}
              />
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                state === "active" && "font-medium text-[var(--text-ink)]",
                state === "done" && "text-emerald-500",
                state === "todo" && "text-[var(--text-muted)]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  state === "active" && "animate-pulse-ring bg-brand-500",
                  state === "done" && "bg-emerald-500",
                  state === "todo" && "bg-[var(--surface-line-strong)]",
                )}
              />
              {PROCESSING_STAGE_LABEL[step].replace("…", "")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
