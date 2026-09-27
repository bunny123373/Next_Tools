/**
 * Shared PDF engine.
 *
 * Everything here is React-free and browser-only. `pdf-lib` and `pdfjs-dist` are
 * always loaded through `await import()` so neither ever lands in a category
 * page or the homepage bundle — each tool's dynamic chunk pulls in only what it
 * actually needs.
 *
 * pdfjs-dist v6 notes, learned the hard way:
 *  - `getDocument({ data })` wants the `Uint8Array`, not a bare `ArrayBuffer`.
 *  - `page.render({ canvas, viewport })` — the old `canvasContext`-only form is
 *    gone, so we always create the canvas ourselves and size it to the viewport.
 *  - Every `PDFDocumentProxy` must be `destroy()`ed. A leaked document pins the
 *    whole parsed file in memory, which is the classic "works twice, then the
 *    tab freezes" bug. `withPdfJsDocument()` exists so there is exactly one
 *    place that guarantees the `finally`.
 */

import type {
  PDFArray as PDFArrayType,
  PDFDict as PDFDictType,
  PDFDocument,
  PDFImage,
  PDFName as PDFNameType,
  PDFNumber as PDFNumberType,
  PDFObject,
  PDFPage,
  PDFRawStream as PDFRawStreamType,
  PDFRef as PDFRefType,
} from "pdf-lib";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/** `getTextContent()`'s return type, without importing a deep path. */
export type PdfJsTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/* ------------------------------------------------------------------ */
/*  Lazy loaders                                                       */
/* ------------------------------------------------------------------ */

let pdfLibPromise: Promise<typeof import("pdf-lib")> | null = null;

/** `pdf-lib` on demand. Cached for the tab's lifetime. */
export function loadPdfLib(): Promise<typeof import("pdf-lib")> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdf-lib").catch((error: unknown) => {
      pdfLibPromise = null;
      throw error;
    });
  }
  return pdfLibPromise;
}

let workerConfigured = false;

/**
 * Point PDF.js at its worker. `new URL(..., import.meta.url)` is the pattern
 * both webpack and Turbopack understand, and it keeps the worker out of the
 * tool chunk (it becomes its own emitted asset).
 *
 * If the bundler could not resolve the specifier we leave `workerSrc` empty.
 * PDF.js then fails fast on a readable error rather than silently doing
 * something surprising, and a worker that *does* load but 404s degrades to
 * PDF.js's own main-thread fallback worker on its own.
 */
function configureWorker(pdfjs: typeof import("pdfjs-dist")): void {
  if (workerConfigured) return;
  workerConfigured = true;
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = "";
  }
}

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** `pdfjs-dist` on demand, with the worker wired up once. */
export function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      configureWorker(pdfjs);
      return pdfjs;
    })().catch((error: unknown) => {
      pdfJsPromise = null;
      throw error;
    });
  }
  return pdfJsPromise;
}

/* ------------------------------------------------------------------ */
/*  Small shared helpers                                               */
/* ------------------------------------------------------------------ */

export function blobFromBytes(bytes: Uint8Array, mime: string): Blob {
  // Copy into a fresh buffer: pdf-lib/pdfjs buffers can be views over a larger
  // ArrayBuffer, and handing that to a Blob would leak the whole file.
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

export function pdfBlob(bytes: Uint8Array): Blob {
  return blobFromBytes(bytes, "application/pdf");
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: "jpeg" | "png",
  quality: number,
): Promise<Blob> {
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This browser could not encode the page as an image."));
      },
      mime,
      format === "jpeg" ? quality : undefined,
    );
  });
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d", { alpha: false });
}

function describeUnknownError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message;
  if (/password/i.test(message)) {
    return "This PDF is password-protected, so it cannot be read here. Remove the password first.";
  }
  if (/Invalid PDF|no header|stream must have|Invalid stream|xref/i.test(message)) {
    return "This file could not be parsed as a PDF. It may be damaged or truncated.";
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Loading with pdf-lib                                               */
/* ------------------------------------------------------------------ */

export interface LoadPdfOptions {
  /**
   * Read the object structure of an encrypted file instead of refusing it.
   * Used by the inspector tools, which only need the catalog, never the
   * decrypted content.
   */
  inspectOnly?: boolean;
}

/**
 * Load a PDF with pdf-lib, turning its two likely failures (encrypted, not a
 * PDF) into sentences a person can act on. Never surfaces a stack trace.
 */
export async function loadPdfDocument(
  source: Blob,
  options: LoadPdfOptions = {},
): Promise<PDFDocument> {
  const { PDFDocument, EncryptedPDFError } = await loadPdfLib();
  const bytes = new Uint8Array(await source.arrayBuffer());
  try {
    return await PDFDocument.load(bytes, {
      ignoreEncryption: options.inspectOnly === true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error(
        "This PDF is password-protected. Remove the password first, then run this tool on the result.",
      );
    }
    throw new Error(
      describeUnknownError(
        error,
        "This file could not be opened as a PDF. It may be damaged, or it may not be a PDF at all.",
      ),
    );
  }
}

/** Real page count, read from the file. Structural read only. */
export async function getPdfPageCount(source: Blob): Promise<number> {
  const doc = await loadPdfDocument(source, { inspectOnly: true });
  return doc.getPageCount();
}

/* ------------------------------------------------------------------ */
/*  Page ranges                                                        */
/* ------------------------------------------------------------------ */

export interface PageRangeResult {
  /** Zero-based page indices, de-duplicated and in document order. */
  indices: number[];
  /** A human-readable reason, or null when the range is usable. */
  error: string | null;
}

/**
 * Parse "1-3, 7, 9-12" into zero-based indices.
 *
 * Pages are 1-based in the UI because that is what a reader sees; the rest of
 * the codebase is 0-based, so the conversion happens here once.
 */
export function parsePageRange(input: string, totalPages: number): PageRangeResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { indices: [], error: "Enter at least one page, for example 1-3, 7, 9-12." };
  }

  const selected = new Set<number>();
  for (const part of trimmed.split(",")) {
    const chunk = part.trim();
    if (!chunk) continue;

    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(chunk);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1) return { indices: [], error: `Pages start at 1, so "${chunk}" is not valid.` };
      if (end < start) {
        return { indices: [], error: `"${chunk}" runs backwards. Use start-end, for example 1-3.` };
      }
      if (start > totalPages) {
        return {
          indices: [],
          error: `Page ${start} is past the end — this document has ${totalPages} page${totalPages === 1 ? "" : "s"}.`,
        };
      }
      const last = Math.min(end, totalPages);
      for (let page = start; page <= last; page += 1) selected.add(page - 1);
      continue;
    }

    if (!/^\d+$/.test(chunk)) {
      return {
        indices: [],
        error: `"${chunk}" is not a page number or range. Use something like 1-3, 7, 9-12.`,
      };
    }
    const page = Number(chunk);
    if (page < 1) return { indices: [], error: `Pages start at 1, so "${chunk}" is not valid.` };
    if (page > totalPages) {
      return {
        indices: [],
        error: `Page ${page} is past the end — this document has ${totalPages} page${totalPages === 1 ? "" : "s"}.`,
      };
    }
    selected.add(page - 1);
  }

  if (selected.size === 0) {
    return { indices: [], error: "Enter at least one page, for example 1-3, 7, 9-12." };
  }
  return { indices: [...selected].sort((a, b) => a - b), error: null };
}

