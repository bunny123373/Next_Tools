"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CATEGORIES, searchTools, type Tool } from "@/lib/tools/registry";
import { useFavorites } from "@/lib/user/hooks";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Heart } from "lucide-react";

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Global tool search (Ctrl/Cmd + K).
 *
 * Keyboard contract: ↑/↓ move, Enter opens, Esc closes, Home/End jump,
 * Tab is trapped inside the dialog by <Modal>.
 */
export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const { ids: favoriteIds } = useFavorites();

  const results = React.useMemo(() => searchTools(query, { limit: 30 }), [query]);

  // Reset on open so the previous query does not linger.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active row in view during keyboard navigation.
  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const openTool = React.useCallback(
    (tool: Tool | undefined) => {
      if (!tool) return;
      onOpenChange(false);
      router.push(tool.route);
    },
    [onOpenChange, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) =>
          results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
        );
        break;
      case "Home":
        if (query) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (query) {
          event.preventDefault();
          setActiveIndex(Math.max(0, results.length - 1));
        }
        break;
      case "Enter":
        event.preventDefault();
        openTool(results[activeIndex]);
        break;
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Search tools"
      className="sm:max-w-2xl"
      hideClose
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            ref={inputRef}
            data-autofocus
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={results[activeIndex] ? `search-item-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-label="Search for a tool"
            placeholder="Search for a tool…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-11 w-full rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] pl-10 pr-10 text-sm text-[var(--text-ink)] placeholder:text-[var(--text-muted)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-line)] hover:text-[var(--text-ink)]"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <ul
          ref={listRef}
          id="search-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain"
        >
          {results.length === 0 ? (
            <li className="px-1 py-10 text-center">
              <p className="text-sm font-medium text-[var(--text-ink)]">No tools match “{query}”</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Try a shorter term, or browse the categories below.
              </p>
            </li>
          ) : (
            results.map((tool, index) => {
              const active = index === activeIndex;
              const category = CATEGORIES.find((c) => c.slug === tool.category);
              const isFavorite = favoriteIds.includes(tool.id);

              return (
                <li key={tool.id} role="presentation">
                  <button
                    type="button"
                    id={`search-item-${index}`}
                    role="option"
                    aria-selected={active}
                    data-index={index}
                    onClick={() => openTool(tool)}
                    onMouseMove={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                      active ? "bg-[var(--surface-card-2)]" : "hover:bg-[var(--surface-card-2)]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-md border transition-colors",
                        active
                          ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
                          : "border-[var(--surface-line)] text-[var(--text-muted)]",
                      )}
                    >
                      <ToolIcon name={tool.icon} size={16} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-[var(--text-ink)]">
                          {tool.name}
                        </span>
                        {isFavorite ? (
                          <Heart
                            aria-label="In your favourites"
                            className="size-3 shrink-0 fill-brand-500 text-brand-500"
                          />
                        ) : null}
                        {tool.status === "setup-required" ? (
                          <Badge tone="warning" className="shrink-0">
                            Setup
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        {category?.navLabel} · {tool.description}
                      </span>
                    </span>

                    {active ? (
                      <CornerDownLeft
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-[var(--text-muted)]"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--surface-line)] pt-3 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">↑</kbd>
            <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">↓</kbd>
            navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">Enter</kbd>
            open
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </Modal>
  );
}
