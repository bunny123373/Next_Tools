"use client";

import * as React from "react";
import { Activity, CalendarClock, Trash2 } from "lucide-react";
import { CATEGORY_MAP, getTool } from "@/lib/tools/registry";
import { useRecent } from "@/lib/user/hooks";
import { formatRelativeTime } from "@/lib/utils/format";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { Button } from "@/components/ui/button";
import { ToolEmptyState } from "@/components/tools/states";
import { ConfirmDialog } from "@/components/ui/modal";
import { toast } from "@/lib/utils/toast";

/**
 * /recent — the last 20 tools this visitor opened, newest first.
 *
 * The spec asks for tool name, icon, last-used time and category. That is
 * exactly the list view below; the cards below it are a convenience.
 */
export function RecentClient() {
  const { recent, clear, count } = useRecent();
  const [confirmClear, setConfirmClear] = React.useState(false);

  const tools = recent
    .map((entry) => ({ entry, tool: getTool(entry.toolId) }))
    .filter((row): row is { entry: (typeof recent)[number]; tool: NonNullable<ReturnType<typeof getTool>> } =>
      row.tool !== undefined,
    );

  if (count === 0) {
    return (
      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
        <ToolEmptyState
          title="Nothing used yet"
          description="Open any tool and it shows up here with the time you last used it. Like favourites, this is stored in this browser only."
          icon={<Activity className="size-5" />}
        >
          <Button variant="primary" size="sm" href="/tools" className="mt-1">
            Find a tool
          </Button>
        </ToolEmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--text-muted)]" role="status" aria-live="polite">
          <span className="font-mono tabular-nums text-[var(--text-ink)]">{count}</span>{" "}
          {count === 1 ? "tool" : "tools"} · newest first
        </p>
        <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          Clear
        </Button>
      </div>

      {/* The record view: name, icon, category, last used. */}
      <ul className="overflow-hidden rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
        {tools.map(({ entry, tool }, index) => {
          const category = CATEGORY_MAP[tool.category];
          return (
            <li
              key={tool.id}
              className={index > 0 ? "border-t border-[var(--surface-line)]" : undefined}
            >
              <a
                href={tool.route}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-card-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)] transition-colors group-hover:border-brand-500/40 group-hover:text-brand-500"
                >
                  <ToolIcon name={tool.icon} size={16} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--text-ink)]">
                    {tool.name}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-muted)]">
                    {category.name}
                    {entry.openCount > 1 ? ` · opened ${entry.openCount}×` : ""}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  <time dateTime={new Date(entry.lastUsedAt).toISOString()}>
                    {formatRelativeTime(entry.lastUsedAt)}
                  </time>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--text-muted)]">Open again</h2>
        <div className="grid-auto-fill-tools grid gap-3">
          {tools.slice(0, 8).map(({ tool }) => (
            <ToolCard key={tool.id} tool={tool} variant="dense" />
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
          toast.info("Recently used cleared");
        }}
        title="Clear recently used?"
        message={`This removes all ${count} entries from this browser. It cannot be undone.`}
        confirmLabel="Clear"
        destructive
      />
    </div>
  );
}
