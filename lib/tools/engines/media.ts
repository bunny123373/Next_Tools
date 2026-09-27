/// <reference path="./media.d.ts" />
/**
 * Shared browser media engine — Web Audio, canvas and MediaRecorder.
 *
 * Every helper here is React-free and runs client-side only. Nothing in this
 * file touches the network, and nothing writes to disk; callers turn the
 * returned `Blob`s into downloads.
 *
 * Why no FFmpeg? `ffmpeg.wasm` needs a ~30 MB WASM payload plus
 * `SharedArrayBuffer`, which in turn requires `Cross-Origin-Opener-Policy` and
 * `Cross-Origin-Embedder-Policy` headers (see `next.config.ts`, behind
 * `NEXT_PUBLIC_CROSS_ORIGIN_ISOLATED`). The functions below are the native
 * replacement, and they are deliberately shaped so an ffmpeg.wasm backend can be
 * dropped in later: each one takes plain options and resolves a `Blob`, so only
 * the body of the function would change.
 *
 * The honest constraint: `MediaRecorder` encodes in *real time*. Video
 * re-encoding therefore takes as long as the clip. We never pretend otherwise —
 * callers get `onTick` callbacks with real elapsed/remaining time.
 */

/* ================================================================== */
/*  Small shared utilities                                             */
/* ================================================================== */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Force a dimension to an even integer — H.264 encoders require it. */
export function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** Linear amplitude (0–1) → dBFS. `-Infinity` for digital silence. */
export function toDb(linear: number): number {
  if (!(linear > 0)) return -Infinity;
  return 20 * Math.log10(linear);
}

/** dBFS → linear amplitude. */
export function fromDb(db: number): number {
  return db <= -100 ? 0 : 10 ** (db / 20);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Yield to the event loop so a long encode does not freeze the tab. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Thrown when a user cancels a long-running recording. */
export class CancelledError extends Error {
  constructor(message = "Cancelled.") {
    super(message);
    this.name = "CancelledError";
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError;
}

/* ================================================================== */
/*  Codec capability detection                                         */
/* ================================================================== */

export interface MediaSupport {
  webmVp9: boolean;
  webmVp8: boolean;
  mp4H264: boolean;
  mp4Avc: boolean;
  ogvTheora: boolean;
  webmOpus: boolean;
  mp4Aac: boolean;
  webmVorbis: boolean;
}

/** MIME string probed for each capability flag. */
const SUPPORT_PROBES: ReadonlyArray<readonly [keyof MediaSupport, string]> = [
  ["webmVp9", "video/webm;codecs=vp9,opus"],
  ["webmVp8", "video/webm;codecs=vp8,vorbis"],
  ["mp4H264", "video/mp4;codecs=avc1.42E01E,mp4a.40.2"],
  ["mp4Avc", "video/mp4;codecs=avc1"],
  ["ogvTheora", "video/ogg;codecs=theora"],
  ["webmOpus", "audio/webm;codecs=opus"],
  ["mp4Aac", "audio/mp4;codecs=mp4a.40.2"],
  ["webmVorbis", "audio/webm;codecs=vorbis"],
];

let supportPromise: Promise<MediaSupport> | null = null;

function probe(type: string): boolean {
  try {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return false;
    }
    return MediaRecorder.isTypeSupported(type);
  } catch {
    return false;
  }
}

/**
 * Real `MediaRecorder.isTypeSupported` results, probed once per page load.
 * Nothing here is guessed from the user agent.
 */
export function detectVideoSupport(): Promise<MediaSupport> {
  if (supportPromise) return supportPromise;
  supportPromise = (async () => {
    // Yield once so a workspace can render a skeleton before we block probing.
    await yieldToMain();
    const out = {} as Record<keyof MediaSupport, boolean>;
    for (const [flag, type] of SUPPORT_PROBES) out[flag] = probe(type);
    return out as MediaSupport;
  })();
  return supportPromise;
}

/** Forget the cached probe. Used by tests and by long-lived sessions. */
export function resetMediaSupportCache(): void {
  supportPromise = null;
}

/* ------------------------------------------------------------------ */
/*  Video output formats                                               */
/* ------------------------------------------------------------------ */

export interface VideoFormat {
  id: string;
  /** Full label for the picker, e.g. "WebM · VP9 + Opus". */
  label: string;
  /** Short label for segmented controls. */
  short: string;
  mime: string;
  ext: string;
  /** Sensible target bitrates in kbps, ascending. */
  bitrates: readonly number[];
  /** Which probe flag decides availability. */
  capability: keyof MediaSupport;
  /** True when the container plays in Safari/iOS. */
  webFriendly: boolean;
}

export const VIDEO_FORMATS: readonly VideoFormat[] = [
  {
    id: "mp4-h264",
    label: "MP4 · H.264 + AAC",
    short: "MP4",
    mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    ext: "mp4",
    bitrates: [400, 800, 1200, 2000, 3500, 6000],
    capability: "mp4H264",
    webFriendly: true,
  },
  {
    id: "webm-vp9",
    label: "WebM · VP9 + Opus",
    short: "WebM VP9",
    mime: "video/webm;codecs=vp9,opus",
    ext: "webm",
    bitrates: [300, 600, 1000, 1800, 3000, 5000],
    capability: "webmVp9",
    webFriendly: false,
  },
  {
    id: "webm-vp8",
    label: "WebM · VP8 + Vorbis",
    short: "WebM VP8",
    mime: "video/webm;codecs=vp8,vorbis",
    ext: "webm",
    bitrates: [300, 600, 1000, 1800, 3000, 5000],
    capability: "webmVp8",
    webFriendly: false,
  },
  {
    id: "ogv-theora",
    label: "Ogg · Theora",
    short: "OGV",
    mime: "video/ogg;codecs=theora",
    ext: "ogv",
    bitrates: [400, 800, 1500, 2500, 4000],
    capability: "ogvTheora",
    webFriendly: false,
  },
];

export function videoFormatById(id: string): VideoFormat {
  return VIDEO_FORMATS.find((format) => format.id === id) ?? VIDEO_FORMATS[0]!;
}

export interface PickedVideoMime {
  /** The MIME string to hand to `MediaRecorder`. Empty when nothing works. */
  mime: string;
  label: string;
  /** Set whenever we could not give the user exactly what they asked for. */
  warning?: string;
  supported: boolean;
  format: VideoFormat;
}

/**
 * Resolve a requested container to something this browser can actually record.
 *
 * When the preferred MIME is unavailable we look for another codec in the same
 * container first, then fall back to a different container — and we always say
 * so in `warning`. A silent substitution would be worse than an honest message.
 */
export function pickVideoMime(preferred: string, support: MediaSupport): PickedVideoMime {
  const wanted = VIDEO_FORMATS.find((format) => format.mime === preferred) ?? videoFormatById(preferred);

  if (support[wanted.capability] && probe(preferred)) {
    return { mime: preferred, label: wanted.label, supported: true, format: wanted };
  }

  const sameContainer = VIDEO_FORMATS.filter(
    (format) => format.ext === wanted.ext && format.id !== wanted.id,
  );
  for (const candidate of sameContainer) {
    if (support[candidate.capability] && probe(candidate.mime)) {
      return {
        mime: candidate.mime,
        label: candidate.label,
        warning: `${wanted.label} is not available in this browser; exporting ${candidate.label} instead.`,
        supported: true,
        format: candidate,
      };
    }
  }

  for (const candidate of VIDEO_FORMATS) {
    if (candidate.ext === wanted.ext) continue;
    if (support[candidate.capability] && probe(candidate.mime)) {
      return {
        mime: candidate.mime,
        label: candidate.label,
        warning: `${wanted.label} is not available in this browser; exporting ${candidate.label} instead.`,
        supported: true,
        format: candidate,
      };
    }
  }

  return {
    mime: "",
    label: "Unavailable",
    warning:
      "This browser cannot encode video at all. Chrome, Edge or Firefox are required for video export.",
    supported: false,
    format: wanted,
  };
}

export interface PickedAudioMime {
  mime: string;
  label: string;
  supported: boolean;
}

/** Audio-only recording MIME, for the pitch-preserving speed path. */
export function pickAudioMime(): PickedAudioMime {
  const candidates: ReadonlyArray<[string, string]> = [
    ["audio/webm;codecs=opus", "WebM · Opus"],
    ["audio/mp4;codecs=mp4a.40.2", "M4A · AAC"],
    ["audio/ogg;codecs=opus", "Ogg · Opus"],
  ];
  for (const [mime, label] of candidates) {
    if (probe(mime)) return { mime, label, supported: true };
  }
  return { mime: "", label: "Unavailable", supported: false };
}

/** Rough output size for a target bitrate over a known duration. */
export function estimateBytes(videoKbps: number, audioKbps: number, seconds: number): number {
  return ((videoKbps + audioKbps) * 1000 * Math.max(0, seconds)) / 8;
}

/* ================================================================== */
/*  Web Audio — decode, resample, analyse                              */
/* ================================================================== */

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

/** `AudioContext` with the old WebKit prefix handled. */
export function createAudioContext(): AudioContext {
  const scope = globalThis as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) throw new Error("This browser does not support the Web Audio API.");
  return new Ctor();
}

