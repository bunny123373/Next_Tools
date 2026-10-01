import type { MetadataRoute } from "next";
import { SITE, absoluteUrl } from "@/lib/site";
import { NOINDEX_ROUTES } from "@/lib/seo/routes";

/**
 * Private, per-user and operational areas are disallowed. Everything a visitor
 * is meant to find is allowed, including the tool pages themselves.
 *
 * The disallow list is derived from the same `NOINDEX_ROUTES` table the sitemap
 * is generated against. Two files hardcoding "what should not be crawled" is
 * how the sitemap came to list `/favorites` while this file forbade it.
 *
 * `disallow` is not the same thing as the `noindex` meta tag, and neither is a
 * substitute for the other — both are declared, because the routes that matter
 * here are gated by a cookie or by localStorage and should never be crawled at
 * all. Where a page is noindex *but* genuinely useful to crawl (a tool page
 * that needs configuration, say), it stays allowed here and is excluded from
 * the sitemap only if it is noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...NOINDEX_ROUTES.map((route) => route.path),
          // Query strings on /tools drive the client-side filter; the canonical
          // page is the bare path, so we keep them out of the index.
          "/tools?",
          "/tools/*?",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE.url,
  };
}
