import Link from "next/link";
import { ArrowRight, Cpu, CloudUpload, Lock } from "lucide-react";
import { CATEGORIES } from "@/lib/tools/categories";
import { PLATFORM_STATS, getCategoryCount } from "@/lib/tools/registry";
import { CategoryCard } from "@/components/tools/ToolCard";

/* ------------------------------------------------------------------ */
/*  Section shell                                                      */
/* ------------------------------------------------------------------ */

export function Section({
  id,
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={className}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          {eyebrow ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-brand-500">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-2xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-1 py-1 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:text-brand-500 sm:self-auto"
          >
            {action.label}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Categories                                                         */
/* ------------------------------------------------------------------ */

export function CategoriesSection() {
  return (
    <Section
      id="categories"
      eyebrow="Browse"
      title="Everything, by category"
      description="Seven focused collections. Pick a category or use the search box to jump straight to a tool."
    >
      <div className="grid-auto-fill-cats grid gap-3">
        {CATEGORIES.map((category) => (
          <CategoryCard
            key={category.slug}
            categorySlug={category.slug}
            toolCount={getCategoryCount(category.slug)}
          />
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Privacy strip                                                      */
/* ------------------------------------------------------------------ */

const PRIVACY_POINTS = [
  {
    icon: Cpu,
    title: "Runs on your device",
    body: `${PLATFORM_STATS.browserBased} tools decode and process your files in the browser tab. No upload, no queue, no server copy.`,
  },
  {
    icon: CloudUpload,
    title: "Says so when it uploads",
    body: `${PLATFORM_STATS.serverBacked} tools need a server or an AI provider. Those pages show an explicit notice above the workspace.`,
  },
  {
    icon: Lock,
    title: "Nothing kept",
    body: "We store tool metadata only — never your files, never the text you type. Local data lives in your browser and you can wipe it in one click.",
  },
] as const;

export function PrivacyStrip() {
  return (
    <Section
      eyebrow="Privacy"
      title="Where your files actually go"
      description="Every tool declares its processing mode, and the site reflects that declaration everywhere it appears."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {PRIVACY_POINTS.map((point) => (
          <div
            key={point.title}
            className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5"
          >
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-brand-500"
            >
              <point.icon className="size-4" />
            </span>
            <h3 className="mt-3.5 text-[14px] font-semibold text-[var(--text-ink)]">
              {point.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
              {point.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Closing CTA                                                        */
/* ------------------------------------------------------------------ */

export function ClosingCta() {
  return (
    <section className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-8 text-center sm:p-12">
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-2xl">
        Can&apos;t find the tool you need?
      </h2>
      <p className="mx-auto mt-2.5 max-w-lg text-[14px] leading-relaxed text-[var(--text-muted)]">
        Tell us what you&apos;re trying to do. Requests are read by a human and directly shape what
        gets built next.
      </p>
      <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
        <Link
          href="/request-tool"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-500 px-6 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          Request a tool
        </Link>
        <Link
          href="/tools"
          className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--surface-line-strong)] px-6 text-sm font-medium text-[var(--text-ink)] transition-colors hover:bg-[var(--surface-card-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          Browse all tools
        </Link>
      </div>
    </section>
  );
}