/**
 * Decode any audio/video container the browser understands.
 *
 * Note on sample rate: `decodeAudioData` *resamples* the source to the
 * `AudioContext`'s hardware rate, so `buffer.sampleRate` is whatever the device
 * runs at (usually 48 kHz) and not necessarily the rate in the file. That is
 * fine for editing, but any tool that must write a specific output rate has to
 * call `resampleBuffer` afterwards. `browserCanDecode` below is what callers use
 * to explain a failure honestly instead of claiming the file is unsupported.
 */
export async function decodeAudio(file: Blob): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  const context = createAudioContext();
  try {
    return await context.decodeAudioData(bytes);
  } catch {
    throw new Error(
      "The browser could not decode this file's audio. MP3, AAC, Opus, Vorbis and PCM/WAV decode everywhere; rarer codecs such as AC-3, DTS or ALAC in an exotic container do not.",
    );
  } finally {
    void context.close().catch(() => undefined);
  }
}

/** An empty context, for probing whether a container decodes at all. */
export async function canDecode(file: Blob): Promise<boolean> {
  try {
    const buffer = await decodeAudio(file);
    return buffer.length > 0;
  } catch {
    return false;
  }
}

/** High-quality resample via `OfflineAudioContext` — the correct tool for this. */
export async function resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;
  const frames = Math.max(1, Math.round(buffer.duration * targetRate));
  const offline = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

/** Exact copy of a time range — sample-accurate, no interpolation. */
export function sliceBuffer(buffer: AudioBuffer, start: number, end: number): AudioBuffer {
  const rate = buffer.sampleRate;
  const from = clamp(Math.floor(start * rate), 0, buffer.length);
  const to = clamp(Math.ceil(end * rate), from, buffer.length);
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: Math.max(1, to - from),
    sampleRate: rate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    out.copyToChannel(data.subarray(from, to), channel, 0);
  }
  return out;
}

/** Mono sum used by every analyser below. Allocation is reused per call. */
function monoData(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) out[i] += data[i];
  }
  if (channels > 1) {
    const scale = 1 / channels;
    for (let i = 0; i < length; i += 1) out[i] *= scale;
  }
  return out;
}

export interface AudioAnalysis {
  /** 0–1 absolute peak. */
  peak: number;
  /** 0–1 root-mean-square level. */
  rms: number;
  peakDb: number;
  rmsDb: number;
  /** Samples at or beyond ±1.0. */
  clipped: number;
  duration: number;
  sampleRate: number;
  channels: number;
}

export function analyseAudio(buffer: AudioBuffer): AudioAnalysis {
  const mono = monoData(buffer);
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (let i = 0; i < mono.length; i += 1) {
    const value = mono[i];
    const magnitude = value < 0 ? -value : value;
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= 1) clipped += 1;
    sumSquares += value * value;
  }
  const rms = mono.length > 0 ? Math.sqrt(sumSquares / mono.length) : 0;
  return {
    peak,
    rms,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    clipped,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
  };
}

export interface WaveformPeaks {
  /** One min/max pair per column, in −1…1. */
  min: Float32Array;
  max: Float32Array;
}

/**
 * Min/max per pixel column. This is what the trimmer and splitter draw, and it
 * is computed from the real decoded samples rather than a decorative curve.
 */
export function computeWaveformPeaks(buffer: AudioBuffer, columns: number): WaveformPeaks {
  const width = Math.max(1, Math.floor(columns));
  const min = new Float32Array(width);
  const max = new Float32Array(width);
  const mono = monoData(buffer);
  const perColumn = mono.length / width;
  for (let column = 0; column < width; column += 1) {
    const start = Math.floor(column * perColumn);
    const end = Math.min(mono.length, Math.max(start + 1, Math.floor((column + 1) * perColumn)));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i += 1) {
      const value = mono[i];
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    min[column] = lo;
    max[column] = hi;
  }
  return { min, max };
}

