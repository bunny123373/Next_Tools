/**
 * Shared image engine.
 *
 * Every tool in the image category funnels through the helpers in this file, so
 * decoding, canvas sizing and encoding behave identically everywhere. React-free
 * by design: these functions may use browser APIs (`createImageBitmap`,
 * `<canvas>`, `toBlob`) because they only ever run client-side, and several of
 * them are safe to call from a Server Component at import time (no DOM access
 * happens until a function is invoked).
 *
 * Two rules run through the whole module:
 *
 *  1. **Never fake support.** `canvasToBlob` rejects when the browser cannot
 *     produce the requested type, and `probeEncoders` encodes a real 1×1
 *     canvas rather than sniffing `toDataURL` strings. Callers surface that as a
 *     readable message instead of handing the user a broken download.
 *  2. **Never silently distort.** Alpha, orientation and edge bleed are handled
 *     explicitly, and metadata that the browser throws away on re-encode is
 *     reported rather than hidden.
 */

import { getExtension } from "@/lib/utils/files";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ImageSize {
  width: number;
  height: number;
}

/** Anything that can be drawn and reports its intrinsic size. */
export type SizedSource = CanvasImageSource & ImageSize;

export type OutputMime = "image/jpeg" | "image/png" | "image/webp";

export interface OutputFormat {
  mime: OutputMime;
  ext: string;
  label: string;
  /** True when a `quality` argument actually changes the bytes. */
  lossy: boolean;
}

/** The three formats every browser that supports `canvas.toBlob` can write. */
export const OUTPUT_FORMATS: readonly OutputFormat[] = [
  { mime: "image/jpeg", ext: "jpg", label: "JPEG", lossy: true },
  { mime: "image/png", ext: "png", label: "PNG", lossy: false },
  { mime: "image/webp", ext: "webp", label: "WebP", lossy: true },
];

const FORMAT_BY_MIME = new Map<string, OutputFormat>(
  OUTPUT_FORMATS.map((format) => [format.mime, format]),
);

export function formatForMime(mime: string): OutputFormat | null {
  return FORMAT_BY_MIME.get(mime) ?? null;
}

/** Human label for a MIME type, falling back to the raw string. */
export function mimeLabel(mime: string): string {
  return formatForMime(mime)?.label ?? mime.replace(/^image\//, "").toUpperCase();
}

/** The output type for a source file: its own type when we can re-encode it,
 *  PNG otherwise (GIF/BMP/AVIF cannot be written by `canvas.toBlob`). */
export function outputTypeFor(file: Blob, name?: string): OutputMime {
  if (formatForMime(file.type)) return file.type as OutputMime;
  const ext = getExtension(name ?? "");
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "image/png";
}

/* ------------------------------------------------------------------ */
/*  Encoder support — probed, not assumed                              */
/* ------------------------------------------------------------------ */

/**
 * What this browser can actually *write*. Populated by `probeEncoders()`.
 * `null` means the probe has not run yet.
 */
let encoderReport: Record<OutputMime, boolean> | null = null;

/** Last-resort answer used before the probe resolves. WebP is assumed
 *  available: every browser that ships `canvas.toBlob` also ships WebP
 *  encoding, and the probe corrects it within a frame. */
const ENCODER_BASELINE: Record<OutputMime, boolean> = {
  "image/jpeg": true,
  "image/png": true,
  "image/webp": true,
};

/**
 * Encode a real 1×1 canvas for every supported type and keep the answer.
 * Runs once per page load. Browsers that do not know a type fall back to PNG
 * and hand back a blob whose `type` is `image/png` — which is exactly how we
 * detect the "this browser cannot write WebP" case.
 */
export async function probeEncoders(): Promise<Record<OutputMime, boolean>> {
  if (encoderReport) return encoderReport;

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  const report: Record<OutputMime, boolean> = { ...ENCODER_BASELINE };

  if (ctx && typeof canvas.toBlob === "function") {
    ctx.fillStyle = "#ff3b30";
    ctx.fillRect(0, 0, 1, 1);
    for (const format of OUTPUT_FORMATS) {
      report[format.mime] = await new Promise<boolean>((resolve) => {
        try {
          canvas.toBlob(
            (blob) => resolve(blob !== null && blob.type === format.mime),
            format.mime,
            0.8,
          );
        } catch {
          resolve(false);
        }
      });
    }
  } else {
    for (const format of OUTPUT_FORMATS) report[format.mime] = false;
  }

  encoderReport = report;
  return report;
}

/** Synchronous view of the probe. See `probeEncoders` for the real work. */
export function encodeSupported(mime: string): boolean {
  const report = encoderReport ?? ENCODER_BASELINE;
  return report[mime as OutputMime] ?? false;
}

/** The output types this browser can write, in canonical order. */
export function supportedOutputTypes(): readonly OutputFormat[] {
  return OUTPUT_FORMATS.filter((format) => encodeSupported(format.mime));
}

/* ------------------------------------------------------------------ */
/*  Canvas filter support                                              */
/* ------------------------------------------------------------------ */

let filterSupport: boolean | null = null;

/**
 * Feature-detect `CanvasRenderingContext2D.filter`.
 *
 * Two checks, because they fail differently: some engines do not have the
 * property at all, and others accept the string but never apply it. We assert
 * that a saturated red pixel actually comes back grey.
 */
export function supportsCanvasFilter(): boolean {
  if (filterSupport !== null) return filterSupport;

  let supported = false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (ctx && typeof ctx.filter === "string") {
      ctx.filter = "grayscale(1)";
      const accepted = ctx.filter.replace(/\s+/g, "") === "grayscale(1)";
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 1, 1);
      const px = ctx.getImageData(0, 0, 1, 1).data;
      supported = accepted && (px[0] !== 255 || px[1] !== 0 || px[2] !== 0);
    }
  } catch {
    supported = false;
  }

  filterSupport = supported;
  return supported;
}

/* ------------------------------------------------------------------ */
/*  Decoding                                                           */
/* ------------------------------------------------------------------ */

const DECODE_HINT =
  "The browser could not decode that image. It may be truncated, or the format may not be supported here.";

/** Decode via `<img>` + object URL. The URL is always revoked. */
function decodeViaElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(DECODE_HINT));
    image.src = url;
  });
}

/**
 * A decoded image: an `ImageBitmap` where one is available, an `<img>` element
 * otherwise. Both draw and both report an intrinsic size, which is all the
 * operations below need.
 */
