import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolsBrowser } from "@/components/tools/ToolsBrowser";
import { JsonLd } from "@/components/layout/JsonLd";
import { CATEGORY_MAP, CATEGORY_ORDER, getToolsByCategory } from "@/lib/tools/registry";
import { breadcrumbJsonLd, categoryJsonLd, getCategoryMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";
import type { ToolCategory } from "@/lib/tools/types";

/** Only 7 known categories — everything else is a 404. */
export function generateStaticParams() {
  return CATEGORY_ORDER.map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  if (!isCategory(slug)) return { title: "Category not found" };
  return {
    ...getCategoryMetadata(slug),
    alternates: { canonical: CATEGORY_MAP[slug].route },
    openGraph: {
      ...getCategoryMetadata(slug).openGraph,
      url: `${SITE.url}${CATEGORY_MAP[slug].route}`,
    },
  };
}

function isCategory(value: string): value is ToolCategory {
  return (CATEGORY_ORDER as readonly string[]).includes(value);
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;
  if (!isCategory(slug)) notFound();

  const category = CATEGORY_MAP[slug];
  const tools = getToolsByCategory(slug);
  const popular = tools.filter((tool) => tool.popular);
  const rest = tools.filter((tool) => !tool.popular);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <JsonLd data={categoryJsonLd(slug)} />
      <JsonLd data={breadcrumbJsonLdFor(slug)} />

      <Breadcrumb
        className="mb-6"
        items={[{ label: "Home", href: "/" }, { label: "All Tools", href: "/tools" }, { label: category.name }]}
      />

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] text-brand-500"
        >
          <ToolIcon name={category.icon} size={22} />
        </span>
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-3xl">
            {category.name}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
            {category.blurb}
          </p>
        </div>
      </header>

      {popular.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-4 text-sm font-medium text-[var(--text-muted)]">
            Popular in {category.navLabel}
          </h2>
          <div className="grid-auto-fill-tools grid gap-3">
            {popular.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
          {rest.length > 0 ? (
            <>
              <h2 className="mb-4 mt-10 text-sm font-medium text-[var(--text-muted)]">
                All {category.navLabel.toLowerCase()} tools ({rest.length})
              </h2>
              <Suspense fallback={null}>
                <ToolsBrowser tools={rest} lockedCategory={slug} />
              </Suspense>
            </>
          ) : null}
        </section>
      ) : (
        <Suspense fallback={null}>
          <ToolsBrowser tools={tools} lockedCategory={slug} />
        </Suspense>
      )}
    </div>
  );
}

function breadcrumbJsonLdFor(slug: ToolCategory) {
  const category = CATEGORY_MAP[slug];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE.url}/` },
      { "@type": "ListItem", position: 2, name: "All Tools", item: `${SITE.url}/tools` },
      { "@type": "ListItem", position: 3, name: category.name, item: `${SITE.url}${category.route}` },
    ],
  };
}
