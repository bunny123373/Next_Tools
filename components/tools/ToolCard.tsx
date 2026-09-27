import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CATEGORY_MAP, type Tool } from "@/lib/tools/registry";
import type { ToolCategory } from "@/lib/tools/types";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/user/FavoriteButton";

/* ------------------------------------------------------------------ */
/*  Tool card                                                          */
/* ------------------------------------------------------------------ */

export interface ToolCardProps {
  tool: Tool;
  className?: string;
  /** `grid` is the standard card; `dense` trims padding; `row` is the /tools list view. */
  variant?: "grid" | "dense" | "row";
}

/**
 * The canonical tool card. Used on the homepage, /tools, category pages,
 * favourites, recents and related-tools — one component, so they all match.
 */
export function ToolCard({ tool, className, variant = "grid" }: ToolCardProps) {
  const category = CATEGORY_MAP[tool.category];
  const row = variant === "row";

  return (
    <div className={cn("group relative", className)}>
      <Link
        href={tool.route}
        className={cn(
          "flex h-full rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]",
          "ring-hairline transition-all duration-200",
          "hover:-translate-y-0.5 hover:border-[var(--surface-line-strong)] hover:bg-[var(--surface-card-2)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          "motion-reduce:hover:translate-y-0",
          row
            ? "flex-row items-center gap-4 p-3.5"
            : "flex-col p-4",
        )}
      >
        <div className={cn("flex items-start", row ? "min-w-0 flex-1 gap-3" : "gap-3")}>
          <span
            aria-hidden="true"
            className={cn(
              "grid shrink-0 place-items-center rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]",
              "text-[var(--text-muted)] transition-colors duration-200",
              "group-hover:border-brand-500/40 group-hover:bg-brand-500/10 group-hover:text-brand-500",
              variant === "dense" ? "size-8" : row ? "size-9" : "size-10",
            )}
          >
            <ToolIcon name={tool.icon} size={variant === "dense" ? 16 : 18} />
          </span>

          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                "font-semibold tracking-[-0.01em] text-[var(--text-ink)]",
                variant === "dense" ? "text-[13px]" : "text-sm",
              )}
            >
              {tool.name}
            </h3>
            <p
              className={cn(
                "mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]",
                row ? "line-clamp-1" : "line-clamp-2",
              )}
            >
              {tool.description}
            </p>
            {row ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="outline">{category.navLabel}</Badge>
                {tool.status === "beta" ? <Badge tone="warning">Beta</Badge> : null}
                {tool.status === "setup-required" ? <Badge tone="warning">Setup</Badge> : null}
                {tool.processing === "local" ? <Badge tone="success">Local</Badge> : null}
              </div>
            ) : null}
          </div>
        </div>

        {row ? null : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge tone="outline">{category.navLabel}</Badge>
              {tool.status === "beta" ? <Badge tone="warning">Beta</Badge> : null}
              {tool.status === "setup-required" ? <Badge tone="warning">Setup</Badge> : null}
              {tool.processing === "local" ? <Badge tone="success">Local</Badge> : null}
            </div>

            <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand-500">
              Open Tool
              <ArrowRight
                aria-hidden="true"
                className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:translate-x-0"
              />
            </span>
          </>
        )}

        {row ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-brand-500">
            Open
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:translate-x-0"
            />
          </span>
        ) : null}
      </Link>

      {/* Sits above the card link so it stays independently clickable. */}
      <div
        className={cn(
          "absolute right-2 top-2 transition-opacity duration-200",
          "opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100",
        )}
      >
        <FavoriteButton toolId={tool.id} toolName={tool.name} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category card                                                      */
/* ------------------------------------------------------------------ */

export interface CategoryCardProps {
  categorySlug: ToolCategory;
  toolCount: number;
  className?: string;
}

export function CategoryCard({ categorySlug, toolCount, className }: CategoryCardProps) {
  const category = CATEGORY_MAP[categorySlug];

  return (
    <Link
      href={category.route}
      className={cn(
        "group flex flex-col rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]",
        "ring-hairline p-5 transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-brand-500/40 hover:bg-[var(--surface-card-2)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        "motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-11 place-items-center rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)] transition-colors duration-200 group-hover:border-brand-500/40 group-hover:bg-brand-500/10 group-hover:text-brand-500"
      >
        <ToolIcon name={category.icon} size={20} />
      </span>

      <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-ink)]">
        {category.name}
      </h3>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
        {category.tagline}
      </p>

      <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-muted)] transition-colors group-hover:text-brand-500">
        {toolCount} {toolCount === 1 ? "tool" : "tools"}
        <ArrowRight
          aria-hidden="true"
          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:translate-x-0"
        />
      </span>
    </Link>
  );
}
