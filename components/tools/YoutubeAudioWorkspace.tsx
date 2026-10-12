"use client";

import * as React from "react";
import { AudioLines, Check, Link2, Music, ShieldCheck, TriangleAlert, Video } from "lucide-react";

import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select } from "@/components/ui/form";
import { FileRow } from "@/components/tools/FileDropzone";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { Notice, ToolError } from "@/components/tools/states";
import { formatBytes } from "@/lib/utils/format";
import { downloadBlob, downloadZipBatch, sumSizes, type NamedBlob } from "@/lib/utils/files";
import { extractMedia, isArchive } from "@/lib/tools/engines/archive";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils/cn";
import {
  ACCEPT_ATTRIBUTE,
  ConversionError,
  classifyYouTubeUrl,
  convertMedia,
  extensionOf,
  formatInfo,
  isSupported,
  loadFFmpeg,
  MAX_INPUT_BYTES,
  OUTPUT_FORMATS,
  parseTimecode,
  resetFFmpeg,
  type ConversionPhase,
  type LinkState,
  type OutputFormat,
} from "@/lib/tools/engines/ffmpeg-mp3";

/* -------------------------------------------------------------------------- */
/*  Workspace                                                                 */
/* -------------------------------------------------------------------------- */

type Phase = "idle" | ConversionPhase;

const BITRATES = [
  { value: "128", label: "128 kbps" },
  { value: "192", label: "192 kbps" },
  { value: "256", label: "256 kbps" },
  { value: "320", label: "320 kbps" },
] as const;

const SAMPLE_RATES = [
  { value: "44100", label: "44.1 kHz" },
  { value: "48000", label: "48 kHz" },
] as const;

/**
 * CRF labels for the MP4 path. CRF is the number most people have never seen,
 * so the picker says what it means rather than showing a bare integer.
 */
const CRFS = [
  { value: "23", label: "Best" },
  { value: "28", label: "Balanced" },
  { value: "33", label: "Small" },
] as const;

