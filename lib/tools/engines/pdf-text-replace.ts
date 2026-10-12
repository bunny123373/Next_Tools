/**
 * Overlay text replacement.
 *
 * HOW IT WORKS, and what it therefore cannot do: the original page content is
 * left completely untouched. A filled rectangle is drawn over the text, and
 * the replacement is drawn on top. Nothing existing is rewritten, so this can
 * never corrupt a document — verified against a real load/modify/save cycle
 * before this file existed.
 *
 * THE HONEST LIMIT: **the original text is still in the file.** It stays
 * selectable, copyable, and findable by any search. Someone who opens the
 * result in an editor and deletes the overlay gets the original straight back.
 * This is a drafting and find-and-replace aid. It is NOT redaction, and it must
 * never be described as one — real redaction has to remove the content, which
 * is what `./pdf-content-edit.ts` attempts and why that one is riskier.
 *
 * The UI says this on the result panel, not only in the FAQ, because a user who
 * redacts a bank statement with this tool and ships it has a problem.
 */

import { PDFDocument, rgb, type PDFFont, type RGB } from "pdf-lib";

import type { RunMatch, TextRun } from "./pdf-text";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type OverlayFont = "helvetica" | "times" | "courier";

export interface OverlayOptions {
  /** Colour painted over the original. White suits virtually every document. */
  background?: RGB;
  textColor?: RGB;
  font?: OverlayFont;
  bold?: boolean;
  /**
   * Shrink the replacement to the width of the text it covers.
   *
   * On by default. Without it a longer replacement overflows into whatever sits
   * to its right, which is how "replace Invoice with Invoice Number" quietly
   * ruins a layout. The size never grows past the original, so text cannot
   * suddenly become larger than its surroundings.
   */
  fitToOriginalWidth?: boolean;
  /** Floor for the shrink, as a fraction of the original size. */
  minSizeRatio?: number;
}

export interface AppliedReplacement {
  pageIndex: number;
  /** 1-based, for display. */
  pageNumber: number;
  before: string;
  after: string;
  /** Original font height in user-space units. */
  fontSize: number;
  /** Size actually drawn, after any shrink to fit. */
  drawnSize: number;
  /** True when the replacement could not fit and was allowed to overflow. */
  overflowed: boolean;
}

export interface OverlayResult {
  bytes: Uint8Array;
  applied: AppliedReplacement[];
  /** Matches the caller asked for that could not be drawn. */
  skipped: { pageIndex: number; itemIndex: number; reason: string }[];
}

/* -------------------------------------------------------------------------- */
/*  Font selection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Maps a chosen family onto a concrete Standard Font.
 *
 * The 14 standard fonts are used rather than embedding a custom face because
 * they need no font program, which keeps the output small and cannot fail on a
 * missing font file. The trade-off is that the overlay will not match the
 * document's own typeface; it is a Standard font, and the UI says so.
 */
/**
 * The 14 names in `StandardFonts` as a plain string union.
 *
 * Deliberately spelled out rather than derived from `keyof typeof StandardFonts`.
 * That keyof yields the *property names* of the enum object, but `embedFont`
 * wants the enum *values*, which are different strings. Deriving one from the
 * other produces a type that looks plausible and rejects every value.
 */
type StandardFontName =
  | "Courier" | "CourierBold" | "CourierOblique" | "CourierBoldOblique"
  | "Helvetica" | "HelveticaBold" | "HelveticaOblique" | "HelveticaBoldOblique"
  | "TimesRoman" | "TimesRomanBold" | "TimesRomanItalic" | "TimesRomanBoldItalic"
  | "Symbol" | "ZapfDingbats";

function resolveStandardFont(family: OverlayFont, bold: boolean): StandardFontName {
  if (family === "times") {
    return bold ? "TimesRomanBold" : "TimesRoman";
  }
  if (family === "courier") {
    return bold ? "CourierBold" : "Courier";
  }
  return bold ? "HelveticaBold" : "Helvetica";
}

/* -------------------------------------------------------------------------- */
/*  Geometry                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The rectangle that hides one run.
 *
 * `height` is pdf.js's font height, which is roughly the cap height rather than
 * the full em box. Ascenders and descenders extend past it, so the box is grown
 * on both sides — too small and the tails of `p`, `y`, `g` stay visible above
 * the replacement, which looks like a mistake even when it is only cosmetic.
 *
 * The bottom is allowed to run slightly past the baseline because a following
 * line of text sits close under it in most layouts; covering a sliver of the
 * line below is far less visible than a leftover descender.
 */
export function coverBoxFor(run: TextRun, padRatio = 0.12): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const pad = run.height * padRatio;
  return {
    x: run.x - pad,
    y: run.y - pad,
    width: Math.max(run.width, 1) + pad * 2,
    height: run.height + pad * 2,
  };
}