/* ------------------------------------------------------------------ */
/*  Sample-level processing                                            */
/* ------------------------------------------------------------------ */

/** In-place linear gain. Returns the new peak so callers can report it. */
export function applyGain(buffer: AudioBuffer, linear: number): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i] * linear;
      data[i] = value;
      const magnitude = value < 0 ? -value : value;
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

/**
 * Equal-power fades. Short fades at a cut boundary are what stop the click you
 * would otherwise get from slicing a waveform.
 */
export function applyFades(
  buffer: AudioBuffer,
  fadeIn: number,
  fadeOut: number,
): void {
  const rate = buffer.sampleRate;
  const inLength = Math.min(buffer.length, Math.max(0, Math.round(fadeIn * rate)));
  const outLength = Math.min(buffer.length, Math.max(0, Math.round(fadeOut * rate)));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < inLength; i += 1) {
      const t = inLength <= 1 ? 1 : i / (inLength - 1);
      data[i] *= Math.sin((t * Math.PI) / 2);
    }
    for (let i = 0; i < outLength; i += 1) {
      const index = data.length - 1 - i;
      if (index < 0) break;
      const t = outLength <= 1 ? 1 : i / (outLength - 1);
      data[index] *= Math.sin((t * Math.PI) / 2);
    }
  }
}

/**
 * Soft clipper with a linear knee below `ceiling` and a `tanh` shoulder above.
 * Genuinely prevents clipping — no sample can exceed ±1 afterwards — while
 * being far more transparent than hard clipping for the peaks that matter.
 */
export function softClip(buffer: AudioBuffer, ceiling = 0.98): number {
  const knee = clamp(ceiling, 0.5, 0.999);
  const span = 1 - knee;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i];
      const magnitude = value < 0 ? -value : value;
      let out: number;
      if (magnitude <= knee) {
        out = value;
      } else {
        const over = (magnitude - knee) / span;
        const shaped = knee + span * Math.tanh(over);
        out = value < 0 ? -shaped : shaped;
      }
      data[i] = out;
      const after = out < 0 ? -out : out;
      if (after > peak) peak = after;
    }
  }
  return peak;
}

