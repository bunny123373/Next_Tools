/**
 * Locating text inside a PDF, without changing it.
 *
 * Shared by the two text tools, which deliberately promise different things:
 *
 *   `/tools/pdf/text-replacer` draws a box over the original and writes new
 *      text on top. It cannot corrupt the document because it never touches the
 *      existing content stream — but the original text REMAINS in the file,
 *      still copyable and still findable by search.
 *   `/tools/pdf/text-editor` rewrites the original text in place. That is a real
 *      edit, and it is correspondingly fragile; see `./pdf-content-edit.ts`.
 *
 * Both need the same first step: find the text runs and know where each one sits
 * on the page. That is what this file does, using pdf.js, which is already a
 * dependency and is the same renderer `pdf-to-text` uses. Reading is safe;
 * writing is where the two tools diverge.
 *
 * WHY RUNS, NOT WORDS: a pdf.js text item is whatever the producer happened to
 * emit as one `Tj`/`TJ` operation. A single word is very often split across two
 * of them, especially in justified text. Matching inside one run is therefore
 * conservative but reliable; matching across runs would need flow analysis and
 * would find things the file does not actually contain contiguously. The
 * find/replace tools say so on the results panel rather than silently missing
 * matches.
 */

import { withPdfJsDocument } from "./pdf";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One text-showing operation, with the geometry needed to draw over it or
 * report where it is.
 *
 * Coordinates are PDF user space: origin bottom-left, units of 1/72 inch.
 * That matches what pdf-lib's `drawText`/`drawRectangle` expect, so no
 * viewport conversion is needed when drawing.
 */
export interface TextRun {
  /** 0-based. */
  pageIndex: number;
  /** 0-based index within that page's text content, for stable identity. */
  itemIndex: number;
  /** The literal string pdf.js decoded for this operation. */
  str: string;
  /** Baseline start point, PDF user space. */
  x: number;
  y: number;
  /** Advance width and cap height as pdf.js reported them, in user-space units. */
  width: number;
  height: number;
  /** pdf.js font key, e.g. "g_d0_f1". Useful for grouping runs by typeface. */
  fontName: string;
  /** Marks a run whose glyphs are drawn individually; spacing heuristics differ. */
  hasEOL: boolean;
}

export interface RunMatch {
  run: TextRun;
  /** Character offsets into `run.str`. */
  start: number;
  end: number;
  /** The matched substring. */
  text: string;
}

export interface FindOptions {
  /** Empty or whitespace matches nothing — an empty needle would hit everywhere. */
  needle: string;
  /** Restrict to these 0-based page indices. Empty means every page. */
  pages?: readonly number[];
  caseSensitive?: boolean;
  /**
   * Match across the space pdf.js inserts between runs on the same line.
   *
   * Off by default. When on, a word split across two operations is found and the
   * caller is told it spans several runs, because replacing it cannot be done
   * inside a single string — which is precisely the case the true editor cannot
   * perform and the overlay tool can.
   */
  joinRuns?: boolean;
}

export interface FindResult {
  matches: RunMatch[];
  /** Matches that only exist because runs were joined. */
  joinedMatches: RunMatch[];
  runsScanned: number;
  pagesScanned: number;
}

/* -------------------------------------------------------------------------- */
/*  Extraction                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every text run in the document, in reading order.
 *
 * Trailing whitespace is trimmed from `str` and the width is scaled to match.
 * That matters because producers routinely emit a space at the end of a run for
 * justification; keeping it would produce phantom matches on "the " twice and
 * put the drawn box a fraction too wide.
 */
export async function extractTextRuns(source: Blob): Promise<TextRun[]> {
  return withPdfJsDocument(source, async (doc) => {
    const runs: TextRun[] = [];

    for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex += 1) {
      const page = await doc.getPage(pageIndex + 1);
      try {
        const content = await page.getTextContent();

        content.items.forEach((item, itemIndex) => {
          // getTextContent returns a union; only the text-bearing member has `str`.
          if (!("str" in item)) return;

          const raw = item.str;
          if (!raw || raw.trim() === "") return;

          const trimmed = raw.replace(/\s+$/, "");
          if (trimmed === "") return;

          const droppedFraction = raw.length === 0 ? 0 : 1 - trimmed.length / raw.length;

          runs.push({
            pageIndex,
            itemIndex,
            str: trimmed,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width * (1 - droppedFraction),
            height: item.height,
            fontName: item.fontName,
            hasEOL: item.hasEOL,
          });
        });
      } finally {
        page.cleanup();
      }
    }

    return runs;
  });
}

/* -------------------------------------------------------------------------- */
/*  Finding                                                                   */
/* -------------------------------------------------------------------------- */

