import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ToolsBrowser } from "@/components/tools/ToolsBrowser";
import { CATEGORIES, PLATFORM_STATS, TOOLS, TOOL_COUNT } from "@/lib/tools/registry";
import { breadcrumbJsonLd, clampDescription } from "@/lib/seo";
import { JsonLd } from "@/components/layout/JsonLd";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `All ${TOOL_COUNT} Free Online Tools`,
  description: clampDescription(
    `Browse all ${TOOL_COUNT} Balu Tools utilities across image, PDF, video, audio, text, AI and developer categories. Search, filter and sort.`,
  ),
  alternates: { canonical: "/tools" },
  openGraph: {
    type: "website",
    title: `All ${TOOL_COUNT} Free Online Tools | ${SITE.name}`,
    description: clampDescription(
      `Browse all ${TOOL_COUNT} Balu Tools utilities across ${CATEGORIES.length} categories.`,
    ),
    url: `${SITE.url}/tools`,
  },
};

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <JsonLd data={breadcrumbJsonLdForTools()} />

      <Breadcrumb
        className="mb-6"
        items={[{ label: "Home", href: "/" }, { label: "All Tools" }]}
      />

      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-3xl">
          All tools
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
          {TOOL_COUNT} utilities across {CATEGORIES.length} categories.{" "}
          {PLATFORM_STATS.browserBased} of them process your files entirely in your browser — the
          rest tell you plainly that they need a server.
        </p>
      </header>

      {/* useSearchParams needs a Suspense boundary to keep this page static. */}
      <Suspense
        fallback={
          <div className="grid-auto-fill-tools grid gap-3" aria-hidden="true">
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className="h-[7.5rem] animate-pulse rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]"
              />
            ))}
          </div>
        }
      >
        <ToolsBrowser tools={TOOLS} />
      </Suspense>
    </div>
  );
}

function breadcrumbJsonLdForTools() {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE.url}/` },
      { "@type": "ListItem", position: 2, name: "All Tools", item: `${SITE.url}/tools` },
    ],
  };
}
