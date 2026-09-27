"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Hide the default close button (e.g. for blocking dialogs). */
  hideClose?: boolean;
  /** Called on Escape. Defaults to onClose. */
  onEscape?: () => void;
}

/**
 * Accessible dialog: focus moves in on open, is trapped while open, and
 * returns to the trigger on close. Escape and backdrop clicks both dismiss.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  hideClose,
  onEscape,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Remember the trigger, move focus into the panel, restore on close.
  React.useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    const focusFirst = () => {
      const node = panelRef.current;
      if (!node) return;
      const target =
        node.querySelector<HTMLElement>('[data-autofocus]') ??
        node.querySelector<HTMLElement>(FOCUSABLE) ??
        node;
      target.focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusFirst);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = overflow;
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Keep Tab inside the panel.
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        (onEscape ?? onClose)();
        return;
      }
      if (event.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, onEscape]);

  // Hooks must run unconditionally, so these are declared before the early
  // return below rather than next to the JSX that consumes them.
  const titleId = React.useId();
  const descId = React.useId();

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 animate-fade-in bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-[var(--surface-card)]",
          "rounded-t-2xl border border-[var(--surface-line)] shadow-2xl sm:max-w-lg sm:rounded-2xl",
          "animate-fade-up",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--surface-line)] p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-[var(--text-ink)]">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-[13px] text-[var(--text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          {!hideClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--surface-line)] p-4 sm:p-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** Imperative confirm dialog built on Modal, for destructive actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className="sm:max-w-md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-ink)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-autofocus
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "h-9 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50",
              destructive ? "bg-brand-500 hover:bg-brand-600" : "bg-brand-500 hover:bg-brand-600",
            )}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-[var(--text-muted)]">{message}</p>
    </Modal>
  );
}
