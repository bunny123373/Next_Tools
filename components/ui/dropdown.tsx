"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface DropdownItem {
  label: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  icon?: React.ReactNode;
  /** Renders in brand red and announces as destructive. */
  destructive?: boolean;
  disabled?: boolean;
  /** Hidden on small screens (keeps mobile toolbars uncluttered). */
  hideOnMobile?: boolean;
}

export interface DropdownProps {
  /** The button that opens the menu. Its onClick is wrapped, not replaced. */
  trigger: React.ReactElement<{
    onClick?: (event: React.MouseEvent) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: string;
  }>;
  items: readonly DropdownItem[];
  align?: "start" | "end";
  label: string;
  className?: string;
}

/** Lightweight menu with roving arrow-key focus and Escape/outside dismissal. */
export function Dropdown({ trigger, items, align = "end", label, className }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | HTMLAnchorElement | null>>([]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.props.onClick?.(event as unknown as React.MouseEvent);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, trigger]);

  React.useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const move = (delta: number) => {
    const enabled = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex(
      ({ index }) => document.activeElement === itemRefs.current[index],
    );
    const next = (current + delta + enabled.length) % enabled.length;
    itemRefs.current[enabled[next]!.index]?.focus();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {React.cloneElement(trigger, {
        onClick: (event: React.MouseEvent) => {
          trigger.props.onClick?.(event);
          setOpen((value) => !value);
        },
        "aria-expanded": open,
        "aria-haspopup": "menu" as const,
      })}

      {open ? (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            }
          }}
          className={cn(
            "absolute z-50 mt-1.5 min-w-[13rem] animate-fade-in overflow-hidden rounded-xl",
            "border border-[var(--surface-line)] bg-[var(--surface-card)] p-1 shadow-2xl",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) =>
            item.href ? (
              <a
                key={index}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                role="menuitem"
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                  "hover:bg-[var(--surface-card-2)] focus:bg-[var(--surface-card-2)] focus:outline-none",
                  item.destructive ? "text-brand-500" : "text-[var(--text-ink)]",
                  item.hideOnMobile && "hidden sm:flex",
                )}
              >
                {item.icon}
                {item.label}
              </a>
            ) : (
              <button
                key={index}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                  "hover:bg-[var(--surface-card-2)] focus:bg-[var(--surface-card-2)] focus:outline-none",
                  "disabled:opacity-40",
                  item.destructive ? "text-brand-500" : "text-[var(--text-ink)]",
                  item.hideOnMobile && "hidden sm:flex",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
