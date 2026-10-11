/**
 * FFmpeg.wasm loader and MP3 conversion.
 *
 * Why this exists separately from `media.ts` and `dev.ts`: those engines use the
 * browser's native decoders, which cannot open a container or codec the Web
 * Audio API has no demuxer for. FFmpeg.wasm opens everything it was compiled
 * with. The cost is a ~31 MB core that has to be fetched before the first
 * conversion, which is why it is loaded on demand and never at import time.
 *
 * Everything here runs in the browser. No request is made to any server with
 * the user's media — the core binary itself is the only network fetch, and it
 * carries no user data.
 *
 * KNOWN GAP — read before deploying: the core is fetched from unpkg.com at
 * runtime rather than self-hosted. The trade-off was deliberate: vendoring
 * 31 MB of wasm into `public/` bloats the repository and the deploy artifact
 * for every visitor, including the ~95% who open this tool's URL by accident
 * from search and leave without converting anything.
 *
 * The consequence is that the engine depends on a third-party CDN being
 * reachable, and that first use needs internet. If this tool is ever promoted
 * out of beta, copy `@ffmpeg/core`'s `dist/umd` into `public/ffmpeg/`, point
 * `CORE_BASE` at `"/ffmpeg"`, and delete this note. That makes it offline-capable
 * and removes the external dependency, at the cost of the bundle size above.
 */

import type { FFmpeg } from "@ffmpeg/ffmpeg";

/** Pinned to an exact version: an unpinned CDN tag can swap the binary under a
 *  cached page and change behaviour without any deploy on our side. */
const FFMPEG_VERSION = "0.12.15";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_VERSION}/dist/umd`;
const UTIL_BASE = `https://unpkg.com/@ffmpeg/util@0.12.2/dist/umd`;

export const FFMPEG_CORE_URL = `${CORE_BASE}/ffmpeg-core.js`;
export const FFMPEG_WASM_URL = `${CORE_BASE}/ffmpeg-core.wasm`;

/**
 * Single-threaded core.
 *
 * The multithreaded build needs `SharedArrayBuffer`, which needs COOP/COEP, which
 * `next.config.ts` deliberately leaves off unless the operator opts in — it
 * would apply `require-corp` to every route in the app. Trading a site-wide
 * header change for maybe 2x on one tool is the wrong deal, so we take the
 * single-threaded core and keep the blast radius at zero.
 */
export const FFMPEG_MULTITHREADED = false;

export const MAX_INPUT_BYTES = 300 * 1024 * 1024;

/** Kept short on purpose — a phone can lose several hundred MB of headroom. */
export const MIN_HEADROOM_BYTES = 200 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [
  "mp4",
  "m4v",
  "webm",
  "mov",
  "mkv",
  "avi",
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "opus",
  "flac",
] as const;

export const ACCEPT_ATTRIBUTE = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  ...ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

export type ConversionPhase = "loading" | "converting" | "done";

export interface ConvertOptions {
  /** FFmpeg output bitrate. */
  bitrateKbps?: number;
  sampleRateHz?: number;
  channels?: 1 | 2;
  /** Progress sink; receives 0–1. */
  onProgress?: (ratio: number) => void;
  /** Distinguishes "downloading the 31 MB core" from "encoding your file". */
  onPhase?: (phase: ConversionPhase) => void;
  signal?: AbortSignal;
}

export interface ConvertResult {
  blob: Blob;
  filename: string;
  bytes: number;
  /** Wall-clock encode time, excluding the core download. */
  elapsedMs: number;
}

export class ConversionError extends Error {
  /** True when the input is the problem rather than the browser or the core. */
  readonly userFacing: boolean;