/** Inverse of `parsePageRange`, for the selection counter. "1-3, 7, 9-12" */
export function formatPageList(indices: readonly number[]): string {
  if (indices.length === 0) return "";
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const groups: string[] = [];
  let start = sorted[0]!;
  let previous = start;
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    groups.push(start === previous ? String(start + 1) : `${start + 1}-${previous + 1}`);
    if (current === undefined) break;
    start = current;
    previous = current;
  }
  return groups.join(", ");
}

/* ------------------------------------------------------------------ */
/*  Page geometry                                                      */
/* ------------------------------------------------------------------ */

export interface PageSize {
  width: number;
  height: number;
}

export function formatPageSize(size: PageSize): string {
  return `${Math.round(size.width)} × ${Math.round(size.height)} pt`;
}

/** mm → pt, for the readable paper-size labels. */
export function mmToPoints(mm: number): number {
  return (mm / 25.4) * 72;
}

/* ------------------------------------------------------------------ */
/*  pdfjs: open, render, always destroy                                 */
/* ------------------------------------------------------------------ */

export type ImageOutputFormat = "jpeg" | "png";

/**
 * Run a function against a PDF.js document and guarantee it is destroyed.
 * Leaked documents are the number one cause of "it worked, then it froze".
 */
export async function withPdfJsDocument<T>(
  source: Blob,
  fn: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await source.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw new Error(
      describeUnknownError(
        error,
        "The browser could not read this PDF. Re-export it from the app that produced it and try again.",
      ),
    );
  }
  try {
    return await fn(doc);
  } finally {
    // pdfjs-dist v6 dropped `PDFDocumentProxy.destroy()`; the loading task owns
    // the worker port and the parsed document, so this is the release point.
    await task.destroy().catch(() => undefined);
  }
}

export interface RenderPageOptions {
  /** 1.0 renders at 72 DPI. 2.0 is 144 DPI. */
  scale: number;
  format: ImageOutputFormat;
  /** JPEG quality, 0–1. Ignored for PNG. */
  quality: number;
  /** Opaque background; PDFs have no alpha and viewers assume white. */
  background?: string;
}

export interface RenderedImage {
  blob: Blob;
  width: number;
  height: number;
}

async function renderPage(
  page: PDFPageProxy,
  options: RenderPageOptions,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const viewport = page.getViewport({ scale: options.scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const context = get2dContext(canvas);
  if (!context) {
    throw new Error("This browser did not provide a 2D canvas, so pages cannot be rendered.");
  }
  const background = options.background ?? "#ffffff";
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const task = page.render({ canvas, viewport, background });
  try {
    await task.promise;
  } catch (error) {
    task.cancel();
    throw error;
  }
}

/** Render one page to an image Blob. */
export async function renderPageToImage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  options: RenderPageOptions,
): Promise<RenderedImage> {
  const page = await doc.getPage(pageIndex + 1);
  const canvas = document.createElement("canvas");
  try {
    await renderPage(page, options, canvas);
    const blob = await canvasToBlob(canvas, options.format, options.quality);
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    page.cleanup();
  }
}

/** Render one page into a canvas the caller owns — used by the thumbnail grids. */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const page = await doc.getPage(pageIndex + 1);
  try {
    await renderPage(page, { scale, format: "png", quality: 1 }, canvas);
  } finally {
    page.cleanup();
  }
}

/** Small, cheap JPEG preview of a page, sized to `targetWidth` CSS pixels. */
export async function renderPageThumbnail(
  doc: PDFDocumentProxy,
  pageIndex: number,
  targetWidth = 180,
): Promise<Blob> {
  const page = await doc.getPage(pageIndex + 1);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, targetWidth / base.width);
    const canvas = document.createElement("canvas");
    await renderPage(page, { scale, format: "jpeg", quality: 0.68 }, canvas);
    return await canvasToBlob(canvas, "jpeg", 0.68);
  } finally {
    page.cleanup();
  }
}

/** One-shot page preview, returned as a Blob for `useObjectUrl`. */
export async function renderPagePreview(
  source: Blob,
  pageIndex: number,
  targetWidth = 420,
): Promise<Blob> {
  return withPdfJsDocument(source, (doc) => renderPageThumbnail(doc, pageIndex, targetWidth));
}

/* ------------------------------------------------------------------ */
/*  Document inspection                                                */
/* ------------------------------------------------------------------ */

export interface DocumentInfo {
  pageCount: number;
  /** Every page's MediaBox, in order. */
  pageSizes: PageSize[];
  /** Distinct sizes with a count each, most common first. */
  distinctPageSizes: { size: PageSize; count: number }[];
  isEncrypted: boolean;
  hasXmp: boolean;
  pdfVersion: string | null;
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string[];
  creator: string | null;
  producer: string | null;
  /** ISO-8601, or null when the file has no such entry. */
  creationDate: string | null;
  /** ISO-8601, or null when the file has no such entry. */
  modificationDate: string | null;
  /** How many indirect objects the parser found. */
  objectCount: number;
  /** How many of those the parser could not make sense of. */
  invalidObjectCount: number;
}

