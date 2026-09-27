/**
 * Centralised tool registry.
 *
 * Definitions live in ./definitions/<category>.ts and are merged here. This
 * module is the only place tool data is assembled, and every consumer — tool
 * cards, search, categories, related tools, the sitemap, breadcrumbs, SEO
 * metadata and the tool page router — reads through the helpers below.
 *
 * This file is pure data + pure functions: no React, no Node APIs, no env
 * access, so it is safe to import from both Server and Client Components.
 */

import { CATEGORIES, CATEGORY_MAP, CATEGORY_ORDER, type Category } from "./categories";
import type { Tool, ToolCategory, ToolMap } from "./types";

import { AI_TOOLS } from "./definitions/ai";
import { AUDIO_TOOLS } from "./definitions/audio";
import { DEVELOPER_TOOLS } from "./definitions/developer";
import { IMAGE_TOOLS } from "./definitions/image";
import { PDF_TOOLS } from "./definitions/pdf";
import { TEXT_TOOLS } from "./definitions/text";
import { VIDEO_TOOLS } from "./definitions/video";

/** Every tool on the platform, grouped by category for a stable default order. */
export const TOOLS: readonly Tool[] = Object.freeze([
  ...IMAGE_TOOLS,
  ...PDF_TOOLS,
  ...VIDEO_TOOLS,
  ...AUDIO_TOOLS,
  ...TEXT_TOOLS,
  ...AI_TOOLS,
  ...DEVELOPER_TOOLS,
]);

/** id → tool. Built once at module load; O(1) lookups from here on. */
export const TOOL_MAP: ToolMap = Object.freeze(
  Object.fromEntries(TOOLS.map((tool) => [tool.id, tool])) as Record<string, Tool>,
);

/** route → tool, used by the dynamic tool page and the search results. */
export const TOOL_BY_ROUTE: Readonly<Record<string, Tool>> = Object.freeze(
  Object.fromEntries(TOOLS.map((tool) => [tool.route, tool])),
);

export const TOOL_COUNT = TOOLS.length;
export const CATEGORY_COUNT = CATEGORIES.length;

/* ------------------------------------------------------------------ */
/*  Basic lookups                                                      */
/* ------------------------------------------------------------------ */

export function getTool(id: string): Tool | undefined {
  return TOOL_MAP[id];
}

export function getToolByRoute(route: string): Tool | undefined {
  const normalised = route.length > 1 && route.endsWith("/") ? route.slice(0, -1) : route;
  return TOOL_BY_ROUTE[normalised];
}

export function isValidCategory(value: string): value is ToolCategory {
  return CATEGORY_ORDER.includes(value as ToolCategory);
}

export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function getToolsByCategory(category: ToolCategory): readonly Tool[] {
  return TOOLS.filter((tool) => tool.category === category);
}

export function getCategoryCount(category: ToolCategory): number {
  return getToolsByCategory(category).length;
}

export { CATEGORIES, CATEGORY_MAP, CATEGORY_ORDER, type Category };
/** Re-exported so consumers can import the type from one place. */
export type { Tool, ToolCategory, ToolIconName, ToolStatus, ProcessingMode } from "./types";

/* ------------------------------------------------------------------ */
/*  Curated rails                                                      */
/* ------------------------------------------------------------------ */

/**
 * Explicitly curated popular tools, in registry order.
 * This is editorial, not fabricated analytics — real usage ranking lives in
 * `useTrendingTools` and only ever reflects actual opens.
 */
export function getPopularTools(limit?: number): readonly Tool[] {
  const popular = TOOLS.filter((tool) => tool.popular);
  return limit ? popular.slice(0, limit) : popular;
}

/** Most recently added first, by `addedOn`. */
export function getNewTools(limit?: number): readonly Tool[] {
  const sorted = [...TOOLS].sort((a, b) => b.addedOn.localeCompare(a.addedOn));
  return limit ? sorted.slice(0, limit) : sorted;
}

export function getToolsAddedSince(isoDate: string): readonly Tool[] {
  return TOOLS.filter((tool) => tool.addedOn >= isoDate);
}

/* ------------------------------------------------------------------ */
/*  Related tools                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve a tool's `related` ids. Curated ids come first, then same-category
 * tools fill the remaining slots so a card is never rendered half-empty.
 */
export function getRelatedTools(tool: Tool, limit = 3): readonly Tool[] {
  const seen = new Set<string>([tool.id]);
  const out: Tool[] = [];

  for (const id of tool.related) {
    const candidate = TOOL_MAP[id];
    if (candidate && !seen.has(candidate.id)) {
      seen.add(candidate.id);
      out.push(candidate);
    }
    if (out.length >= limit) return out;
  }

  for (const candidate of getToolsByCategory(tool.category)) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
    if (out.length >= limit) break;
  }

  return out;
}

