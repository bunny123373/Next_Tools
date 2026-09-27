import type { Metadata } from "next";
import { CATEGORIES, TOOL_COUNT, getNewTools, getPopularTools } from "@/lib/tools/registry";
import { SITE } from "@/lib/site";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";
import { Hero } from "@/components/home/Hero";
import { CategoriesSection, ClosingCta, PrivacyStrip, Section } from "@/components/home/Sections";
import { InstallPrompt, TrendingRail, YourToolsRail } from "@/components/home/YourToolsRail";
import { ToolCard } from "@/components/tools/ToolCard";
import { JsonLd } from "@/components/layout/JsonLd";

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.pitch}`,
  description: `${TOOL_COUNT} fast, private, browser-based tools for images, PDFs, video, audio, text, AI and developers. No sign-up, no upload for most tools.`,
  alternates: { canonical: "/" },
};

/** Revalidate hourly; the registry only changes on deploy. */
export const revalidate = 3600;

export default function HomePage() {
  const popular = getPopularTools(8);
  const newest = getNewTools(6);

  return (
    <>
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={organizationJsonLd()} />

      <Hero />

      <div className="mx-auto flex max-w-[1400px] flex-col gap-16 px-4 py-14 sm:px-6 sm:py-16 lg:gap-20 lg:px-8">
        <YourToolsRail />
        <TrendingRail />

        <Section
          eyebrow="Popular"
          title="Popular tools"
          description="The ones people come back for. This list is curated by us, not generated from invented usage numbers."
          action={{ label: "All tools", href: "/tools" }}
        >
          <div className="grid-auto-fill-tools grid gap-3">
            {popular.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </Section>

        <CategoriesSection />

        <Section
          eyebrow="New"
          title="Recently added"
          description="The newest additions to the toolbox."
          action={{ label: "Browse everything", href: "/tools?sort=newest" }}
        >
          <div className="grid-auto-fill-tools grid gap-3">
            {newest.map((tool) => (
              <ToolCard key={tool.id} tool={tool} variant="dense" />
            ))}
          </div>
        </Section>

        <div className="flex flex-col gap-4">
          <InstallPrompt />
          <PrivacyStrip />
        </div>

        <ClosingCta />
      </div>

      <script
        type="application/ld+json"
        // Structured data for the category landing pages, emitted once here so
        // crawlers can see the full collection without visiting each page.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            CATEGORIES.map((category) => ({
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: category.name,
              description: category.description,
              url: `${SITE.url}${category.route}`,
              isPartOf: { "@id": `${SITE.url}/#website` },
            })),
          ),
        }}
      />
    </>
  );
}