function toIsoOrNull(value: Date | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function sizeKey(size: PageSize): string {
  return `${Math.round(size.width)}x${Math.round(size.height)}`;
}

/** Read the real info dictionary, page geometry and encryption state. */
export async function readDocumentInfo(source: Blob): Promise<DocumentInfo> {
  const pdfjs = await loadPdfLib();
  const { PDFName, PDFDict } = pdfjs;
  const doc = await loadPdfDocument(source, { inspectOnly: true });

  const pageSizes = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });

  const counts = new Map<string, { size: PageSize; count: number }>();
  for (const size of pageSizes) {
    const key = sizeKey(size);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { size, count: 1 });
  }
  const distinctPageSizes = [...counts.values()].sort((a, b) => b.count - a.count);

  const context = doc.context;
  const catalog = context.lookupMaybe(context.trailerInfo.Root, PDFDict);
  const hasXmp = Boolean(catalog?.has(PDFName.of("Metadata")));

  const objects = context.enumerateIndirectObjects();
  let invalidObjectCount = 0;
  for (const [, object] of objects) {
    if (object instanceof pdfjs.PDFInvalidObject) invalidObjectCount += 1;
  }

  const keywords = doc.getKeywords();
  // `PDFHeader.toString()` also carries the binary comment line, so match the
  // version out of it rather than reporting the whole header.
  const version = /(\d+\.\d+)/.exec(context.header.toString())?.[1] ?? null;

  return {
    pageCount: doc.getPageCount(),
    pageSizes,
    distinctPageSizes,
    isEncrypted: doc.isEncrypted,
    hasXmp,
    pdfVersion: version || null,
    title: doc.getTitle() || null,
    author: doc.getAuthor() || null,
    subject: doc.getSubject() || null,
    keywords: keywords ? keywords.split(/,\s*/).filter(Boolean) : [],
    creator: doc.getCreator() || null,
    producer: doc.getProducer() || null,
    creationDate: toIsoOrNull(doc.getCreationDate()),
    modificationDate: toIsoOrNull(doc.getModificationDate()),
    objectCount: objects.length,
    invalidObjectCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Metadata editing                                                   */
/* ------------------------------------------------------------------ */

export interface MetadataFields {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export function emptyMetadataFields(): MetadataFields {
  return { title: "", author: "", subject: "", keywords: "", creator: "", producer: "" };
}

export function fieldsFromInfo(info: DocumentInfo): MetadataFields {
  return {
    title: info.title ?? "",
    author: info.author ?? "",
    subject: info.subject ?? "",
    keywords: info.keywords.join(", "),
    creator: info.creator ?? "",
    producer: info.producer ?? "",
  };
}

/** Write the six writable info-dictionary values. Empty means "remove". */
export function applyMetadataFields(doc: PDFDocument, fields: MetadataFields): void {
  const keywords = fields.keywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  doc.setTitle(fields.title.trim());
  doc.setAuthor(fields.author.trim());
  doc.setSubject(fields.subject.trim());
  doc.setCreator(fields.creator.trim());
  doc.setProducer(fields.producer.trim());
  if (keywords.length > 0) doc.setKeywords(keywords);
  else doc.setKeywords([]);
}

/**
 * Clear the info dictionary and drop the XMP stream.
 *
 * This is a real rewrite, not forensic erasure: anything drawn into the page
 * content itself is untouched, because there is no way to know which drawing
 * operators are "metadata".
 */
export async function stripDocumentMetadata(doc: PDFDocument): Promise<void> {
  const { PDFDict, PDFName, PDFNull } = await loadPdfLib();
  const context = doc.context;

  const info = context.trailerInfo.Info
    ? context.lookupMaybe(context.trailerInfo.Info, PDFDict)
    : undefined;
  if (info) {
    for (const key of [
      "Title",
      "Author",
      "Subject",
      "Keywords",
      "Creator",
      "Producer",
      "CreationDate",
      "ModDate",
      "Trapped",
    ]) {
      info.set(PDFName.of(key), PDFNull);
    }
  }

  const catalog = context.lookupMaybe(context.trailerInfo.Root, PDFDict);
  if (catalog?.has(PDFName.of("Metadata"))) {
    catalog.delete(PDFName.of("Metadata"));
  }
}

/* ------------------------------------------------------------------ */
/*  Object-graph reachability (orphan cleanup)                          */
/* ------------------------------------------------------------------ */

/**
 * Delete indirect objects that nothing reachable from the trailer points at.
 * Returns the number removed, so the UI can report a real count.
 */
export async function removeOrphanedObjects(doc: PDFDocument): Promise<number> {
  const {
    PDFArray,
    PDFDict,
    PDFRef,
    PDFStream,
  } = await loadPdfLib();
  const context = doc.context;

  const live = new Set<string>();
  const stack: PDFObject[] = [];
  const push = (object: PDFObject | undefined) => {
    if (object) stack.push(object);
  };

  // The trailer values are PDFRefs, and they must go through the *same* path as
  // every other reference so their own ids land in the live set. Pushing the
  // already-dereferenced object instead would orphan the catalog itself.
  const { trailerInfo } = context;
  push(trailerInfo.Root as PDFObject | undefined);
  push(trailerInfo.Info as PDFObject | undefined);
  push(trailerInfo.Encrypt as PDFObject | undefined);
  push(trailerInfo.ID as PDFObject | undefined);

  while (stack.length > 0) {
    const object = stack.pop();
    if (!object) continue;
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (live.has(key)) continue;
      live.add(key);
      push(context.lookup(object));
      continue;
    }
    if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) push(value);
      continue;
    }
    if (object instanceof PDFArray) {
      for (const value of object.asArray()) push(value);
      continue;
    }
    if (object instanceof PDFStream) {
      for (const [, value] of object.dict.entries()) push(value);
      continue;
    }
  }

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (live.has(ref.toString())) continue;
    if (context.delete(ref)) removed += 1;
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/*  Re-deflating content streams                                       */
/* ------------------------------------------------------------------ */

/**
 * Re-compress page content streams that were stored uncompressed.
 *
 * pdf-lib writes stream objects back out byte-for-byte, so a producer that
 * wrote raw page content keeps the raw bytes. Deflating them is free size.
 */