export type LoadedSource = CanvasImageSource &
  ImageSize & {
    /** Present on `ImageBitmap`; absent on the `<img>` fallback. */
    close?: () => void;
  };

/**
 * Decode a blob into something drawable.
 *
 * `createImageBitmap` rejects some perfectly valid files — a few SVG and HEIC
 * variants, and anything the image decoder sniffs differently from the blob
 * sniffer — so we fall back to an `<img>` element and then re-wrap the decoded
 * element in a bitmap. When the browser has no `createImageBitmap` at all
 * (Safari 11–14) the element is returned as-is, which every operation here can
 * still draw. The object URL is always revoked.
 */
export async function loadSource(blob: Blob): Promise<LoadedSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to the element path below.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await decodeViaElement(url);
    const natural: ImageSize = { width: image.naturalWidth, height: image.naturalHeight };
    if (natural.width < 1 || natural.height < 1) throw new Error(DECODE_HINT);

    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(image);
      } catch {
        // Fall through to the canvas path.
      }
      // A canvas is a different encode path, so it sometimes succeeds where the
      // element does not.
      const { canvas } = drawToCanvas(image, natural);
      return createImageBitmap(canvas);
    }

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** True when `source` is a real `ImageBitmap` rather than an element. */
function isImageBitmap(source: LoadedSource): source is ImageBitmap {
  return typeof (source as ImageBitmap).close === "function";
}

/**
 * Decode a blob to a real `ImageBitmap`. This is the strict form: it throws
 * where `loadSource` would settle for an `<img>` element, so prefer
 * `loadSource` unless the caller genuinely needs bitmap semantics.
 */
export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  const source = await loadSource(blob);
  if (isImageBitmap(source)) return source;
  throw new Error(
    "This browser has no createImageBitmap, so the image cannot be decoded as a bitmap.",
  );
}

/** Release a decoded source. Safe to call on the `<img>` fallback. */
function releaseSource(source: LoadedSource): void {
  source.close?.();
}

/** Intrinsic size without keeping the pixels around. */
export async function readImageSize(blob: Blob): Promise<ImageSize> {
  const source = await loadSource(blob);
  const size = { width: source.width, height: source.height };
  releaseSource(source);
  return size;
}

/* ------------------------------------------------------------------ */
/*  Canvas plumbing                                                    */
/* ------------------------------------------------------------------ */

export interface DrawOptions extends Partial<ImageSize> {
  /** Filled before the source is drawn. Use it for formats without alpha. */
  background?: string | null;
  /** A CSS filter applied while drawing the source, e.g. `"blur(4px)"`. */
  filter?: string | null;
  /** Defaults to true. Pixelate turns it off for its upscale pass. */
  smoothing?: boolean;
}

export interface DrawResult {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): DrawResult {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("This browser blocked the 2D canvas context, so the image cannot be processed.");
  }
  return { canvas, ctx };
}

/**
 * Size a source to a canvas. The context is always configured from scratch —
 * `filter` in particular is sticky state, so a forgotten reset would bleed one
 * tool's effect into the next.
 */
export function drawToCanvas(source: SizedSource, options: DrawOptions = {}): DrawResult {
  const width = options.width ?? source.width;
  const height = options.height ?? source.height;
  const { canvas, ctx } = createCanvas(width, height);

  ctx.filter = options.filter ?? "none";
  ctx.imageSmoothingEnabled = options.smoothing ?? true;
  ctx.imageSmoothingQuality = "high";

  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";
  return { canvas, ctx };
}

/* ------------------------------------------------------------------ */
/*  Encoding                                                           */
/* ------------------------------------------------------------------ */

/**
 * `canvas.toBlob` as a promise, with the two failure modes turned into
 * readable errors: no encoder at all, and a silent fallback to another format.
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(
        new Error(
          "This browser cannot export canvas images, so the result cannot be produced here.",
        ),
      );
      return;
    }

    // PNG ignores `quality`; passing it anyway is harmless but noisy.
    const lossy = formatForMime(type)?.lossy ?? true;

    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(
              new Error(
                `This browser could not encode the image as ${mimeLabel(type)}. ` +
                  "Use a different output format — JPEG and PNG work everywhere.",
              ),
            );
            return;
          }
          if (blob.type && type && blob.type !== type) {
            reject(
              new Error(
                `This browser does not support ${mimeLabel(type)} encoding — it produced ` +
                  `${mimeLabel(blob.type)} instead. Pick JPEG or PNG.`,
              ),
            );
            return;
          }
          resolve(blob);
        },
        type,
        lossy && quality !== undefined ? quality : undefined,
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The image could not be encoded."));
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Sizing maths                                                       */
/* ------------------------------------------------------------------ */

export interface FitOptions {
  maxWidth?: number;
  maxHeight?: number;
  /** Allow the result to be larger than the source. Off by default. */
  allowUpscale?: boolean;
}

/** Fit inside a box, never enlarging unless explicitly asked. */
export function fitSize(source: ImageSize, options: FitOptions): ImageSize {
  const { maxWidth, maxHeight, allowUpscale = false } = options;
  if (!maxWidth && !maxHeight) return { width: source.width, height: source.height };

  const ratios: number[] = [];
  if (maxWidth && maxWidth > 0) ratios.push(maxWidth / source.width);
  if (maxHeight && maxHeight > 0) ratios.push(maxHeight / source.height);
  if (!allowUpscale) ratios.push(1);

  const ratio = Math.min(...ratios);
  return {
    width: Math.max(1, Math.round(source.width * ratio)),
    height: Math.max(1, Math.round(source.height * ratio)),
  };
}

/** Uniform scale factor, e.g. for the 25% / 50% / 200% presets. */
export function scaleSize(source: ImageSize, factor: number): ImageSize {
  return {
    width: Math.max(1, Math.round(source.width * factor)),
    height: Math.max(1, Math.round(source.height * factor)),
  };
}

/** Parse a user-typed dimension. Returns null for anything not a positive int. */
export function parseDimension(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(parsed, 20000);
}

/* ------------------------------------------------------------------ */
/*  The generic render path                                            */
/* ------------------------------------------------------------------ */

export interface EncodedImage extends ImageSize {
  blob: Blob;
  type: string;
}

export interface RenderSpec extends ImageSize {
  background?: string | null;
  filter?: string | null;
  smoothing?: boolean;
  /**
   * Custom paint, for transforms that need a transform matrix (rotation,
   * flipping, watermarks). Defaults to a full-canvas `drawImage`.
   */
  paint?: (ctx: CanvasRenderingContext2D, size: ImageSize) => void;
}

