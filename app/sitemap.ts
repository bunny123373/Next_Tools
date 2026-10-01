import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";
import { buildSitemap } from "@/lib/seo/routes";

/**
 * The URL list and the `lastmod` values live in `@/lib/seo/routes` so that this
 * file and `robots.ts` cannot disagree about what is indexable — they did once,
 * and the sitemap advertised three pages that were explicitly `noindex`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap();
}

export const revalidate = 3600;

/** Exposed for the /api-docs page, which reports the real sitemap size. */
export const SITEMAP_ORIGIN = SITE.url;