export async function recompressContentStreams(doc: PDFDocument): Promise<number> {
  const { PDFArray, PDFName, PDFRawStream, decodePDFRawStream } = await loadPdfLib();
  const context = doc.context;
  const filterKey = PDFName.of("Filter");
  let count = 0;

  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) continue;
    for (let index = 0; index < contents.size(); index += 1) {
      const stream = contents.lookupMaybe(index, PDFRawStream);
      if (!stream) continue;
      if (stream.dict.has(filterKey)) continue;
      const decoded = decodePDFRawStream(stream).decode();
      if (decoded.length >= stream.getContentsSize()) continue;
      contents.set(index, context.register(context.flateStream(decoded)));
      count += 1;
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Image downsampling                                                 */
/* ------------------------------------------------------------------ */

export interface CompressOptions {
  /** JPEG quality for re-encoded images, 0.3–0.95. */
  jpegQuality: number;
  /** Longest-edge cap in pixels. 0 disables downsampling entirely. */
  maxDimension: number;
  /** Clear the info dictionary and the XMP stream. */
  stripMetadata: boolean;
}

export interface CompressReport {
  bytesBefore: number;
  bytesAfter: number;
  /** Image XObjects that were decoded and re-encoded. */
  imagesDownsampled: number;
  /** Image XObjects found, including the ones we had to skip. */
  imagesTotal: number;
  /** Image XObjects skipped because their encoding is not one we can decode. */
  imagesSkipped: number;
  /** Content streams that were deflated. */
  streamsRecompressed: number;
  orphanedObjectsRemoved: number;
  metadataStripped: boolean;
  /** True when the output is not smaller than the input. */
  grew: boolean;
}

function asNumber(object: PDFObject | undefined, pdfjs: typeof import("pdf-lib")): number | null {
  return object instanceof pdfjs.PDFNumber ? object.asNumber() : null;
}

function asNameString(object: PDFObject | undefined): string | null {
  if (object && "asString" in object && typeof object.asString === "function") {
    return object.asString();
  }
  return null;
}

/** PNG/TIFF predictors, which is what `/DecodeParms /Predictor` turns on. */
function undoPredictor(
  data: Uint8Array,
  bytesPerPixel: number,
  columns: number,
  predictor: number,
): Uint8Array {
  if (predictor < 10) return data;
  if (predictor === 2) {
    // TIFF predictor 2: horizontal differencing, applied per component row.
    const rowLength = bytesPerPixel * columns;
    const rows = Math.floor(data.length / rowLength);
    const out = new Uint8Array(data);
    for (let row = 0; row < rows; row += 1) {
      const offset = row * rowLength;
      for (let i = bytesPerPixel; i < rowLength; i += 1) {
        out[offset + i] = (out[offset + i]! + out[offset + i - bytesPerPixel]!) & 0xff;
      }
    }
    return out;
  }
  // PNG predictors 10–15.
  const rowLength = bytesPerPixel * columns + 1;
  const rows = Math.floor(data.length / rowLength);
  const out = new Uint8Array(rows * bytesPerPixel * columns);
  let previousRow = new Uint8Array(bytesPerPixel * columns);
  for (let row = 0; row < rows; row += 1) {
    const src = row * rowLength;
    const filter = data[src] ?? 0;
    const target = row * bytesPerPixel * columns;
    for (let i = 0; i < bytesPerPixel * columns; i += 1) {
      const raw = data[src + 1 + i] ?? 0;
      const left = i >= bytesPerPixel ? out[target + i - bytesPerPixel]! : 0;
      const up = previousRow[i] ?? 0;
      const upLeft = i >= bytesPerPixel ? previousRow[i - bytesPerPixel]! : 0;
      let value = raw;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4:
          value = raw + paeth(left, up, upLeft);
          break;
        default:
          value = raw;
      }
      out[target + i] = value & 0xff;
    }
    previousRow = out.subarray(target, target + bytesPerPixel * columns);
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

interface DecodedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Decode a raster image XObject into something the canvas can draw.
 *
 * We handle the two encodings that dominate real PDFs:
 *  - `/DCTDecode` — the stream *is* a JPEG file, handed straight to the browser.
 *  - `/FlateDecode` with 8 bits per component in DeviceGray or DeviceRGB —
 *    inflate, undo any predictor, and build ImageData.
 *
 * Everything else (JPEG 2000, CCITT fax, indexed palettes, CMYK, 1/4-bit,
 * stencil masks, soft masks) is reported as skipped rather than mangled.
 */
async function decodeImageXObject(
  stream: PDFRawStreamType,
  pdfjs: typeof import("pdf-lib"),
): Promise<DecodedImage | null> {
  const raw = stream.contents;
  if (raw.length === 0) return null;

  const { PDFArray, PDFName, PDFNumber, decodePDFRawStream } = pdfjs;
  const width = asNumber(stream.dict.get(PDFName.of("Width")), pdfjs);
  const height = asNumber(stream.dict.get(PDFName.of("Height")), pdfjs);
  if (!width || !height || width <= 0 || height <= 0) return null;

  const filterObject = stream.dict.get(PDFName.of("Filter"));
  const filters: string[] = [];
  if (filterObject instanceof PDFArray) {
    for (const entry of filterObject.asArray()) {
      const name = asNameString(entry);
      if (name) filters.push(name);
    }
  } else {
    const name = asNameString(filterObject);
    if (name) filters.push(name);
  }
  if (filters.length === 0) return null;

  const last = filters[filters.length - 1];
  if (last === "DCTDecode") {
    // Strip any filters applied before the JPEG payload (e.g. Flate).
    const jpegBytes = filters.length === 1 ? raw : decodePDFRawStream(stream).decode();
    const blob = new Blob([new Uint8Array(jpegBytes)], { type: "image/jpeg" });
    try {
      const bitmap = await createImageBitmap(blob);
      const decoded: DecodedImage = { blob, width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return decoded;
    } catch {
      // CMYK and some progressive JPEGs are not decodable here.
      return null;
    }
  }

  if (filters.length !== 1 || last !== "FlateDecode") return null;

  const bitsPerComponent = asNumber(stream.dict.get(PDFName.of("BitsPerComponent")), pdfjs) ?? 8;
  if (bitsPerComponent !== 8) return null;

  const colorSpace = asNameString(stream.dict.get(PDFName.of("ColorSpace")));
  let components: number;
  if (colorSpace === "DeviceRGB" || colorSpace === "CalRGB") components = 3;
  else if (colorSpace === "DeviceGray" || colorSpace === "CalGray") components = 1;
  else return null;

  const expected = width * height * components;
  if (expected > 64 * 1024 * 1024) return null;

  let samples = decodePDFRawStream(stream).decode();
  if (samples.length < expected) return null;

  let predictor = 1;
  const paramsObject = stream.dict.get(PDFName.of("DecodeParms"));
  if (paramsObject instanceof pdfjs.PDFDict) {
    const params = paramsObject;
    const columns = asNumber(params.get(PDFName.of("Columns")), pdfjs) ?? width;
    const predictorValue = asNumber(params.get(PDFName.of("Predictor")), pdfjs) ?? 1;
    predictor = predictorValue;
    if (predictor >= 10) {
      samples = undoPredictor(samples, components, columns, predictor);
    }
  }
  if (samples.length < expected) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = get2dContext(canvas);
  if (!context) return null;

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i += 1) {
    const source = i * components;
    if (components === 1) {
      const grey = samples[source] ?? 0;
      pixels[p] = grey;
      pixels[p + 1] = grey;
      pixels[p + 2] = grey;
    } else {
      pixels[p] = samples[source] ?? 0;
      pixels[p + 1] = samples[source + 1] ?? 0;
      pixels[p + 2] = samples[source + 2] ?? 0;
    }
    pixels[p + 3] = 255;
    p += 4;
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return { blob: await canvasToBlob(canvas, "png", 1), width, height };
}

/** Draw `image` into a canvas of at most `maxDimension` on its longest edge. */
async function downscaleToJpeg(
  image: DecodedImage,
  maxDimension: number,
  quality: number,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(image.blob);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = maxDimension > 0 && longest > maxDimension ? maxDimension / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = get2dContext(canvas);
    if (!context) throw new Error("This browser did not provide a 2D canvas.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "jpeg", quality);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close();
  }
}

/** Ids of every image used as a soft mask or a stencil, which we must not touch. */
async function collectMaskRefs(doc: PDFDocument): Promise<Set<string>> {
  const { PDFDict, PDFName, PDFRef } = await loadPdfLib();
  const masks = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    for (const key of ["SMask", "Mask"]) {
      const value = object.get(PDFName.of(key));
      const ref = value instanceof PDFRef ? value : undefined;
      if (ref) masks.add(ref.toString());
      if (value instanceof PDFDict) {
        const nested = value.get(PDFName.of("S"));
        if (nested instanceof PDFRef) masks.add(nested.toString());
      }
    }
  }
  return masks;
}

interface ImageCandidate {
  ref: string;
  stream: PDFRawStreamType;
  width: number;
  height: number;
}

function findImageCandidates(
  doc: PDFDocument,
  pdfjs: typeof import("pdf-lib"),
  masks: Set<string>,
): ImageCandidate[] {
  const { PDFName, PDFNumber } = pdfjs;
  const found = new Map<string, ImageCandidate>();

  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof pdfjs.PDFRawStream)) continue;
    if (masks.has(ref.toString())) continue;

    const subtype = asNameString(object.dict.get(PDFName.of("Subtype")));
    if (subtype !== "Image") continue;
    // Stencil masks are 1-bit; downsampling them would destroy them.
    if (object.dict.has(PDFName.of("ImageMask"))) continue;

    const width = asNumber(object.dict.get(PDFName.of("Width")), pdfjs);
    const height = asNumber(object.dict.get(PDFName.of("Height")), pdfjs);
    if (!width || !height) continue;

    found.set(ref.toString(), { ref: ref.toString(), stream: object, width, height });
  }
  return [...found.values()];
}

/**
 * Replace every reference to `replacements` in the reachable resource tree,
 * including nested Form XObjects and tiling patterns, and report how many
 * resource slots changed.
 *
 * Anything we miss is simply not substituted: the old object stays reachable, so
 * it is never deleted and the output stays valid. It just stays large.
 */