  constructor(message: string, options?: { userFacing?: boolean; cause?: unknown }) {
    super(message);
    this.name = "ConversionError";
    this.userFacing = options?.userFacing ?? false;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/* -------------------------------------------------------------------------- */
/*  YouTube link classification                                              */
/* -------------------------------------------------------------------------- */

export type LinkState =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "video"; url: string; videoId: string }
  | { kind: "channel"; url: string }
  | { kind: "playlist"; url: string };

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * Classifies a YouTube URL and returns the canonical watch page.
 *
 * This makes no network request, deliberately. Resolving a URL into a
 * streamable media URL requires either YouTube's internal player API or
 * signature extraction, and both are the thing this tool refuses to do — so the
 * only honest output is "here is the page, open it yourself".
 *
 * Kept as a pure function so the behaviour is testable without a DOM.
 */
export function classifyYouTubeUrl(raw: string): LinkState {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };

  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      kind: "invalid",
      message: "That doesn't look like a URL. Paste the full link, including https://.",
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "invalid", message: "Only http and https links are understood." };
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    return {
      kind: "invalid",
      message: `That is a ${host} link, not a YouTube one. If you meant to convert a file, use the upload area below.`,
    };
  }

  if (url.pathname.startsWith("/playlist")) {
    return { kind: "playlist", url: `https://www.youtube.com${url.pathname}${url.search}` };
  }

  const id = host.endsWith("youtu.be")
    ? url.pathname.slice(1).split("/")[0]
    : (url.searchParams.get("v") ?? "");

  if (id && /^[\w-]{11}$/.test(id)) {
    return { kind: "video", url: `https://www.youtube.com/watch?v=${id}`, videoId: id };
  }

  if (
    url.pathname.startsWith("/channel/") ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/c/") ||
    url.pathname.startsWith("/user/")
  ) {
    return { kind: "channel", url: `https://www.youtube.com${url.pathname}` };
  }

  return {
    kind: "invalid",
    message:
      "That's a YouTube URL, but not a link to a single video. Copy the link from the browser address bar on the watch page.",
  };
}

/* -------------------------------------------------------------------------- */
/*  Filename helpers                                                          */
/* -------------------------------------------------------------------------- */

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function isSupported(file: { name: string; type?: string }): boolean {
  const ext = extensionOf(file.name);
  if ((ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) return true;
  // Some browsers report an empty or generic type for MKV/AVI; fall back to it
  // rather than rejecting a file FFmpeg would open happily.
  const type = (file.type ?? "").toLowerCase();
  return type.startsWith("video/") || type.startsWith("audio/");
}

export function outputName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "") || "audio";
  return `${base}.mp3`;
}

/* -------------------------------------------------------------------------- */
/*  Core loading                                                              */
/* -------------------------------------------------------------------------- */

let ffmpegPromise: Promise<FFmpeg> | null = null;

/**
 * Loads FFmpeg once per tab and reuses it for every later conversion.
 *
 * The promise is cached rather than the instance so two clicks during the
 * 31 MB download share one fetch instead of racing two.
 */
export function loadFFmpeg(onPhase?: (phase: ConversionPhase) => void): Promise<FFmpeg> {
  if (ffmpegPromise) return ffmpegPromise;

  ffmpegPromise = (async () => {
    onPhase?.("loading");
    try {
      const [{ FFmpeg: FFmpegClass }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);

      const instance = new FFmpegClass();

      /**
       * `toBlobURL` rewrites each asset as a blob URL. Without it the worker
       * resolves `ffmpeg-core.js` relative to the page, receives HTML, and fails
       * with an opaque "failed to fetch" that says nothing useful.
       *
       * The preflight exists because `toBlobURL` turns a 404 into a blob of the
       * error page, and the real failure only surfaces later as a wasm parse
       * error. Checking first lets us name the actual problem.
       */
      const fetchAsset = async (url: string, mimeType: string): Promise<string> => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new ConversionError(
            `Could not download the FFmpeg core (HTTP ${response.status}). Check your connection and try again.`,
            { userFacing: true },
          );
        }
        return toBlobURL(url, mimeType);
      };

      const [coreURL, wasmURL, workerURL, classWorkerURL] = await Promise.all([
        fetchAsset(FFMPEG_CORE_URL, "text/javascript"),
        fetchAsset(FFMPEG_WASM_URL, "application/wasm"),
        // Without the worker URLs the worker resolves them against our origin.
        fetchAsset(`${UTIL_BASE}/ffmpeg-worker.js`, "text/javascript"),
        fetchAsset(`${UTIL_BASE}/814.ffmpeg.js`, "text/javascript"),
      ]);

      await instance.load({ coreURL, wasmURL, workerURL, classWorkerURL });
      return instance;
    } catch (error) {
      // Clear the cache so a retry re-downloads rather than replaying the failure.
      ffmpegPromise = null;
      throw new ConversionError(
        error instanceof ConversionError
          ? error.message
          : "The FFmpeg core could not be loaded. Check your connection and try again.",
        { userFacing: true, cause: error },
      );
    }
  })();

  return ffmpegPromise;
}

