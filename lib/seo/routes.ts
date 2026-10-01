/**
 * The sitemap and robots.txt are generated from the registry, so a new tool is
 * indexed the moment it is added to `lib/tools/definitions/`. No manual upkeep.
 *
 * This module exists because the two files disagreed. The sitemap listed
 * `/favorites`, `/recent` and `/dashboard` while those pages each carried
 * `robots: { index: false }` — a direct instruction to a crawler to ignore a
 * URL it was simultaneously being told to fetch. Search engines resolve that
 * against the site, and a sitemap that contradicts itself is worth less than no
 * sitemap at all.
 *
 * So the indexability decision is declared once, here, and consumed by both
 * files. `scripts/check-seo.mjs` then re-derives it from the page sources and
 * fails if the two ever diverge again — the check is what makes the shared
 * module trustworthy rather than just tidy.
 */

import type { MetadataRoute } from "next";
import { CATEGORIES, TOOLS } from "@/lib/tools/registry";
import { absoluteUrl } from "@/lib/site";

type Frequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

/**
 * Routes that must never appear in a sitemap, with the reason each is excluded.
 *
 * The `why` is load-bearing. `scripts/check-seo.mjs` cross-checks this list
 * against the `robots` metadata in each page, so an entry added here that does
 * not match the page — or a page that gains `index: false` without a matching
 * entry here — is a build failure rather than a silent contradiction.
 */
export const NOINDEX_ROUTES: readonly { path: string; why: string }[] = [
  { path: "/admin", why: "operational area, gated by a session cookie" },
  { path: "/admin/requests", why: "operational area, gated by a session cookie" },
  { path: "/admin/settings", why: "operational area, gated by a session cookie" },
  { path: "/admin/tools", why: "operational area, gated by a session cookie" },
  { path: "/dashboard", why: "per-user history; empty and identical for crawlers" },
  { path: "/favorites", why: "per-user, stored in localStorage" },
  { path: "/recent", why: "per-user, stored in localStorage" },
  { path: "/offline", why: "PWA fallback shell, served only when the app is unreachable" },
] as const;

/* -------------------------------------------------------------------------- */
/* lastmod                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `lastModified` is derived from the registry rather than from `new Date()`.
 *
 * The previous version stamped the current time on every URL on every request.
 * That is not merely imprecise, it is the specific thing crawlers are told not
 * to do: a site where all 120 pages claim to have changed at the moment the
 * sitemap was fetched gets crawled less efficiently than a site that omits the
 * field, and it teaches the crawler that this site's `lastmod` is meaningless.
 *
 * Two honest values are available, and only two:
 *
 *  - A tool page's last real change is the tool's own `addedOn`, which is real
 *    data recorded when the tool was written.
 *  - A page whose visible content is derived from the registry changes exactly
 *    when the registry changes, so the newest `addedOn` in scope is its true
 *    last modification.
 *
 * For the hand-written pages — privacy, terms, about — neither applies. Their
 * edit dates are not recorded anywhere in the repo, so inventing one would be
 * guessing. They carry no `lastmod` at all, which is the documented way to say
 * "I don't know" and is strictly better than a wrong answer.
 */
function registryDate(scope?: readonly { addedOn: string }[]): Date {
  const source = scope ?? TOOLS;
  return new Date(source.reduce((latest, t) => (t.addedOn > latest ? t.addedOn : latest), ""));
}

/* -------------------------------------------------------------------------- */
/* sitemap                                                                      */
/* -------------------------------------------------------------------------- */

type StaticRoute = {
  path: string;
  changeFrequency: Frequency;
  priority: number;
  /** Omitted where the true modification date is not knowable. See above. */
  lastModified?: Date;
};

/**
 * The hand-maintained pages. Kept as a table rather than a literal array
 * because the columns are now reasoned about individually — the previous flat
 * list gave `/favorites` the same treatment as `/tools` without anyone reading
 * it noticing.
 *
 * `/pricing`, `/api-docs` and `/tool-builder` were missing entirely. All three
 * are indexable (and `/tool-builder` says so explicitly), so they were simply
 * unreachable through the sitemap.
 */
const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: "/", changeFrequency: "weekly", priority: 1, lastModified: registryDate() },
  { path: "/tools", changeFrequency: "weekly", priority: 0.9, lastModified: registryDate() },
  { path: "/faq", changeFrequency: "monthly", priority: 0.6, lastModified: registryDate() },
  { path: "/request-tool", changeFrequency: "monthly", priority: 0.5 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.5 },
  { path: "/api-docs", changeFrequency: "monthly", priority: 0.5 },
  { path: "/tool-builder", changeFrequency: "monthly", priority: 0.5 },
  { path: "/about", changeFrequency: "yearly", priority: 0.4 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
] as const;

/**
 * `priority` and `changeFrequency` are advisory only. Google has ignored both
 * since 2015 and says so in its own documentation; other engines use them, so
 * they are kept, but they are relative hints, not a ranking instruction.
 */
export function buildSitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    ...(route.lastModified ? { lastModified: route.lastModified } : {}),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const categoryRoutes: MetadataRoute.Sitemap = CATEGORIES.map((category) => {
    const inCategory = TOOLS.filter((tool) => tool.category === category.slug);
    return {
      url: absoluteUrl(category.route),
      // A category page lists its tools, so its last change is the newest tool
      // in it. Scoped rather than global: a new audio tool does not modify the
      // image category page, and claiming otherwise is the same error at a
      // smaller scale.
      lastModified: registryDate(inCategory.length ? inCategory : undefined),
      changeFrequency: "weekly" as Frequency,
      priority: 0.8,
    };
  });

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

/** Paths in the sitemap, for the seo check to compare against page sources. */
export function sitemapPaths(): string[] {
  return buildSitemap().map((entry) => new URL(entry.url).pathname);
}