/** Hard ceiling, used only where a guaranteed bound is required. */
export function clampToCeiling(buffer: AudioBuffer, ceiling: number): void {
  const limit = Math.abs(ceiling);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      if (data[i] > limit) data[i] = limit;
      else if (data[i] < -limit) data[i] = -limit;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Silence detection                                                  */
/* ------------------------------------------------------------------ */

export interface SilenceRange {
  /** Input time, seconds. */
  start: number;
  end: number;
  duration: number;
}

export interface SilencePlan {
  /** Silent runs that met the minimum duration, in input time. */
  detected: SilenceRange[];
  /** The ranges actually cut out (after the padding guard). */
  removed: SilenceRange[];
  /** Ranges kept, in input time, covering the trimmed result. */
  kept: SilenceRange[];
  removedSeconds: number;
  keptSeconds: number;
}

export interface SilenceOptions {
  /** Level below which a window counts as silent, in dBFS. */
  thresholdDb: number;
  /** Silent runs shorter than this are left alone. */
  minSilence: number;
  /** Seconds of silence kept on each side of a cut to avoid clicks. */
  padding: number;
}

/** Window size for RMS analysis: 10 ms, a good balance of speed and accuracy. */
const SILENCE_WINDOW = 0.01;

/**
 * Find silent regions from the real sample data. This is a level gate, not a
 * voice-activity model — it will happily cut a very quiet sustained note. The
 * UI says so.
 */
export function planSilenceRemoval(buffer: AudioBuffer, options: SilenceOptions): SilencePlan {
  const { thresholdDb, minSilence, padding } = options;
  const threshold = fromDb(thresholdDb);
  const rate = buffer.sampleRate;
  const window = Math.max(1, Math.round(SILENCE_WINDOW * rate));
  const mono = monoData(buffer);
  const duration = buffer.duration;

  const detected: SilenceRange[] = [];
  let runStart = -1;
  for (let offset = 0; offset < mono.length; offset += window) {
    const end = Math.min(mono.length, offset + window);
    let sumSquares = 0;
    for (let i = offset; i < end; i += 1) sumSquares += mono[i] * mono[i];
    const rms = end > offset ? Math.sqrt(sumSquares / (end - offset)) : 0;
    const silent = rms < threshold;
    const startTime = offset / rate;
    const endTime = end / rate;
    if (silent && runStart < 0) {
      runStart = startTime;
    } else if (!silent && runStart >= 0) {
      detected.push({ start: runStart, end: startTime, duration: startTime - runStart });
      runStart = -1;
    }
    void endTime;
  }
  if (runStart >= 0) {
    detected.push({ start: runStart, end: duration, duration: duration - runStart });
  }

  const keptMinimum = detected.filter((range) => range.duration >= minSilence);
  const removed: SilenceRange[] = [];
  for (const range of keptMinimum) {
    const start = range.start + padding;
    const end = range.end - padding;
    if (end - start > 0.02) {
      removed.push({ start, end, duration: end - start });
    }
  }

  const kept: SilenceRange[] = [];
  let cursor = 0;
  for (const range of removed) {
    if (range.start > cursor + 0.005) {
      kept.push({ start: cursor, end: range.start, duration: range.start - cursor });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (duration - cursor > 0.005) {
    kept.push({ start: cursor, end: duration, duration: duration - cursor });
  }

  const removedSeconds = removed.reduce((sum, range) => sum + range.duration, 0);
  return {
    detected: keptMinimum,
    removed,
    kept: kept.length > 0 ? kept : [{ start: 0, end: duration, duration }],
    removedSeconds,
    keptSeconds: Math.max(0, duration - removedSeconds),
  };
}

/** Build one buffer from a list of kept ranges, in order. */
export function concatenateRanges(buffer: AudioBuffer, ranges: SilenceRange[]): AudioBuffer {
  const rate = buffer.sampleRate;
  const total = ranges.reduce((sum, range) => sum + Math.max(0, Math.round((range.end - range.start) * rate)), 0);
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: Math.max(1, total),
    sampleRate: rate,
  });
  let offset = 0;
  for (const range of ranges) {
    const from = clamp(Math.floor(range.start * rate), 0, buffer.length);
    const to = clamp(Math.ceil(range.end * rate), from, buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      out.copyToChannel(buffer.getChannelData(channel).subarray(from, to), channel, offset);
    }
    offset += to - from;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Merging                                                            */
/* ------------------------------------------------------------------ */

export interface MergeTrack {
  buffer: AudioBuffer;
  /** Track gain in dB. */
  gainDb?: number;
  /** Fade in/out applied at both ends of the track, seconds. */
  fade?: number;
}

export interface MergePlan {
  totalDuration: number;
  channelCount: number;
  sampleRate: number;
}

/** Duration the merge will produce, including gaps — shown live in the UI. */
export function planMerge(tracks: MergeTrack[], gap: number, sampleRate: number): MergePlan {
  const audio = tracks.reduce((sum, track) => sum + track.buffer.duration, 0);
  const totalDuration = audio + Math.max(0, gap) * Math.max(0, tracks.length - 1);
  return {
    totalDuration,
    channelCount: tracks.reduce((max, track) => Math.max(max, track.buffer.numberOfChannels), 2),
    sampleRate,
  };
}

/** Concatenate on an `OfflineAudioContext` so gain and fades run in the graph. */
export async function mergeBuffers(
  tracks: MergeTrack[],
  gap: number,
  sampleRate: number,
): Promise<AudioBuffer> {
  const plan = planMerge(tracks, gap, sampleRate);
  const frames = Math.max(1, Math.ceil(plan.totalDuration * sampleRate));
  const offline = new OfflineAudioContext(plan.channelCount, frames, sampleRate);

  let cursor = 0;
  for (const track of tracks) {
    const source = offline.createBufferSource();
    source.buffer = track.buffer;
    const gain = offline.createGain();
    const linear = dbToGain(track.gainDb ?? 0);
    gain.gain.setValueAtTime(linear, cursor);
    const fade = Math.min(track.fade ?? 0, track.buffer.duration / 2);
    if (fade > 0.001) {
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.linearRampToValueAtTime(linear, cursor + fade);
      gain.gain.setValueAtTime(linear, cursor + track.buffer.duration - fade);
      gain.gain.linearRampToValueAtTime(0.0001, cursor + track.buffer.duration);
    }
    source.connect(gain).connect(offline.destination);
    source.start(cursor);
    cursor += track.buffer.duration + Math.max(0, gap);
  }

  return offline.startRendering();
}

/* ------------------------------------------------------------------ */
/*  Speed change                                                       */
/* ------------------------------------------------------------------ */

/**
 * Speed change by reinterpreting the same samples at a different sample rate.
 * Instant, artefact-free, and it changes pitch by the same factor — the honest
 * description, and the reason the UI labels it clearly.
 */
export function changeSpeedResample(buffer: AudioBuffer, rate: number): AudioBuffer {
  const multiplier = clamp(rate, 0.25, 4);
  // AudioBuffer requires 8–96 kHz, which is also where the trick is faithful:
  // outside it the browser would refuse or resample for us.
  const targetRate = clamp(Math.round(buffer.sampleRate * multiplier), 8000, 96000);
  if (targetRate === buffer.sampleRate) return buffer;
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: targetRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    out.copyToChannel(buffer.getChannelData(channel), channel);
  }
  return out;
}

/**
 * Pitch-preserving speed change. The browser's media element does the
 * time-stretching (`HTMLMediaElement.preservesPitch`) and we record the result,
 * so this runs in real time. There is no instant, purely-API path to a
 * pitch-preserving stretch — that is what libraries like SoundTouch exist for.
 */
export interface PitchRecorderOptions {
  file: Blob;
  /** Object URL the caller already owns; one is created when omitted. */
  url?: string;
  rate: number;
  mime: string;
  preservePitch: boolean;
  start?: number;
  end?: number;
  onTick?: (tick: TranscodeTick) => void;
  signal?: AbortSignal;
}

export interface PitchRecorderOutcome {
  blob: Blob;
  /** False when the browser ignored `preservesPitch`. */
  preservePitchApplied: boolean;
  duration: number;
}

export interface RecorderRun<T> {
  result: Promise<T>;
  cancel(reason?: string): void;
}

export function runPitchPreservingRecorder(
  options: PitchRecorderOptions,
): RecorderRun<PitchRecorderOutcome> {
  const controller = new AbortController();
  const link = () => {
    if (options.signal?.aborted) controller.abort(options.signal.reason);
  };
  link();
  options.signal?.addEventListener("abort", link, { once: true });
  const { signal } = controller;

  let cancelReason = "Cancelled.";

  const result = (async (): Promise<PitchRecorderOutcome> => {
    const ownedUrl = options.url ? null : URL.createObjectURL(options.file);
    const url = options.url ?? ownedUrl!;
    const element = document.createElement("audio");
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    element.src = url;

    const cleanup: Array<() => void> = [];
    try {
      await waitForEvent(element, "loadedmetadata", "The browser could not read this audio file.");

      // `preservesPitch` is the standard spelling; older WebKit builds only had
      // the prefixed one. Read through an index signature so the `in` narrowing
      // on the element type does not collapse the branches to `never`.
      const pitchable = element as unknown as Record<string, boolean>;
      if ("preservesPitch" in element) {
        pitchable["preservesPitch"] = options.preservePitch;
      } else if ("webkitPreservesPitch" in element) {
        pitchable["webkitPreservesPitch"] = options.preservePitch;
      } else {
        throw new Error(
          "This browser has no pitch-preserving speed control. Safari, for example, does not implement HTMLMediaElement.preservesPitch.",
        );
      }

      const capture = (element as unknown as { captureStream?: () => MediaStream }).captureStream;
      if (typeof capture !== "function") {
        throw new Error("This browser cannot capture audio from a media element (captureStream is missing).");
      }
      const stream = capture.call(element);
      if (stream.getAudioTracks().length === 0) {
        throw new Error("This browser did not expose an audio track for recording.");
      }
      cleanup.push(() => stream.getTracks().forEach((track) => track.stop()));

      const recorder = new MediaRecorder(stream, {
        ...(options.mime ? { mimeType: options.mime } : {}),
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      const startedAt = performance.now();
      const total = Math.max(0.01, (options.end ?? element.duration) - (options.start ?? 0));
      const done = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error("The browser stopped recording unexpectedly."));
      });

      recorder.start(1000);
      if (options.start) element.currentTime = options.start;
      element.playbackRate = options.rate;
      await element.play();
      cleanup.push(() => {
        element.onended = null;
        element.pause();
      });

      await new Promise<void>((resolve) => {
        const onEnded = () => resolve();
        const onAbort = () => resolve();
        element.addEventListener("ended", onEnded, { once: true });
        signal.addEventListener("abort", onAbort, { once: true });
        const tick = () => {
          const elapsed = (performance.now() - startedAt) / 1000;
          const consumed = Math.max(0, element.currentTime - (options.start ?? 0));
          options.onTick?.({
            mediaTime: consumed,
            elapsed,
            remaining: total > 0 ? Math.max(0, (total - consumed) / options.rate) : null,
            percent: total > 0 ? clamp((consumed / total) * 100, 0, 100) : null,
          });
          if (!element.paused && !signal.aborted) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        cleanup.push(() => {
          element.removeEventListener("ended", onEnded);
          signal.removeEventListener("abort", onAbort);
        });
      });

      element.pause();
      if (signal.aborted) throw new CancelledError(cancelReason);
      recorder.stop();
      await done;

      const blob = new Blob(chunks, { type: options.mime || recorder.mimeType || "audio/webm" });
      if (blob.size === 0) throw new Error("The browser produced an empty recording.");
      return {
        blob,
        preservePitchApplied: options.preservePitch,
        duration: element.duration / options.rate,
      };
    } finally {
      for (const fn of cleanup.reverse()) fn();
      element.removeAttribute("src");
      element.load();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      options.signal?.removeEventListener("abort", link);
    }
  })();

  return {
    result,
    cancel(reason = "Cancelled.") {
      cancelReason = reason;
      controller.abort(reason);
    },
  };
}

/* ================================================================== */
/*  WAV encoding                                                       */
/* ================================================================== */

export type WavBitDepth = 16 | 24 | 32;

export interface WavOptions {
  bitDepth?: WavBitDepth;
  /** Force mono or stereo. Anything else is downmixed to stereo. */
  channels?: 1 | 2;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function channelData(buffer: AudioBuffer, channels: 1 | 2): Float32Array[] {
  if (channels === 1) return [mixToMono(buffer)];
  const [first, second] = [buffer.getChannelData(0), buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)];
  if (buffer.numberOfChannels === 1) return [first, first];
  if (buffer.numberOfChannels === 2) return [first, second];
  // >2 channels: average the extras into the side channel.
  const side = new Float32Array(buffer.length);
  for (let channel = 1; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) side[i] += data[i];
  }
  const count = buffer.numberOfChannels - 1;
  for (let i = 0; i < side.length; i += 1) side[i] /= count;
  return [first, side];
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) out[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    const scale = 1 / buffer.numberOfChannels;
    for (let i = 0; i < out.length; i += 1) out[i] *= scale;
  }
  return out;
}

