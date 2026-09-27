import * as React from "react";
import { AlertTriangle, CloudUpload, Cpu, Terminal } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  PROCESSING_BADGE,
  PROCESSING_DESCRIPTION,
  PROCESSING_LABEL,
  type ProcessingMode,
  type Tool,
  type ToolStatus,
} from "@/lib/tools/types";
import { Badge } from "@/components/ui/badge";
import { Notice } from "./states";

/* ------------------------------------------------------------------ */
/*  Privacy indicator                                                  */
/* ------------------------------------------------------------------ */

const MODE_ICON: Record<ProcessingMode, React.ReactNode> = {
  local: <Cpu aria-hidden="true" className="size-3.5" />,
  server: <CloudUpload aria-hidden="true" className="size-3.5" />,
  ai: <AlertTriangle aria-hidden="true" className="size-3.5" />,
};

/**
 * States where the work actually happens, in plain language.
 *
 * This is a factual claim derived from `tool.processing`, which each tool
 * definition must set truthfully. We never print "your files are never stored"
 * for a tool that uploads them.
 */
export function PrivacyNote({
  mode,
  className,
  detailed = false,
}: {
  mode: ProcessingMode;
  className?: string;
  detailed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3",
        mode === "local"
          ? "border-emerald-500/25 bg-emerald-500/[0.05]"
          : "border-amber-500/25 bg-amber-500/[0.05]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 shrink-0",
          mode === "local" ? "text-emerald-500" : "text-amber-500",
        )}
      >
        {MODE_ICON[mode]}
      </span>
      <div className="min-w-0 text-[13px] leading-relaxed">
        <p
          className={cn(
            "font-medium",
            mode === "local" ? "text-emerald-500" : "text-amber-500",
          )}
        >
          {PROCESSING_LABEL[mode]}
        </p>
        {detailed ? (
          <p className="mt-0.5 text-[var(--text-muted)]">{PROCESSING_DESCRIPTION[mode]}</p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Setup required                                                     */
/* ------------------------------------------------------------------ */

export function SetupRequired({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-[14px] border border-amber-500/30 bg-amber-500/[0.05] p-5 sm:p-6",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500"
        >
          <Terminal className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--text-ink)]">Setup required</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
            This tool needs a server-side provider that the operator of this deployment has not
            configured yet. The interface below is complete, but it will not produce a result until
            the missing configuration is added. We would rather tell you that than show a button
            that silently fails.
          </p>
        </div>
      </div>

      {tool.setupNote ? (
        <div className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
            What needs to be configured
          </p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--text-ink)]">
            {tool.setupNote}
          </pre>
        </div>
      ) : null}

      <ul className="grid gap-1.5 text-[13px] text-[var(--text-muted)]">
        <li>• Set the environment variable(s) above in your deployment environment.</li>
        <li>• Restart the server so the new value is picked up.</li>
        <li>• Reload this page — no rebuild is needed for server-side variables.</li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

export interface ToolShellProps {
  children: React.ReactNode;
  className?: string;
  /** Rendered under the workspace, e.g. a second action row. */
  footer?: React.ReactNode;
  /** Removes the default padding — for full-bleed canvases. */
  flush?: boolean;
}

/**
 * The container every tool workspace renders inside. Provides the card, the
 * consistent padding rhythm, and nothing else — layout decisions stay with the
 * tool so each one can use the space well.
 */
export function ToolShell({ children, className, footer, flush }: ToolShellProps) {
  return (
    <section
      aria-label="Tool workspace"
      className={cn(
        "rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]",
        "ring-hairline",
        flush ? "overflow-hidden" : "p-4 sm:p-6",
        className,
      )}
    >
      {children}
      {footer ? (
        <div className={cn("mt-6 border-t border-[var(--surface-line)] pt-5", !flush && "mt-6")}>
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badges                                                      */
/* ------------------------------------------------------------------ */

export function ProcessingBadge({ mode }: { mode: ProcessingMode }) {
  return (
    <Badge tone={mode === "local" ? "success" : mode === "server" ? "warning" : "info"}>
      {PROCESSING_BADGE[mode]}
    </Badge>
  );
}

/** Renders a beta / setup-required pill. Stable tools render nothing. */
export function StatusBadge({ status }: { status: ToolStatus }) {
  if (status === "stable") return null;
  if (status === "beta") {
    return <Badge tone="warning">Beta</Badge>;
  }
  return <Badge tone="warning">Setup required</Badge>;
}

export { Notice };
