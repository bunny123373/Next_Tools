"use client";

/**
 * PDF text extraction, in the browser.
 *
 * AI PDF Chat reads the document *here* rather than uploading it, so the file
 * itself never leaves the visitor's device — only the extracted text goes to
 * the provider. That is a materially better privacy story than uploading a
 * 20 MB contract to a chat endpoint, and it costs nothing: `pdfjs-dist` is
 * dynamically imported at the moment a file is picked, so nobody who does not
 * use this tool downloads a PDF parser.
 *
 * The route (`POST /api/ai/pdf`) can also extract server-side. That path exists
 * for when this one fails — a browser that will not start the worker, a
 * malformed document — and the workspace offers it as a labelled choice rather
 * than silently uploading the file.
 *
 * What extraction cannot recover, and what the prompt then tells the model:
 * page numbers, reading order inside multi-column layouts, hyphenation at line
 * breaks, figures, and any text that exists only as pixels.
 */

/** Structural view of the text items pdf.js returns. */
interface PdfTextItem {
  str?: string;
}

export interface BrowserExtractedPdf {
  text: string;
  pageCount: number;
}

/** A failure with wording written for the visitor. */
export class PdfExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractError";
  }
}

const MAX_PAGES = 400;

/** pdf.js is loaded on demand and only once. */
let pdfModule: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfModule) {
    pdfModule = import("pdfjs-dist").then((pdfjs) => {
      // Bundler-friendly worker resolution: `new URL(..., import.meta.url)`
      // makes the worker an emitted asset instead of a runtime fetch from a
      // path we would have to guess.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfModule;
}

/** Pulls the text layer out of a PDF the visitor picked. */
export async function extractPdfTextInBrowser(file: File): Promise<BrowserExtractedPdf> {
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await loadPdfJs();
  } catch {
    throw new PdfExtractError(
      "The PDF reader could not be loaded in this browser. You can send the file to our server instead, which extracts the text there.",
    );
  }

  let task: ReturnType<typeof pdfjs.getDocument>;
  try {
    const buffer = await file.arrayBuffer();
    task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: 0,
    });
  } catch {
    throw new PdfExtractError("That file could not be opened as a PDF.");
  }

  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch {
    await task.destroy().catch(() => undefined);
    throw new PdfExtractError(
      "That PDF could not be opened. It may be encrypted, damaged, or password protected.",
    );
  }

  const pageCount = document.numPages;
  try {
    if (pageCount > MAX_PAGES) {
      throw new PdfExtractError(
        `That PDF has ${pageCount} pages. This tool reads up to ${MAX_PAGES}.`,
      );
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => {
            const str = (item as PdfTextItem).str;
            return typeof str === "string" ? str : "";
          })
          .join(" ")
          .trim(),
      );
      page.cleanup();
    }

    const text = pages.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();

    if (!text) {
      throw new PdfExtractError(
        "No text could be extracted. This PDF is most likely a scan — the pages are images with no text layer underneath. Run it through an OCR tool first.",
      );
    }

    return { text, pageCount };
  } catch (error) {
    if (error instanceof PdfExtractError) throw error;
    throw new PdfExtractError(
      "That PDF could not be read to the end. It may be damaged or password protected.",
    );
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
