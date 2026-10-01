/**
 * Keeps the sitemap, robots.txt and the pages' own `index` directives in
 * agreement.
 *
 * This check exists because they once did not. The sitemap advertised
 * `/favorites`, `/recent` and `/dashboard` while each of those pages declared
 * `robots: { index: false }` — the site was asking a crawler to fetch three
 * URLs it had been told to ignore. Nothing errored, the build was green, and
 * the contradiction only showed up as worse indexing than the site deserved.
 *
 * Three invariants, all derived from source rather than asserted by hand:
 *
 *  1. NOINDEX_ROUTES (lib/seo/routes.ts) lists exactly the pages that resolve
 *     to index: false, walking the layout chain the way Next.js metadata does.
 *  2. No noindex route appears in the sitemap; no indexable page is missing
 *     from it. /pricing, /api-docs and /tool-builder were absent for years of
 *     "working" this way.
 *  3. No duplicate URLs, no future lastmod, and the sitemap origin is the real
 *     deployment rather than localhost — which is what NEXT_PUBLIC_SITE_URL is
 *     currently set to on the live host, so this check fails until that is
 *     corrected.
 *
 * Run: node scripts/check-seo.mjs   (add BASE_URL to also hit a live server)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = "app";
const SEO_MODULE = "lib/seo/routes.ts";
const CATEGORIES = "lib/tools/categories.ts";
const DEFINITIONS = "lib/tools/definitions";

const problems = [];
const fail = (msg) => problems.push(msg);

let checks = 0;
const check = (label, ok, detail) => {
  checks += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) fail(label);
};

/* ── page routes and their effective index directive ─────────────────────── */

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** `robots: { index: false, ... }` in a metadata block, or undefined. */
function indexDirective(source) {
  const block = /robots:\s*\{([^}]*)\}/.exec(source);
  if (!block) return undefined;
  const value = /index:\s*(true|false)/.exec(block[1]);
  return value ? value[1] === "true" : undefined;
}

/**
 * Next.js merges metadata down the layout chain, with the nearest definition
 * winning. The root layout says index: true; app/admin/layout.tsx says false
 * for everything beneath it. A page with no directive of its own is only
 * noindex if some ancestor said so — which is how the four /admin routes are
 * covered without repeating themselves in four places.
 */
function effectiveIndex(pagePath) {
  const parts = relative(APP, pagePath).split(/[\\/]/);
  parts.pop(); // drop page.tsx, leaving the directories above it

  let index = true; // the root layout's own value
  const chain = [join(APP, "layout.tsx")];
  let prefix = APP;
  for (const segment of parts) {
    prefix = join(prefix, segment);
    chain.push(join(prefix, "layout.tsx"));
  }

  for (const layout of chain) {
    if (!existsSync(layout)) continue;
    const value = indexDirective(readFileSync(layout, "utf8"));
    if (value !== undefined) index = value;
  }

  // A page-level directive overrides everything above it.
  const own = indexDirective(readFileSync(pagePath, "utf8"));
  return own ?? index;
}

/** "/tools/[category]/[slug]" → "/tools/:category/:slug" */
function routeOf(pagePath) {
  const dir = relative(APP, join(pagePath, ".."));
  return "/" + dir.split(/[\\/]/).map((s) => (s.startsWith("[") ? `:${s}` : s)).join("/");
}

const pages = walk(APP)
  .filter((p) => p.endsWith("page.tsx"))
  .map((p) => ({ file: p, route: routeOf(p), index: effectiveIndex(p) }));

/** Dynamic routes are matched by prefix; a concrete sitemap entry never collides. */
const isDynamic = (route) => route.includes(":");
const coveredByDynamic = (route) =>
  pages.some((p) => isDynamic(p.route) && p.route.split("/").every((seg, i) => seg.startsWith(":") || seg === route.split("/")[i]));

/* ── what the sitemap module declares ────────────────────────────────────── */

