import * as React from "react";
import { CATEGORY_MAP } from "@/lib/tools/categories";
import type { Tool, ToolStatus } from "@/lib/tools/types";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { PrivacyNote, ProcessingBadge, StatusBadge } from "@/components/tools/ToolShell";
import { FavoriteButton } from "@/components/user/FavoriteButton";
import { ShareTool } from "@/components/tools/ShareTool";
import { ToolStatusCopy } from "./ToolStatusCopy";

export interface ToolHeaderProps {
  tool: Tool;
  /**
   * Status resolved at request time (see `resolveToolStatus`). Falls back to
   * the registry value, which is the pessimistic default.
   */
  status?: ToolStatus;
  className?: string;
}

/** Breadcrumb + title + description + privacy + actions. Identical on every tool page. */
export function ToolHeader({ tool, status, className }: ToolHeaderProps) {
  const category = CATEGORY_MAP[tool.category];
  const effectiveStatus = status ?? tool.status;

  return (
    <header className={className}>
      <Breadcrumb
        className="mb-5"
        items={[
          { label: "Home", href: "/" },
          { label: "All Tools", href: "/tools" },
          { label: category.name, href: category.route },
          { label: tool.name },
        ]}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span
            aria-hidden="true"
            className="hidden size-12 shrink-0 place-items-center rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] text-brand-500 sm:grid"
          >
            <ToolIcon name={tool.icon} size={22} />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-[28px] sm:leading-tight">
                {tool.name}
              </h1>
              <StatusBadge status={effectiveStatus} />
            </div>

            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--text-muted)]">
              {tool.intro}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ProcessingBadge mode={tool.processing} />
              <span className="text-xs text-[var(--text-muted)]">{category.name}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ShareTool path={tool.route} title={tool.name} text={tool.description} />
          <FavoriteButton toolId={tool.id} toolName={tool.name} appearance="full" />
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <PrivacyNote mode={tool.processing} detailed />
        <ToolStatusCopy tool={tool} status={effectiveStatus} />
      </div>
    </header>
  );
}