async function substituteResourceRefs(
  doc: PDFDocument,
  resources: PDFDictType | undefined,
  replacements: Map<string, PDFRefType>,
  seen: Set<PDFDictType>,
): Promise<number> {
  const { PDFDict, PDFName, PDFRef, PDFStream } = await loadPdfLib();
  if (!resources) return 0;
  if (seen.has(resources)) return 0;
  seen.add(resources);

  let changed = 0;

  const xObjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (xObjects) {
    for (const [name, value] of xObjects.entries()) {
      if (!(value instanceof PDFRef)) continue;
      const target = doc.context.lookup(value);
      if (!(target instanceof PDFStream)) continue;

      const subtype = asNameString(target.dict.get(PDFName.of("Subtype")));
      if (subtype === "Form") {
        const nested = doc.context.lookupMaybe(target.dict.get(PDFName.of("Resources")), PDFDict);
        changed += await substituteResourceRefs(doc, nested, replacements, seen);
        continue;
      }

      const replacement = replacements.get(value.toString());
      if (replacement) {
        xObjects.set(name, replacement);
        changed += 1;
      }
    }
  }

  // Tiling patterns carry their own resource dictionary, so walk into those too.
  const patterns = resources.lookupMaybe(PDFName.of("Pattern"), PDFDict);
  if (patterns) {
    for (const [, value] of patterns.entries()) {
      const target = value instanceof PDFRef ? doc.context.lookup(value) : value;
      if (!(target instanceof PDFStream)) continue;
      const nested = doc.context.lookupMaybe(target.dict.get(PDFName.of("Resources")), PDFDict);
      changed += await substituteResourceRefs(doc, nested, replacements, seen);
    }
  }

  return changed;
}

/* ------------------------------------------------------------------ */
/*  Compression                                                        */
/* ------------------------------------------------------------------ */

export type CompressPhase = "reading" | "images" | "cleanup" | "writing";

export interface CompressProgress {
  phase: CompressPhase;
  /** 0–1 across the image pass, or null when it is not knowable. */
  ratio: number | null;
  detail: string;
}

/**
 * The real thing, and only the real thing.
 *
 * What this does:
 *   1. Decodes each raster image XObject it understands, downscales it to
 *      `maxDimension` and re-encodes it as JPEG at `jpegQuality`.
 *   2. Re-deflates page content streams that were stored uncompressed.
 *   3. Optionally clears the info dictionary and XMP stream.
 *   4. Deletes objects nothing points at any more.
 *
 * What it does NOT do: re-encode vector art, subset fonts, or drop a colour
 * space. A PDF that is already optimised comes out the same size, and the
 * report says so rather than inventing a saving.
 */
export async function compressPdf(
  source: Blob,
  options: CompressOptions,
  onProgress?: (progress: CompressProgress) => void,
): Promise<{ blob: Blob; report: CompressReport }> {
  const pdfjs = await loadPdfLib();
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } = pdfjs;

  onProgress?.({ phase: "reading", ratio: null, detail: "Reading the document" });
  const bytesBefore = source.size;
  const doc = await loadPdfDocument(source);

  // 1 ── image downsampling
  onProgress?.({ phase: "images", ratio: 0, detail: "Scanning embedded images" });
  const masks = await collectMaskRefs(doc);
  const candidates = findImageCandidates(doc, pdfjs, masks);
  const replacements = new Map<string, PDFRefType>();

  let processed = 0;
  for (const candidate of candidates) {
    processed += 1;
    if (
      options.maxDimension <= 0 ||
      Math.max(candidate.width, candidate.height) <= options.maxDimension
    ) {
      onProgress?.({
        phase: "images",
        ratio: processed / candidates.length,
        detail: `Image ${processed} of ${candidates.length} — already within the size limit`,
      });
      continue;
    }

    const decoded = await decodeImageXObject(candidate.stream, pdfjs);
    if (!decoded) {
      onProgress?.({
        phase: "images",
        ratio: processed / candidates.length,
        detail: `Image ${processed} of ${candidates.length} — encoding not supported, left as is`,
      });
      continue;
    }

    let reencoded: { bytes: Uint8Array; width: number; height: number };
    try {
      reencoded = await downscaleToJpeg(decoded, options.maxDimension, options.jpegQuality);
    } catch {
      onProgress?.({
        phase: "images",
        ratio: processed / candidates.length,
        detail: `Image ${processed} of ${candidates.length} — could not be re-encoded`,
      });
      continue;
    }

    // Never let an image grow: only substitute when it is genuinely smaller.
    if (reencoded.bytes.length >= candidate.stream.getContentsSize()) {
      onProgress?.({
        phase: "images",
        ratio: processed / candidates.length,
        detail: `Image ${processed} of ${candidates.length} — re-encoding was not smaller, kept the original`,
      });
      continue;
    }

    const dict = PDFDict.withContext(doc.context);
    dict.set(PDFName.of("Type"), PDFName.of("XObject"));
    dict.set(PDFName.of("Subtype"), PDFName.of("Image"));
    dict.set(PDFName.of("Width"), PDFNumber.of(reencoded.width));
    dict.set(PDFName.of("Height"), PDFNumber.of(reencoded.height));
    dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
    dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    replacements.set(candidate.ref, doc.context.register(PDFRawStream.of(dict, reencoded.bytes)));

    onProgress?.({
      phase: "images",
      ratio: processed / candidates.length,
      detail: `Image ${processed} of ${candidates.length} — re-encoded to ${reencoded.width}×${reencoded.height}`,
    });
  }

  // Point every resource slot at the new object, pages and nested forms included.
  if (replacements.size > 0) {
    const seen = new Set<PDFDictType>();
    for (const page of doc.getPages()) {
      const resources = page.node.Resources();
      await substituteResourceRefs(doc, resources, replacements, seen);
    }
  }

  // 2 ── content streams
  onProgress?.({ phase: "cleanup", ratio: null, detail: "Re-compressing page content" });
  const streamsRecompressed = await recompressContentStreams(doc);

  // 3 ── metadata
  if (options.stripMetadata) await stripDocumentMetadata(doc);

  // 4 ── orphan sweep
  const orphanedObjectsRemoved = await removeOrphanedObjects(doc);

  onProgress?.({ phase: "writing", ratio: null, detail: "Writing the new document" });
  const saved = await doc.save();
  const bytesAfter = saved.length;

  return {
    blob: pdfBlob(saved),
    report: {
      bytesBefore,
      bytesAfter,
      imagesDownsampled: replacements.size,
      imagesTotal: candidates.length,
      imagesSkipped: candidates.length - replacements.size,
      streamsRecompressed,
      orphanedObjectsRemoved,
      metadataStripped: options.stripMetadata,
      grew: bytesAfter > bytesBefore,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Repair                                                             */
/* ------------------------------------------------------------------ */

export interface RepairFinding {
  kind: "fixed" | "info" | "clean";
  text: string;
}

export interface RepairResult {
  /** A re-saved document with a fresh cross-reference table. */
  blob: Blob;
  findings: RepairFinding[];
  /** True when the parser found nothing wrong at all. */
  nothingToRepair: boolean;
  bytesBefore: number;
  bytesAfter: number;
  pageCount: number;
}

function tailText(bytes: Uint8Array, length: number): string {
  const start = Math.max(0, bytes.length - length);
  let text = "";
  for (let i = start; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]!);
  }
  return text;
}

/**
 * Load, rebuild and re-save, then report what actually changed.
 *
 * A PDF that pdf-lib parses cleanly was never badly broken, and saying so is
 * more useful than claiming a repair that did not happen. The structural
 * markers we check are read out of the raw bytes, not guessed.
 */