/* -------------------------------------------------------------------------- */
/*  Apply                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Draws replacements over the matched runs and returns a new PDF.
 *
 * `replacements` is keyed by `pageIndex` + `itemIndex` rather than by match
 * offsets, because a run may contain several matches of the same needle and
 * they all resolve to the same run. Deduplicating by run here — rather than
 * trusting the caller to have done it — means an overlapping set of matches
 * cannot double-draw and smear the replacement twice.
 */
export async function overlayReplaceRuns(
  source: ArrayBuffer | Uint8Array,
  replacements: readonly RunMatch[],
  newTextFor: (match: RunMatch) => string,
  options: OverlayOptions = {},
): Promise<OverlayResult> {
  const {
    background = rgb(1, 1, 1),
    textColor = rgb(0, 0, 0),
    font: family = "helvetica",
    bold = false,
    fitToOriginalWidth = true,
    minSizeRatio = 0.6,
  } = options;

  const doc = await PDFDocument.load(source);
  const standardName = resolveStandardFont(family, bold);
  const applied: AppliedReplacement[] = [];
  const skipped: OverlayResult["skipped"] = [];

  // Group by page so each page's font is embedded once, not once per match.
  const byPage = new Map<number, RunMatch[]>();
  for (const match of replacements) {
    const list = byPage.get(match.run.pageIndex);
    if (list) list.push(match);
    else byPage.set(match.run.pageIndex, [match]);
  }

  for (const [pageIndex, matches] of byPage) {
    let page;
    try {
      page = doc.getPage(pageIndex);
    } catch {
      for (const match of matches) {
        skipped.push({
          pageIndex,
          itemIndex: match.run.itemIndex,
          reason: "The page could not be opened in the output document.",
        });
      }
      continue;
    }

    // One embed per page. `embedFont` is cached by pdf-lib, so this is cheap
    // even when called for several pages, but keeping it local is clearer.
    let font: PDFFont;
    try {
      font = await doc.embedFont(standardName);
    } catch {
      for (const match of matches) {
        skipped.push({
          pageIndex,
          itemIndex: match.run.itemIndex,
          reason: "The replacement font could not be embedded.",
        });
      }
      continue;
    }

    /**
     * Collapse to one draw per run, last match winning.
     *
     * Two matches in the same run ("Invoice" appearing twice in one `Tj`) would
     * otherwise both draw a full-width box over the same line and the second
     * would erase the first.
     */
    const byRun = new Map<number, RunMatch>();
    for (const match of matches) byRun.set(match.run.itemIndex, match);

    for (const match of byRun.values()) {
      const run = match.run;
      const replacement = newTextFor(match);

      if (replacement.trim() === "") {
        // An empty replacement still gets a cover, which is how a caller blanks
        // text out. There is simply nothing to draw on top.
        const box = coverBoxFor(run);
        page.drawRectangle({ ...box, color: background, borderWidth: 0 });
        applied.push({
          pageIndex,
          pageNumber: pageIndex + 1,
          before: match.text,
          after: "",
          fontSize: run.height,
          drawnSize: 0,
          overflowed: false,
        });
        continue;
      }

      const box = coverBoxFor(run);
      page.drawRectangle({ ...box, color: background, borderWidth: 0 });

      let size = run.height;
      let overflowed = false;

      if (fitToOriginalWidth && box.width > 0) {
        try {
          const natural = font.widthOfTextAtSize(replacement, size);
          if (natural > box.width) {
            const fitted = size * (box.width / natural);
            // Never shrink past the floor, and never below something legible.
            size = Math.max(fitted, size * minSizeRatio, 4);
            overflowed = font.widthOfTextAtSize(replacement, size) > box.width;
          }
        } catch {
          // A character the font cannot measure is a reason to report, not to
          // throw: the box is already drawn, so leaving the text out degrades
          // gracefully instead of losing the whole document.
          skipped.push({
            pageIndex,
            itemIndex: run.itemIndex,
            reason: "The replacement contains a character this font cannot draw.",
          });
          continue;
        }
      }

      try {
        page.drawText(replacement, {
          x: run.x,
          y: run.y,
          size,
          font,
          color: textColor,
        });
      } catch {
        skipped.push({
          pageIndex,
          itemIndex: run.itemIndex,
          reason: "The replacement text could not be drawn with the selected font.",
        });
        continue;
      }

      applied.push({
        pageIndex,
        pageNumber: pageIndex + 1,
        before: match.text,
        after: replacement,
        fontSize: run.height,
        drawnSize: size,
        overflowed,
      });
    }
  }

  const bytes = await doc.save();
  return { bytes, applied, skipped };
}