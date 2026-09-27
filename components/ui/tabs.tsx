"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
  /** Fill the available width (mobile friendly). */
  fullWidth?: boolean;
}

/**
 * WAI-ARIA tabs with roving focus and arrow-key navigation. Panels are wired
 * with `id` / `aria-labelledby` so screen readers announce the change.
 */
export function Tabs({ items, value, onChange, label, className, fullWidth }: TabsProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const enabled = items.filter((item) => !item.disabled);
    const current = enabled.findIndex((item) => item.value === value);
    if (current === -1) return;

    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else if (event.key === "ArrowRight") next = (current + 1) % enabled.length;
    else next = (current - 1 + enabled.length) % enabled.length;

    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-tab-value="${CSS.escape(target.value)}"]`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "scrollbar-none flex gap-1 overflow-x-auto border-b border-[var(--surface-line)]",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            data-tab-value={item.value}
            role="tab"
            type="button"
            id={`tab-${item.value}`}
            aria-selected={active}
            aria-controls={`panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5",
              "text-[13px] font-medium transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500",
              "disabled:opacity-40",
              active ? "text-[var(--text-ink)]" : "text-[var(--text-muted)] hover:text-[var(--text-ink)]",
              fullWidth && "flex-1 justify-center",
            )}
          >
            {item.icon}
            {item.label}
            {item.badge}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors duration-200",
                active ? "bg-brand-500" : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  value: string;
  activeValue: string;
  children: React.ReactNode;
  className?: string;
}

export function TabPanel({ value, activeValue, children, className }: TabPanelProps) {
  if (value !== activeValue) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${value}`}
      aria-labelledby={`tab-${value}`}
      tabIndex={0}
      className={cn("animate-fade-in focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