export default function YoutubeAudioWorkspace() {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);

  /**
   * Batch state. `queue` is what will be converted, `outputs` what has already
   * been converted. A single `file` used to sit alongside these, but it could
   * disagree with `queue` after a per-row remove — the queue is the only truth.
   */
  const [queue, setQueue] = React.useState<File[]>([]);
  const [outputs, setOutputs] = React.useState<NamedBlob[]>([]);
  const [unpacking, setUnpacking] = React.useState(false);
  const [batchIndex, setBatchIndex] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [percent, setPercent] = React.useState(0);
  const [result, setResult] = React.useState<{
    name: string;
    bytes: number;
    format: OutputFormat;
  } | null>(null);
  const [error, setError] = React.useState<{ title: string; detail?: string } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [link, setLink] = React.useState("");
  const [linkState, setLinkState] = React.useState<LinkState>({ kind: "empty" });

  const [format, setFormat] = React.useState<OutputFormat>("mp3");
  const [bitrate, setBitrate] = React.useState("192");
  const [sampleRate, setSampleRate] = React.useState("44100");
  const [channels, setChannels] = React.useState<"1" | "2">("2");
  const [crf, setCrf] = React.useState("28");
  const [trimStart, setTrimStart] = React.useState("");
  const [trimEnd, setTrimEnd] = React.useState("");
  const [normalize, setNormalize] = React.useState(false);

  /**
   * Trim inputs are free text, so the error has to be derived from what the
   * user typed rather than stored. Empty means "keep the whole file", which is
   * why `undefined` and `0` are different: `-ss 0` is a no-op we must not emit.
   */
  const trimStartSec = trimStart.trim() ? parseTimecode(trimStart) : undefined;
  const trimEndSec = trimEnd.trim() ? parseTimecode(trimEnd) : undefined;
  const trimError =
    trimStart.trim() && trimStartSec === undefined
      ? "Use mm:ss or seconds, for example 1:23."
      : trimEnd.trim() && trimEndSec === undefined
        ? "Use mm:ss or seconds, for example 4:05."
        : trimStartSec !== undefined &&
            trimEndSec !== undefined &&
            trimEndSec <= trimStartSec
          ? "The end has to be after the start."
          : null;

  const abortRef = React.useRef<AbortController | null>(null);
  /**
   * The encoded MP3. Held in a ref rather than state because it can be tens of
   * megabytes and must not sit in a state update that triggers extra renders.
   * `downloadBlob` builds its own blob URL and revokes it, so nothing leaks.
   */
  const blobRef = React.useRef<Blob>(new Blob());
  const busy = phase === "loading" || phase === "converting";

  /* ---------------------------------------------------------------------- */
  /*  File selection                                                        */
  /* ---------------------------------------------------------------------- */

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setQueue([]);
    setOutputs([]);
    setBatchIndex(0);
    setResult(null);
    setError(null);
    setNotice(null);
    setPercent(0);
    setPhase("idle");
    // Drop the previous encode so a 60 MB Blob is not retained after "Remove".
    blobRef.current = new Blob();
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  /**
   * Accepts media files and Takeout zips.
   *
   * Zips are unpacked here rather than in the convert path so the queue is
   * always a flat list of real media — every later stage (validation, the
   * batch loop, the download) then works on files, never archives.
   */
  const accept = React.useCallback(
    async (incoming: FileList | File[] | null) => {
      const list = Array.from(incoming ?? []);
      if (list.length === 0) return;

      reset();
      setNotice(null);

      const archives = list.filter(isArchive);
      const plain = list.filter((f) => !isArchive(f));
      const collected: File[] = [];

      for (const plainFile of plain) {
        if (isSupported(plainFile)) collected.push(plainFile);
      }

      if (archives.length > 0) {
        setUnpacking(true);
        try {
          for (const archive of archives) {
            const extracted = await extractMedia(archive);
            if (extracted.notAnArchive && extracted.skipped.length > 0) {
              setError({ title: "That archive could not be opened.", detail: extracted.skipped[0]?.reason });
              setUnpacking(false);
              return;
            }
            for (const entry of extracted.files) collected.push(entry.file);
            if (extracted.skipped.length > 0) {
              setNotice(`${extracted.skipped.length} entr${extracted.skipped.length === 1 ? "y was" : "ies were"} skipped in ${archive.name}.`);
            }
          }
        } finally {
          setUnpacking(false);
        }
      }

      // Validate after unpacking, so extracted files are checked too.
      const usable = collected.filter((f) => {
        if (f.size === 0) return false;
        return f.size <= MAX_INPUT_BYTES;
      });

      const rejected = collected.filter((f) => f.size === 0 || f.size > MAX_INPUT_BYTES);

      if (usable.length === 0) {
        setError({
          title: list.length === 1 && rejected.length === 1 && rejected[0]!.size === 0
            ? "That file is empty."
            : "No usable media was found.",
          detail:
            rejected.length > 0
              ? `${rejected.length} file${rejected.length === 1 ? "" : "s"} skipped — each must be non-empty and under ${formatBytes(MAX_INPUT_BYTES)}.`
              : "Expected MP4, WebM, MOV, MKV, AVI, MP3, WAV, M4A, AAC, OGG, Opus or FLAC, or a Takeout zip.",
        });
        return;
      }

      if (rejected.length > 0) {
        setNotice(`${rejected.length} file${rejected.length === 1 ? " was" : "s were"} skipped — empty or over ${formatBytes(MAX_INPUT_BYTES)}.`);
      }

      setQueue(usable);
    },
    [reset],
  );

  /* ---------------------------------------------------------------------- */
  /*  Conversion                                                            */
  /* ---------------------------------------------------------------------- */

  const convert = async () => {
    const targets = queue;
    if (targets.length === 0 || busy || trimError) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setResult(null);
    setOutputs([]);
    setBatchIndex(0);
    setPercent(0);
    setPhase("loading");

    const isBatch = targets.length > 1;
    const produced: NamedBlob[] = [];
    let last: Awaited<ReturnType<typeof convertMedia>> | null = null;
    let failure: ConversionError | null = null;

    try {
      for (const [index, source] of targets.entries()) {
        if (controller.signal.aborted) break;
        setBatchIndex(index);
        // One file failing must not discard the ones already converted — a
        // Takeout export of 40 clips should yield 39 files, not nothing.
        try {
          const outcome = await convertMedia(source, {
            format,
            bitrateKbps: Number(bitrate),
            sampleRateHz: Number(sampleRate),
            channels: Number(channels) as 1 | 2,
            crf: Number(crf),
            trim:
              trimError || (trimStartSec === undefined && trimEndSec === undefined)
                ? undefined
                : { startSec: trimStartSec, endSec: trimEndSec },
            normalize,
            signal: controller.signal,
            onPhase: (next) => {
              setPhase(next);
              if (next === "converting") setPercent(0);
            },
            onProgress: (ratio) => {
              // A batch bar should advance across the whole set, not stall at
              // 50% while file 20 of 40 runs.
              const overall = ((index + ratio) / targets.length) * 100;
              setPercent(overall);
            },
          });

          last = outcome;
          blobRef.current = outcome.blob;
          produced.push({ name: outcome.filename, blob: outcome.blob });
          setOutputs([...produced]);
        } catch (caught) {
          if (caught instanceof ConversionError && caught.message === "Cancelled.") throw caught;
          const detail =
            caught instanceof ConversionError && caught.cause instanceof Error
              ? caught.cause.message
              : caught instanceof Error
                ? caught.message
                : String(caught);
          failure = new ConversionError(
            targets.length > 1
              ? `${targets.length - produced.length} of ${targets.length} files failed. First error: ${source.name}`
              : caught instanceof ConversionError
                ? caught.message
                : "The conversion failed.",
            { userFacing: true, cause: detail },
          );
          break;
        }
      }
    } catch (caught) {
      if (!(caught instanceof ConversionError) || caught.message !== "Cancelled.") {
        failure = new ConversionError("The conversion failed.", {
          userFacing: true,
          cause: caught,
        });
      }
    } finally {
      abortRef.current = null;
    }

    if (produced.length > 0) {
      setOutputs(produced);
      setResult({ name: produced[produced.length - 1]!.name, bytes: produced[produced.length - 1]!.blob.size, format });
      setPercent(100);
      setPhase("done");
    }

    if (failure) {
      setError({ title: failure.message, detail: failure.cause instanceof Error ? failure.cause.message : undefined });
      setPhase(produced.length > 0 ? "done" : "idle");
      return;
    }

    if (controller.signal.aborted) {
      setPhase("idle");
      return;
    }

    toast.success(
      isBatch ? `${produced.length} files ready` : `${formatInfo(format).label} ready`,
      isBatch
        ? `${produced.length} of ${targets.length} files converted`
        : `${last?.filename} · ${formatBytes(last?.bytes ?? 0)}`,
    );
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
  };

  // Abort an in-flight run if the component goes away mid-encode.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /** Warm the 31 MB core up before the user commits to a conversion. */
  const prefetch = async () => {
    try {
      setPhase("loading");
      await loadFFmpeg((next) => setPhase(next));
      setPhase("idle");
      toast.success("Engine ready", "FFmpeg is loaded — conversions will start immediately.");
    } catch {
      resetFFmpeg();
      setPhase("idle");
      setError({ title: "The FFmpeg core could not be loaded. Check your connection and try again." });
    }
  };

  /* ---------------------------------------------------------------------- */
  /*  Link handling                                                         */
  /* ---------------------------------------------------------------------- */

  const processLink = () => setLinkState(classifyYouTubeUrl(link));

  /* ---------------------------------------------------------------------- */
  /*  Render                                                                */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------------------------------------------------------- */}
      {/*  YouTube link                                                     */}
      {/* ---------------------------------------------------------------- */}
      <ToolShell>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-brand-500"
            >
              <Video className="size-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-ink)]">YouTube link</h2>
              <p className="text-[13px] text-[var(--text-muted)]">
                Check a link and open the official page.
              </p>
            </div>
          </div>

          <Field
            label="Video URL"
            error={linkState.kind === "invalid" ? linkState.message : null}
            hint="Paste a link to a single YouTube video."
          >
            {({ id, describedBy, invalid }) => (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="url"
                  inputMode="url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={link}
                  onChange={(event) => {
                    setLink(event.target.value);
                    if (linkState.kind !== "empty") setLinkState({ kind: "empty" });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") processLink();
                  }}
                  className="flex-1"
                />
                <Button onClick={processLink} className="shrink-0">
                  <Link2 className="size-4" aria-hidden="true" />
                  Process link
                </Button>
              </div>
            )}
          </Field>

          {linkState.kind === "video" ? (
            <Notice tone="success" icon={<ShieldCheck className="size-3.5" />} title="Valid video link.">
              This tool does not download anything from YouTube. Open the official page and use
              YouTube&rsquo;s own download option if the uploader has made one available, or ask the
              copyright holder for permission. If you already hold the file, upload it below and it
              will be converted here.
              <a
                href={linkState.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-emerald-500 underline underline-offset-2 hover:opacity-80"
              >
                <Video className="size-3.5" aria-hidden="true" />
                Open on YouTube
              </a>
            </Notice>
          ) : null}

          {linkState.kind === "playlist" || linkState.kind === "channel" ? (
            <Notice tone="warning" title="That isn't a single video.">
              Playlists and channels contain many videos, each with its own rights holder. Open the
              page and handle each video individually.
              <a
                href={linkState.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block font-medium text-amber-500 underline underline-offset-2 hover:opacity-80"
              >
                Open on YouTube
              </a>
            </Notice>
          ) : null}
        </div>
      </ToolShell>

      {/* ---------------------------------------------------------------- */}
      {/*  Converter                                                        */}
      {/* ---------------------------------------------------------------- */}
      <ToolShell>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-brand-500"
            >
              <Music className="size-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-ink)]">
                Convert a file you own to MP3 or MP4
              </h2>
              <p className="text-[13px] text-[var(--text-muted)]">
                FFmpeg.wasm runs entirely in this tab. Nothing is uploaded.
              </p>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={`${ACCEPT_ATTRIBUTE},.zip,application/zip`}
            multiple
            className="sr-only"
            onChange={(event) => {
              void accept(event.target.files);
            }}
          />

          {unpacking ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-6 py-10 text-center">
              <Music className="size-4 animate-pulse text-emerald-500" aria-hidden="true" />
              <p className="text-[13px] text-[var(--text-muted)]" role="status">
                Opening the archive and finding media inside…
              </p>
            </div>
          ) : queue.length === 0 ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose an audio or video file to convert"
              aria-disabled={busy || undefined}
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(event) => {
                if (busy) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                dragDepth.current += 1;
                if (!busy) setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) event.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                dragDepth.current -= 1;
                if (dragDepth.current <= 0) {
                  dragDepth.current = 0;
                  setDragging(false);
                }
              }}
              onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            void accept(event.dataTransfer.files);
          }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3",
                "rounded-[14px] border-2 border-dashed px-6 py-12 text-center",
                "transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                dragging
                  ? "border-emerald-500 bg-emerald-500/[0.07]"
                  : "border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] hover:border-emerald-500/50",
                busy && "cursor-not-allowed opacity-50",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-12 place-items-center rounded-xl border transition-colors duration-200",
                  dragging
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-500"
                    : "border-[var(--surface-line)] bg-[var(--surface-card)] text-[var(--text-muted)]",
                )}
              >
                <AudioLines className="size-5" />
              </span>
              <div className="space-y-1">
                <p className="text-[15px] font-medium text-[var(--text-ink)]">
                  {dragging ? "Drop to select" : "Drop your files or a Takeout zip"}
                </p>
                <p className="text-[13px] text-[var(--text-muted)]">
                  or{" "}
                  <span className="font-medium text-emerald-500">browse from your device</span>
                </p>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                MP4, WebM, MOV, MKV, AVI, MP3, WAV, M4A, AAC, OGG, Opus, FLAC, ZIP · max{" "}
                {formatBytes(MAX_INPUT_BYTES)} each
              </p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--text-muted)]">
                A Google Takeout zip is unpacked here and every clip inside is queued. Only convert
                media you own or have permission to use.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-[var(--text-ink)]" role="status">
                  {queue.length} {queue.length === 1 ? "file" : "files"} selected
                  <span className="ml-2 font-normal text-[var(--text-muted)]">
                    {formatBytes(sumSizes(queue))}
                  </span>
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={reset}
                  disabled={busy || unpacking}
                >
                  Clear
                </Button>
              </div>
              <ul className="grid gap-1.5">
                {queue.map((queued, index) => (
                  <FileRow
                    key={`${queued.name}-${index}`}
                    file={queued}
                    index={index}
                    meta={extensionOf(queued.name).toUpperCase()}
                    disabled={busy}
                    onRemove={() => {
                      setQueue((current) => current.filter((_, i) => i !== index));
                      setResult(null);
                      setOutputs([]);
                    }}
                    trailing={
                      batchIndex === index && busy ? (
                        <span className="text-[11px] text-emerald-500">converting…</span>
                      ) : undefined
                    }
                  />
                ))}
              </ul>
              {queue.length > 6 ? (
                <details className="text-[11px] text-[var(--text-muted)]">
                  <summary className="cursor-pointer hover:text-[var(--text-ink)]">
                    {queue.length} files — most likely a Takeout export
                  </summary>
                  <p className="mt-1 leading-relaxed">
                    They will be converted one after another. You can cancel at any point; files
                    already finished are kept.
                  </p>
                </details>
              ) : null}
            </div>
          )}

          {/* Options ---------------------------------------------------- */}
          {queue.length > 0 && !result ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">
                  Output format
                </span>
                <Segmented
                  label="Output format"
                  value={format}
                  disabled={busy}
                  onChange={setFormat}
                  options={OUTPUT_FORMATS.map((entry) => ({
                    value: entry.id,
                    label: entry.label,
                  }))}
                />
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  {formatInfo(format).hint}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="yt-bitrate" className="text-[13px] font-medium text-[var(--text-ink)]">
                  Audio bitrate
                </label>
                <Select
                  id="yt-bitrate"
                  value={bitrate}
                  disabled={busy}
                  onChange={(event) => setBitrate(event.target.value)}
                >
                  {BITRATES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="yt-rate" className="text-[13px] font-medium text-[var(--text-ink)]">
                  Sample rate
                </label>
                <Select
                  id="yt-rate"
                  value={sampleRate}
                  disabled={busy}
                  onChange={(event) => setSampleRate(event.target.value)}
                >
                  {SAMPLE_RATES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Channels</span>
                <Segmented
                  label="Channels"
                  size="sm"
                  value={channels}
                  disabled={busy}
                  onChange={setChannels}
                  options={[
                    { value: "1", label: "Mono" },
                    { value: "2", label: "Stereo" },
                  ]}
                />
              </div>
              </div>

              {/* Video quality only exists on the MP4 path. */}
              {format === "mp4" ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="yt-crf" className="text-[13px] font-medium text-[var(--text-ink)]">
                    Video quality
                  </label>
                  <Select
                    id="yt-crf"
                    value={crf}
                    disabled={busy}
                    onChange={(event) => setCrf(event.target.value)}
                  >
                    {CRFS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              {/* Trim + loudness ------------------------------------------ */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">
                    Trim <span className="font-normal text-[var(--text-muted)]">(optional)</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Trim start"
                      placeholder="Start 1:23"
                      value={trimStart}
                      disabled={busy}
                      invalid={Boolean(trimError)}
                      onChange={(event) => setTrimStart(event.target.value)}
                      className="min-w-0"
                    />
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      &rarr;
                    </span>
                    <Input
                      aria-label="Trim end"
                      placeholder="End 4:05"
                      value={trimEnd}
                      disabled={busy}
                      invalid={Boolean(trimError)}
                      onChange={(event) => setTrimEnd(event.target.value)}
                      className="min-w-0"
                    />
                  </div>
                  <p className={`text-[11px] ${trimError ? "text-brand-500" : "text-[var(--text-muted)]"}`}>
                    {trimError ?? "Leave blank to keep the whole file. mm:ss or plain seconds."}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">Loudness</span>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2.5",
                      busy && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={normalize}
                      disabled={busy}
                      onChange={(event) => setNormalize(event.target.checked)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border",
                        "border-[var(--surface-line-strong)] transition-colors duration-150",
                        "peer-checked:border-emerald-500 peer-checked:bg-emerald-500",
                        "peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40",
                      )}
                    >
                      <Check className="size-3 text-white opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={3.5} />
                    </span>
                    <span className="min-w-0 text-[13px] leading-snug">
                      <span className="text-[var(--text-ink)]">Normalise to &minus;14 LUFS</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                        EBU R128, the level every streaming platform targets.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          {/* Progress ---------------------------------------------------- */}
          {busy ? (
            <div className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
              <ProgressBar
                stage={phase === "loading" ? "preparing" : "processing"}
                percent={phase === "loading" ? null : percent}
                caption={
                  phase === "loading"
                    ? "Downloading the FFmpeg core (~31 MB). This happens once."
                    : format === "mp4"
                      ? "Encoding H.264 in this tab. Video encoding in WebAssembly is slow — a few minutes of video can take several."
                      : "Encoding in this tab — the page stays usable."
                }
                className="[&_div]:text-emerald-500"
              />
              <Button variant="ghost" size="sm" onClick={cancel} className="mt-3">
                Cancel
              </Button>
            </div>
          ) : null}

          {/* Result ------------------------------------------------------ */}
          {result ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-5 py-6 text-center">
              <p className="text-[15px] font-medium text-[var(--text-ink)]">
                {outputs.length > 1
                  ? `${outputs.length} ${formatInfo(result.format).label} files are ready.`
                  : `Your ${formatInfo(result.format).label} is ready.`}
              </p>
              <p className="text-[13px] text-[var(--text-muted)]">
                {outputs.length > 1 ? (
                  <>{formatBytes(sumSizes(outputs.map((o) => ({ size: o.blob.size }))))} in total</>
                ) : (
                  <>
                    <span className="font-mono">{result.name}</span> · {formatBytes(result.bytes)}
                  </>
                )}
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {outputs.length > 1 ? (
                  <Button
                    onClick={() => void downloadZipBatch(outputs, `converted-${formatInfo(result.format).label.toLowerCase()}`)}
                    className="bg-emerald-500 hover:bg-emerald-600"
                  >
                    <Music className="size-4" aria-hidden="true" />
                    Download all as ZIP
                  </Button>
                ) : (
                  <Button onClick={() => downloadBlob(blobRef.current, result.name)} className="bg-emerald-500 hover:bg-emerald-600">
                    <Music className="size-4" aria-hidden="true" />
                    Download {formatInfo(result.format).label}
                  </Button>
                )}
                <Button variant="secondary" onClick={reset}>
                  Convert another batch
                </Button>
              </div>
            </div>
          ) : null}

          {/* Error -------------------------------------------------------- */}
          {error ? (
            <ToolError
              title={error.title}
              detail={error.detail}
              // A rejection error leaves `file` null, so retrying the conversion
              // would be a no-op. Only offer the retry when there is actually a
              // file to re-run; otherwise send the user back to the picker.
              onRetry={
                queue.length > 0
                  ? () => {
                      resetFFmpeg();
                      void convert();
                    }
                  : () => inputRef.current?.click()
              }
            >
              {queue.length > 0 ? null : (
                <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                  Choose another file
                </Button>
              )}
            </ToolError>
          ) : null}

          {/* Idle actions ------------------------------------------------ */}
          {queue.length > 0 && !result && !busy && !error ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void convert()} disabled={Boolean(trimError)}>
                <Music className="size-4" aria-hidden="true" />
                Convert {queue.length > 1 ? `${queue.length} files` : `to ${formatInfo(format).label}`}
              </Button>
              <Button variant="secondary" onClick={reset}>
                Choose another file
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void prefetch()} className="self-center">
                Pre-load engine
              </Button>
            </div>
          ) : null}

          {notice ? (
            <Notice tone="warning" icon={<TriangleAlert className="size-3.5" />}>
              {notice}
            </Notice>
          ) : null}

          {queue.length === 0 && !busy && !error && !unpacking ? (
            <Notice tone="info" icon={<ShieldCheck className="size-3.5" />}>
              The first conversion downloads a ~31 MB FFmpeg core and caches it for the session.
              Nothing you select is uploaded — the file is read in this tab and encoded here.
            </Notice>
          ) : null}
        </div>
      </ToolShell>

      </div>
  );
}