async function renderToBlob(
  source: SizedSource,
  spec: RenderSpec,
  type: string,
  quality?: number,
): Promise<Blob> {
  const { canvas, ctx } = createCanvas(spec.width, spec.height);
  ctx.filter = spec.filter ?? "none";
  ctx.imageSmoothingEnabled = spec.smoothing ?? true;
  ctx.imageSmoothingQuality = "high";

  if (spec.background) {
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (spec.paint) {
    spec.paint(ctx, { width: canvas.width, height: canvas.height });
  } else {
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  ctx.filter = "none";
  return canvasToBlob(canvas, type, quality);
}

/* ------------------------------------------------------------------ */
/*  Public operations                                                  */
/* ------------------------------------------------------------------ */

export interface ReencodeOptions {
  type: OutputMime | string;
  /** 0–1. Ignored for lossless formats. */
  quality?: number;
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowUpscale?: boolean;
  /** CSS colour drawn under the image — required for JPEG with transparency. */
  background?: string | null;
  filter?: string | null;
}

/** Decode → optional resize → re-encode. The workhorse. */
export async function reencode(blob: Blob, options: ReencodeOptions): Promise<EncodedImage> {
  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };
    const fitted = fitSize(natural, {
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      allowUpscale: options.allowUpscale,
    });
    const width = options.width ?? fitted.width;
    const height = options.height ?? fitted.height;

    const out = await renderToBlob(
      source,
      { width, height, background: options.background ?? null, filter: options.filter ?? null },
      options.type,
      options.quality,
    );
    return { blob: out, width, height, type: options.type };
  } finally {
    releaseSource(source);
  }
}

/** Paint callback shared by the rotate and flip operations. */
function transformPaint(
  source: ImageSize,
  degrees: number,
  flipHorizontal: boolean,
  flipVertical: boolean,
) {
  return (ctx: CanvasRenderingContext2D) => {
    ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
    if (degrees) ctx.rotate((degrees * Math.PI) / 180);
    if (flipHorizontal || flipVertical) ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
    ctx.drawImage(
      source as CanvasImageSource,
      -source.width / 2,
      -source.height / 2,
      source.width,
      source.height,
    );
  };
}

export interface RotateOptions {
  degrees: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  type: OutputMime | string;
  quality?: number;
  background?: string | null;
}

/**
 * Rotate and mirror in a single re-encode.
 *
 * The angle is applied first and the mirror second, in the rotated frame —
 * the same order every photo editor uses. A quarter turn swaps the output
 * dimensions; any other angle gets a bounding box so nothing is clipped.
 */
export async function rotate(blob: Blob, options: RotateOptions): Promise<EncodedImage> {
  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };
    const normalised = ((options.degrees % 360) + 360) % 360;
    const onQuarterTurn = normalised % 90 === 0;
    const quarterTurn = Math.round(normalised / 90) % 4;

    let width: number;
    let height: number;
    if (onQuarterTurn) {
      const swaps = quarterTurn % 2 === 1;
      width = swaps ? natural.height : natural.width;
      height = swaps ? natural.width : natural.height;
    } else {
      const rad = (normalised * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      width = Math.max(1, Math.round(natural.width * cos + natural.height * sin));
      height = Math.max(1, Math.round(natural.width * sin + natural.height * cos));
    }

    const out = await renderToBlob(
      source,
      {
        width,
        height,
        background: options.background ?? null,
        paint: transformPaint(
          natural,
          normalised,
          Boolean(options.flipHorizontal),
          Boolean(options.flipVertical),
        ),
      },
      options.type,
      options.quality,
    );
    return { blob: out, width, height, type: options.type };
  } finally {
    releaseSource(source);
  }
}

export interface FlipOptions {
  horizontal: boolean;
  vertical: boolean;
  type: OutputMime | string;
  quality?: number;
  background?: string | null;
}

export async function flip(blob: Blob, options: FlipOptions): Promise<EncodedImage> {
  return rotate(blob, {
    degrees: 0,
    flipHorizontal: options.horizontal,
    flipVertical: options.vertical,
    type: options.type,
    quality: options.quality,
    background: options.background,
  });
}

export interface CropRect extends ImageSize {
  x: number;
  y: number;
}

/** Clamp a selection to the image and round it to whole pixels. */
export function clampRect(rect: CropRect, source: ImageSize): CropRect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, source.width - 1));
  const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, source.height - 1));
  const width = Math.min(Math.max(1, Math.round(rect.width)), source.width - x);
  const height = Math.min(Math.max(1, Math.round(rect.height)), source.height - y);
  return { x, y, width, height };
}

export interface CropOptions {
  rect: CropRect;
  type: OutputMime | string;
  quality?: number;
  background?: string | null;
}

export async function crop(blob: Blob, options: CropOptions): Promise<EncodedImage> {
  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };
    const rect = clampRect(options.rect, natural);
    const out = await renderToBlob(
      source,
      {
        width: rect.width,
        height: rect.height,
        background: options.background ?? null,
        paint: (ctx) => {
          ctx.drawImage(
            source,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            rect.width,
            rect.height,
          );
        },
      },
      options.type,
      options.quality,
    );
    return { blob: out, width: rect.width, height: rect.height, type: options.type };
  } finally {
    releaseSource(source);
  }
}

export interface BlurOptions {
  /** Gaussian radius in pixels. */
  radius: number;
  type: OutputMime | string;
  quality?: number;
  background?: string | null;
}

/**
 * True Gaussian blur through `ctx.filter`.
 *
 * The filter samples outside the geometry it is applied to, which normally
 * leaves a transparent halo around the border. We bleed the draw by a fraction
 * of the radius — capped so a big radius on a small image cannot visibly zoom
 * the picture — and for formats without alpha we fall back to the background
 * colour blending in.
 */
export async function blur(blob: Blob, options: BlurOptions): Promise<EncodedImage> {
  if (!supportsCanvasFilter()) {
    throw new Error(
      "This browser does not implement canvas filters, so a real blur cannot be rendered here.",
    );
  }

  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };
    const radius = Math.max(0, options.radius);
    const bleed = Math.min(radius, Math.floor(Math.min(natural.width, natural.height) * 0.03));

    const out = await renderToBlob(
      source,
      {
        width: natural.width,
        height: natural.height,
        background: options.background ?? null,
        filter: `blur(${radius}px)`,
        paint: (ctx) => {
          ctx.drawImage(
            source,
            -bleed,
            -bleed,
            natural.width + bleed * 2,
            natural.height + bleed * 2,
          );
        },
      },
      options.type,
      options.quality,
    );
    return { blob: out, width: natural.width, height: natural.height, type: options.type };
  } finally {
    releaseSource(source);
  }
}