/**
 * Write a correct RIFF/WAVE file.
 *
 * 16-bit is plain PCM and needs nothing extra. 24- and 32-bit PCM are only
 * formally valid with a `fact` chunk declaring the sample-frame count, so we
 * write one. This is the safe, boring path: no float extensions, no
 * WAVE_FORMAT_EXTENSIBLE, so every player and editor reads the result.
 */
export function encodeWav(
  buffer: AudioBuffer,
  bitDepth: WavBitDepth = 16,
  options: WavOptions = {},
): Blob {
  const depth = bitDepth === 24 || bitDepth === 32 ? bitDepth : 16;
  const channels: 1 | 2 = options.channels ?? (buffer.numberOfChannels === 1 ? 1 : 2);
  const data = channelData(buffer, channels);
  const frames = buffer.length;
  const bytesPerSample = depth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const factChunk = depth === 16 ? 0 : 12;
  const headerBytes = 12 + 24 + factChunk + 8;

  const view = new DataView(new ArrayBuffer(headerBytes + dataBytes));
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, headerBytes - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // WAVE_FORMAT_PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, depth, true);

  let offset = 36;
  if (depth !== 16) {
    writeAscii(view, offset, "fact");
    view.setUint32(offset + 4, 4, true);
    view.setUint32(offset + 8, frames, true);
    offset += 12;
  }

  writeAscii(view, offset, "data");
  view.setUint32(offset + 4, dataBytes, true);
  offset += 8;

  const scale = depth === 16 ? 32767 : depth === 24 ? 8388607 : 2147483647;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const source = data[channel]!;
      const raw = source[frame] ?? 0;
      const clamped = raw > 1 ? 1 : raw < -1 ? -1 : raw;
      const value = Math.round(clamped * scale);
      if (depth === 16) {
        view.setInt16(offset, value, true);
        offset += 2;
      } else if (depth === 24) {
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
        offset += 3;
      } else {
        view.setInt32(offset, value, true);
        offset += 4;
      }
    }
  }

  return new Blob([view.buffer], { type: "audio/wav" });
}

/* ================================================================== */
/*  MP3 encoding                                                       */
/* ================================================================== */

/** lamejs only understands these two rates well. */
const MP3_RATES = [44100, 48000] as const;

/** One MP3 frame is 1152 samples per channel. */
const MP3_BLOCK = 1152;

export type Mp3Bitrate = 96 | 128 | 160 | 192 | 256 | 320;

export const MP3_BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];

/** MP3 at a target bitrate over a known duration — the size estimate in the UI. */
export function estimateMp3Bytes(kbps: number, seconds: number): number {
  // 17-byte Xing/Info frame plus ~0.5% container overhead.
  return Math.round((kbps * 1000 * Math.max(0, seconds)) / 8 + 4096);
}

