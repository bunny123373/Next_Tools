import type { MetadataRoute } from "next";
import { CATEGORIES, TOOLS } from "@/lib/tools/registry";
import { SITE, absoluteUrl } from "@/lib/site";

/**
 * Sitemap is generated from the registry, so a new tool is indexed the moment
 * it is added to `lib/tools/definitions/`. No manual maintenance.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/tools"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/favorites"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/recent"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/dashboard"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/request-tool"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/faq"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/about"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: absoluteUrl("/contact"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: absoluteUrl("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
  ];

  const categoryRoutes: MetadataRoute.Sitemap = CATEGORIES.map((category) => ({
    url: absoluteUrl(category.route),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const toolRoutes: MetadataRoute.Sitemap = TOOLS.map((tool) => ({
    url: absoluteUrl(tool.route),
    lastModified: new Date(tool.addedOn),
    changeFrequency: "monthly",
    // Setup-required tools are still worth indexing: the page explains the
    // requirement, which is genuinely useful to someone researching the tool.
    priority: tool.popular ? 0.8 : 0.6,
  }));

  return [...staticRoutes, ...categoryRoutes, ...toolRoutes];
}

export const revalidate = 3600;

/** Exposed for the /api-docs page, which reports the real sitemap size. */
export const SITEMAP_ORIGIN = SITE.url;
