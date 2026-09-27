/**
 * Ambient declarations for untyped runtime dependencies used by
 * `lib/tools/engines/media.ts`.
 *
 * `gifenc@1.0.3` ships JavaScript only, so TypeScript cannot infer anything
 * about it. The shapes below mirror `node_modules/gifenc/src/index.js` exactly
 * — `quantise` is spelled with an "s" at runtime, which is why the declaration
 * keeps that name rather than the README's `quantize`.
 *
 * This file is pulled into the program by the triple-slash reference at the top
 * of `media.ts`: the project's `tsconfig.json` uses a TypeScript glob for source
 * files, which does not pick up standalone declaration files.
 *
 * `@breezystack/lamejs` *does* ship a `type.d.ts`, so it is not redeclared here;
 * see the note on `encodeMp3` in `media.ts` about its `encodeBuffer` signature.
 */

declare module "gifenc" {
  /** An RGB or RGBA colour table row, as produced by `quantise`. */
  export type GifPalette = number[][];

  export interface GifQuantizeOptions {
    /** `"rgb565"` (default), `"rgb444"` or `"rgba4444"`. */
    format?: "rgb565" | "rgb444" | "rgba4444";
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export interface GifFrameOptions {
    /** Colour table. Required for the first frame. */
    palette?: GifPalette | null;
    /** Only used when `auto: false` was passed to `GIFEncoder`. */
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** Frame delay in milliseconds. */
    delay?: number;
    /** `-1` = play once, `0` = loop forever, `n` = `n` extra iterations. */
    repeat?: number;
    dispose?: number;
  }

  export interface GifEncoderOptions {
    initialCapacity?: number;
    auto?: boolean;
  }

  export interface GifStream {
    writeByte(byte: number): void;
    writeBytes(bytes: ArrayLike<number>, offset?: number, length?: number): void;
  }

  export interface GifEncoderInstance {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBuffer;
    readonly stream: GifStream;
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifFrameOptions,
    ): void;
  }

  export function GIFEncoder(options?: GifEncoderOptions): GifEncoderInstance;

  export function quantise(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: GifQuantizeOptions,
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;

  export function prequantize(
    rgba: Uint8Array | Uint8ClampedArray,
    options?: GifQuantizeOptions,
  ): void;

  export function nearestColorIndex(palette: GifPalette, pixel: number[]): number;

  export default GIFEncoder;
}
