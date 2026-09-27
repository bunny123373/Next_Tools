"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { searchTools } from "@/lib/tools/registry";
import { ToolIcon } from "@/components/tools/ToolIcon";

interface SearchBoxProps {
  className?: string;
  size?: "lg" | "md";
}

/**
 * Hero search. Filters the registry live and navigates on selection.
 * Deliberately not lazy: the index is already in the bundle and a hero that
 * responds on the first keystroke is worth the few kilobytes.
 */
export function SearchBox({ className, size = "lg" }: SearchBoxProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const results = React.useMemo(
    () => (query.trim() ? searchTools(query, { limit: 7 }) : []),
    [query],
  );
  const showPanel = focused && query.trim().length > 0;

  React.useEffect(() => setActiveIndex(0), [query]);

  // Dismiss on an outside click.
  React.useEffect(() => {
    if (!focused) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [focused]);

  const go = React.useCallback(
    (route: string) => {
      setFocused(false);
      setQuery("");
      router.push(route);
    },
    [router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setFocused(false);
      return;
    }
    if (results.length === 0) {
      if (event.key === "Enter" && query.trim()) {
        event.preventDefault();
        go(`/tools?q=${encodeURIComponent(query.trim())}`);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const tool = results[activeIndex];
      if (tool) go(tool.route);
      else go(`/tools?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-[var(--surface-card)] transition-colors duration-200",
          showPanel ? "border-brand-500/50" : "border-[var(--surface-line)] hover:border-[var(--surface-line-strong)]",
          size === "lg" ? "h-14 px-4" : "h-11 px-3",
        )}
      >
        <Search
          aria-hidden="true"
          className={cn(
            "shrink-0 text-[var(--text-muted)]",
            size === "lg" ? "size-5" : "size-4",
          )}
        />
        <input
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="hero-search-results"
          aria-autocomplete="list"
          aria-label="Search for a tool"
          placeholder="Search for a tool…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[var(--text-ink)] placeholder:text-[var(--text-muted)] focus:outline-none [&::-webkit-search-cancel-button]:hidden",
            size === "lg" ? "text-[15px]" : "text-sm",
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFocused(false);
            }}
            aria-label="Clear search"
            className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] sm:inline">
            Ctrl K
          </kbd>
        )}
      </div>

      {showPanel ? (
        <ul
          id="hero-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-40 animate-fade-in overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] p-1 shadow-2xl"
        >
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center">
              <p className="text-sm text-[var(--text-ink)]">No tools match “{query}”</p>
              <button
                type="button"
                onClick={() => go(`/tools?q=${encodeURIComponent(query.trim())}`)}
                className="mt-2 text-xs font-medium text-brand-500 hover:underline"
              >
                Search all tools instead
              </button>
            </li>
          ) : (
            <>
              {results.map((tool, index) => (
                <li key={tool.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onClick={() => go(tool.route)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                      index === activeIndex
                        ? "bg-[var(--surface-card-2)]"
                        : "hover:bg-[var(--surface-card-2)]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-md border",
                        index === activeIndex
                          ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
                          : "border-[var(--surface-line)] text-[var(--text-muted)]",
                      )}
                    >
                      <ToolIcon name={tool.icon} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[var(--text-ink)]">
                        {tool.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        {tool.description}
                      </span>
                    </span>
                    {index === activeIndex ? (
                      <CornerDownLeft
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-[var(--text-muted)]"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
              <li className="mt-1 border-t border-[var(--surface-line)] pt-1">
                <button
                  type="button"
                  onClick={() => go(`/tools?q=${encodeURIComponent(query.trim())}`)}
                  className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
                >
                  See all results for “{query.trim()}”
                </button>
              </li>
            </>
          )}
        </ul>
      ) : null}
    </div>
  );
}