function toInt16(source: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i += 1) {
    const value = source[i] ?? 0;
    const clamped = value > 1 ? 1 : value < -1 ? -1 : value;
    out[i - from] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

/**
 * Encode to MP3 with `lamejs`, loaded on demand.
 *
 * Typing note: `@breezystack/lamejs` ships its own `type.d.ts`, but its
 * `Mp3Encoder.encodeBuffer(left, right?)` signature is too narrow — at runtime
 * `right` is only required for stereo, and the return type is a *new*
 * `Uint8Array` that must be copied rather than pushed. We therefore load the
 * module once, check the constructor actually exists, and use a narrow local
 * interface for the encoder instead of widening the published types.
 *
 * The encoder wants mono/stereo `Int16Array`s at 44.1 or 48 kHz, so we resample
 * and downmix first, then encode in blocks — yielding to the main thread
 * periodically so a ten-minute track does not freeze the tab.
 */
export async function encodeMp3(
  buffer: AudioBuffer,
  kbps: number,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const module = (await import("@breezystack/lamejs")) as unknown;
  const ctor = (module as { Mp3Encoder?: new (c: number, r: number, k: number) => Mp3EncoderLike })
    .Mp3Encoder;
  if (typeof ctor !== "function") {
    throw new Error("The MP3 encoder could not be loaded. Check your connection and try again.");
  }

  const sampleRate = MP3_RATES.includes(buffer.sampleRate as (typeof MP3_RATES)[number])
    ? buffer.sampleRate
    : 44100;
  const prepared = await resampleBuffer(buffer, sampleRate);

  const mono = prepared.numberOfChannels === 1;
  const channels = mono ? 1 : 2;
  const { left, right } = prepareMp3Channels(prepared, mono);
  const encoder = new ctor(channels, sampleRate, Math.round(kbps));

  const frames = prepared.length;
  const blocks = Math.ceil(frames / MP3_BLOCK);
  const parts: Uint8Array[] = [];
  let sinceYield = 0;

  for (let block = 0; block < blocks; block += 1) {
    const from = block * MP3_BLOCK;
    const to = Math.min(frames, from + MP3_BLOCK);
    const chunk = encoder.encodeBuffer(toInt16(left, from, to), mono ? undefined : toInt16(right, from, to));
    if (chunk.length > 0) parts.push(chunk);
    sinceYield += 1;
    if (sinceYield >= 8) {
      sinceYield = 0;
      onProgress?.((block / blocks) * 100);
      await yieldToMain();
    }
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);
  onProgress?.(100);

  return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}

interface Mp3EncoderLike {
  encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
  flush(): Uint8Array;
}

function prepareMp3Channels(
  buffer: AudioBuffer,
  mono: boolean,
): { left: Float32Array; right: Float32Array } {
  const first = buffer.getChannelData(0);
  if (mono) return { left: first, right: first };
  if (buffer.numberOfChannels === 2) return { left: first, right: buffer.getChannelData(1) };
  // More than two channels: average the remaining ones into the right channel.
  const right = new Float32Array(buffer.length);
  let count = 0;
  for (let channel = 1; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) right[i] += data[i];
    count += 1;
  }
  if (count > 0) {
    for (let i = 0; i < right.length; i += 1) right[i] /= count;
  }
  return { left: first, right };
}

/* ================================================================== */
/*  Video — probing, seeking, thumbnails                               */
/* ================================================================== */

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

function waitForEvent(
  target: HTMLMediaElement,
  success: string,
  failureDetail: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(success, onSuccess);
      target.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(failureDetail));
    };
    target.addEventListener(success, onSuccess);
    target.addEventListener("error", onError, { once: true });
  });
}

/** Some WebM/MKV files report `Infinity`; seeking to a huge time forces a real value. */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  return new Promise<number>((resolve) => {
    const onTimeUpdate = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.currentTime = 0;
        resolve(video.duration);
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.currentTime = 1e101;
    setTimeout(() => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    }, 4000);
  });
}

export interface VideoProbe {
  url: string;
  element: HTMLVideoElement;
  meta: VideoMeta;
  dispose: () => void;
}

/** Load a video file into a detached element and read its real dimensions. */
export async function probeVideo(file: Blob): Promise<VideoProbe> {
  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.preload = "metadata";
  element.playsInline = true;
  element.muted = true;
  element.src = url;

  try {
    await waitForEvent(
      element,
      "loadedmetadata",
      "The browser could not read this video. Its container or codec is not supported — try MP4 (H.264) or WebM (VP8/VP9).",
    );
    const duration = await resolveDuration(element);
    return {
      url,
      element,
      meta: {
        duration,
        width: element.videoWidth || 0,
        height: element.videoHeight || 0,
      },
      dispose: () => {
        element.removeAttribute("src");
        element.load();
        URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    element.removeAttribute("src");
    element.load();
    URL.revokeObjectURL(url);
    throw error;
  }
}

export interface VideoMetaLite {
  duration: number;
  width: number;
  height: number;
}

export async function readVideoMeta(file: Blob): Promise<VideoMetaLite> {
  const probe = await probeVideo(file);
  const meta = probe.meta;
  probe.dispose();
  return meta;
}

export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const target = clamp(time, 0, Math.max(0, duration - 1e-3));
  if (Math.abs(video.currentTime - target) < 1e-3 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not seek inside this video."));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError, { once: true });
    try {
      video.currentTime = target;
    } catch {
      cleanup();
      reject(new Error("The browser could not seek inside this video."));
    }
  });
}

