import Link from "next/link";
import { Home, Search } from "lucide-react";
import { CATEGORIES } from "@/lib/tools/categories";
import { Button } from "@/components/ui/button";
import { ToolIcon } from "@/components/tools/ToolIcon";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <p className="font-mono text-5xl font-semibold tabular-nums text-brand-500">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-3xl">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--text-muted)]">
        The link may be out of date, or the tool may have been renamed. Everything currently
        available is one click away below.
      </p>

      <div className="mt-7 flex flex-col items-stretch gap-2 sm:flex-row">
        <Button variant="primary" href="/">
          <Home className="size-4" aria-hidden="true" />
          Go home
        </Button>
        <Button variant="secondary" href="/tools">
          <Search className="size-4" aria-hidden="true" />
          Browse all tools
        </Button>
      </div>

      <nav aria-label="Categories" className="mt-10 w-full">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Categories
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CATEGORIES.map((category) => (
            <li key={category.slug}>
              <Link
                href={category.route}
                className="flex items-center gap-2.5 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-3 py-2.5 text-left transition-colors hover:border-[var(--surface-line-strong)]"
              >
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]"
                >
                  <ToolIcon name={category.icon} size={13} />
                </span>
                <span className="truncate text-[13px] text-[var(--text-ink)]">
                  {category.navLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