export async function repairPdf(
  source: Blob,
  options: { dropOrphans: boolean },
): Promise<RepairResult> {
  const pdfjs = await loadPdfLib();
  const bytes = new Uint8Array(await source.arrayBuffer());
  const bytesBefore = bytes.length;
  const tail = tailText(bytes, 2048);

  const { PDFDocument } = pdfjs;
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (error) {
    throw new Error(
      describeUnknownError(
        error,
        "This PDF could not be parsed at all, so its structure cannot be rebuilt. The file may be truncated — check that the download completed.",
      ),
    );
  }

  const findings: RepairFinding[] = [];
  const hasEof = tail.includes("%%EOF");
  const hasStartXref = /startxref/.test(tail);
  const hasXref = /\bxref\b/.test(tail) || /\/Type\s*\/XRef/.test(tail);
  const objects = doc.context.enumerateIndirectObjects();
  const invalidObjects = objects.filter(([, object]) => object instanceof pdfjs.PDFInvalidObject);

  if (invalidObjects.length > 0) {
    findings.push({
      kind: "fixed",
      text: `Rebuilt ${invalidObjects.length} unreadable object${
        invalidObjects.length === 1 ? "" : "s"
      } from the surrounding structure.`,
    });
  }

  if (!hasEof) {
    findings.push({
      kind: "fixed",
      text: "The last 2 KB of the file had no %%EOF marker — the usual sign of a download that was interrupted or a file with junk appended. The rewritten file ends with a proper one.",
    });
  }
  if (!hasStartXref || !hasXref) {
    findings.push({
      kind: "fixed",
      text: "The last 2 KB had no cross-reference table or startxref pointer where a reader looks for it. The rewritten file has a freshly generated one.",
    });
  }

  const pageCount = doc.getPageCount();
  findings.push({
    kind: "info",
    text: `Parsed ${objects.length} indirect object${
      objects.length === 1 ? "" : "s"
    } and ${pageCount} page${pageCount === 1 ? "" : "s"}.`,
  });

  let orphanedObjectsRemoved = 0;
  if (options.dropOrphans) {
    orphanedObjectsRemoved = await removeOrphanedObjects(doc);
    findings.push(
      orphanedObjectsRemoved > 0
        ? {
            kind: "fixed",
            text: `Removed ${orphanedObjectsRemoved} orphaned object${
              orphanedObjectsRemoved === 1 ? "" : "s"
            } that nothing referenced.`,
          }
        : { kind: "info", text: "No orphaned objects were found." },
    );
  }

  const saved = await doc.save();
  const bytesAfter = saved.length;

  if (!hasEof || !hasStartXref || !hasXref || invalidObjects.length > 0 || orphanedObjectsRemoved > 0) {
    findings.push({
      kind: "info",
      text: "Wrote a fresh cross-reference table; the output is a clean PDF 1.7 file.",
    });
  } else {
    findings.push({
      kind: "clean",
      text: "This PDF loaded without errors and its structure was already valid.",
    });
  }

  return {
    blob: pdfBlob(saved),
    findings,
    nothingToRepair:
      hasEof && hasStartXref && hasXref && invalidObjects.length === 0 && orphanedObjectsRemoved === 0,
    bytesBefore,
    bytesAfter,
    pageCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Merge / split / extract                                            */
/* ------------------------------------------------------------------ */

export interface PdfOutput {
  name: string;
  blob: Blob;
  note: string;
}

function safeStem(name: string, fallback: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]+/g, "").trim().replace(/^\.+/, "");
  return cleaned || fallback;
}

/** Merge documents in the order given, preserving page order and rotation. */
export async function mergePdfFiles(
  files: File[],
  onProgress?: (done: number, total: number, caption?: string) => void,
): Promise<{ blob: Blob; pageCount: number; fileCount: number }> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const merged = await PDFDocument.create();
  let pageCount = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    onProgress?.(index, files.length, `Reading ${file.name}`);
    const source = await loadPdfDocument(file);
    const sourcePages = source.getPages();
    const copied = await merged.copyPages(
      source,
      sourcePages.map((_, pageIndex) => pageIndex),
    );
    copied.forEach((page, pageIndex) => {
      // pdf-lib's page embedder does not carry /Rotate across documents, so we
      // copy it ourselves. A merged scan has to come out the right way up.
      const angle = sourcePages[pageIndex]?.getRotation().angle ?? 0;
      page.setRotation(degrees(((angle % 360) + 360) % 360));
      merged.addPage(page);
      pageCount += 1;
    });
    onProgress?.(index + 1, files.length, `Merged ${file.name}`);
  }

  onProgress?.(files.length, files.length, "Writing the merged document");
  const bytes = await merged.save();
  return { blob: pdfBlob(bytes), pageCount, fileCount: files.length };
}

export type SplitMode = "each" | "ranges" | "selection";

export interface SplitOptions {
  mode: SplitMode;
  rangeText: string;
  /** Zero-based page indices, used when mode is "selection". */
  selection: number[];
}

/** Group page indices for each output document, honouring the chosen mode. */
export function planSplit(totalPages: number, options: SplitOptions): PageRangeResult {
  if (options.mode === "selection") {
    if (options.selection.length === 0) {
      return { indices: [], error: "Select at least one page, or type a range." };
    }
    return { indices: [...options.selection].sort((a, b) => a - b), error: null };
  }
  if (options.mode === "each") {
    return { indices: Array.from({ length: totalPages }, (_, index) => index), error: null };
  }
  return parsePageRange(options.rangeText, totalPages);
}

export async function splitPdf(
  file: File,
  options: SplitOptions,
  onProgress?: (done: number, total: number, caption?: string) => void,
): Promise<PdfOutput[]> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const source = await loadPdfDocument(file);
  const totalPages = source.getPageCount();
  const parsed = planSplit(totalPages, options);
  if (parsed.error) throw new Error(parsed.error);
  const indices = parsed.indices;

  const groups: number[][] = [];
  if (options.mode === "each") {
    for (const index of indices) groups.push([index]);
  } else {
    groups.push(indices);
  }

  const stem = safeStem(file.name.replace(/\.pdf$/i, ""), "document");
  const outputs: PdfOutput[] = [];

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex]!;
    onProgress?.(groupIndex, groups.length, `Building part ${groupIndex + 1} of ${groups.length}`);

    const target = await PDFDocument.create();
    const sourcePages = group.map((index) => source.getPage(index));
    const copied = await target.copyPages(source, group);
    copied.forEach((page, pageIndex) => {
      const angle = sourcePages[pageIndex]?.getRotation().angle ?? 0;
      page.setRotation(degrees(((angle % 360) + 360) % 360));
      target.addPage(page);
    });

    const bytes = await target.save();
    // One file per page, or a single file, so the names must be unique on disk.
    const name =
      options.mode === "each"
        ? `${stem}-page-${String(groupIndex + 1).padStart(3, "0")}.pdf`
        : `${stem}-pages-${groupIndex + 1}.pdf`;

    outputs.push({
      name,
      blob: pdfBlob(bytes),
      note: `${group.length} page${group.length === 1 ? "" : "s"}`,
    });
  }

  onProgress?.(groups.length, groups.length, "Finished");
  return outputs;
}

/** Extract a selection of pages into one new document. */
export async function extractPdfPages(
  file: File,
  indices: number[],
): Promise<{ blob: Blob; pageCount: number }> {
  const { PDFDocument, degrees } = await loadPdfLib();
  if (indices.length === 0) throw new Error("Select at least one page, or type a range.");
  const source = await loadPdfDocument(file);
  const total = source.getPageCount();
  for (const index of indices) {
    if (index < 0 || index >= total) throw new Error("One of the selected pages is out of range.");
  }

  const target = await PDFDocument.create();
  const sourcePages = indices.map((index) => source.getPage(index));
  const copied = await target.copyPages(source, indices);
  copied.forEach((page, pageIndex) => {
    const angle = sourcePages[pageIndex]?.getRotation().angle ?? 0;
    page.setRotation(degrees(((angle % 360) + 360) % 360));
    target.addPage(page);
  });

  const bytes = await target.save();
  return { blob: pdfBlob(bytes), pageCount: indices.length };
}

