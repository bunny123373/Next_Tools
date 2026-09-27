import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleHelp, ListOrdered, Lock, ShieldCheck } from "lucide-react";

import { CATEGORY_MAP, TOOLS, getRelatedTools, getToolByRoute, isValidCategory } from "@/lib/tools/registry";
import { PROCESSING_DESCRIPTION, PROCESSING_LABEL } from "@/lib/tools/types";
import { breadcrumbJsonLd, faqJsonLd, getToolMetadata, softwareApplicationJsonLd } from "@/lib/seo";
import { resolveToolStatus } from "@/lib/tools/runtime";
import { JsonLd } from "@/components/layout/JsonLd";
import { ToolHeader } from "@/components/tools/ToolHeader";
import { ToolWorkspace } from "@/components/tools/workspaces/registry";
import { ToolCard } from "@/components/tools/ToolCard";
import { TrackToolView } from "@/components/user/TrackToolView";
import { ShareTool } from "@/components/tools/ShareTool";
import { Button } from "@/components/ui/button";

/**
 * Every tool page is statically generated from the registry, so the whole site
 * ships as HTML and each tool's code is a lazily loaded chunk on top.
 */
export function generateStaticParams() {
  // Take category and slug from the registry fields rather than re-parsing
  // `route`. An earlier version did `const [, category, slug] = route.split("/")`,
  // which silently took "tools" as the category and the real category as the
  // slug — collapsing all 100 tools onto a handful of wrong params and 404ing
  // every tool page.
  return TOOLS.map((tool) => ({ category: tool.category, slug: tool.slug }));
}

/** 404 for anything not in the registry, rather than a 200 with a shell. */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<Metadata> {
  const { category, slug } = await params;
  const tool = lookup(category, slug);
  if (!tool) return { title: "Tool not found" };
  return getToolMetadata(tool);
}

