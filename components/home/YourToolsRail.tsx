"use client";

import * as React from "react";
import { Download, Heart, History, TrendingUp } from "lucide-react";
import { getTool } from "@/lib/tools/registry";
import { localTrending } from "@/lib/user/store";
import { useFavorites, useLocalStats, useRecent } from "@/lib/user/hooks";
import { ToolCard } from "@/components/tools/ToolCard";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/lib/hooks";
import { ToolEmptyState } from "@/components/tools/states";
import { Section } from "./Sections";

/** Chrome's install event, typed. Not in lib.dom yet. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Your tools" rail. Everything here comes from real local activity —
 * favourites the visitor set, tools they actually opened, and a trending list
 * ranked from their own usage counters.
 *
 * We never label a tool "trending" without a real signal behind it. If the
 * visitor has not used enough tools for a ranking to mean anything, the section
 * says so instead of inventing a leaderboard.
 */
export function YourToolsRail() {
  const { ids: favoriteIds, count: favoriteCount } = useFavorites();
  const { recent } = useRecent();
  // Favourites and usage live in localStorage, so the server cannot know them.
  // Rendering the real values on the first client pass would disagree with the
  // server HTML, so the server-safe state renders first and this fills in after.
  const mounted = useMounted();

  // Trending is TrendingRail's concern; this section is about recents and
  // favourites only.
  const hasAnything = favoriteCount > 0 || recent.length > 0;

  if (!mounted) {
    // The same shape the empty state produces, so the first client render is
    // identical to the server's and React has nothing to reconcile.
    return (
      <Section eyebrow="Yours" title="Pick up where you left off" className="min-h-[13rem]">
        <div className="h-32 animate-pulse rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]" />
      </Section>
    );
  }

  if (!hasAnything) {
    return (
      <Section
        eyebrow="Yours"
        title="Your toolbox"
        description="Tools you open and favourite show up here, on this device only."
      >
        <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <ToolEmptyState
            title="Nothing here yet"
            description="Open a few tools and hit the heart on the ones you like. We'll remember them here — and only here, in your browser."
            icon={<Heart className="size-5" />}
          >
            <Button variant="secondary" size="sm" href="/tools" className="mt-1">
              Browse tools
            </Button>
          </ToolEmptyState>
        </div>
      </Section>
    );
  }

  return (
    <Section
      eyebrow="Yours"
      title="Pick up where you left off"
      description="Your recently opened and favourited tools, stored in this browser and nowhere else."
      action={{ label: "View all", href: "/recent" }}
    >
      <div className="flex flex-col gap-6">
        {recent.length > 0 ? (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)]">
              <History className="size-3.5" aria-hidden="true" />
              Recently used
            </h3>
            <div className="grid-auto-fill-tools grid gap-3">
              {recent.slice(0, 4).map((entry) => {
                const tool = getTool(entry.toolId);
                return tool ? <ToolCard key={tool.id} tool={tool} variant="dense" /> : null;
              })}
            </div>
          </div>
        ) : null}

        {favoriteCount > 0 ? (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)]">
              <Heart className="size-3.5" aria-hidden="true" />
              Favourites ({favoriteCount})
            </h3>
            <div className="grid-auto-fill-tools grid gap-3">
              {favoriteIds.slice(0, 4).map((id) => {
                const tool = getTool(id);
                return tool ? <ToolCard key={tool.id} tool={tool} variant="dense" /> : null;
              })}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * Trending rail. Ranked from real usage — but only shown when there is enough
 * of it. Never a fabricated leaderboard.
 */
export function TrendingRail() {
  const { recent } = useRecent();
  const stats = useLocalStats();
  const mounted = useMounted();

  // Ranking needs a real usage signal, so it is browser-only and mount-gated.
  const trendingIds = React.useMemo(
    () => (mounted && stats.totalOpens >= 3 ? localTrending(6) : []),
    [mounted, stats.totalOpens, recent.length],
  );
  const tools = trendingIds.map(getTool).filter((tool) => tool !== undefined);

  if (tools.length === 0) {
    return (
      <Section
        eyebrow="Trending"
        title="Trending for you"
        description="A ranking appears here once you've used enough tools for it to be meaningful."
      >
        <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <ToolEmptyState
            title="Not enough data yet — and we won't fake it"
            description="Trending is ranked from real usage. Use a few tools and your own most-used list will appear here. We don't show made-up popularity numbers."
            icon={<TrendingUp className="size-5" />}
          >
            <Button variant="secondary" size="sm" href="/tools" className="mt-1">
              Explore tools
            </Button>
          </ToolEmptyState>
        </div>
      </Section>
    );
  }

  return (
    <Section
      eyebrow="Trending"
      title="Trending for you"
      description="Ranked from the tools you have actually used on this device."
    >
      <div className="grid-auto-fill-tools grid gap-3">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} variant="dense" />
        ))}
      </div>
    </Section>
  );
}

/**
 * Install prompt for the PWA. Only appears when the browser actually offers
 * installation, and it explains the offline scope honestly.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = React.useState<InstallPromptEvent | null>(null);

  React.useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!deferred) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-brand-500"
        >
          <Download className="size-4" />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-ink)]">
            Install Balu Tools
          </h3>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
            Adds an app shortcut and caches the interface for offline browsing. Tools that need a
            server or an AI provider still require a connection — each one says so.
          </p>
        </div>
      </div>
      <Button
        variant="primary"
        size="sm"
        className="shrink-0"
        onClick={async () => {
          await deferred.prompt();
          setDeferred(null);
        }}
      >
        Install
      </Button>
    </div>
  );
}
