"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { LayoutGrid, List, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CATEGORIES } from "@/lib/tools/categories";
import { searchTools, type Tool } from "@/lib/tools/registry";
import type { ToolCategory, ToolIconName } from "@/lib/tools/types";
import { ToolCard } from "@/components/tools/ToolCard";
import { Button } from "@/components/ui/button";
import { Input, Segmented } from "@/components/ui/form";
import { ToolEmptyState } from "@/components/tools/states";
import { ToolIcon } from "@/components/tools/ToolIcon";

type SortMode = "popular" | "az" | "newest" | "category";
type Density = "grid" | "list";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "popular", label: "Popular" },
  { value: "az", label: "A–Z" },
  { value: "newest", label: "Newest" },
  { value: "category", label: "Category" },
];

function sortTools(tools: readonly Tool[], mode: SortMode): readonly Tool[] {
  const list = [...tools];
  switch (mode) {
    case "az":
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case "newest":
      return list.sort(
        (a, b) => b.addedOn.localeCompare(a.addedOn) || a.name.localeCompare(b.name),
      );
    case "category":
      return list.sort(
        (a, b) =>
          a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
      );
    case "popular":
    default:
      // Curated popularity first, then the search relevance we already computed.
      return list.sort(
        (a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)) || a.name.localeCompare(b.name),
      );
  }
}

export interface ToolsBrowserProps {
  /** All tools, or just this category's when rendered on a category page. */
  tools: readonly Tool[];
  /** Locked category for a category landing page. */
  lockedCategory?: ToolCategory;
}

/**
 * The /tools browser. Filtering, sorting and search all run against the
 * registry in memory — no request, so results are instant.
 *
 * The `?q=` / `?category=` / `?sort=` params are read on mount and written back
 * on change, which makes filtered views linkable and shareable without a
 * server round trip.
 */
export function ToolsBrowser({ tools, lockedCategory }: ToolsBrowserProps) {
  const searchParams = useSearchParams();

  const [query, setQuery] = React.useState(searchParams.get("q") ?? "");
  const [category, setCategory] = React.useState<ToolCategory | "all">(
    lockedCategory ?? ((searchParams.get("category") as ToolCategory | null) ?? "all"),
  );
  const [sort, setSort] = React.useState<SortMode>(
    (searchParams.get("sort") as SortMode | null) ?? "popular",
  );
  const [density, setDensity] = React.useState<Density>("grid");
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  // Keep the URL in sync so the view can be shared and survives a refresh.
  React.useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (!lockedCategory && category !== "all") params.set("category", category);
    if (sort !== "popular") params.set("sort", sort);
    const next = params.toString();
    window.history.replaceState(null, "", next ? `?${next}` : window.location.pathname);
  }, [query, category, sort, lockedCategory]);

  const results = React.useMemo(() => {
    const searched = query.trim()
      ? searchTools(query, { category: lockedCategory ?? undefined, limit: 200 })
      : tools;
    return sortTools(searched, sort);
  }, [query, sort, tools, lockedCategory]);

  const categoryCounts = React.useMemo(() => {
    const counts = new Map<ToolCategory, number>();
    for (const tool of tools) counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
    return counts;
  }, [tools]);

  const hasFilters = query.trim().length > 0 || (!lockedCategory && category !== "all");

  const reset = () => {
    setQuery("");
    if (!lockedCategory) setCategory("all");
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Search + view controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <label htmlFor="tools-search" className="sr-only">
            Search tools
          </label>
          <Input
            id="tools-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools by name, description or keyword…"
            className="h-11 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text-ink)]"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {!lockedCategory ? (
            <Button
              variant={category !== "all" ? "primary" : "secondary"}
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              aria-controls="tools-filters"
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filter
              {category !== "all" ? (
                <span className="ml-0.5 size-1.5 rounded-full bg-current" aria-hidden="true" />
              ) : null}
            </Button>
          ) : null}

          <Segmented
            label="View density"
            size="sm"
            value={density}
            onChange={setDensity}
            className="w-auto"
            options={[
              { value: "grid", label: "", icon: <LayoutGrid className="size-3.5" />, title: "Grid view" },
              { value: "list", label: "", icon: <List className="size-3.5" />, title: "List view" },
            ]}
          />
        </div>
      </div>

      {/* Category + sort filters */}
      <div
        id="tools-filters"
        className={cn(
          "flex flex-col gap-3",
          !lockedCategory && !filtersOpen ? "hidden sm:flex" : "flex",
        )}
      >
        {!lockedCategory ? (
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <CategoryPill
              active={category === "all"}
              onClick={() => setCategory("all")}
              label="All"
              count={tools.length}
            />
            {CATEGORIES.map((item) => {
              const count = categoryCounts.get(item.slug) ?? 0;
              if (count === 0) return null;
              return (
                <CategoryPill
                  key={item.slug}
                  active={category === item.slug}
                  onClick={() => setCategory(category === item.slug ? "all" : item.slug)}
                  label={item.navLabel}
                  count={count}
                  icon={item.icon}
                />
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[var(--text-muted)]">Sort</span>
          <Segmented
            label="Sort tools"
            size="sm"
            value={sort}
            onChange={setSort}
            className="w-auto"
            options={SORT_OPTIONS}
          />
        </div>
      </div>

      {/* Result count + reset */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-line)] pt-4">
        <p className="text-[13px] text-[var(--text-muted)]" role="status" aria-live="polite">
          <span className="font-mono tabular-nums text-[var(--text-ink)]">{results.length}</span>{" "}
          {results.length === 1 ? "tool" : "tools"}
          {query.trim() ? ` matching “${query.trim()}”` : ""}
        </p>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="size-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* Results */}
      {results.length === 0 ? (
        <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <ToolEmptyState
            title={`No tools match “${query.trim()}”`}
            description="Try a different keyword, or clear the filters to see everything."
            icon={<Search className="size-5" />}
          >
            <Button variant="secondary" size="sm" onClick={reset} className="mt-1">
              Clear filters
            </Button>
          </ToolEmptyState>
        </div>
      ) : density === "grid" ? (
        <div className="grid-auto-fill-tools grid gap-3">
          {results.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      ) : (
        <ul className="grid gap-2">
          {results.map((tool) => (
            <li key={tool.id}>
              <ToolCard tool={tool} variant="row" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryPill({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: ToolIconName;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150",
        active
          ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
          : "border-[var(--surface-line)] bg-[var(--surface-card)] text-[var(--text-muted)] hover:border-[var(--surface-line-strong)] hover:text-[var(--text-ink)]",
      )}
    >
      {icon ? <ToolIcon name={icon} size={13} /> : null}
      {label}
      <span className="font-mono tabular-nums opacity-60">{count}</span>
    </button>
  );
}
