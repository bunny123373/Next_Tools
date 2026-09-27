"use client";

import { AlertTriangle, Keyboard } from "lucide-react";
import type { Tool, ToolStatus } from "@/lib/tools/types";
import { Notice } from "@/components/tools/states";

/**
 * Honest capability disclosure. A browser tool that is known to be limited
 * says so here, above the workspace, instead of letting the visitor discover
 * it after the fact.
 */
export function ToolStatusCopy({ tool, status }: { tool: Tool; status?: ToolStatus }) {
  const effective = status ?? tool.status;

  if (effective === "setup-required") {
    return (
      <Notice tone="warning" icon={<AlertTriangle className="size-3.5" />}>
        <strong className="font-medium">Setup required.</strong> {tool.setupNote}
      </Notice>
    );
  }

  if (effective === "beta") {
    return (
      <Notice tone="warning" icon={<AlertTriangle className="size-3.5" />}>
        <strong className="font-medium">Beta.</strong> This tool works, but output quality or codec
        availability depends on your browser. If a format is unavailable it will say so rather than
        silently producing the wrong thing.
      </Notice>
    );
  }

  return null;
}

/** Renders the keyboard shortcuts that apply to a tool. */
export function ShortcutHints({
  hints,
  className,
}: {
  hints: { keys: string; description: string }[];
  className?: string;
}) {
  if (hints.length === 0) return null;

  return (
    <div className={className}>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        <Keyboard className="size-3.5" aria-hidden="true" />
        Keyboard shortcuts
      </p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {hints.map((hint) => (
          <li key={hint.keys} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-[var(--text-muted)]">{hint.description}</span>
            <kbd className="shrink-0 rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-ink)]">
              {hint.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}
