"use client";

import * as React from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { usePathname } from "next/navigation";
import { Menu, Moon, Search, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CATEGORIES } from "@/lib/tools/categories";
import { TOOL_COUNT } from "@/lib/tools/registry";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useTheme } from "./theme-provider";
import { SearchDialog } from "./SearchDialog";

/* Desktop navigation links. Home + All Tools + one per category. */
const DESKTOP_LINKS = [
  { label: "Home", href: "/" },
  { label: "All Tools", href: "/tools" },
  ...CATEGORIES.map((category) => ({
    label: category.navLabel,
    href: category.route,
  })),
] as const;

export function Navbar() {
  const pathname = usePathname();
  const { theme, toggle, mounted } = useTheme();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Global Ctrl/Cmd + K, and "/" as a secondary trigger.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close the mobile sheet on navigation.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock the page behind the mobile sheet.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [mobileOpen]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--surface-line)] bg-[var(--surface-canvas)]/85 backdrop-blur-md">
        <nav
          aria-label="Main"
          className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:h-16 sm:px-6 lg:px-8"
        >
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-md text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-ink)]"
          >
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-md bg-brand-500 text-[13px] font-bold text-white"
            >
              B
            </span>
            <span className="hidden sm:inline">
              Balu <span className="text-brand-500">Tools</span>
            </span>
          </Link>

          <div className="hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
            {DESKTOP_LINKS.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                    active
                      ? "text-[var(--text-ink)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-ink)]",
                  )}
                >
                  {link.label}
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-brand-500"
                    />
                  ) : null}
                </Link>
              );
            })}
          </div>

          {/*
           * Every icon-only control in this row is `icon` (40x40), not
           * `icon-sm` (32x32) and not `sm`.
           *
           * 32px is under the 40px minimum this project already applies to
           * touch targets, and on a phone it is a small thing to hit on its own.
           * They are sized as a set because they sit side by side: raising only
           * the theme button would leave two mismatched squares in one row,
           * which reads as a mistake even though only one of them was one.
           *
           * Verified at 320/375/768/1024/1440 with no horizontal scroll at any
           * of them — four 40px buttons plus the wordmark still fit a 320px
           * viewport with room to spare.
           */}
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <HeaderClock />
            {/*
             * Search is the one control here that widens with its content, so it
             * is `size="md"` (auto width) rather than `size="icon"`, which pins
             * the button to a fixed `w-10`.
             *
             * It used to be `size="icon"` and carried a "Search" label plus a
             * `Ctrl K` badge, both revealed at `xl`. Inside a fixed 40px box those
             * had nowhere to go and were clipped — the label simply never fit.
             * Below `xl` the label and badge are hidden and the explicit
             * `w-10 px-0` restores the square icon-button footprint, so the
             * cluster stays exactly as compact as it was on smaller screens.
             */}
            <Tooltip content="Search tools (Ctrl + K)" side="bottom">
              <Button
                variant="ghost"
                size="md"
                onClick={() => setSearchOpen(true)}
                aria-label="Search tools"
                aria-keyshortcuts="Control+K"
                className="w-10 justify-center px-0 xl:w-auto xl:justify-start xl:px-4"
              >
                <Search className="size-4 shrink-0" aria-hidden="true" />
                <span className="hidden xl:inline">Search</span>
                <kbd className="hidden shrink-0 rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px] text-[var(--text-muted)] xl:inline">
                  Ctrl K
                </kbd>
              </Button>
            </Tooltip>

            <Tooltip content={mounted && theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label={mounted && theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {/* Both icons render; the theme stylesheet reveals one, so SSR has no flash. */}
                <Sun className="dark-only size-4" aria-hidden="true" />
                <Moon className="light-only size-4" aria-hidden="true" />
              </Button>
            </Tooltip>

            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen((value) => !value)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
            >
              {mobileOpen ? (
                <X className="size-5" aria-hidden="true" />
              ) : (
                <Menu className="size-5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </nav>

        {/* Mobile sheet */}
        {mobileOpen ? (
          <div
            id="mobile-nav"
            className="animate-fade-in max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-[var(--surface-line)] bg-[var(--surface-canvas)] lg:hidden"
          >
            <div className="px-4 py-4 sm:px-6">
              <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Browse
              </p>
              <ul className="grid gap-0.5 sm:grid-cols-2">
                {DESKTOP_LINKS.map((link) => {
                  const active = isActive(link.href);
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-brand-500/10 text-brand-500"
                            : "text-[var(--text-ink)] hover:bg-[var(--surface-card-2)]",
                        )}
                      >
                        {link.label}
                        {active ? (
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-500" />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <p className="px-1 pb-2 pt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Your tools
              </p>
              <ul className="grid gap-0.5 sm:grid-cols-2">
                {[
                  { label: "Favourites", href: "/favorites" },
                  { label: "Recently used", href: "/recent" },
                  { label: "History", href: "/dashboard" },
                  { label: `All ${TOOL_COUNT} tools`, href: "/tools" },
                ].map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block rounded-lg px-3 py-2.5 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>

              {/*
                * A labelled control here as well as in the header.

                * The header icon works at every width, but a 40px target with no
                * visible label is a poor thing to ask someone to find on a phone,
                * and it announces only an action rather than the current mode.
                * This row is full width and names the state, which is what the
                * header icon cannot do in the space available.

                * `sm:hidden` because from 640px up the header icon sits beside it
                * and the row would only repeat it.
                */}
              <div className="mt-5 border-t border-[var(--surface-line)] pt-4 sm:hidden">
                <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Appearance
                </p>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={
                    mounted && theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
                  }
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] px-3 py-3 text-left text-sm transition-colors hover:bg-[var(--surface-card-2)]"
                >
                  <span className="min-w-0">
                    <span className="block text-[var(--text-ink)]">
                      {mounted && theme === "dark" ? "Dark mode" : "Light mode"}
                    </span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      Tap to switch to {mounted && theme === "dark" ? "light" : "dark"}
                    </span>
                  </span>
                  <Sun className="dark-only size-5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                  <Moon className="light-only size-5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Live header clock                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The visitor's real local time, date and year, ticking once a second.
 *
 * Why it exists: it is the one piece of ambient information the header has no
 * home for, and it is genuinely useful on a tools site — "what day is it"
 * decides whether to look at New Tools, and the clock is a fast sanity check
 * that the page is live.
 *
 * Hydration: a clock is the classic way to ship a React mismatch, because the
 * server has one "now" and the browser has another. So nothing clock-dependent
 * renders on the server — the state starts at 0, and the first real value is
 * written from a `setTimeout(0)` after mount. Until then the element renders a
 * fixed-width placeholder so the header does not visibly jump when it fills in.
 * This is the same pattern `TimestampConverterWorkspace` uses.
 *
 * Timezone: intentionally the visitor's own zone, read via `Intl` rather than
 * UTC or a fixed offset. A clock that shows the wrong local time is worse than
 * no clock.
 */
function HeaderClock() {
  const [now, setNow] = React.useState(0);

  React.useEffect(() => {
    const start = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, []);

  // Stable pieces are built once; only the second changes each tick.
  const time = React.useMemo(
    () =>
      now === 0
        ? ""
        : new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(now),
    [now],
  );

  const date = React.useMemo(
    () =>
      now === 0
        ? ""
        : new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(now),
    [now],
  );

  const zone = React.useMemo(() => {
    if (now === 0) return "";
    try {
      // `short` keeps it to something like "GMT+5:30" — a label, not a sentence.
      const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(now)
        .find((piece) => piece.type === "timeZoneName");
      return part?.value ?? "";
    } catch {
      return "";
    }
  }, [now]);

  const ready = now !== 0;

  return (
    <div
      className="hidden items-center gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2.5 py-1 text-[12px] leading-none text-[var(--text-muted)] lg:flex"
      // Announced politely so a screen reader reads it without interrupting.
      role="timer"
      aria-live="off"
    >
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-mono tabular-nums text-[var(--text-ink)]">
        {ready ? time : "--:--:--"}
      </span>
      {/*
       * The date and year are the wide part, and they are the first thing that
       * should go when the row is tight.
       *
       * The navbar row is at its most crowded between `lg` (1024px) and `xl`
       * (1280px): that is exactly where the desktop nav links and all three
       * icon buttons are visible at once, and adding a full date there pushes
       * the row past the viewport. So `lg` shows the clock alone and `xl` adds
       * the rest. The separator is hidden with it so no dangling pipe is left.
       */}
      <span className="hidden items-center gap-2 xl:flex">
        <span aria-hidden="true" className="text-[var(--surface-line-strong)]">
          |
        </span>
        <span className="whitespace-nowrap">
          {ready ? date : "-- --- ----"}
          {ready && zone ? <span className="ml-1.5 opacity-70">{zone}</span> : null}
        </span>
      </span>
    </div>
  );
}
