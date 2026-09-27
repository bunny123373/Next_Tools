import type { Metadata } from "next";
import { CATEGORY_MAP } from "@/lib/tools/categories";
import type { Tool } from "@/lib/tools/types";
import { PROCESSING_DESCRIPTION, PROCESSING_LABEL } from "@/lib/tools/types";
import { SITE, absoluteUrl } from "@/lib/site";

/* ------------------------------------------------------------------ */
/*  Per-page metadata                                                  */
/* ------------------------------------------------------------------ */

const MAX_DESCRIPTION = 158;

function clampDescription(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_DESCRIPTION) return clean;
  return `${clean.slice(0, MAX_DESCRIPTION - 1).replace(/[\s,.;:—-]+$/, "")}…`;
}

/**
 * Unique metadata for a tool page. The title and description are written for
 * the tool specifically — no shared boilerplate, no keyword stuffing.
 */
export function getToolMetadata(tool: Tool): Metadata {
  const category = CATEGORY_MAP[tool.category];
  const url = absoluteUrl(tool.route);
  const description = clampDescription(tool.description);
  const keywords = Array.from(
    new Set([
      ...tool.name.toLowerCase().split(/\s+/),
      `${tool.name.toLowerCase()} online`,
      `free ${tool.name.toLowerCase()}`,
      ...tool.keywords,
    ]),
  );

  return {
    title: `${tool.name} — Free Online Tool | ${SITE.name}`,
    description,
    keywords,
    alternates: { canonical: tool.route },
    openGraph: {
      type: "article",
      siteName: SITE.name,
      title: `${tool.name} — Free Online Tool | ${SITE.name}`,
      description,
      url,
      images: [{ url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: tool.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${tool.name} — Free Online Tool | ${SITE.name}`,
      description,
      images: [absoluteUrl("/opengraph-image")],
    },
  };
}

export function getCategoryMetadata(categorySlug: keyof typeof CATEGORY_MAP): Metadata {
  const category = CATEGORY_MAP[categorySlug];
  const description = clampDescription(
    `${category.blurb.split(". ")[0]}. Free, no sign-up, ${SITE.name}.`,
  );

  return {
    title: `${category.name} — Free Online ${category.navLabel} Tools`,
    description,
    keywords: [category.name.toLowerCase(), ...category.keywords],
    alternates: { canonical: category.route },
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title: `${category.name} | ${SITE.name}`,
      description,
      url: absoluteUrl(category.route),
    },
    twitter: {
      card: "summary_large_image",
      title: `${category.name} | ${SITE.name}`,
      description,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  JSON-LD                                                            */
/* ------------------------------------------------------------------ */

const FAQ_SCHEMA = "https://schema.org/FAQPage";
const BREADCRUMB_SCHEMA = "https://schema.org/BreadcrumbList";
const WEBSITE_SCHEMA = "https://schema.org/WebSite";
const SOFTWARE_SCHEMA = "https://schema.org/SoftwareApplication";

/** Site-wide WebSite + SearchAction. Rendered once, on the homepage. */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE.url}/#website`,
    name: SITE.name,
    alternateName: SITE.pitch,
    url: SITE.url,
    description: SITE.description,
    inLanguage: "en",
    publisher: { "@id": `${SITE.url}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE.url}/tools?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE.url}/#organization`,
    name: SITE.name,
    url: SITE.url,
    slogan: SITE.pitch,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icons/icon-512.png"),
      width: 512,
      height: 512,
    },
    sameAs: [SITE.social.github, SITE.social.youtube, SITE.social.instagram, SITE.social.x],
  };
}

/**
 * SoftwareApplication for a single tool.
 *
 * `offers` is deliberately Free/0 — we do not fabricate pricing tiers we have
 * not built. `isAccessibleForFree` reflects that no tool requires payment.
 */
export function softwareApplicationJsonLd(tool: Tool) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${absoluteUrl(tool.route)}#app`,
    name: tool.name,
    description: clampDescription(tool.description),
    url: absoluteUrl(tool.route),
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    featureList: tool.features,
    publisher: { "@id": `${SITE.url}/#organization` },
    isPartOf: { "@id": `${SITE.url}/#website` },
  };
}

export function breadcrumbJsonLd(tool: Tool) {
  const category = CATEGORY_MAP[tool.category];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "All Tools", item: absoluteUrl("/tools") },
      {
        "@type": "ListItem",
        position: 3,
        name: category.name,
        item: absoluteUrl(category.route),
      },
      {
        "@type": "ListItem",
        position: 4,
        name: tool.name,
        item: absoluteUrl(tool.route),
      },
    ],
  };
}

export function faqJsonLd(tool: Tool) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${absoluteUrl(tool.route)}#faq`,
    mainEntity: tool.faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function categoryJsonLd(categorySlug: keyof typeof CATEGORY_MAP) {
  const category = CATEGORY_MAP[categorySlug];
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: category.name,
    description: category.description,
    url: absoluteUrl(category.route),
    isPartOf: { "@id": `${SITE.url}/#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      numberOfItems: undefined,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export { FAQ_SCHEMA, BREADCRUMB_SCHEMA, WEBSITE_SCHEMA, SOFTWARE_SCHEMA };
export { PROCESSING_DESCRIPTION, PROCESSING_LABEL, clampDescription };
