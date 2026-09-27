import type { Metadata } from "next";
import { CATEGORIES, PLATFORM_STATS, TOOL_COUNT } from "@/lib/tools/registry";
import { Button } from "@/components/ui/button";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { ToolCard } from "@/components/tools/ToolCard";
import { getPopularTools } from "@/lib/tools/registry";

export const metadata: Metadata = {
  title: "You're offline",
  description: "The Balu Tools shell could not be loaded from the network or the offline cache.",
  robots: { index: false, follow: false },
};

/**
 * Served as a fallback by the service worker when both the network and the
 * cache miss. Deliberately renders a handful of real links so a visitor who
 * lands here can still navigate if the shell becomes available.
 */
export default function OfflinePage() {
  const popular = getPopularTools(6);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/[0.05] p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)]">
          You&apos;re offline
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
          The interface could not be loaded from the network, and this page is not in the offline
          cache yet. Visit Balu Tools once while connected and the app shell will be available
          offline from then on.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" href="/">
            Try again
          </Button>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">Categories</h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATEGORIES.map((category) => (
            <li key={category.slug}>
              <a
                href={category.route}
                className="flex items-center gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-3 py-2.5 text-[13px] text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)]"
              >
                <span aria-hidden="true" className="text-[var(--text-muted)]">
                  <ToolIcon name={category.icon} size={14} />
                </span>
                {category.navLabel}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">Popular tools</h2>
        <div className="mt-3 grid-auto-fill-tools grid gap-3">
          {popular.map((tool) => (
            <ToolCard key={tool.id} tool={tool} variant="dense" />
          ))}
        </div>
      </section>

      <p className="mt-8 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Note that tools which need a server or an AI provider do not work offline, whatever the
        interface does. {PLATFORM_STATS.browserBased} of the {TOOL_COUNT} tools process files
        entirely on your device and will keep working with no connection at all.
      </p>
    </div>
  );
}