/** Seek, wait for `seeked`, then paint the frame into `canvas`. */
export async function drawVideoFrame(
  video: HTMLVideoElement,
  time: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  await seekVideo(video, time);
  if (video.readyState < 2) {
    throw new Error("The browser had not decoded the frame at that timestamp.");
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a 2D canvas context.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
}

export interface Thumbnail {
  /** Data URL, ready for an `<img src>`. */
  src: string;
  /** Media time the frame was taken from. */
  time: number;
  /** False when the browser could not produce this frame. */
  ok: boolean;
}

/**
 * Grab thumbnails at real timestamps. Frames the browser cannot decode are
 * reported with `ok: false` rather than silently replaced by a neighbour.
 */
export async function captureThumbnails(
  video: HTMLVideoElement,
  times: number[],
  width: number,
  maxWidth = 160,
): Promise<Thumbnail[]> {
  const ratio = video.videoHeight > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(Math.min(maxWidth, width || maxWidth)));
  canvas.height = Math.max(1, Math.round(canvas.width * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a 2D canvas context.");

  const out: Thumbnail[] = [];
  for (const time of times) {
    try {
      await seekVideo(video, time);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      out.push({ src: canvas.toDataURL("image/jpeg", 0.65), time, ok: true });
    } catch {
      out.push({ src: "", time, ok: false });
    }
  }
  return out;
}

/* ================================================================== */
/*  Video — the real-time recorder                                     */
/* ================================================================== */

export interface TranscodeTick {
  /** Seconds of source media consumed so far. */
  mediaTime: number;
  /** Wall-clock seconds spent recording. */
  elapsed: number;
  /** Wall-clock seconds remaining, or `null` when it cannot be known. */
  remaining: number | null;
  /** Real progress: source consumed / source requested. `null` when unknown. */
  percent: number | null;
}

export interface TranscodeOptions {
  file: Blob;
  /** Object URL the caller already owns. One is created and revoked otherwise. */
  url?: string;
  /** From `pickVideoMime`. */
  mime: string;
  width: number;
  height: number;
  fps: number;
  /** Target video bitrate in kbps. MediaRecorder treats this as a hint. */
  videoKbps?: number;
  /** Target audio bitrate in kbps. */
  audioKbps?: number;
  /** Source time to start at, seconds. */
  start?: number;
  /** Source time to stop at, seconds. */
  end?: number;
  /** 1 = real time. Higher plays faster, lower slower. */
  playbackRate?: number;
  preservePitch?: boolean;
  includeAudio?: boolean;
  /**
   * Sub-rectangle of the source frame to sample, in source pixels. Omit to use
   * the whole frame. This is how the cropper works: the same 9-argument
   * `drawImage` call that the resizer uses, with a source box as well.
   */
  sourceRect?: { x: number; y: number; width: number; height: number };
  /** Drawn on top of every frame, in output pixel space. */
  overlay?: (
    context: CanvasRenderingContext2D,
    frame: { time: number; width: number; height: number },
  ) => void;
  onTick?: (tick: TranscodeTick) => void;
  signal?: AbortSignal;
}

export interface TranscodeOutcome {
  blob: Blob;
  /** False when the browser refused to give us an audio track. */
  audio: boolean;
  /** Frames actually painted into the canvas. */
  frames: number;
  /** Frame callbacks where no new image was available. */
  skipped: number;
  width: number;
  height: number;
  /** Output duration in seconds, derived from the recorded blob length. */
  duration: number;
}

export interface TranscodeRun {
  result: Promise<TranscodeOutcome>;
  cancel(reason?: string): void;
}

/**
 * The workhorse behind every re-encoding video tool.
 *
 * A hidden `<video>` plays the source in real time; each composited frame is
 * drawn to a canvas at the requested size, an optional overlay is painted on
 * top, and the canvas is captured into a `MediaRecorder` alongside the source's
 * audio. Frames are driven by `requestVideoFrameCallback` where it exists — so
 * we only paint when a genuinely new image is available — and by
 * `requestAnimationFrame` otherwise.
 *
 * Audio note: we reroute the element through a `MediaElementAudioSourceNode`
 * into a `MediaStreamAudioDestinationNode` and a zero gain into the speakers.
 * That is what lets us capture sound without playing it out loud, and it means
 * the recorder's audio follows `playbackRate` *and* `preservesPitch`.
 */
export function runCanvasRecorder(options: TranscodeOptions): TranscodeRun {
  const controller = new AbortController();
  const link = () => {
    if (options.signal?.aborted) controller.abort(options.signal.reason);
  };
  link();
  options.signal?.addEventListener("abort", link, { once: true });
  const { signal } = controller;
  let cancelReason = "Cancelled.";

  const result = (async (): Promise<TranscodeOutcome> => {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("This browser has no MediaRecorder, so video export is not possible.");
    }
    if (!options.mime) {
      throw new Error("This browser cannot encode any of the offered video formats.");
    }

    const ownedUrl = options.url ? null : URL.createObjectURL(options.file);
    const url = options.url ?? ownedUrl!;
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.muted = false;
    video.crossOrigin = "anonymous";
    video.src = url;

    const cleanup: Array<() => void> = [];
    let audioContext: AudioContext | null = null;
    let audioDestination: MediaStreamAudioDestinationNode | null = null;

    try {
      await waitForEvent(
        video,
        "loadedmetadata",
        "The browser could not read this video. Its container or codec is not supported.",
      );
      const sourceDuration = await resolveDuration(video);
      if (!(sourceDuration > 0)) {
        throw new Error("The browser could not determine this video's length.");
      }

      const start = clamp(options.start ?? 0, 0, Math.max(0, sourceDuration - 0.02));
      const end = clamp(options.end ?? sourceDuration, start + 0.04, sourceDuration);
      const rate = clamp(options.playbackRate ?? 1, 0.1, 8);
      const mediaSpan = end - start;

      // ---------------------------------------------------------------- audio
      let audioIncluded = false;
      if (options.includeAudio !== false) {
        try {
          const context = createAudioContext();
          audioContext = context;
          const source = context.createMediaElementSource(video);
          const destination = context.createMediaStreamDestination();
          const mute = context.createGain();
          mute.gain.value = 0;
          source.connect(destination);
          source.connect(mute);
          mute.connect(context.destination);
          await context.resume();
          if (context.state === "running" && destination.stream.getAudioTracks().length > 0) {
            audioIncluded = true;
            audioDestination = destination;
            cleanup.push(() => {
              source.disconnect();
              mute.disconnect();
            });
          }
        } catch {
          audioIncluded = false;
        }
      }

      // ---------------------------------------------------------------- canvas
      const canvas = document.createElement("canvas");
      canvas.width = options.width;
      canvas.height = options.height;
      const context2d = canvas.getContext("2d", { alpha: false });
      if (!context2d) throw new Error("This browser could not create a 2D canvas context.");
      context2d.fillStyle = "#000000";
      context2d.fillRect(0, 0, canvas.width, canvas.height);

      // Below 1× the canvas only changes `rate` times per source second, so
      // sampling it any faster would record duplicates. Above 1× we keep the
      // requested rate and let the recorder drop frames, exactly as a normal
      // speed-up transcode does.
      const captureFps = clamp(Math.round(options.fps * Math.min(rate, 1)), 1, 60);
      const canvasStream = canvas.captureStream(captureFps);
      cleanup.push(() => canvasStream.getTracks().forEach((track) => track.stop()));

      // ---------------------------------------------------------------- record
      const stream = new MediaStream(canvasStream.getVideoTracks());
      if (audioDestination) {
        for (const track of audioDestination.stream.getAudioTracks()) stream.addTrack(track);
      }
      cleanup.push(() => stream.getTracks().forEach((track) => track.stop()));

      const recorder = new MediaRecorder(stream, {
        mimeType: options.mime,
        ...(options.videoKbps ? { videoBitsPerSecond: options.videoKbps * 1000 } : {}),
        ...(options.audioKbps ? { audioBitsPerSecond: options.audioKbps * 1000 } : {}),
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      await seekVideo(video, start);
      if (rate !== 1) video.playbackRate = rate;
      if (options.preservePitch !== undefined) {
        const pitchable = video as unknown as Record<string, boolean>;
        if ("preservesPitch" in video) pitchable["preservesPitch"] = options.preservePitch;
        else if ("webkitPreservesPitch" in video) pitchable["webkitPreservesPitch"] = options.preservePitch;
      }

      const startedAt = performance.now();
      let frames = 0;
      let skipped = 0;
      let lastDrawn = -1;
      let finished = false;
      let stopRecorders: () => void = () => undefined;

      const recordStarted = new Promise<void>((resolve, reject) => {
        recorder.onstart = () => resolve();
        recorder.onerror = () => reject(new Error("The browser stopped recording unexpectedly."));
      });

      recorder.start(1000);
      await recordStarted;

      try {
        await video.play();
      } catch {
        throw new Error("The browser refused to play this video, so it could not be recorded.");
      }
      cleanup.push(() => {
        video.pause();
        video.onended = null;
      });

      const supportsFrameCallback = typeof video.requestVideoFrameCallback === "function";

      // Clamp the requested source box to the real decoded frame, so a crop that
      // runs a pixel past the edge samples black rather than throwing.
      const requested = options.sourceRect;
      const box =
        requested && requested.width > 0 && requested.height > 0
          ? {
              x: clamp(requested.x, 0, Math.max(0, video.videoWidth - 1)),
              y: clamp(requested.y, 0, Math.max(0, video.videoHeight - 1)),
              width: Math.max(1, Math.min(requested.width, video.videoWidth)),
              height: Math.max(1, Math.min(requested.height, video.videoHeight)),
            }
          : null;

      const draw = () => {
        if (video.readyState < 2 || video.videoWidth === 0) {
          skipped += 1;
          return;
        }
        if (video.currentTime === lastDrawn) {
          skipped += 1;
          return;
        }
        lastDrawn = video.currentTime;
        if (box) {
          context2d.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
        } else {
          context2d.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        if (options.overlay) {
          options.overlay(context2d, {
            time: Math.max(0, video.currentTime - start),
            width: canvas.width,
            height: canvas.height,
          });
        }
        frames += 1;
      };

      const report = () => {
        const mediaTime = clamp(video.currentTime - start, 0, mediaSpan);
        const elapsed = (performance.now() - startedAt) / 1000;
        options.onTick?.({
          mediaTime,
          elapsed,
          remaining: mediaSpan > 0 ? Math.max(0, (mediaSpan - mediaTime) / rate) : null,
          percent: mediaSpan > 0 ? clamp((mediaTime / mediaSpan) * 100, 0, 100) : null,
        });
      };

      await new Promise<void>((resolve) => {
        let scheduled: number | null = null;
        const step = () => {
          if (finished) return;
          draw();
          report();
          if (signal.aborted || video.ended || video.currentTime >= end) {
            video.pause();
            finished = true;
            resolve();
            return;
          }
          if (supportsFrameCallback) {
            scheduled = video.requestVideoFrameCallback(step);
          } else {
            scheduled = requestAnimationFrame(step);
          }
          stopRecorders = () => {
            if (scheduled !== null) {
              if (supportsFrameCallback) video.cancelVideoFrameCallback(scheduled);
              else cancelAnimationFrame(scheduled);
            }
          };
        };
        step();
      });
      stopRecorders();
      video.pause();

      if (signal.aborted) throw new CancelledError(cancelReason);

      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.stop();
      await stopped;

      const blob = new Blob(chunks, { type: options.mime });
      if (blob.size === 0) {
        throw new Error("The browser produced an empty recording. Try a smaller frame or a lower frame rate.");
      }
      return {
        blob,
        audio: stream.getAudioTracks().length > 0,
        frames,
        skipped,
        width: canvas.width,
        height: canvas.height,
        duration: mediaSpan / rate,
      };
    } finally {
      for (const fn of cleanup.reverse()) fn();
      video.removeAttribute("src");
      video.load();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      if (audioContext) void audioContext.close().catch(() => undefined);
      options.signal?.removeEventListener("abort", link);
    }
  })();

  return {
    result,
    cancel(reason = "Cancelled.") {
      cancelReason = reason;
      controller.abort(reason);
    },
  };
}

/* ================================================================== */
/*  GIF encoding                                                       */
/* ================================================================== */

export interface GifOptions {
  width: number;
  height: number;
  /** Frames per second of the *output*. */
  fps: number;
  /** `-1` plays once, `0` loops forever, `n` loops `n` extra times. */
  repeat: number;
  /** Palette size: 64 / 128 / 256. */
  colors: number;
  /** Trade quality for size. */
  quality: "high" | "balanced" | "small";
}

export interface GifWriter {
  /** Quantise and append one RGBA frame. */
  addFrame(rgba: Uint8ClampedArray): void;
  /** Global palette derived from `rgba`, to be applied to every frame. */
  setPalette(rgba: Uint8ClampedArray): void;
  readonly frameCount: number;
  finish(): Blob;
}

function qualityFormat(quality: GifOptions["quality"]): "rgb565" | "rgb444" {
  return quality === "small" ? "rgb444" : "rgb565";
}

/**
 * Thin wrapper over `gifenc`. The encoder is dynamically imported, and a single
 * global palette is shared by every frame so animation does not shimmer.
 */
export async function createGifWriter(options: GifOptions): Promise<GifWriter> {
  const { GIFEncoder, quantise, applyPalette } = await import("gifenc");
  const encoder = GIFEncoder({ initialCapacity: 1024 * 256 });
  const delay = Math.max(20, Math.round(1000 / Math.max(1, options.fps)));
  let palette: number[][] | null = null;
  let count = 0;

  return {
    setPalette(rgba) {
      palette = quantise(rgba, options.colors, { format: qualityFormat(options.quality) });
    },
    addFrame(rgba) {
      if (!palette) {
        palette = quantise(rgba, options.colors, { format: qualityFormat(options.quality) });
      }
      const index = applyPalette(rgba, palette, qualityFormat(options.quality));
      encoder.writeFrame(index, options.width, options.height, {
        palette,
        delay,
        repeat: options.repeat,
      });
      count += 1;
    },
    get frameCount() {
      return count;
    },
    finish() {
      if (count === 0) throw new Error("No frames were captured, so there is nothing to encode.");
      encoder.finish();
      return new Blob([encoder.bytes() as BlobPart], { type: "image/gif" });
    },
  };
}