export interface PixelateOptions {
  /** Size of one square "pixel" in source pixels. */
  pixelSize: number;
  type: OutputMime | string;
  quality?: number;
  background?: string | null;
}

/**
 * Honest pixelation: downscale to a grid of large blocks, then upscale with
 * smoothing off so the browser reproduces the blocks as hard squares. No
 * blur, no overlay — the pixels really are gone.
 */
export async function pixelate(blob: Blob, options: PixelateOptions): Promise<EncodedImage> {
  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };
    const block = Math.max(2, Math.round(options.pixelSize));
    const smallW = Math.max(1, Math.round(natural.width / block));
    const smallH = Math.max(1, Math.round(natural.height / block));

    const small = createCanvas(smallW, smallH);
    small.ctx.imageSmoothingEnabled = true;
    small.ctx.imageSmoothingQuality = "high";
    if (options.background) {
      small.ctx.fillStyle = options.background;
      small.ctx.fillRect(0, 0, smallW, smallH);
    }
    small.ctx.drawImage(source, 0, 0, smallW, smallH);

    const { canvas, ctx } = createCanvas(natural.width, natural.height);
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small.canvas, 0, 0, smallW, smallH, 0, 0, natural.width, natural.height);

    const out = await canvasToBlob(canvas, options.type, options.quality);
    return { blob: out, width: natural.width, height: natural.height, type: options.type };
  } finally {
    releaseSource(source);
  }
}

export interface GrayscaleOptions {
  /** 0–100. 100 is a full conversion. */
  amount: number;
  type: OutputMime | string;
  quality?: number;
  background?: string | null;
  /** Pass false to force the manual per-pixel path. */
  filterSupported?: boolean;
}

/** Rows per band in the manual fallback, so a huge image never needs a
 *  `getImageData` call for the whole frame at once. */
const BAND_ROWS = 1024;

/**
 * Grayscale with a real strength control.
 *
 * `grayscale(N%)` does the whole job when the browser implements canvas
 * filters, which is the fast path and needs no pixel readback. Where the filter
 * is missing we blend luminance per pixel in horizontal bands — slower, but it
 * produces the same result everywhere rather than pretending with a different
 * effect.
 */
export async function grayscale(blob: Blob, options: GrayscaleOptions): Promise<EncodedImage> {
  const amount = Math.min(100, Math.max(0, Math.round(options.amount)));
  const canFilter = (options.filterSupported ?? supportsCanvasFilter()) && amount > 0;

  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };

    if (canFilter) {
      const out = await renderToBlob(
        source,
        {
          width: natural.width,
          height: natural.height,
          background: options.background ?? null,
          filter: `grayscale(${amount}%)`,
        },
        options.type,
        options.quality,
      );
      return { blob: out, width: natural.width, height: natural.height, type: options.type };
    }

    const { canvas, ctx } = drawToCanvas(source, {
      width: natural.width,
      height: natural.height,
      background: options.background ?? null,
    });

    const strength = amount / 100;
    for (let y = 0; y < natural.height; y += BAND_ROWS) {
      const rows = Math.min(BAND_ROWS, natural.height - y);
      const band = ctx.getImageData(0, y, natural.width, rows);
      const data = band.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        // Rec. 601 luma, the same weighting CSS `grayscale()` uses.
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = data[i] + (luma - data[i]) * strength;
        data[i + 1] = data[i + 1] + (luma - data[i + 1]) * strength;
        data[i + 2] = data[i + 2] + (luma - data[i + 2]) * strength;
      }
      ctx.putImageData(band, 0, y);
    }

    const out = await canvasToBlob(canvas, options.type, options.quality);
    return { blob: out, width: natural.width, height: natural.height, type: options.type };
  } finally {
    releaseSource(source);
  }
}

/* ------------------------------------------------------------------ */
/*  Watermark                                                          */
/* ------------------------------------------------------------------ */

export const WATERMARK_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top centre",
  "top-right": "Top right",
  "middle-left": "Middle left",
  center: "Centre",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
};

export interface TextWatermark {
  mode: "text";
  text: string;
  color: string;
  /** Font size as a percentage of the image's shorter side. */
  sizePercent: number;
  rotation: number;
  opacity: number;
  position: WatermarkPosition;
  bold: boolean;
  italic: boolean;
  fontFamily: string;
}

export interface LogoWatermark {
  mode: "logo";
  logo: Blob;
  /** Logo width as a percentage of the image width. */
  widthPercent: number;
  rotation: number;
  opacity: number;
  position: WatermarkPosition;
}

export type WatermarkOptions = (TextWatermark | LogoWatermark) & {
  type: OutputMime | string;
  quality?: number;
  background?: string | null;
  /** Bound the render, for previews. Text and logo sizes are relative, so the
   *  result is proportional rather than different. */
  maxWidth?: number;
  maxHeight?: number;
};