/** Stable identity for a run, used as a React key and in result tables. */
export function runKey(run: TextRun): string {
  return `${run.pageIndex}:${run.itemIndex}`;
}

/**
 * Finds every occurrence of `needle`.
 *
 * Matching is per-run, and a run is the smallest unit a PDF can actually be
 * edited at. That is a deliberate limit, not a shortcut: a substring that only
 * appears when two runs are glued together does not exist as one string in the
 * file, so the true editor cannot change it without rewriting both operations
 * and reflowing the line.
 */
export function findText(runs: readonly TextRun[], options: FindOptions): FindResult {
  const needle = options.needle.trim();
  if (needle === "") {
    return { matches: [], joinedMatches: [], runsScanned: runs.length, pagesScanned: 0 };
  }

  const pages = options.pages;
  const caseSensitive = options.caseSensitive ?? false;
  const haystackNeedle = caseSensitive ? needle : needle.toLowerCase();

  const matches: RunMatch[] = [];
  const joinedMatches: RunMatch[] = [];
  let pagesScanned = 0;
  const seenPages = new Set<number>();

  for (const run of runs) {
    if (pages && pages.length > 0 && !pages.includes(run.pageIndex)) continue;
    if (!seenPages.has(run.pageIndex)) {
      seenPages.add(run.pageIndex);
      pagesScanned += 1;
    }

    const haystack = caseSensitive ? run.str : run.str.toLowerCase();
    let from = 0;

    for (;;) {
      const at = haystack.indexOf(haystackNeedle, from);
      if (at === -1) break;
      matches.push({
        run,
        start: at,
        end: at + needle.length,
        text: run.str.slice(at, at + needle.length),
      });
      from = at + Math.max(1, needle.length);
    }
  }

  if (options.joinRuns) {
    joinedMatches.push(...findAcrossRuns(runs, needle, caseSensitive, pages));
  }

  return { matches, joinedMatches, runsScanned: runs.length, pagesScanned };
}

/**
 * Finds needles that straddle a run boundary on the same baseline.
 *
 * Only runs that share a page AND a baseline are joined. Anything looser would
 * match two words from different columns, which is a false positive of exactly
 * the kind that makes a find-and-replace tool untrustworthy.
 */
function findAcrossRuns(
  runs: readonly TextRun[],
  needle: string,
  caseSensitive: boolean,
  pages: readonly number[] | undefined,
): RunMatch[] {
  const byLine = new Map<string, TextRun[]>();

  for (const run of runs) {
    if (pages && pages.length > 0 && !pages.includes(run.pageIndex)) continue;
    // Half a point of tolerance: producers place successive runs on the same
    // line with tiny floating-point differences.
    const key = `${run.pageIndex}:${run.y.toFixed(1)}`;
    const list = byLine.get(key);
    if (list) list.push(run);
    else byLine.set(key, [run]);
  }

  const results: RunMatch[] = [];

  // Lower-cased copy of the needle, computed once. Declaring a second `needle`
  // here would shadow the parameter and reference it in its own initializer.
  const haystackNeedle = caseSensitive ? needle : needle.toLowerCase();

  for (const line of byLine.values()) {
    if (line.length < 2) continue;
    line.sort((a, b) => a.x - b.x);

    for (let i = 0; i < line.length - 1; i += 1) {
      const head = line[i]!;
      const tail = line[i + 1]!;
      const combined = `${head.str}${tail.str}`;
      const haystack = caseSensitive ? combined : combined.toLowerCase();

      const at = haystack.indexOf(haystackNeedle);
      // Only report a boundary-spanning hit: the needle must cross the join.
      if (at === -1 || at + haystackNeedle.length <= head.str.length) continue;

      results.push({
        run: head,
        start: at,
        end: at + haystackNeedle.length,
        text: combined.slice(at, at + haystackNeedle.length),
      });
    }
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/*  Presentation helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Group matches by page, preserving document order, for a readable results list. */
export function groupMatchesByPage(matches: readonly RunMatch[]): { pageIndex: number; items: RunMatch[] }[] {
  const grouped = new Map<number, RunMatch[]>();

  for (const match of matches) {
    const list = grouped.get(match.run.pageIndex);
    if (list) list.push(match);
    else grouped.set(match.run.pageIndex, [match]);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageIndex, items]) => ({ pageIndex, items }));
}

/** A short snippet around a match, with the match itself marked out. */
export function snippetFor(match: RunMatch, radius = 32): { before: string; match: string; after: string } {
  const { start, end, text, run } = match;
  const from = Math.max(0, start - radius);
  const to = Math.min(run.str.length, end + radius);

  return {
    before: (from > 0 ? "…" : "") + run.str.slice(from, start),
    match: text,
    after: run.str.slice(end, to) + (to < run.str.length ? "…" : ""),
  };
}