/* ------------------------------------------------------------------ */
/*  Rotate                                                             */
/* ------------------------------------------------------------------ */

export type RotateAngle = 90 | 180 | 270;

export async function rotatePdfPages(
  file: File,
  indices: number[] | "all",
  angle: RotateAngle,
): Promise<{ blob: Blob; pageCount: number; rotated: number }> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const doc = await loadPdfDocument(file);
  const pages = doc.getPages();
  const targets = indices === "all" ? pages.map((_, index) => index) : indices;

  if (targets.length === 0) throw new Error("Select at least one page to rotate.");
  for (const index of targets) {
    if (index < 0 || index >= pages.length) throw new Error("One of the selected pages is out of range.");
  }

  for (const index of targets) {
    const page = pages[index]!;
    const current = page.getRotation().angle;
    const next = (((current + angle) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }

  const bytes = await doc.save();
  return { blob: pdfBlob(bytes), pageCount: pages.length, rotated: targets.length };
}

/* ------------------------------------------------------------------ */
/*  Page numbers                                                       */
/* ------------------------------------------------------------------ */

export type NumberPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type NumberFormat = "page-of" | "number" | "dashes";

export const NUMBER_POSITIONS: readonly NumberPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export const POSITION_LABEL: Record<NumberPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top centre",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
};

export const NUMBER_FORMAT_LABEL: Record<NumberFormat, string> = {
  "page-of": "Page 3 of 12",
  number: "3",
  dashes: "- 3 -",
};

export interface PageNumberOptions {
  position: NumberPosition;
  format: NumberFormat;
  /** The number given to the first numbered page. */
  startAt: number;
  skipFirstPage: boolean;
  fontSize: number;
  /** Distance from the page edge, in points. */
  margin: number;
}

export function pageNumberLabel(
  format: NumberFormat,
  pageNumber: number,
  total: number,
): string {
  if (format === "page-of") return `Page ${pageNumber} of ${total}`;
  if (format === "dashes") return `- ${pageNumber} -`;
  return String(pageNumber);
}

export async function addPageNumbers(
  file: File,
  options: PageNumberOptions,
): Promise<{ blob: Blob; pageCount: number; numbered: number }> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await loadPdfLib();
  const doc = await loadPdfDocument(file);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = pages.length;
  const first = options.skipFirstPage ? 1 : 0;
  let numbered = 0;

  for (let index = first; index < total; index += 1) {
    const page = pages[index]!;
    const { width, height } = page.getSize();
    const label = pageNumberLabel(options.format, options.startAt + (index - first), total);
    const textWidth = font.widthOfTextAtSize(label, options.fontSize);

    const horizontal = options.position.split("-")[0] as "top" | "bottom";
    const align = options.position.split("-")[1] as "left" | "center" | "right";
    const x =
      align === "left"
        ? options.margin
        : align === "right"
          ? width - options.margin - textWidth
          : (width - textWidth) / 2;
    const y = horizontal === "top" ? height - options.margin - options.fontSize : options.margin;

    page.drawText(label, {
      x,
      y,
      size: options.fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
      rotate: degrees(0),
    });
    numbered += 1;
  }

  const bytes = await doc.save();
  return { blob: pdfBlob(bytes), pageCount: total, numbered };
}

/* ------------------------------------------------------------------ */
/*  Watermark                                                          */
/* ------------------------------------------------------------------ */

export type WatermarkMode = "single" | "tile";

export interface WatermarkOptions {
  text: string;
  mode: WatermarkMode;
  /** 0.05–1. */
  opacity: number;
  fontSize: number;
  angle: number;
  /** "#rrggbb". */
  color: string;
  /** Zero-based page indices. */
  pages: number[];
  margin: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/** Centre `textWidth` on a `width × height` page, rotated by `angle` degrees. */
function centredRotatedOrigin(
  width: number,
  height: number,
  textWidth: number,
  fontSize: number,
  angle: number,
): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Nudge along the rotated "up" axis so the glyphs sit on the optical centre.
  const centreX = width / 2 - Math.sin(radians) * fontSize * 0.35;
  const centreY = height / 2 + Math.cos(radians) * fontSize * 0.35;
  return {
    x: centreX - (textWidth * cos) / 2,
    y: centreY - (textWidth * sin) / 2,
  };
}

/**
 * Reject text the standard font cannot encode, before we draw it.
 *
 * The Standard-14 fonts use WinAnsi, so an em dash or a CJK character would
 * otherwise blow up deep inside `encodeText` with an opaque error. Saying which
 * characters are the problem is far more useful.
 */
function assertEncodable(font: { getCharacterSet(): number[] }, text: string): void {
  const supported = new Set(font.getCharacterSet());
  const bad = [...new Set([...text])].filter(
    (character) => !supported.has(character.codePointAt(0) ?? 0),
  );
  if (bad.length === 0) return;
  const sample = bad.slice(0, 6).map((character) => `"${character}"`).join(", ");
  throw new Error(
    `The built-in Helvetica font cannot encode ${sample}. Use plain letters, digits and Western punctuation instead.`,
  );
}

export async function addWatermark(
  file: File,
  options: WatermarkOptions,
): Promise<{ blob: Blob; pageCount: number; watermarked: number }> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await loadPdfLib();
  const doc = await loadPdfDocument(file);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = options.text.trim();
  if (!text) throw new Error("Enter the text you want to stamp onto the pages.");
  if (options.pages.length === 0) throw new Error("Choose at least one page to watermark.");
  assertEncodable(font, text);

  const colour = hexToRgb(options.color) ?? { r: 0.85, g: 0.1, b: 0.1 };
  const fill = rgb(colour.r, colour.g, colour.b);
  const textWidth = font.widthOfTextAtSize(text, options.fontSize);
  const lineHeight = font.heightAtSize(options.fontSize);
  const radians = (options.angle * Math.PI) / 180;
  let watermarked = 0;

  for (const index of options.pages) {
    if (index < 0 || index >= pages.length) {
      throw new Error("One of the selected pages is out of range.");
    }
    const page = pages[index]!;
    const { width, height } = page.getSize();

    if (options.mode === "single") {
      const origin = centredRotatedOrigin(width, height, textWidth, options.fontSize, options.angle);
      page.drawText(text, {
        x: origin.x,
        y: origin.y,
        size: options.fontSize,
        font,
        color: fill,
        opacity: options.opacity,
        rotate: degrees(options.angle),
      });
      watermarked += 1;
      continue;
    }

    // Tiled: walk a grid in the rotated frame and map each cell back to the page.
    const diagonal = Math.hypot(width, height);
    const stepX = textWidth + options.fontSize * 2;
    const stepY = lineHeight * 4;
    const columns = Math.max(1, Math.ceil(diagonal / stepX));
    const rows = Math.max(1, Math.ceil(diagonal / stepY));
    if (columns * rows > 400) continue; // Refuse to emit an absurd operator list.

    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const u = -diagonal / 2 + column * stepX;
        const v = -diagonal / 2 + row * stepY;
        page.drawText(text, {
          x: width / 2 + u * cos - v * sin,
          y: height / 2 + u * sin + v * cos,
          size: options.fontSize,
          font,
          color: fill,
          opacity: options.opacity,
          rotate: degrees(options.angle),
        });
      }
    }
    watermarked += 1;
  }

  const bytes = await doc.save();
  return { blob: pdfBlob(bytes), pageCount: pages.length, watermarked };
}