const seo = readFileSync(SEO_MODULE, "utf8");

/**
 * Pulls the `path` fields out of one array literal in lib/seo/routes.ts.
 *
 * Anchored on `= [` rather than the first `[`, because every one of these
 * declarations carries a type annotation that itself contains brackets —
 * `readonly { path: string; why: string }[]` — and reading that as the array
 * yields an empty list. An empty list then makes every check below vacuously
 * true, which is the worst failure mode a check can have, so the count is
 * asserted rather than assumed.
 */
function declaredPaths(arrayName) {
  const start = seo.indexOf(`const ${arrayName}`);
  if (start === -1) {
    fail(`${arrayName} is not declared in ${SEO_MODULE}`);
    return [];
  }
  const open = seo.indexOf("= [", start);
  const close = seo.indexOf("\n]", open);
  if (open === -1 || close === -1) {
    fail(`could not read the ${arrayName} literal from ${SEO_MODULE}`);
    return [];
  }
  const paths = [...seo.slice(open, close).matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) {
    fail(`${arrayName} parsed as empty — the check below it would pass for the wrong reason`);
  }
  return paths;
}

const declaredNoindex = declaredPaths("NOINDEX_ROUTES");
const declaredStatic = declaredPaths("STATIC_ROUTES");

/** Routes the registry contributes: categories and tools. */
const categoryRoutes = [
  ...[...readFileSync(CATEGORIES, "utf8").matchAll(/^\s{4}route:\s*"([^"]+)",/gm)].map((m) => m[1]),
];
const definitionSources = readdirSync(DEFINITIONS)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .map((f) => readFileSync(join(DEFINITIONS, f), "utf8"));
const toolRoutes = definitionSources.flatMap((src) =>
  [...src.matchAll(/^\s{4}route:\s*"([^"]+)",/gm)].map((m) => m[1]),
);

const sitemapRoutes = [...declaredStatic, ...categoryRoutes, ...toolRoutes];

/* ── 1. NOINDEX_ROUTES matches the pages ─────────────────────────────────── */

console.log(`\n${pages.length} page routes, ${sitemapRoutes.length} sitemap URLs\n`);
console.log("=== noindex routes agree with the pages ===\n");

const actualNoindex = pages.filter((p) => !p.index).map((p) => p.route).sort();
const listedNoindex = [...new Set(declaredNoindex)].sort();

check(
  "every noindex page is in NOINDEX_ROUTES",
  actualNoindex.every((r) => listedNoindex.includes(r)),
  actualNoindex.filter((r) => !listedNoindex.includes(r)).join(", ") || `${actualNoindex.length} routes`,
);
check(
  "every NOINDEX_ROUTES entry really is a noindex page",
  listedNoindex.every((r) => actualNoindex.includes(r)),
  listedNoindex.filter((r) => !actualNoindex.includes(r)).join(", ") || undefined,
);

/* ── 2. the two lists do not overlap ─────────────────────────────────────── */

console.log("\n=== the sitemap and the noindex list do not overlap ===\n");

const noindexInSitemap = sitemapRoutes.filter((r) => listedNoindex.includes(r));
check(
  "no noindex route is advertised for indexing",
  noindexInSitemap.length === 0,
  noindexInSitemap.join(", ") || undefined,
);

/* ── 3. every indexable page is reachable through the sitemap ────────────── */

console.log("\n=== every indexable page is in the sitemap ===\n");

const missing = pages
  .filter((p) => p.index && !sitemapRoutes.includes(p.route) && !coveredByDynamic(p.route))
  .map((p) => p.route);
check(
  "no indexable page is missing",
  missing.length === 0,
  missing.join(", ") || `${pages.filter((p) => p.index).length} indexable pages`,
);

/* ── 4. the sitemap is internally consistent ─────────────────────────────── */

console.log("\n=== the sitemap is well-formed ===\n");

