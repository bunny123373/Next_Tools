import * as React from "react";
import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

export interface ToolEmptyStateProps {
  title?: string;
  description?: React.ReactNode;
  /** Icon rendered above the copy. */
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function ToolEmptyState({
  title = "Drop your files here to get started.",
  description,
  icon,
  className,
  children,
}: ToolEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]"
        >
          {icon}
        </div>
      ) : null}
      <div className="max-w-md space-y-1.5">
        <p className="text-[15px] font-medium text-[var(--text-ink)]">{title}</p>
        {description ? (
          <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Error state                                                        */
/* ------------------------------------------------------------------ */

export interface ToolErrorProps {
  title?: string;
  /** Technical detail, shown in a disclosure so the default view stays calm. */
  detail?: string | null;
  onRetry?: () => void;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The only error surface tools render. Raw stack traces are never shown to a
 * visitor — technical detail is opt-in and always human-readable text.
 */
export function ToolError({
  title = "We couldn't process this file. Please try another file.",
  detail,
  onRetry,
  className,
  children,
}: ToolErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] px-5 py-8 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-[var(--text-ink)]">{title}</p>
      {detail ? (
        <details className="w-full max-w-lg text-left">
          <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-ink)]">
            Technical details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
            {detail}
          </pre>
        </details>
      ) : null}
      {children}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="h-9 rounded-lg border border-brand-500/40 px-4 text-sm font-medium text-brand-500 transition-colors hover:bg-brand-500/10"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Success state                                                       */
/* ------------------------------------------------------------------ */

export function ToolSuccess({
  title = "Your file is ready.",
  description,
  className,
  children,
}: {
  title?: string;
  description?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-5 py-8 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-[var(--text-ink)]">{title}</p>
      {description ? (
        <p className="max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline notice (info / warning / privacy)                            */
/* ------------------------------------------------------------------ */

export type NoticeTone = "info" | "warning" | "success" | "brand";

const NOTICE_TONES: Record<NoticeTone, string> = {
  info: "border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]",
  warning: "border-amber-500/30 bg-amber-500/[0.07] text-amber-500",
  success: "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-500",
  brand: "border-brand-500/30 bg-brand-500/[0.07] text-brand-500",
};

export function Notice({
  tone = "info",
  icon,
  title,
  children,
  className,
}: {
  tone?: NoticeTone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed",
        NOTICE_TONES[tone],
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="mt-px shrink-0">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        {title ? <span className="font-medium">{title} </span> : null}
        {children}
      </div>
    </div>
  );
}