const FONT_STACKS = [
  { label: "System sans", value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
] as const;

export { FONT_STACKS };

/** Anchor point for a position, in canvas pixels. */
function anchorFor(position: WatermarkPosition, width: number, height: number): [number, number] {
  const marginX = Math.max(12, Math.round(width * 0.04));
  const marginY = Math.max(12, Math.round(height * 0.04));
  const x =
    position.endsWith("left")
      ? marginX
      : position.endsWith("right")
        ? width - marginX
        : width / 2;
  const y = position.startsWith("top")
    ? marginY
    : position.startsWith("bottom")
      ? height - marginY
      : height / 2;
  return [x, y];
}

export async function watermark(blob: Blob, options: WatermarkOptions): Promise<EncodedImage> {
  const source = await loadSource(blob);
  let logoSource: LoadedSource | null = null;

  try {
    const decoded: ImageSize = { width: source.width, height: source.height };
    // Text and logo sizes are relative to the image, so a bounded render is
    // proportional rather than different — that is what previews rely on.
    const canvasSize = fitSize(decoded, {
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
    });

    if (options.mode === "logo") {
      logoSource = await loadSource(options.logo);
    }

    const out = await renderToBlob(
      source,
      {
        width: canvasSize.width,
        height: canvasSize.height,
        background: options.background ?? null,
        paint: (ctx) => {
          ctx.drawImage(source, 0, 0, canvasSize.width, canvasSize.height);
          if (options.mode === "logo") {
            if (!logoSource) return;
            const logoW = Math.max(1, Math.round(source.width * (options.widthPercent / 100)));
            const logoH = Math.max(
              1,
              Math.round(logoW * (logoSource.height / Math.max(1, logoSource.width))),
            );
            const [ax, ay] = anchorFor(options.position, canvasSize.width, canvasSize.height);
            ctx.save();
            ctx.globalAlpha = Math.min(1, Math.max(0, options.opacity / 100));
            ctx.translate(ax, ay);
            ctx.rotate((options.rotation * Math.PI) / 180);
            ctx.drawImage(logoSource, -logoW / 2, -logoH / 2, logoW, logoH);
            ctx.restore();
            return;
          }

          const text = options.text.trim();
          if (!text) return;
          const fontSize = Math.max(
            8,
            Math.round(Math.min(canvasSize.width, canvasSize.height) * (options.sizePercent / 100)),
          );
          const weight = options.bold ? "700" : "500";
          const style = options.italic ? "italic " : "";
          ctx.save();
          ctx.font = `${style}${weight} ${fontSize}px ${options.fontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.globalAlpha = Math.min(1, Math.max(0, options.opacity / 100));
          const [ax, ay] = anchorFor(options.position, canvasSize.width, canvasSize.height);
          ctx.translate(ax, ay);
          ctx.rotate((options.rotation * Math.PI) / 180);
          // A thin dark outline keeps light text legible on light photos.
          ctx.lineWidth = Math.max(1, fontSize / 14);
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
          ctx.strokeText(text, 0, 0);
          ctx.fillStyle = options.color;
          ctx.fillText(text, 0, 0);
          ctx.restore();
        },
      },
      options.type,
      options.quality,
    );

    return {
      blob: out,
      width: canvasSize.width,
      height: canvasSize.height,
      type: options.type,
    };
  } finally {
    releaseSource(source);
    logoSource?.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Colour extraction                                                  */
/* ------------------------------------------------------------------ */

export interface Swatch {
  hex: string;
  rgb: [number, number, number];
  /** Share of the sampled pixels in this cluster, 0–1. */
  share: number;
}

export interface PaletteResult {
  swatches: Swatch[];
  /** How many pixels fed the clustering. */
  sampledPixels: number;
  /** Size of the downscale the palette was computed from. */
  sampleSize: ImageSize;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/** Longest side of the analysis downscale. Big enough to be representative,
 *  small enough that clustering stays instant on a 100 MP photo. */
const PALETTE_SAMPLE_EDGE = 100;

interface Bin {
  r: number;
  g: number;
  b: number;
  count: number;
  rSum: number;
  gSum: number;
  bSum: number;
}

interface Box {
  bins: Bin[];
  count: number;
}

/** Draw a bounded-downscale of the image and hand back its pixels. */
async function samplePixels(
  blob: Blob,
  maxEdge: number,
): Promise<{ pixels: Uint8ClampedArray; size: ImageSize }> {
  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };
    const size = fitSize(natural, { maxWidth: maxEdge, maxHeight: maxEdge });
    const { canvas, ctx } = drawToCanvas(source, size);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { pixels: data, size: { width: canvas.width, height: canvas.height } };
  } finally {
    releaseSource(source);
  }
}

/**
 * Median-cut palette extraction over a 4-bit-per-channel histogram.
 *
 * Bucketing to 4096 bins first means the split/search works on a few thousand
 * weighted points instead of hundreds of thousands of pixels, which is what
 * makes this usable on a large photo without a worker.
 */
export async function extractPalette(blob: Blob, colorCount: number): Promise<PaletteResult> {
  const wanted = Math.min(24, Math.max(2, Math.round(colorCount)));
  const { pixels, size } = await samplePixels(blob, PALETTE_SAMPLE_EDGE);

  const bins = new Map<number, Bin>();
  let sampledPixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    sampledPixels += 1;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const existing = bins.get(key);
    if (existing) {
      existing.count += 1;
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
    } else {
      bins.set(key, { r: r >> 4, g: g >> 4, b: b >> 4, count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  if (sampledPixels === 0) {
    return { swatches: [], sampledPixels: 0, sampleSize: size };
  }

  let boxes: Box[] = [{ bins: [...bins.values()], count: sampledPixels }];

  while (boxes.length < wanted) {
    // Split the box that holds the most pixels and the widest channel range.
    let targetIndex = -1;
    let targetRange = -1;
    let targetPixels = 0;

    boxes.forEach((box, index) => {
      if (box.bins.length < 2) return;
      let rMin = 255;
      let rMax = 0;
      let gMin = 255;
      let gMax = 0;
      let bMin = 255;
      let bMax = 0;
      for (const bin of box.bins) {
        if (bin.r < rMin) rMin = bin.r;
        if (bin.r > rMax) rMax = bin.r;
        if (bin.g < gMin) gMin = bin.g;
        if (bin.g > gMax) gMax = bin.g;
        if (bin.b < bMin) bMin = bin.b;
        if (bin.b > bMax) bMax = bin.b;
      }
      const spread =
        Math.max(rMax - rMin, gMax - gMin, bMax - bMin) * 1024 + box.count;
      if (box.count > targetPixels || (box.count === targetPixels && spread > targetRange)) {
        targetIndex = index;
        targetRange = spread;
        targetPixels = box.count;
      }
    });

    if (targetIndex === -1) break;
    const target = boxes[targetIndex];
    if (!target) break;

    const channel = widestChannel(target.bins);
    target.bins.sort((a, b) => a[channel] - b[channel]);

    const half = target.count / 2;
    let running = 0;
    let splitAt = 0;
    for (let i = 0; i < target.bins.length - 1; i += 1) {
      running += target.bins[i]?.count ?? 0;
      splitAt = i + 1;
      if (running >= half) break;
    }

    const leftBins = target.bins.slice(0, splitAt);
    const rightBins = target.bins.slice(splitAt);
    if (leftBins.length === 0 || rightBins.length === 0) break;

    boxes = [
      ...boxes.slice(0, targetIndex),
      { bins: leftBins, count: sumCounts(leftBins) },
      { bins: rightBins, count: sumCounts(rightBins) },
      ...boxes.slice(targetIndex + 1),
    ];
  }

  const swatches: Swatch[] = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const bin of box.bins) {
      r += bin.rSum;
      g += bin.gSum;
      b += bin.bSum;
    }
    const rgb: [number, number, number] = [
      Math.round(r / box.count),
      Math.round(g / box.count),
      Math.round(b / box.count),
    ];
    return { hex: rgbToHex(rgb[0], rgb[1], rgb[2]), rgb, share: box.count / sampledPixels };
  });

  swatches.sort((a, b) => b.share - a.share);
  return { swatches, sampledPixels, sampleSize: size };
}

function widestChannel(bins: Bin[]): "r" | "g" | "b" {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (const bin of bins) {
    if (bin.r < rMin) rMin = bin.r;
    if (bin.r > rMax) rMax = bin.r;
    if (bin.g < gMin) gMin = bin.g;
    if (bin.g > gMax) gMax = bin.g;
    if (bin.b < bMin) bMin = bin.b;
    if (bin.b > bMax) bMax = bin.b;
  }
  const dr = rMax - rMin;
  const dg = gMax - gMin;
  const db = bMax - bMin;
  if (dg >= dr && dg >= db) return "g";
  if (db >= dr && db >= dg) return "b";
  return "r";
}

function sumCounts(bins: Bin[]): number {
  let total = 0;
  for (const bin of bins) total += bin.count;
  return total;
}

/**
 * Read one pixel. `ratioX` / `ratioY` are 0–1 positions in the image, so the
 * caller can map a click on a scaled preview straight across.
 */
export async function sampleColorAtRatio(
  blob: Blob,
  ratioX: number,
  ratioY: number,
): Promise<{ hex: string; rgb: [number, number, number] }> {
  const source = await loadSource(blob);
  try {
    const natural: ImageSize = { width: source.width, height: source.height };
    // Huge photos are sampled from a bounded render — the average colour of a
    // small region is the same thing at a fraction of the memory.
    const size = fitSize(natural, { maxWidth: 4096, maxHeight: 4096 });
    const { ctx } = drawToCanvas(source, size);

    const x = Math.min(size.width - 1, Math.max(0, Math.round(ratioX * size.width)));
    const y = Math.min(size.height - 1, Math.max(0, Math.round(ratioY * size.height)));
    const data = ctx.getImageData(x, y, 1, 1).data;
    const rgb: [number, number, number] = [data[0], data[1], data[2]];
    return { hex: rgbToHex(rgb[0], rgb[1], rgb[2]), rgb };
  } finally {
    releaseSource(source);
  }
}

/* ------------------------------------------------------------------ */
/*  Metadata: JPEG, PNG, WebP, GIF, BMP                                */
/* ------------------------------------------------------------------ */

/**
 * EXIF lives in a JPEG APP1 segment that cameras write immediately after the
 * SOI marker, so a bounded prefix is enough in practice. Reading 512 KB keeps
 * a 50 MB photo from being pulled into memory just to look at its header.
 */
const HEADER_SCAN_BYTES = 512 * 1024;

export interface ExifSummary {
  orientation: number | null;
  orientationLabel: string | null;
  dateTimeOriginal: string | null;
  make: string | null;
  model: string | null;
  software: string | null;
  exposureTime: string | null;
  fNumber: string | null;
  iso: number | null;
  focalLength: string | null;
  /** Decimal degrees, present only when the GPS block was complete. */
  gps: { latitude: number; longitude: number } | null;
  gpsPresent: boolean;
  /** How many IFD entries were read, so the panel can be honest about coverage. */
  tagCount: number;
}

export interface PngSummary extends ImageSize {
  bitDepth: number;
  colorType: string;
  interlace: string;
  /** Resolved from `pHYs` when present. */
  dpi: { x: number; y: number } | null;
  chunks: { type: string; bytes: number }[];
  hasExif: boolean;
  text: { key: string; value: string }[];
}

export interface WebpSummary extends ImageSize {
  chunks: { type: string; bytes: number }[];
  hasExif: boolean;
  hasIcc: boolean;
  hasXmp: boolean;
  hasAlpha: boolean;
  hasAnimation: boolean;
}

export interface ImageMetadata {
  /** Short format name derived from the magic bytes, not the filename. */
  format: string;
  /** Pixel dimensions stored in the file header. */
  width: number | null;
  height: number | null;
  mimeType: string;
  byteLength: number;
  exif: ExifSummary | null;
  png: PngSummary | null;
  webp: WebpSummary | null;
  /** Dimensions after EXIF orientation, from an actual decode. */
  decoded: ImageSize | null;
  decodeError: string | null;
  notes: string[];
}

const ORIENTATION_LABELS: Record<number, string> = {
  1: "Normal",
  2: "Mirrored horizontally",
  3: "Rotated 180°",
  4: "Mirrored vertically",
  5: "Mirrored horizontally, rotated 270°",
  6: "Rotated 90° clockwise",
  7: "Mirrored horizontally, rotated 90°",
  8: "Rotated 270° clockwise",
};

const TYPE_BYTES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

type TagValue =
  | { kind: "ascii"; text: string }
  | { kind: "number"; value: number }
  | { kind: "rational"; value: number }
  | { kind: "rationals"; values: number[] };

function readTagValue(
  view: DataView,
  tiffStart: number,
  little: boolean,
  type: number,
  count: number,
  valueOffset: number,
): TagValue | null {
  const unit = TYPE_BYTES[type];
  if (!unit) return null;
  const total = unit * count;
  const base = total <= 4 ? valueOffset : tiffStart + view.getUint32(valueOffset, little);
  if (base < 0 || base + total > view.byteLength) return null;

  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  const i32 = (offset: number) => view.getInt32(offset, little);
  const ratio = (offset: number) => {
    const numerator = u32(offset);
    const denominator = i32(offset + 4);
    return denominator === 0 ? Number.NaN : numerator / denominator;
  };

  switch (type) {
    case 2: {
      let text = "";
      for (let i = 0; i < count; i += 1) {
        const code = view.getUint8(base + i);
        if (code === 0) break;
        text += String.fromCharCode(code);
      }
      return { kind: "ascii", text: text.trim() };
    }
    case 3:
      return { kind: "number", value: u16(base) };
    case 4:
      return { kind: "number", value: u32(base) };
    case 5:
      return { kind: "rational", value: ratio(base) };
    case 10: {
      const values: number[] = [];
      for (let i = 0; i < count; i += 1) values.push(ratio(base + i * 8));
      return { kind: "rationals", values };
    }
    case 1:
    case 6:
    case 7:
      return { kind: "number", value: view.getUint8(base) };
    default:
      return null;
  }
}

function readIfd(
  view: DataView,
  tiffStart: number,
  little: boolean,
  offset: number,
): Map<number, TagValue> {
  const entries = new Map<number, TagValue>();
  const start = tiffStart + offset;
  if (start + 2 > view.byteLength) return entries;

  const count = view.getUint16(start, little);
  for (let i = 0; i < count; i += 1) {
    const entry = start + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const valueCount = view.getUint32(entry + 4, little);
    const value = readTagValue(view, tiffStart, little, type, valueCount, entry + 8);
    if (value) entries.set(tag, value);
  }
  return entries;
}

function numberOf(value: TagValue | undefined): number | null {
  if (!value) return null;
  if (value.kind === "number") return value.value;
  if (value.kind === "rational" && Number.isFinite(value.value)) return value.value;
  return null;
}

function textOf(value: TagValue | undefined): string | null {
  if (!value || value.kind !== "ascii") return null;
  return value.text.length > 0 ? value.text : null;
}

function formatRational(value: number | null, unit: string, fraction: boolean): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (fraction && value < 1) {
    const denominator = Math.round(1 / value);
    if (denominator > 1 && denominator < 10000) return `1/${denominator} ${unit}`;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

function formatExifDate(value: string | null): string | null {
  if (!value || value.length < 10) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(5, 7)}-${value.slice(8, 10)}`;
  const time = value.length >= 19 ? ` ${value.slice(11, 19)}` : "";
  return `${iso}${time}`;
}

function parseTiffExif(view: DataView, tiffStart: number): ExifSummary | null {
  const little = view.getUint16(tiffStart) === 0x4949;
  const magic = view.getUint16(tiffStart + 2, little);
  if (magic !== 42) return null;

  const ifd0 = readIfd(view, tiffStart, little, view.getUint32(tiffStart + 4, little));
  const summary: ExifSummary = {
    orientation: numberOf(ifd0.get(0x0112)),
    orientationLabel: null,
    dateTimeOriginal: null,
    make: textOf(ifd0.get(0x010f)),
    model: textOf(ifd0.get(0x0110)),
    software: textOf(ifd0.get(0x0131)),
    exposureTime: null,
    fNumber: null,
    iso: null,
    focalLength: null,
    gps: null,
    gpsPresent: false,
    tagCount: ifd0.size,
  };
  if (summary.orientation !== null) {
    summary.orientationLabel = ORIENTATION_LABELS[summary.orientation] ?? "Unknown";
  }

  const exifPointer = numberOf(ifd0.get(0x8769));
  if (exifPointer !== null) {
    const exif = readIfd(view, tiffStart, little, exifPointer);
    summary.tagCount += exif.size;
    summary.dateTimeOriginal = formatExifDate(textOf(exif.get(0x9003)));
    summary.exposureTime = formatRational(numberOf(exif.get(0x829a)), "s", true);
    const aperture = numberOf(exif.get(0x829d));
    summary.fNumber =
      aperture !== null && Number.isFinite(aperture) && aperture > 0
        ? `f/${aperture >= 10 ? Math.round(aperture) : Math.round(aperture * 10) / 10}`
        : null;
    summary.iso = numberOf(exif.get(0x8827));
    summary.focalLength = formatRational(numberOf(exif.get(0x920a)), "mm", false);
  }

  const gpsPointer = numberOf(ifd0.get(0x8825));
  if (gpsPointer !== null) {
    const gps = readIfd(view, tiffStart, little, gpsPointer);
    summary.tagCount += gps.size;
    const latRef = textOf(gps.get(0x0001));
    const lat = gps.get(0x0002);
    const lonRef = textOf(gps.get(0x0003));
    const lon = gps.get(0x0004);
    if (lat && lon && lat.kind === "rationals" && lon.kind === "rationals") {
      summary.gpsPresent = true;
      const toDecimal = (parts: number[]) =>
        (parts[0] ?? 0) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
      const latValue = toDecimal(lat.values) * (latRef?.toUpperCase() === "S" ? -1 : 1);
      const lonValue = toDecimal(lon.values) * (lonRef?.toUpperCase() === "W" ? -1 : 1);
      if (Number.isFinite(latValue) && Number.isFinite(lonValue)) {
        summary.gps = { latitude: latValue, longitude: lonValue };
      }
    } else {
      summary.gpsPresent = true;
    }
  }

  return summary;
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(view: DataView): {
  size: ImageSize | null;
  exif: ExifSummary | null;
} {
  const size: ImageSize = { width: 0, height: 0 };
  let exif: ExifSummary | null = null;
  let offset = 2;

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);

    // Standalone markers carry no payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd8) {
      offset += 2;
      continue;
    }
    // EOI and start-of-scan: nothing useful past here.
    if (marker === 0xd9 || marker === 0xda) break;

    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    const payload = offset + 4;

    if (marker === 0xe1 && !exif && payload + 10 <= view.byteLength) {
      let isExif = true;
      for (let i = 0; i < 4; i += 1) {
        if (view.getUint8(payload + i) !== "Exif".charCodeAt(i)) isExif = false;
      }
      if (isExif) {
        exif = parseTiffExif(view, payload + 6);
      }
    }

    if (JPEG_SOF_MARKERS.has(marker) && payload + 5 <= view.byteLength) {
      size.height = view.getUint16(payload + 1);
      size.width = view.getUint16(payload + 3);
    }

    offset = payload + length - 2;
  }

  return { size: size.width > 0 && size.height > 0 ? size : null, exif };
}

const PNG_COLOR_TYPES: Record<number, string> = {
  0: "Greyscale",
  2: "Truecolour",
  3: "Indexed",
  4: "Greyscale + alpha",
  6: "Truecolour + alpha",
};

function parsePng(bytes: Uint8Array): PngSummary | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size: ImageSize = { width: 0, height: 0 };
  const summary: PngSummary = {
    width: 0,
    height: 0,
    bitDepth: 0,
    colorType: "—",
    interlace: "—",
    dpi: null,
    chunks: [],
    hasExif: false,
    text: [],
  };

  let offset = 8; // past the 8-byte signature
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    if (summary.chunks.length < 24) summary.chunks.push({ type, bytes: length });
    const data = offset + 8;

    if (type === "IHDR" && data + 13 <= bytes.byteLength) {
      size.width = view.getUint32(data);
      size.height = view.getUint32(data + 4);
      summary.bitDepth = bytes[data + 8] ?? 0;
      summary.colorType = PNG_COLOR_TYPES[bytes[data + 9] ?? 0] ?? "Unknown";
      summary.interlace = bytes[data + 12] === 1 ? "Adam7" : "None";
    } else if (type === "pHYs" && data + 9 <= bytes.byteLength) {
      const unit = bytes[data + 8];
      if (unit === 1) {
        const factor = 0.0254;
        summary.dpi = {
          x: Math.round(view.getUint32(data) * factor),
          y: Math.round(view.getUint32(data + 4) * factor),
        };
      }
    } else if (type === "eXIf") {
      summary.hasExif = true;
    } else if (type === "tEXt" && data + 1 <= bytes.byteLength) {
      const raw = readLatin1(bytes.subarray(data, Math.min(data + length, bytes.byteLength)));
      const split = raw.indexOf("\0");
      if (split > 0) {
        summary.text.push({ key: raw.slice(0, split), value: raw.slice(split + 1) });
      }
    }

    // Stop once we are into the image data; chunk list beyond that is noise.
    if (type === "IDAT" || type === "IEND") break;
    offset = data + length + 4;
  }

  if (size.width === 0 || size.height === 0) return null;
  summary.width = size.width;
  summary.height = size.height;
  return summary;
}

function readLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function parseWebp(bytes: Uint8Array): WebpSummary | null {
  if (bytes.byteLength < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const summary: WebpSummary = {
    width: 0,
    height: 0,
    chunks: [],
    hasExif: false,
    hasIcc: false,
    hasXmp: false,
    hasAlpha: false,
    hasAnimation: false,
  };

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const type = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    summary.chunks.push({ type, bytes: length });

    if (type === "VP8X" && data + 10 <= bytes.byteLength) {
      const flags = bytes[data] ?? 0;
      summary.hasAlpha = (flags & 0x10) !== 0;
      summary.hasIcc = (flags & 0x20) !== 0;
      summary.hasXmp = (flags & 0x08) !== 0;
      summary.hasAnimation = (flags & 0x02) !== 0;
      summary.width = ((bytes[data + 4] ?? 0) | ((bytes[data + 5] ?? 0) << 8) | ((bytes[data + 6] ?? 0) << 16)) + 1;
      summary.height = ((bytes[data + 7] ?? 0) | ((bytes[data + 8] ?? 0) << 8) | ((bytes[data + 9] ?? 0) << 16)) + 1;
    } else if (type === "VP8L" && data + 5 <= bytes.byteLength && bytes[data] === 0x2f) {
      const bits =
        (bytes[data + 1] ?? 0) |
        ((bytes[data + 2] ?? 0) << 8) |
        ((bytes[data + 3] ?? 0) << 16) |
        ((bytes[data + 4] ?? 0) << 24);
      summary.width = (bits & 0x3fff) + 1;
      summary.height = ((bits >> 14) & 0x3fff) + 1;
    } else if (type === "VP8 " && data + 10 <= bytes.byteLength) {
      // Skip the 3-byte frame tag, then the 3-byte start code.
      const start = data + 3;
      if (bytes[start] === 0x9d && bytes[start + 1] === 0x01 && bytes[start + 2] === 0x2a) {
        const sizeBits = ((bytes[start + 3] ?? 0) | ((bytes[start + 4] ?? 0) << 8)) & 0x3fff;
        const sizeBits2 = ((bytes[start + 5] ?? 0) | ((bytes[start + 6] ?? 0) << 8)) & 0x3fff;
        summary.width = sizeBits;
        summary.height = sizeBits2;
      }
    } else if (type === "EXIF") {
      summary.hasExif = true;
    }

    offset = data + length + (length % 2);
  }

  if (summary.width === 0 || summary.height === 0) return null;
  return summary;
}

function parseGif(bytes: Uint8Array): ImageSize | null {
  if (bytes.byteLength < 13) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseBmp(bytes: Uint8Array): ImageSize | null {
  if (bytes.byteLength < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const height = Math.abs(rawHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Read a file's headers, EXIF and chunk table.
 *
 * Dimensions come from the container header, which is the *stored* size, and
 * are reported separately from the decoded size so a photo with an EXIF
 * rotation is described correctly instead of looking like a mismatch.
 */
export async function readImageMetadata(file: Blob): Promise<ImageMetadata> {
  const slice = file.slice(0, Math.min(file.size, HEADER_SCAN_BYTES));
  const bytes = new Uint8Array(await slice.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let format = "Image";
  let size: ImageSize | null = null;
  let exif: ExifSummary | null = null;
  let png: PngSummary | null = null;
  let webp: WebpSummary | null = null;
  const notes: string[] = [];

  const isPng =
    bytes.byteLength > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpeg = bytes.byteLength > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const isRiff =
    bytes.byteLength > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (isJpeg) {
    format = "JPEG";
    const parsed = parseJpeg(view);
    size = parsed.size;
    exif = parsed.exif;
    if (!exif) {
      notes.push(
        "No APP1/Exif segment was found in the first 512 KB of this JPEG. Most cameras write it immediately after the header; a file that has had its metadata stripped will not have one.",
      );
    }
  } else if (isPng) {
    format = "PNG";
    png = parsePng(bytes);
    size = png ? { width: png.width, height: png.height } : null;
  } else if (isRiff) {
    format = "WebP";
    webp = parseWebp(bytes);
    size = webp ? { width: webp.width, height: webp.height } : null;
  } else if (
    bytes.byteLength > 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    format = "GIF";
    size = parseGif(bytes);
    notes.push("Animated GIFs are flattened to their first frame if you process them elsewhere.");
  } else if (bytes.byteLength > 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    format = "BMP";
    size = parseBmp(bytes);
  } else {
    notes.push(
      "This container has no header parser here, so the dimensions below come from decoding the pixels.",
    );
  }

  let decoded: ImageSize | null = null;
  let decodeError: string | null = null;
  try {
    const source = await loadSource(file);
    decoded = { width: bitmap.width, height: bitmap.height };
    releaseSource(source);
  } catch (error) {
    // A browser with no createImageBitmap can still draw the image, so try the
    // lenient path before reporting a decode failure.
    try {
      const source = await loadSource(file);
      decoded = { width: source.width, height: source.height };
      releaseSource(source);
    } catch {
      decodeError = error instanceof Error ? error.message : "The image could not be decoded.";
    }
  }

  const fallsBack = size ?? decoded;
  return {
    format,
    width: fallsBack?.width ?? null,
    height: fallsBack?.height ?? null,
    mimeType: file.type || "unknown",
    byteLength: file.size,
    exif,
    png,
    webp,
    decoded,
    decodeError,
    notes,
  };
}
