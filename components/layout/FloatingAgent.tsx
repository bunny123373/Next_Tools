"use client";

/**
 * The floating assistant launcher.
 *
 * Sits in the root layout, so it is on every page, which makes two things
 * matter that would not matter inside a single tool:
 *
 *  1. **It must not be a dead button.** A widget that opens to an error is
 *     worse than no widget, so the launcher probes `/api/ai/status` and renders
 *     *nothing at all* when no provider is configured. The probe is deliberately
 *     minimal — a bare `fetch` reading two booleans — because importing the AI
 *     client would pull zod and the response schemas into every page on the
 *     site. The result is cached in `sessionStorage` so moving around the site
 *     costs one request, not one per page.
 *
 *  2. **It must stay cheap until it is used.** The panel is a `next/dynamic`
 *     import, so the streaming client and its schemas are only downloaded when
 *     someone actually opens the bot. Everything in this file is a few hundred
 *     bytes.
 *
 * The panel is deliberately *not* a modal: it does not trap focus or block the
 * page, because a chat you cannot scroll away from is not a chat widget.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { MessageSquareText, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Loaded on open, so its dependencies stay out of every other page's bundle. */
const AgentPanel = dynamic(
  () => import("./AgentPanel").then((module) => module.AgentPanel),
  { ssr: false },
);

const CACHE_KEY = "balu:assistant-available";
/** Re-probe at most this often, so a redeploy is picked up within a session. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Paths where a second chat window would be redundant or competing. */
const HIDDEN_PATHS = ["/tools/ai/chat"];

function readCache(): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "at" in parsed &&
      "available" in parsed &&
      typeof parsed.at === "number" &&
      typeof parsed.available === "boolean"
    ) {
      if (Date.now() - parsed.at < CACHE_TTL_MS) return parsed.available;
    }
  } catch {
    // Private mode, disabled storage, or corrupt value. Treat as a miss.
  }
  return null;
}

function writeCache(available: boolean): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), available }));
  } catch {
    // A failed cache write only costs an extra probe next page.
  }
}

export function FloatingAgent() {
  const pathname = usePathname();
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const hidden = HIDDEN_PATHS.some((path) => pathname === path || pathname?.startsWith(`${path}/`));

  // Navigating to a page that hides the launcher must also close it, or it
  // reappears already open on the way back.
  React.useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  React.useEffect(() => {
    if (hidden) return;

    const cached = readCache();
    if (cached !== null) {
      setAvailable(cached);
      return;
    }

    const controller = new AbortController();
    let active = true;

    void fetch("/api/ai/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return false;
        // Read only the two fields we need; no schema, no zod.
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null) return false;
        const record = body as { configured?: unknown; features?: { chat?: unknown } };
        return record.configured === true && record.features?.chat === true;
      })
      .then((result) => {
        if (!active) return;
        writeCache(result);
        setAvailable(result);
      })
      .catch(() => {
        // Offline, or the route is unreachable. `false` means we render nothing,
        // which is the honest outcome: we do not know that chat works.
        if (active) setAvailable(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [hidden]);

  // Escape closes, and a click outside closes. Bound while open only.
  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Nothing to render while we do not know, when it is unavailable, or on a
  // page that already is the chat.
  if (hidden || available !== true) return null;

  return (
    <>
      {/* Backdrop only on small screens, where the panel is a full sheet. */}
      {open ? (
        <div
          className="fixed inset-0 z-[60] bg-black/40 sm:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <div
        ref={panelRef}
        role="dialog"
        aria-label="AI assistant"
        aria-modal="false"
        className={cn(
          "fixed z-[70] flex flex-col overflow-hidden border border-[var(--surface-line)] bg-[var(--surface-card)] shadow-2xl",
          // Full-bleed on a phone, inset card from `sm` up. The mobile case has
          // to respect the notch and the home indicator, or the header sits
          // under the status bar and the composer under the gesture bar.
          "inset-0 pt-[var(--safe-top)] pb-[var(--safe-bottom)]",
          "sm:inset-auto sm:bottom-[max(1.5rem,var(--safe-bottom))] sm:right-[max(1.25rem,var(--safe-right))]",
          "sm:h-[min(34rem,calc(100dvh-10rem))] sm:w-[24rem] sm:rounded-2xl sm:pt-0 sm:pb-0",
          // Nothing inside is `position: sticky`, so clipping here cannot break
          // a sticky child the way an `overflow: hidden` ancestor does.
          open ? "flex" : "hidden",
        )}
      >
        <AgentPanel
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      </div>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close the AI assistant" : "Open the AI assistant"}
        className={cn(
          // `max()` keeps a 20px minimum on devices reporting no inset, and
          // adds the home-indicator / notch inset where there is one. Without
          // this the button half-overlaps the iOS home indicator.
          "fixed z-[70] grid place-items-center rounded-full shadow-lg transition-all",
          "bottom-[max(1.25rem,var(--safe-bottom))] right-[max(1.25rem,var(--safe-right))]",
          // 56px on every size: comfortably past the 44px touch target minimum.
          "size-14",
          "bg-[var(--text-ink)] text-[var(--surface-card)] hover:opacity-90",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          // While open the button is invisible, and on a small screen the panel
          // is full-bleed underneath it — so it must stop taking clicks, or it
          // would sit on top of the composer's send button and swallow taps.
          open ? "pointer-events-none scale-90 opacity-0" : "scale-100 opacity-100",
        )}
      >
        {open ? (
          <X className="size-6" aria-hidden="true" />
        ) : (
          <MessageSquareText className="size-6" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