const duplicates = sitemapRoutes.filter((r, i) => sitemapRoutes.indexOf(r) !== i);
check("no duplicate URLs", duplicates.length === 0, [...new Set(duplicates)].join(", ") || undefined);

/* lastmod comes from `addedOn`, so a typo'd or future date would be served to
 * crawlers as a real signal. Every tool route uses one, so check them all. */
const addedDates = definitionSources.flatMap((src) =>
  [...src.matchAll(/^\s{4}addedOn:\s*"([^"]+)",/gm)].map((m) => m[1]),
);
const future = addedDates.filter((d) => new Date(d) > new Date());
const unparseable = addedDates.filter((d) => Number.isNaN(new Date(d).valueOf()));
check("no lastmod is in the future", future.length === 0, future.join(", ") || `${addedDates.length} dates`);
check("every lastmod is a real date", unparseable.length === 0, unparseable.join(", ") || undefined);

const fallback = /requiredUrl\(\s*process\.env\.NEXT_PUBLIC_SITE_URL,\s*"([^"]+)"/.exec(
  readFileSync("lib/site.ts", "utf8"),
)?.[1];
check(
  "the sitemap fallback origin is the real deployment",
  Boolean(fallback) && !/localhost|127\.0\.0\.1|example/.test(fallback),
  fallback ?? "could not read it from lib/site.ts",
);

/* ── 5. optional: what the running server actually serves ────────────────── */

const BASE = process.env.BASE_URL ?? process.env.SITE_URL_CHECK;
if (BASE) {
  console.log(`\n=== what ${BASE} actually serves ===\n`);
  try {
    const served = new URL(BASE);
    const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    check("the served sitemap is not empty", urls.length > 0, `${urls.length} <loc> entries`);
    check("the served sitemap has no duplicates", new Set(urls).size === urls.length);

    /* Origin agreement, not a blanket "no localhost".
     *
     * Locally the sitemap is *correctly* full of localhost: NEXT_PUBLIC_SITE_URL
     * is set to http://localhost:3000 in .env.local and the override is doing
     * its job. What matters is that the origin in the sitemap is the origin
     * being served.
     *
     * That is precisely what the live host gets wrong. NEXT_PUBLIC_SITE_URL is
     * set to http://localhost:3000 in Vercel's environment too, so every
     * canonical tag, every og:url, the robots.txt Host line and all 119 sitemap
     * entries point at a dev server that does not exist for a crawler. Run this
     * with BASE_URL=https://101plus.vercel.app and it fails.
     */
    const origins = new Set(urls.map((u) => new URL(u).origin));
    check(
      "the sitemap uses the origin being served",
      origins.size === 1 && [...origins][0] === served.origin,
      `served ${served.origin}, sitemap uses ${[...origins].join(", ")}`,
    );

    check(
      "the served sitemap has no noindex route",
      !urls.some((u) => listedNoindex.includes(new URL(u).pathname)),
      urls.filter((u) => listedNoindex.includes(new URL(u).pathname)).join(", ") || undefined,
    );

    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    const missingDisallow = listedNoindex.filter(
      (route) =>
        !new RegExp(`^Disallow:\\s*${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(robots),
    );
    check(
      "robots.txt disallows every noindex route",
      missingDisallow.length === 0,
      missingDisallow.join(", ") || `${listedNoindex.length} routes`,
    );
    check(
      "robots.txt advertises the sitemap on the right origin",
      robots.includes(`${served.origin}/sitemap.xml`),
      `${served.origin}/sitemap.xml`,
    );
  } catch (error) {
    console.log(`  (skipped — ${error instanceof Error ? error.message : error})`);
  }
}

console.log(
  problems.length === 0
    ? `\n✓ ${checks} check(s) passed — the sitemap and the pages agree\n`
    : `\n${problems.length} problem(s)\n  ${problems.join("\n  ")}\n`,
);
process.exit(problems.length === 0 ? 0 : 1);
