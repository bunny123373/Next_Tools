"use client";

import * as React from "react";
import { Info, Play, Scissors, Square, TriangleAlert } from "lucide-react";
import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformProgress,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { AudioPreview } from "@/components/tools/FilePreview";
import { DownloadButton, DownloadGroup, OpenButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Slider, Stat } from "@/components/ui/form";
import { cn } from "@/lib/utils/cn";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  analyseAudio,
  applyFades,
  computeWaveformPeaks,
  decodeAudio,
  encodeMp3,
  encodeWav,
  estimateMp3Bytes,
  sliceBuffer,
  type AudioAnalysis,
  type Mp3Bitrate,
  type WaveformPeaks,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "audio-trimmer",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];

type OutputFormat = "wav" | "mp3";

interface Options {
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
  format: OutputFormat;
  bitDepth: WavBitDepth;
  kbps: Mp3Bitrate;
}

interface TrackInfo {
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  peakDb: number;
  ok: boolean;
}

export default function AudioTrimmerWorkspace() {
  const { files, add, remove, move, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const [tracks, setTracks] = React.useState<TrackInfo[]>([]);
  const [active, setActive] = React.useState(0);
  const [start, setStart] = React.useState(0);
  const [end, setEnd] = React.useState(0);
  const [fadeIn, setFadeIn] = React.useState(0.01);
  const [fadeOut, setFadeOut] = React.useState(0.01);
  const [format, setFormat] = React.useState<OutputFormat>("wav");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);
  const [playing, setPlaying] = React.useState(false);
  const playerRef = React.useRef<HTMLAudioElement | null>(null);

  const single = files.length === 1;
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  // Decode every file so lengths are real, not guessed from file size.
  React.useEffect(() => {
    let alive = true;
    if (files.length === 0) {
      setTracks([]);
      return;
    }
    void Promise.all(
      files.map(async (file): Promise<TrackInfo> => {
        try {
          const analysis: AudioAnalysis = analyseAudio(await decodeAudio(file));
          return {
            name: file.name,
            duration: analysis.duration,
            sampleRate: analysis.sampleRate,
            channels: analysis.channels,
            peakDb: analysis.peakDb,
            ok: analysis.duration > 0,
          };
        } catch {
          return { name: file.name, duration: 0, sampleRate: 0, channels: 0, peakDb: -Infinity, ok: false };
        }
      }),
    ).then((value) => {
      if (!alive) return;
      setTracks(value);
      setActive(0);
    });
    return () => {
      alive = false;
    };
  }, [files]);

  const current = tracks[active] ?? null;
  const duration = current?.ok ? current.duration : 0;

  // Reset the selection whenever the active file changes.
  React.useEffect(() => {
    setStart(0);
    setEnd(duration);
  }, [active, duration]);

  const span = Math.max(0, end - start);
  const estimate =
    format === "mp3"
      ? estimateMp3Bytes(kbps, span)
      : Math.round(span * (current?.sampleRate ?? 44100) * (current?.channels === 1 ? 1 : 2) * (bitDepth / 8)) + 44;

  const clampRange = React.useCallback(
    (nextStart: number, nextEnd: number) => {
      const low = Math.max(0, Math.min(nextStart, duration));
      const high = Math.max(0, Math.min(nextEnd, duration));
      if (high - low < 0.05) return;
      setStart(low);
      setEnd(high);
    },
    [duration],
  );

  const options = React.useMemo<Options>(
    () => ({ start, end, fadeIn, fadeOut, format, bitDepth, kbps }),
    [start, end, fadeIn, fadeOut, format, bitDepth, kbps],
  );

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const results: TransformResult[] = [];
      for (let index = 0; index < batch.length; index += 1) {
        const file = batch[index]!;
        const share = (fraction: number) => ((index + fraction) / batch.length) * 100;
        report({
          percent: share(0),
          done: index,
          total: batch.length,
          caption: `Decoding ${file.name}`,
        });

        const buffer = await decodeAudio(file);
        if (buffer.length === 0) {
          throw new Error(`${file.name} has no decodable audio.`);
        }
        if (current.end - current.start < 0.05) {
          throw new Error(`${file.name}: the selection is empty.`);
        }

        report({
          percent: share(0.5),
          done: index,
          total: batch.length,
          caption: `Cutting ${formatDuration(current.start)} to ${formatDuration(current.end)}`,
        });

        // Exact copy by sample index, then the fades on top.
        const slice = sliceBuffer(buffer, current.start, Math.min(current.end, buffer.duration));
        applyFades(slice, current.fadeIn, current.fadeOut);

        const blob =
          current.format === "mp3"
            ? await encodeMp3(slice, current.kbps, (percent) => {
                report({
                  percent: share(0.7 + (percent / 100) * 0.3),
                  done: index,
                  total: batch.length,
                  caption: `Encoding ${file.name} - ${Math.round(percent)}%`,
                });
              })
            : encodeWav(slice, current.bitDepth, {});

        const analysis = analyseAudio(slice);
        results.push({
          blob,
          filename: withExtension(`${baseName(file.name)}-trim`, current.format),
          source: file,
          note: `${formatDuration(slice.duration)} · ${current.format.toUpperCase()} · peak ${
            Number.isFinite(analysis.peakDb) ? `${analysis.peakDb.toFixed(1)} dBFS` : "-inf dBFS"
          }`,
        });
        report({ percent: share(1), done: index + 1, total: batch.length, caption: `Wrote ${file.name}` });
      }
      return results;
    },
    [],
  );

  const { results, stage, percent, done, total, error, run, reset, isRunning } = useTransform({
    transform,
    options,
  });

  const primary = results[0] ?? null;
  const primaryUrl = useObjectUrl(primary?.blob ?? null);
  const outputBytes = results.reduce((sum, item) => sum + item.blob.size, 0);

  const startExport = React.useCallback(() => {
    if (files.length === 0 || isRunning) return;
    void run(files);
  }, [files, run, isRunning]);

  useShortcut(files.length > 0 && span >= 0.05 && !isRunning, startExport);

  React.useEffect(() => {
    if (stage !== "complete" || results.length === 0) return;
    recordJob(TOOL, {
      status: "success",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: results.length,
      inputBytes: totalBytes,
      outputBytes,
      outputName: results.length === 1 ? results[0]?.filename : `${results.length} trimmed files`,
    });
  }, [stage, results, files.length, files, totalBytes, outputBytes]);

  React.useEffect(() => {
    if (stage !== "idle" || !error) return;
    recordJob(TOOL, {
      status: "error",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: files.length,
      errorMessage: error,
    });
  }, [stage, error, files]);

  /** Loop the preview over the selection only. */
  const onTimeUpdate = React.useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.currentTime < start - 0.01 || player.currentTime >= end - 0.01) {
      player.currentTime = start;
      void player.play().catch(() => undefined);
    }
  }, [start, end]);

  const togglePreview = React.useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) {
      player.currentTime = start;
      void player
        .play()
        .then(() => setPlaying(true))
        .catch(() => undefined);
    } else {
      player.pause();
      setPlaying(false);
    }
  }, [start]);

  const handleReset = () => {
    setPlaying(false);
    clear();
    reset();
  };

  const handleRemove = (index: number) => {
    remove(index);
    setActive((value) => Math.max(0, Math.min(value, files.length - 2)));
  };

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        <FileStage
          files={files}
          onAdd={add}
          onRemove={handleRemove}
          onClear={clear}
          onReorder={move}
          category="audio"
          multiple
          maxFiles={MAX_FILES}
          maxBytes={SITE.limits.audio}
          reorderable
          emptyTitle="Drop audio to trim it."
          emptyDescription="Cut on a real waveform, preview the selection, and export with fades that prevent clicks."
          dropzoneHint={`Up to ${MAX_FILES} files, ${Math.round(SITE.limits.audio / 1024 / 1024)} MB each.`}
          error={error}
          stage={stage}
          percent={percent}
          done={done}
          total={total}
          onRetry={startExport}
          renderMeta={(file) => {
            const track = tracks.find((item) => item.name === file.name);
            if (!track) return null;
            if (!track.ok) return <span className="text-brand-500">cannot decode</span>;
            return `${formatDuration(track.duration)} · ${track.sampleRate} Hz · ${track.channels === 1 ? "mono" : `${track.channels}ch`}`;
          }}
          controls={
            <div className="flex flex-col gap-4">
              {single && duration > 0 ? (
                <SelectionPanel
                  src={sourceUrl}
                  fileName={source?.name ?? "audio"}
                  duration={duration}
                  start={start}
                  end={end}
                  disabled={isRunning}
                  onChange={clampRange}
                />
              ) : null}

              {single && duration > 0 ? (
                <>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Selection" value={formatDuration(span)} tone="brand" />
                    <Stat
                      label="Removed"
                      value={formatDuration(duration - span)}
                      hint={`${((span / duration) * 100).toFixed(0)}% kept`}
                    />
                    <Stat label="Source" value={formatDuration(duration)} />
                    <Stat
                      label="Output size"
                      value={formatBytes(estimate)}
                      hint={format === "mp3" ? `${kbps} kbps` : `${bitDepth}-bit PCM`}
                    />
                  </dl>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="In point" hint="Seconds from the start of the file.">
                      {({ id }) => (
                        <Input
                          id={id}
                          type="number"
                          min={0}
                          max={Number(duration.toFixed(3))}
                          step={0.01}
                          value={Number(start.toFixed(3))}
                          disabled={isRunning}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value)) clampRange(value, end);
                          }}
                          suffix={<>s</>}
                        />
                      )}
                    </Field>
                    <Field label="Out point" hint="The selection runs up to here.">
                      {({ id }) => (
                        <Input
                          id={id}
                          type="number"
                          min={0}
                          max={Number(duration.toFixed(3))}
                          step={0.01}
                          value={Number(end.toFixed(3))}
                          disabled={isRunning}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value)) clampRange(start, value);
                          }}
                          suffix={<>s</>}
                        />
                      )}
                    </Field>
                  </div>
                </>
              ) : null}

              {!single && files.length > 1 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] font-medium text-[var(--text-ink)]">Pick the file to inspect</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    The same in, out and fades are applied to every file in the list.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tracks.map((track, index) => (
                      <Button
                        key={track.name}
                        size="sm"
                        variant={index === active ? "primary" : "secondary"}
                        onClick={() => setActive(index)}
                        disabled={isRunning}
                      >
                        {track.name.slice(0, 18)}
                      </Button>
                    ))}
                  </div>
                  {current?.ok ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      {current.name} is {formatDuration(current.duration)}. Use the trimmer with a single file for the
                      waveform and per-cut handles.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={`Fade in - ${Math.round(fadeIn * 1000)} ms`} hint="A short ramp prevents a click at the cut.">
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={0}
                      max={2000}
                      step={5}
                      value={Math.round(fadeIn * 1000)}
                      onChange={(event) => setFadeIn(Number(event.target.value) / 1000)}
                    />
                  )}
                </Field>
                <Field label={`Fade out - ${Math.round(fadeOut * 1000)} ms`} hint="Equal-power ramps, so a longer fade sounds natural.">
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={0}
                      max={2000}
                      step={5}
                      value={Math.round(fadeOut * 1000)}
                      onChange={(event) => setFadeOut(Number(event.target.value) / 1000)}
                    />
                  )}
                </Field>
              </div>

              <Field label="Output format" hint="WAV is uncompressed and exact; MP3 is much smaller and lossy.">
                {() => (
                  <Segmented
                    label="Output format"
                    value={format}
                    onChange={(value) => setFormat(value as OutputFormat)}
                    options={[
                      { value: "wav", label: "WAV" },
                      { value: "mp3", label: "MP3" },
                    ]}
                  />
                )}
              </Field>

              {format === "mp3" ? (
                <Field label="MP3 bitrate" hint="MP3 only supports 44.1 and 48 kHz; anything else is resampled.">
                  {({ id }) => (
                    <Segmented
                      label="MP3 bitrate"
                      size="sm"
                      value={String(kbps)}
                      onChange={(value) => setKbps(Number(value) as Mp3Bitrate)}
                      options={BITRATES.map((rate) => ({ value: String(rate), label: `${rate}` }))}
                    />
                  )}
                </Field>
              ) : (
                <Field label="WAV bit depth" hint="16-bit matches CD; 24-bit leaves headroom for further processing.">
                  {({ id }) => (
                    <Segmented
                      label="WAV bit depth"
                      size="sm"
                      value={String(bitDepth)}
                      onChange={(value) => setBitDepth(Number(value) as WavBitDepth)}
                      options={WAV_DEPTHS.map((depth) => ({ value: String(depth), label: `${depth}-bit` }))}
                    />
                  )}
                </Field>
              )}
            </div>
          }
          action={
            <ProcessButton
              onClick={startExport}
              disabled={files.length === 0 || span < 0.05 || isRunning}
              loading={isRunning}
              label="Export selection"
              icon={<Scissors className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {single && sourceUrl && duration > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-ink)]">Preview the selection</h3>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied audio, no captions apply */}
            <audio
              ref={playerRef}
              src={sourceUrl}
              preload="auto"
              onTimeUpdate={onTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className="hidden"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={togglePreview}>
                {playing ? (
                  <Square className="size-3.5" aria-hidden="true" />
                ) : (
                  <Play className="size-3.5" aria-hidden="true" />
                )}
                {playing ? "Pause" : `Play ${formatDuration(span)} selection`}
              </Button>
              <span className="text-xs text-[var(--text-muted)]">
                Loops the selection only. {formatDuration(start)} to {formatDuration(end)}.
              </span>
            </div>
          </div>
        ) : null}

        {results.length > 0 ? (
          <ResultsPanel title={results.length === 1 ? "Trimmed audio ready" : `${results.length} trimmed files ready`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Files" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat label="Source size" value={formatBytes(totalBytes)} hint="never modified" />
              <Stat
                label="Fades"
                value={`${Math.round(fadeIn * 1000)} / ${Math.round(fadeOut * 1000)} ms`}
                hint="in / out"
              />
            </dl>

            {results.length === 1 && primary && primaryUrl ? (
              <div className="flex flex-col gap-2">
                <AudioPreview file={primary.blob} src={primaryUrl} />
                <div className="flex flex-wrap items-center gap-2">
                  <DownloadButton blob={primary.blob} filename={primary.filename} label="Download" />
                  <OpenButton blob={primary.blob} filename={primary.filename} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">{primary.note}</p>
              </div>
            ) : results.length > 1 ? (
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName="trimmed-audio.zip"
                originalTotalBytes={totalBytes}
              />
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          The cut is sample-accurate: the range is copied by sample index, not re-rendered through a time window. Fades are
          the only thing added on top.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Waveform + selection panel                                         */
/* ------------------------------------------------------------------ */

function SelectionPanel({
  src,
  fileName,
  duration,
  start,
  end,
  disabled,
  onChange,
}: {
  src: string | null;
  fileName: string;
  duration: number;
  start: number;
  end: number;
  disabled: boolean;
  onChange: (start: number, end: number) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const dragging = React.useRef<"start" | "end" | null>(null);
  const [peaks, setPeaks] = React.useState<WaveformPeaks | null>(null);

  // Peaks come from the real decoded samples, at the exact column count we draw.
  React.useEffect(() => {
    let alive = true;
    if (!src) {
      setPeaks(null);
      return;
    }
    const columns = Math.max(320, Math.min(1600, Math.round(duration * 90)));
    void fetch(src)
      .then((response) => response.blob())
      .then((blob) => decodeAudio(blob))
      .then((buffer) => {
        if (alive) setPeaks(computeWaveformPeaks(buffer, columns));
      })
      .catch(() => {
        if (alive) setPeaks(null);
      });
    return () => {
      alive = false;
    };
  }, [src, duration]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 96;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const middle = height / 2;
    context.fillStyle = "rgba(255, 59, 48, 0.9)";
    const step = width / peaks.min.length;
    for (let column = 0; column < peaks.min.length; column += 1) {
      const lo = peaks.min[column] ?? 0;
      const hi = peaks.max[column] ?? 0;
      const top = middle - hi * middle * 0.94;
      const bottom = middle - lo * middle * 0.94;
      context.fillRect(column * step, top, Math.max(1, step), Math.max(1, bottom - top));
    }
  }, [peaks]);

  const timeFrom = React.useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
    },
    [duration],
  );

  React.useEffect(() => {
    if (disabled) return;
    const onMove = (event: PointerEvent) => {
      const which = dragging.current;
      if (!which) return;
      event.preventDefault();
      const time = timeFrom(event.clientX);
      if (which === "start") onChange(Math.min(time, end - 0.05), end);
      else onChange(start, Math.max(time, start + 0.05));
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [disabled, end, start, onChange, timeFrom]);

  const onKey = (which: "start" | "end") => (event: React.KeyboardEvent) => {
    if (disabled) return;
    const step = event.shiftKey ? 1 : 0.05;
    let delta = 0;
    if (event.key === "ArrowLeft") delta = -step;
    else if (event.key === "ArrowRight") delta = step;
    else return;
    event.preventDefault();
    if (which === "start") onChange(Math.min(start + delta, end - 0.05), end);
    else onChange(start, Math.max(end + delta, start + 0.05));
  };

  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={trackRef}
        className="relative h-24 touch-none select-none overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)]"
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" role="img" aria-label={`Waveform of ${fileName}`} />
        <div aria-hidden="true" className="absolute inset-y-0 bg-black/60" style={{ left: 0, width: `${startPct}%` }} />
        <div aria-hidden="true" className="absolute inset-y-0 bg-black/60" style={{ left: `${endPct}%`, right: 0 }} />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 border-y-2 border-brand-500"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        <Handle
          label="In point"
          value={start}
          max={duration}
          pct={startPct}
          disabled={disabled}
          onPointerDown={() => {
            dragging.current = "start";
          }}
          onKeyDown={onKey("start")}
        />
        <Handle
          label="Out point"
          value={end}
          max={duration}
          pct={endPct}
          disabled={disabled}
          onPointerDown={() => {
            dragging.current = "end";
          }}
          onKeyDown={onKey("end")}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
        <span>0:00</span>
        <span className="font-mono tabular-nums">
          {formatDuration(start)} to {formatDuration(end)} &middot; {formatDuration(end - start)} selected
        </span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}

function Handle({
  label,
  value,
  max,
  pct,
  disabled,
  onPointerDown,
  onKeyDown,
}: {
  label: string;
  value: number;
  max: number;
  pct: number;
  disabled: boolean;
  onPointerDown: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Number(max.toFixed(3))}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={`${value.toFixed(3)} seconds`}
      aria-disabled={disabled || undefined}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        onPointerDown();
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm bg-brand-500/90",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        disabled && "pointer-events-none opacity-50",
      )}
      style={{ left: `${pct}%` }}
    >
      <span aria-hidden="true" className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-white/80" />
    </div>
  );
}

function useShortcut(enabled: boolean, action: () => void) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey) || !enabled) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, action]);
}
