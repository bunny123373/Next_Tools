"use client";

import * as React from "react";
import { AudioLines, Link2, Music, ShieldCheck, Trash2, Video } from "lucide-react";

import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select } from "@/components/ui/form";
import { FileRow } from "@/components/tools/FileDropzone";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { Notice, ToolError } from "@/components/tools/states";
import { formatBytes } from "@/lib/utils/format";
import { downloadBlob } from "@/lib/utils/files";
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

  const [file, setFile] = React.useState<File | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [percent, setPercent] = React.useState(0);
  const [result, setResult] = React.useState<{
    name: string;
    bytes: number;
    format: OutputFormat;
  } | null>(null);
  const [error, setError] = React.useState<{ title: string; detail?: string } | null>(null);

  const [link, setLink] = React.useState("");
  const [linkState, setLinkState] = React.useState<LinkState>({ kind: "empty" });

  const [format, setFormat] = React.useState<OutputFormat>("mp3");
  const [bitrate, setBitrate] = React.useState("192");
  const [sampleRate, setSampleRate] = React.useState("44100");
  const [channels, setChannels] = React.useState<"1" | "2">("2");
  const [crf, setCrf] = React.useState("28");

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
    setFile(null);
    setResult(null);
    setError(null);
    setPercent(0);
    setPhase("idle");
    // Drop the previous encode so a 60 MB Blob is not retained after "Remove".
    blobRef.current = new Blob();
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const accept = React.useCallback((incoming: FileList | File[] | null) => {
    const candidate = incoming?.[0];
    if (!candidate) return;

    reset();

    if (!isSupported(candidate)) {
      setError({
        title: "That file type isn't supported.",
        detail: `${candidate.name} — expected one of MP4, WebM, MOV, MKV, AVI, MP3, WAV, M4A, AAC, OGG, Opus or FLAC.`,
      });
      return;
    }

    if (candidate.size === 0) {
      setError({ title: "That file is empty.", detail: `${candidate.name} is 0 bytes.` });
      return;
    }

    if (candidate.size > MAX_INPUT_BYTES) {
      setError({
        title: "That file is too large to convert here.",
        detail: `${candidate.name} is ${formatBytes(candidate.size)}. The limit is ${formatBytes(MAX_INPUT_BYTES)}, because the whole file has to fit in memory alongside the decoder.`,
      });
      return;
    }

    setFile(candidate);
  }, [reset]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    accept(event.dataTransfer.files);
  };

  /* ---------------------------------------------------------------------- */
  /*  Conversion                                                            */
  /* ---------------------------------------------------------------------- */

  const convert = async () => {
    if (!file || busy) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setResult(null);
    setPercent(0);
    setPhase("loading");

    try {
      const outcome = await convertMedia(file, {
        format,
        bitrateKbps: Number(bitrate),
        sampleRateHz: Number(sampleRate),
        channels: Number(channels) as 1 | 2,
        crf: Number(crf),
        signal: controller.signal,
        onPhase: (next) => {
          setPhase(next);
          if (next === "converting") setPercent(0);
        },
        onProgress: (ratio) => setPercent(ratio * 100),
      });

      blobRef.current = outcome.blob;
      setResult({ name: outcome.filename, bytes: outcome.bytes, format: outcome.format });
      setPercent(100);
      setPhase("done");
      toast.success("MP3 ready", `${outcome.filename} · ${formatBytes(outcome.bytes)}`);
    } catch (caught) {
      const cancelled = caught instanceof ConversionError && caught.message === "Cancelled.";
      if (cancelled) {
        setPhase("idle");
        return;
      }
      const detail =
        caught instanceof ConversionError && caught.cause instanceof Error
          ? caught.cause.message
          : caught instanceof Error
            ? caught.message
            : String(caught);
      setError({
        title: caught instanceof ConversionError ? caught.message : "The conversion failed.",
        detail,
      });
      setPhase("idle");
    } finally {
      abortRef.current = null;
    }
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
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              accept(event.target.files);
            }}
          />

          {!file ? (
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
              onDrop={onDrop}
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
                  {dragging ? "Drop to select" : "Drop your file here"}
                </p>
                <p className="text-[13px] text-[var(--text-muted)]">
                  or{" "}
                  <span className="font-medium text-emerald-500">browse from your device</span>
                </p>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                MP4, WebM, MOV, MKV, AVI, MP3, WAV, M4A, AAC, OGG, Opus, FLAC · max{" "}
                {formatBytes(MAX_INPUT_BYTES)}
              </p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--text-muted)]">
                Only convert media you own or have permission to use.
              </p>
            </div>
          ) : (
            <ul className="grid gap-2">
              <FileRow
                file={file}
                index={0}
                meta={extensionOf(file.name).toUpperCase()}
                disabled={busy}
                onRemove={reset}
                trailing={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={reset}
                    disabled={busy}
                    aria-label="Remove file"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              />
            </ul>
          )}

          {/* Options ---------------------------------------------------- */}
          {file && !result ? (
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
                Your {formatInfo(result.format).label} is ready.
              </p>
              <p className="text-[13px] text-[var(--text-muted)]">
                <span className="font-mono">{result.name}</span> · {formatBytes(result.bytes)}
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button onClick={() => downloadBlob(blobRef.current, result.name)} className="bg-emerald-500 hover:bg-emerald-600">
                  <Music className="size-4" aria-hidden="true" />
                  Download {formatInfo(result.format).label}
                </Button>
                <Button variant="secondary" onClick={reset}>
                  Convert another file
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
                file
                  ? () => {
                      resetFFmpeg();
                      void convert();
                    }
                  : () => inputRef.current?.click()
              }
            >
              {file ? null : (
                <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                  Choose another file
                </Button>
              )}
            </ToolError>
          ) : null}

          {/* Idle actions ------------------------------------------------ */}
          {file && !result && !busy && !error ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void convert()}>
                <Music className="size-4" aria-hidden="true" />
                Convert to {formatInfo(format).label}
              </Button>
              <Button variant="secondary" onClick={reset}>
                Choose another file
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void prefetch()} className="self-center">
                Pre-load engine
              </Button>
            </div>
          ) : null}

          {!file && !busy && !error ? (
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