function lookup(category: string, slug: string) {
  if (!isValidCategory(category)) return undefined;
  return getToolByRoute(`/tools/${category}/${slug}`);
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;
  const tool = lookup(category, slug);
  if (!tool) notFound();

  const categoryInfo = CATEGORY_MAP[tool.category];
  // Server-side env check: a configured provider flips the badge automatically.
  const status = resolveToolStatus(tool);
  const related = getRelatedTools(tool, 3);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <JsonLd data={softwareApplicationJsonLd(tool)} />
      <JsonLd data={breadcrumbJsonLd(tool)} />
      <JsonLd data={faqJsonLd(tool)} />
      <TrackToolView toolId={tool.id} />

      <ToolHeader tool={tool} status={status} />

      <div className="mt-8">
        <ToolWorkspace tool={tool} />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/*  SEO + help content                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-12">
          <HowItWorks tool={tool} />
          <Features tool={tool} />
          <PrivacyBlock tool={tool} />
          <Faq tool={tool} />
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
            <h2 className="text-[13px] font-semibold text-[var(--text-ink)]">Keep exploring</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
              More {categoryInfo.navLabel.toLowerCase()} tools
            </p>
            <ul className="mt-3 grid gap-1">
              {getRelatedTools(tool, 5)
                .filter((item) => item.id !== tool.id)
                .slice(0, 4)
                .map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.route}
                      className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
                    >
                      <span className="truncate">{item.name}</span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </Link>
                  </li>
                ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              href={categoryInfo.route}
              className="mt-3 w-full"
            >
              All {categoryInfo.navLabel} tools
            </Button>
          </div>

          <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
            <h2 className="text-[13px] font-semibold text-[var(--text-ink)]">Share</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
              The link points at this tool&apos;s page only — never at your files or your input.
            </p>
            <div className="mt-3">
              <ShareTool path={tool.route} title={tool.name} text={tool.description} compact={false} />
            </div>
          </div>

          <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
            <h2 className="text-[13px] font-semibold text-[var(--text-ink)]">Missing something?</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
              Tell us what you were trying to do and we&apos;ll look at it.
            </p>
            <Button
              variant="ghost"
              size="sm"
              href={`/request-tool?tool=${encodeURIComponent(tool.name)}`}
              className="mt-2 -ml-2"
            >
              Request a tool
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </aside>
      </div>

      {/* Related tools, full width. */}
      {related.length > 0 ? (
        <section className="mt-16 border-t border-[var(--surface-line)] pt-10">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--text-ink)]">
            Related tools
          </h2>
          <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
            Frequently used alongside {tool.name.toLowerCase()}.
          </p>
          <div className="mt-5 grid-auto-fill-tools grid gap-3">
            {related.map((item) => (
              <ToolCard key={item.id} tool={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Content blocks                                                     */
/* ------------------------------------------------------------------ */

function HowItWorks({ tool }: { tool: (typeof TOOLS)[number] }) {
  return (
    <section aria-labelledby="how-it-works">
      <h2
        id="how-it-works"
        className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-[var(--text-ink)]"
      >
        <ListOrdered className="size-4 text-brand-500" aria-hidden="true" />
        How to use {tool.name}
      </h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {tool.howItWorks.map((step, index) => (
          <li
            key={index}
            className="flex gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] p-4"
          >
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-md border border-brand-500/30 bg-brand-500/10 font-mono text-[11px] font-semibold text-brand-500"
            >
              {index + 1}
            </span>
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{step}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Features({ tool }: { tool: (typeof TOOLS)[number] }) {
  return (
    <section aria-labelledby="features">
      <h2
        id="features"
        className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-[var(--text-ink)]"
      >
        <CheckCircle2 className="size-4 text-brand-500" aria-hidden="true" />
        Features
      </h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {tool.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-[13px] leading-relaxed">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-emerald-500"
            />
            <span className="text-[var(--text-muted)]">{feature}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrivacyBlock({ tool }: { tool: (typeof TOOLS)[number] }) {
  const local = tool.processing === "local";
  return (
    <section aria-labelledby="privacy">
      <h2
        id="privacy"
        className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-[var(--text-ink)]"
      >
        <ShieldCheck className="size-4 text-brand-500" aria-hidden="true" />
        Privacy
      </h2>
      <div
        className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${
          local
            ? "border-emerald-500/25 bg-emerald-500/[0.05]"
            : "border-amber-500/25 bg-amber-500/[0.05]"
        }`}
      >
        <Lock
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${local ? "text-emerald-500" : "text-amber-500"}`}
        />
        <div className="text-[13px] leading-relaxed">
          <p className={`font-medium ${local ? "text-emerald-500" : "text-amber-500"}`}>
            {PROCESSING_LABEL[tool.processing]}
          </p>
          <p className="mt-1 text-[var(--text-muted)]">{PROCESSING_DESCRIPTION[tool.processing]}</p>
          {local ? (
            <p className="mt-1.5 text-[var(--text-muted)]">
              We also record which tools you open and which files you process, but only as
              metadata in your own browser. Your file contents are never written to storage and
              never sent anywhere.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Faq({ tool }: { tool: (typeof TOOLS)[number] }) {
  return (
    <section aria-labelledby="faq">
      <h2
        id="faq"
        className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-[var(--text-ink)]"
      >
        <CircleHelp className="size-4 text-brand-500" aria-hidden="true" />
        Frequently asked questions
      </h2>
      <div className="mt-4 grid gap-2">
        {tool.faq.map((item, index) => (
          <details
            key={index}
            className="group rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-3.5 transition-colors hover:border-[var(--surface-line-strong)]"
          >
            <summary className="cursor-pointer list-none text-[14px] font-medium text-[var(--text-ink)] marker:content-none">
              <span className="flex items-start justify-between gap-3">
                <span>{item.question}</span>
                <span
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-45"
                >
                  +
                </span>
              </span>
            </summary>
            <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
