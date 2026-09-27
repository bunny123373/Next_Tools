"use client";

import * as React from "react";
import Link from "next/link";
import { Heart, Search, Trash2 } from "lucide-react";
import { CATEGORY_MAP, getTool, type Tool } from "@/lib/tools/registry";
import { useFavorites } from "@/lib/user/hooks";
import { ToolCard } from "@/components/tools/ToolCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { ToolEmptyState } from "@/components/tools/states";
import { ConfirmDialog } from "@/components/ui/modal";
import { toast } from "@/lib/utils/toast";

/**
 * /favorites — the visitor's saved tools.
 *
 * Backed by localStorage. A signed-in implementation mirrors the same list to
 * the database; the read path is identical either way, because the store is the
 * single interface.
 */
export function FavoritesClient() {
  const { favorites, clear, count } = useFavorites();
  const [query, setQuery] = React.useState("");
  const [confirmClear, setConfirmClear] = React.useState(false);

  const tools = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return favorites
      .map((entry) => getTool(entry.toolId))
      .filter((tool): tool is Tool => tool !== undefined)
      .filter((tool) => {
        if (!q) return true;
        const category = CATEGORY_MAP[tool.category];
        return `${tool.name} ${tool.description} ${category.name}`.toLowerCase().includes(q);
      });
  }, [favorites, query]);

  // Group by category so a long list stays scannable.
  const grouped = React.useMemo(() => {
    const map = new Map<string, typeof tools>();
    for (const tool of tools) {
      const list = map.get(tool.category) ?? [];
      list.push(tool);
      map.set(tool.category, list);
    }
    return Array.from(map.entries());
  }, [tools]);

  if (count === 0) {
    return (
      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
        <ToolEmptyState
          title="No favourites yet"
          description="Tap the heart on any tool to pin it here. Favourites are stored in this browser, so they work without a sign-in and never leave your device."
          icon={<Heart className="size-5" />}
        >
          <Button variant="primary" size="sm" href="/tools" className="mt-1">
            Browse tools
          </Button>
        </ToolEmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <label htmlFor="favorites-search" className="sr-only">
            Filter favourites
          </label>
          <Input
            id="favorites-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter your favourites…"
            className="h-10 pl-9"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmClear(true)}
          className="self-start sm:self-auto"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Clear all
        </Button>
      </div>

      {tools.length === 0 ? (
        <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <ToolEmptyState
            title="Nothing matches that filter"
            description="Try a different word, or clear the filter to see all of your favourites."
            icon={<Search className="size-5" />}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map(([category, list]) => (
            <section key={category}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]">
                {CATEGORY_MAP[category as keyof typeof CATEGORY_MAP].name}
                <span className="font-mono text-[11px] tabular-nums opacity-60">{list.length}</span>
              </h2>
              <div className="grid-auto-fill-tools grid gap-3">
                {list.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="border-t border-[var(--surface-line)] pt-5 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Showing {tools.length} of {count} saved {count === 1 ? "tool" : "tools"}. Favourites live in
        this browser&apos;s local storage — we do not have an account system yet, so clearing site
        data will clear them too.{" "}
        <Link href="/dashboard" className="text-brand-500 hover:underline">
          Manage your data
        </Link>
        .
      </p>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
          toast.info("Favourites cleared");
        }}
        title="Clear all favourites?"
        message={`This removes all ${count} saved tools from this browser. It cannot be undone.`}
        confirmLabel="Clear favourites"
        destructive
      />
    </div>
  );
}