/* ------------------------------------------------------------------ */
/*  Text extraction                                                    */
/* ------------------------------------------------------------------ */

export type PageSeparator = "none" | "blank-line" | "page-header" | "form-feed";

export const PAGE_SEPARATOR_LABEL: Record<PageSeparator, string> = {
  none: "No separator",
  "blank-line": "Blank line between pages",
  "page-header": "— Page N — header",
  "form-feed": "Form feed (\\f) between pages",
};

export interface TextExtractionOptions {
  /** Zero-based page indices, or null for the whole document. */
  pages: number[] | null;
  separator: PageSeparator;
}

export interface TextExtractionResult {
  text: string;
  pageTexts: string[];
  totalCharacters: number;
  totalWords: number;
  pagesRead: number;
  pagesWithText: number;
}

function separatorFor(mode: PageSeparator, pageNumber: number): string {
  if (mode === "none") return "";
  if (mode === "blank-line") return "\n\n";
  if (mode === "form-feed") return "\n\f\n";
  return `\n\n— Page ${pageNumber} —\n\n`;
}

/**
 * Turn a page's positioned glyph runs into lines.
 *
 * A PDF stores text as glyph runs with a transform matrix, not as paragraphs.
 * We treat a meaningful Y change as a new line and a horizontal gap as a space.
 */
function pageContentToText(content: PdfJsTextContent): string {
  let out = "";
  let lastY: number | null = null;
  let lastRight: number | null = null;
  let lastHeight = 0;

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const text = item.str;
    if (text.length === 0) continue;

    const x = typeof item.transform[4] === "number" ? item.transform[4] : 0;
    const y = typeof item.transform[5] === "number" ? item.transform[5] : 0;
    const width = Math.abs(item.width ?? 0);
    const height = Math.abs(item.height ?? 0) || lastHeight || 10;

    if (lastY !== null && lastRight !== null) {
      const deltaY = Math.abs(y - lastY);
      if (deltaY > Math.max(1, height * 0.3)) {
        out += "\n";
      } else if (x - lastRight > Math.max(height * 0.2, width * 0.2)) {
        out += " ";
      }
    }

    out += text;

    if (item.hasEOL) {
      out += "\n";
      lastY = null;
      lastRight = null;
    } else {
      lastY = y;
      lastRight = x + width;
    }
    lastHeight = height;
  }

  return out;
}

export async function extractPdfText(
  source: Blob,
  options: TextExtractionOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<TextExtractionResult> {
  return withPdfJsDocument(source, async (doc) => {
    const total = options.pages ? options.pages.length : doc.numPages;
    const indices =
      options.pages ??
      Array.from({ length: doc.numPages }, (_, index) => index);

    const pageTexts: string[] = [];
    const parts: string[] = [];
    let totalCharacters = 0;
    let totalWords = 0;
    let pagesWithText = 0;

    for (let position = 0; position < indices.length; position += 1) {
      const index = indices[position]!;
      const page = await doc.getPage(index + 1);
      let text = "";
      try {
        const content = await page.getTextContent();
        text = pageContentToText(content);
      } finally {
        page.cleanup();
      }

      const trimmed = text.trim();
      if (trimmed.length > 0) pagesWithText += 1;
      pageTexts.push(trimmed);
      if (position > 0) parts.push(separatorFor(options.separator, index + 1));
      parts.push(text.replace(/\n{3,}/g, "\n\n").trim());
      totalCharacters += trimmed.length;
      if (trimmed.length > 0) {
        totalWords += trimmed.split(/\s+/).filter(Boolean).length;
      }
      onProgress?.(position + 1, total);
    }

    return {
      text: parts.join("").trim(),
      pageTexts,
      totalCharacters,
      totalWords,
      pagesRead: indices.length,
      pagesWithText,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Images to PDF                                                      */
/* ------------------------------------------------------------------ */

export type PdfPaperSize = "a4" | "letter" | "fit";
export type PdfOrientation = "auto" | "portrait" | "landscape";

export const PAPER_SIZE_LABEL: Record<PdfPaperSize, string> = {
  a4: "A4 (210 × 297 mm)",
  letter: "US Letter (8.5 × 11 in)",
  fit: "Fit to image (no margin)",
};

export const ORIENTATION_LABEL: Record<PdfOrientation, string> = {
  auto: "Auto — match the image",
  portrait: "Portrait",
  landscape: "Landscape",
};

export interface ImagesToPdfOptions {
  paperSize: PdfPaperSize;
  orientation: PdfOrientation;
  /** Points, 0–50. */
  margin: number;
}

const A4: PageSize = { width: 595.28, height: 841.89 };
const LETTER: PageSize = { width: 612, height: 792 };

function sniffImageFormat(bytes: Uint8Array): "jpeg" | "png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  return null;
}

function containSize(image: { width: number; height: number }, box: PageSize): PageSize {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export interface ImagesToPdfResult {
  blob: Blob;
  pageCount: number;
  /** One entry per image: the page size actually used. */
  pageSizes: PageSize[];
}

/** Turn images into a PDF, one image per page, at real page dimensions. */
export async function imagesToPdf(
  files: File[],
  options: ImagesToPdfOptions,
  onProgress?: (done: number, total: number, caption?: string) => void,
): Promise<ImagesToPdfResult> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const pageSizes: PageSize[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    onProgress?.(index, files.length, `Placing ${file.name}`);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const format = sniffImageFormat(bytes);
    if (!format) {
      throw new Error(
        `"${file.name}" is not a JPEG or PNG. This tool only embeds the raw bytes, so the format has to be exact.`,
      );
    }

    const image: PDFImage = format === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const pixel = { width: image.width, height: image.height };

    let page: PageSize;
    if (options.paperSize === "fit") {
      page = pixel;
    } else {
      const base = options.paperSize === "letter" ? LETTER : A4;
      const landscape =
        options.orientation === "landscape" ||
        (options.orientation === "auto" && pixel.width > pixel.height);
      page = landscape ? { width: base.height, height: base.width } : base;
    }

    const margin = options.paperSize === "fit" ? 0 : options.margin;
    const box: PageSize = {
      width: Math.max(1, page.width - margin * 2),
      height: Math.max(1, page.height - margin * 2),
    };
    const drawn = containSize(pixel, box);

    const pdfPage = doc.addPage([page.width, page.height]);
    pdfPage.drawImage(image, {
      x: margin + (box.width - drawn.width) / 2,
      y: margin + (box.height - drawn.height) / 2,
      width: drawn.width,
      height: drawn.height,
    });
    pageSizes.push(page);
    onProgress?.(index + 1, files.length, `Placed ${file.name}`);
  }

  onProgress?.(files.length, files.length, "Writing the document");
  const bytes = await doc.save();
  return { blob: pdfBlob(bytes), pageCount: files.length, pageSizes };
}

/* ------------------------------------------------------------------ */
/*  Re-exported pdf-lib types used across the workspaces               */
/* ------------------------------------------------------------------ */

export type { PDFArrayType, PDFDictType, PDFNameType, PDFNumberType, PDFRawStreamType, PDFRefType };
export type PdfLibDocument = PDFDocument;
export type PdfLibPage = PDFPage;
export type PdfJsDocument = PDFDocumentProxy;
export type PdfJsPage = PDFPageProxy;
