/**
 * Server-side PDF text extraction for `POST /api/ai/pdf`.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS RUNS HERE AND NOT IN THE BROWSER
 * ---------------------------------------------------------------------------
 *  The browser is the primary path — the workspace extracts the text with
 *  pdf.js locally and sends only the text, so the document itself never leaves
 *  the visitor's device. This module is the fallback the workspace offers when
 *  the in-browser extraction fails, and the path an API caller uses when they
 *  just want to POST a PDF.
 *
 *  We implemented it server-side rather than pretending it was done, because
 *  `pdfjs-dist` genuinely runs in the Node runtime: the legacy ESM build has no
 *  DOM dependency for `getTextContent()`, which is all we need. Anything the
 *  extractor cannot read comes back as an explicit failure — a scanned
 *  document with no text layer returns "no text layer", never an empty answer
 *  dressed up as a summary of nothing.
 *
 *  What extraction cannot recover, and what the prompt then tells the model:
 *  page numbers, reading order inside multi-column layouts, hyphenation at line
 *  breaks, figures, and any text that is only present as pixels.
 */

import { HttpError } from "../lib/http";

/** Structural view of the text items pdf.js returns. */
interface PdfTextItem {
  str?: string;
}

export interface ExtractedPdf {
  text: string;
  pageCount: number;
}

const MAX_PAGES = 400;

/**
 * Decodes a `data:application/pdf;base64,…` URL and pulls out its text.
 *
 * `pdfjs-dist` is imported dynamically: it is a large module and no visitor who
 * never opens a PDF should pay for it. Throws `HttpError` with a message written
 * for the visitor when the document cannot be read.
 */
export async function extractPdfText(dataUrl: string): Promise<ExtractedPdf> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = base64ToBytes(base64);

  // A PDF always starts with "%PDF-". Checking it here turns a mislabelled
  // upload into a clear message instead of a parser stack trace.
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 5));
  if (header !== "%PDF-") {
    throw new HttpError("bad_request", "That file is not a PDF.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // `destroy()` lives on the loading task, not on the document, so the task
  // has to be kept for the whole extraction — that is what frees the worker and
  // the parsed page cache when we are done, including on an error path.
  const task = pdfjs.getDocument({
    data: bytes,
    // Nothing in this process renders a glyph or evaluates a font program, and
    // both are pure attack surface for a malicious document.
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
  });

  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch {
    await task.destroy().catch(() => undefined);
    throw new HttpError(
      "bad_request",
      "That PDF could not be opened. It may be encrypted, damaged, or not a PDF at all.",
    );
  }

  const pageCount = document.numPages;

  try {
    if (pageCount > MAX_PAGES) {
      throw new HttpError(
        "bad_request",
        `That PDF has ${pageCount} pages. This tool reads up to ${MAX_PAGES}.`,
      );
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      // `TextMarkedContent` entries have no `str`; anything without text
      // contributes nothing rather than the string "undefined".
      const text = content.items
        .map((item) => {
          const str = (item as PdfTextItem).str;
          return typeof str === "string" ? str : "";
        })
        .join(" ");
      pages.push(text.trim());
      page.cleanup();
    }

    const text = pages.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();

    if (!text) {
      throw new HttpError(
        "bad_request",
        "No text could be extracted from that PDF. It is most likely a scan — the page images contain no text layer for a model to read. Run it through OCR first.",
      );
    }

    return { text, pageCount };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      "bad_request",
      "That PDF could not be read to the end. It may be damaged or password protected.",
    );
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Decodes standard base64 into bytes without a Node-only Buffer dependency. */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const binary = atob(clean);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const source = Buffer.from(clean, "base64");
  const bytes = new Uint8Array(new ArrayBuffer(source.length));
  bytes.set(source);
  return bytes;
}