/** Test seam, and the escape hatch for the "load failed" retry button. */
export function resetFFmpeg(): void {
  ffmpegPromise = null;
}

export function isCoreLoaded(): boolean {
  return ffmpegPromise !== null;
}

/* -------------------------------------------------------------------------- */
/*  Conversion                                                                */
/* -------------------------------------------------------------------------- */

/** Turns FFmpeg's stderr tail into something a person can act on. */
function explain(log: string): string {
  const text = log.toLowerCase();
  if (text.includes("no such file or directory")) {
    return "FFmpeg could not read the file. It may be empty, corrupt, or still syncing from your device.";
  }
  if (text.includes("invalid data found when processing input")) {
    return "FFmpeg could not decode this file. It may be corrupt, or use a codec this build does not include.";
  }
  if (text.includes("does not contain any stream")) {
    return "This file has no audio track, so there is nothing to convert to MP3.";
  }
  if (text.includes("unknown format")) {
    return "FFmpeg does not recognise this file's container format.";
  }
  return "The conversion failed inside FFmpeg. The technical log is below.";
}

/** Accumulates stderr during a run so a failure can explain itself. */
export function createLogCollector(limit = 40) {
  const lines: string[] = [];
  return {
    onLog: ({ message }: { type: string; message: string }) => {
      lines.push(message);
      if (lines.length > limit) lines.shift();
    },
    tail(count = 12): string {
      return lines.slice(-count).join("\n");
    },
  };
}

export async function convertToMp3(file: File, options: ConvertOptions = {}): Promise<ConvertResult> {
  const {
    bitrateKbps = 192,
    sampleRateHz = 44100,
    channels = 2,
    onProgress,
    onPhase,
    signal,
  } = options;

  if (signal?.aborted) throw new ConversionError("Cancelled.", { userFacing: true });

  if (typeof SharedArrayBuffer === "undefined" && FFMPEG_MULTITHREADED) {
    throw new ConversionError(
      "This browser is not cross-origin isolated, so the multi-threaded core cannot start.",
      { userFacing: true },
    );
  }

  const ffmpeg = await loadFFmpeg(onPhase);
  if (signal?.aborted) throw new ConversionError("Cancelled.", { userFacing: true });

  const inputName = `input.${extensionOf(file.name) || "bin"}`;
  const outputName_ = "output.mp3";

  // FFmpeg reports progress and stderr on worker messages; both callbacks are
  // registered per run and torn down in `finally` so a second conversion cannot
  // write into the first one's state.
  const logs = createLogCollector();
  const handleProgress = ({ progress }: { progress: number }) => {
    // FFmpeg occasionally reports >1 while flushing the final packets.
    onProgress?.(Math.min(1, Math.max(0, progress)));
  };
  ffmpeg.on("progress", handleProgress);
  ffmpeg.on("log", logs.onLog);

  const startedAt = performance.now();

  try {
    onPhase?.("converting");
    const { fetchFile } = await import("@ffmpeg/util");
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const args = [
      "-i",
      inputName,
      "-vn", // drop any video stream; MP3 is audio-only
      "-map_metadata",
      "-1", // strip identifying metadata
      "-b:a",
      `${bitrateKbps}k`,
      "-ar",
      String(sampleRateHz),
      "-ac",
      String(channels),
      "-f",
      "mp3",
      outputName_,
    ];

    const code = await ffmpeg.exec(args);

    if (code !== 0) {
      const detail = logs.tail(12);
      throw new ConversionError(explain(detail), { userFacing: true, cause: detail });
    }

    const data = (await ffmpeg.readFile(outputName_)) as Uint8Array;
    if (data.byteLength === 0) {
      throw new ConversionError(
        "FFmpeg produced an empty file. The input may have no decodable audio track.",
        { userFacing: true },
      );
    }

    // Copy out of the wasm heap before deleting: `readFile` returns a view into
    // memory that `deleteFile` invalidates.
    const bytes = new Uint8Array(data);
    const blob = new Blob([bytes], { type: "audio/mpeg" });

    return {
      blob,
      filename: outputName(file.name),
      bytes: bytes.byteLength,
      elapsedMs: performance.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ConversionError("The conversion failed unexpectedly.", {
      userFacing: true,
      cause: error,
    });
  } finally {
    ffmpeg.off("progress", handleProgress);
    ffmpeg.off("log", logs.onLog);
    // Best-effort cleanup; a failure here must not mask a real result.
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName_)]);
  }
}