/** Sibling tools in the same category, excluding the current one. */
export function getCategoryTools(tool: Tool, limit?: number): readonly Tool[] {
  const siblings = getToolsByCategory(tool.category).filter((t) => t.id !== tool.id);
  return limit ? siblings.slice(0, limit) : siblings;
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

/** Flattened haystack built once — keeps keystroke search cheap. */
interface SearchEntry {
  tool: Tool;
  haystack: string;
  name: string;
}

const SEARCH_INDEX: readonly SearchEntry[] = TOOLS.map((tool) => ({
  tool,
  name: tool.name.toLowerCase(),
  haystack: [
    tool.name,
    tool.description,
    tool.intro,
    CATEGORY_MAP[tool.category].name,
    CATEGORY_MAP[tool.category].navLabel,
    ...tool.keywords,
    ...tool.features,
  ]
    .join(" ")
    .toLowerCase(),
}));

/**
 * Rank tools against a query.
 *
 * Scoring is intentionally transparent: exact name prefix > name substring >
 * keyword hit > description hit > fuzzy subsequence. There is no ML and no
 * network call, so search works offline and is fully explainable.
 */
export function searchTools(
  query: string,
  options: { category?: ToolCategory; limit?: number } = {},
): readonly Tool[] {
  const { category, limit = 24 } = options;
  const q = query.trim().toLowerCase();
  const pool = category ? getToolsByCategory(category) : TOOLS;

  if (!q) {
    return limit ? pool.slice(0, limit) : pool;
  }

  const terms = q.split(/\s+/).filter(Boolean);
  const scored: { tool: Tool; score: number }[] = [];

  for (const entry of SEARCH_INDEX) {
    if (category && entry.tool.category !== category) continue;

    let score = 0;
    let matchedAll = true;

    for (const term of terms) {
      let termScore = 0;

      if (entry.name === term) termScore += 200;
      else if (entry.name.startsWith(term)) termScore += 120;
      else if (entry.name.includes(term)) termScore += 70;

      const keywordIndex = entry.tool.keywords.findIndex((k) => k.toLowerCase().includes(term));
      if (keywordIndex >= 0) termScore += 40 - Math.min(keywordIndex, 10);

      if (termScore === 0 && entry.haystack.includes(term)) {
        // Weight the first occurrence by how early it appears.
        termScore = 20 - Math.min(Math.floor(entry.haystack.indexOf(term) / 60), 15);
      }

      if (termScore === 0) {
        termScore = fuzzyScore(entry.name, term) * 12;
        if (termScore === 0) termScore = fuzzyScore(entry.haystack, term) * 4;
      }

      if (termScore === 0) {
        matchedAll = false;
        break;
      }
      score += termScore;
    }

    if (!matchedAll) continue;

    // Small nudges so the curated rails stay visible near the top.
    if (entry.tool.popular) score += 6;
    if (score > 0) scored.push({ tool: entry.tool, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
  );

  return limit ? scored.slice(0, limit).map((s) => s.tool) : scored.map((s) => s.tool);
}

/**
 * Subsequence match with a contiguity bonus. Returns 0–1.
 * "jpgcmp" → "Image Compressor" scores well; "zzz" scores 0.
 */
export function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  if (haystack === needle) return 1;

  let hi = 0;
  let streak = 0;
  let hits = 0;
  let firstIndex = -1;

  for (let ni = 0; ni < needle.length; ni++) {
    const char = needle[ni]!;
    if (char === " ") continue;
    const found = haystack.indexOf(char, hi);
    if (found === -1) return 0;
    if (firstIndex === -1) firstIndex = found;
    streak = found === hi ? streak + 1 : 1;
    hits += 1;
    hi = found + 1;
  }

  const coverage = hits / needle.length;
  const spread = haystack.length > 0 ? 1 - Math.min(firstIndex / haystack.length, 1) : 0;
  return coverage * 0.6 + spread * 0.2 + (streak / needle.length) * 0.2;
}

/* ------------------------------------------------------------------ */
/*  Integrity checks (development + build)                            */
/* ------------------------------------------------------------------ */

export interface RegistryProblem {
  kind: "duplicate-id" | "duplicate-route" | "unknown-category" | "unknown-related" | "bad-slug" | "faq-too-short" | "missing-setup-note";
  detail: string;
}

/**
 * Validates registry invariants. Called from a dev-only check and surfaced on
 * /admin/tools so a malformed entry can't quietly ship.
 */
export function validateRegistry(): readonly RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const ids = new Set<string>();
  const routes = new Set<string>();

  for (const tool of TOOLS) {
    if (ids.has(tool.id)) problems.push({ kind: "duplicate-id", detail: tool.id });
    ids.add(tool.id);
    if (routes.has(tool.route)) problems.push({ kind: "duplicate-route", detail: tool.route });
    routes.add(tool.route);

    if (!CATEGORY_ORDER.includes(tool.category)) {
      problems.push({ kind: "unknown-category", detail: `${tool.id} → ${tool.category}` });
    }
    if (!isValidSlug(tool.slug)) {
      problems.push({ kind: "bad-slug", detail: `${tool.id} → ${tool.slug}` });
    }
    if (tool.status === "setup-required" && !tool.setupNote) {
      problems.push({ kind: "missing-setup-note", detail: tool.id });
    }
    if (tool.faq.length < 3) {
      problems.push({ kind: "faq-too-short", detail: `${tool.id} → ${tool.faq.length} entries` });
    }
    for (const id of tool.related) {
      if (!TOOL_MAP[id]) problems.push({ kind: "unknown-related", detail: `${tool.id} → ${id}` });
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/*  Counted stats for the homepage                                     */
/* ------------------------------------------------------------------ */

export const PLATFORM_STATS = Object.freeze({
  tools: TOOL_COUNT,
  categories: CATEGORY_COUNT,
  /**
   * Honest, statically-true claim: every tool in the registry is either
   * `local` or a provider-backed tool. We do not claim a percentage of tools
   * that run offline, because server-backed tools (AI) genuinely do not.
   */
  get browserBased() {
    return TOOLS.filter((tool) => tool.processing === "local").length;
  },
  get serverBacked() {
    return TOOLS.filter((tool) => tool.processing !== "local").length;
  },
});
