"use client";

import * as React from "react";
import { Info, Scissors, TriangleAlert } from "lucide-react";
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
import { VideoPreview } from "@/components/tools/FilePreview";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { SizeComparisonStats } from "@/components/tools/BeforeAfter";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Select, Stat } from "@/components/ui/form";
import { cn } from "@/lib/utils/cn";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  VIDEO_FORMATS,
  captureThumbnails,
  detectVideoSupport,
  estimateBytes,
  pickVideoMime,
  probeVideo,
  readVideoMeta,
  runCanvasRecorder,
  videoFormatById,
  type MediaSupport,
  type Thumbnail,
  type TranscodeTick,
  type VideoMetaLite,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "video-trimmer",
  category: "video",
  processing: "local",
};

const THUMBNAILS = 20;
const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const AUDIO_KBPS = 128;

interface Options {
  start: number;
  end: number;
  formatId: string;
  fps: number;
  keepAudio: boolean;
}

export default function VideoTrimmerWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  const [support, setSupport] = React.useState<MediaSupport | null>(null);
  // Everything derived from the file is tagged with it, so picking a new file
  // invalidates the old probe, thumbnails and selection by comparison rather
  // than by resetting four pieces of state from an effect.
  const [loaded, setLoaded] = React.useState<{
    key: string;
    meta: VideoMetaLite | null;
    thumbs: Thumbnail[];
    error: string | null;
  }>({ key: "", meta: null, thumbs: [], error: null });
  const probeKey = source ? `${source.name}:${source.size}:${source.lastModified}` : "";
  const isLoaded = loaded.key === probeKey;
  const meta = isLoaded ? loaded.meta : null;
  const thumbs = isLoaded ? loaded.thumbs : [];
  const probeError = isLoaded ? loaded.error : null;
  const probing = Boolean(source) && !isLoaded;

  // The selection is stored as fractions of the file, so it survives a change
  // of absolute duration without being rewritten.
  const [selection, setSelection] = React.useState<{ key: string; start: number; end: number } | null>(null);
  const start = selection?.key === probeKey ? selection.start : 0;
  const end = selection?.key === probeKey ? selection.end : 0;

  const [formatId, setFormatId] = React.useState("webm-vp9");
  const [fps, setFps] = React.useState(30);
  const [keepAudio, setKeepAudio] = React.useState(true);

  const [tick, setTick] = React.useState<TranscodeTick | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const [noAudio, setNoAudio] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const recorderRef = React.useRef<{ cancel: (reason?: string) => void } | null>(null);
  const playerRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    let alive = true;
    void detectVideoSupport().then((value) => alive && setSupport(value));
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!source) return;
    let alive = true;
    let dispose: (() => void) | null = null;
    void probeVideo(source)
      .then(async (result) => {
        if (!alive) {
          result.dispose();
          return;
        }
        dispose = result.dispose;
        const duration = result.meta.duration;
        setLoaded({ key: probeKey, meta: result.meta, thumbs: [], error: null });
        setSelection({ key: probeKey, start: 0, end: duration });
        const step = duration / THUMBNAILS;
        const times = Array.from({ length: THUMBNAILS }, (_, index) =>
          Math.min(Math.max(0, duration - 0.02), index * step + step / 2),
        );
        const captured = await captureThumbnails(result.element, times, result.meta.width);
        if (alive) setLoaded({ key: probeKey, meta: result.meta, thumbs: captured, error: null });
      })
      .catch((error: unknown) => {
        if (alive) {
          setLoaded({
            key: probeKey,
            meta: null,
            thumbs: [],
            error: error instanceof Error ? error.message : "This video could not be read.",
          });
        }
      });

    return () => {
      alive = false;
      dispose?.();
    };
  }, [source, probeKey]);

  const picked = React.useMemo(
    () => (support ? pickVideoMime(videoFormatById(formatId).mime, support) : null),
    [support, formatId],
  );

  const duration = meta?.duration ?? 0;
  const span = Math.max(0, end - start);
  const estimate = estimateBytes(3000, keepAudio ? AUDIO_KBPS : 0, span);

  const clampRange = React.useCallback(
    (nextStart: number, nextEnd: number) => {
      const low = Math.max(0, Math.min(nextStart, duration));
      const high = Math.max(0, Math.min(nextEnd, duration));
      if (high - low < 0.1) return;
      setSelection({ key: probeKey, start: low, end: high });
    },
    [duration, probeKey],
  );

  const options = React.useMemo<Options>(
    () => ({ start, end, formatId, fps, keepAudio }),
    [start, end, formatId, fps, keepAudio],
  );

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const file = batch[0];
      if (!file) throw new Error("Choose a video first.");
      if (!support || !picked) throw new Error("Still checking which formats this browser supports.");
      if (!picked.supported) throw new Error(picked.warning ?? "This browser cannot encode video.");
      if (current.end - current.start < 0.1) {
        throw new Error("The selection is too short. Drag the out point further right.");
      }
      const probed: VideoMetaLite = meta ?? (await readVideoMeta(file));
      if (probed.width < 2 || probed.height < 2) {
        throw new Error("This video reports no picture dimensions, so it cannot be re-encoded.");
      }

      const run = runCanvasRecorder({
        file,
        mime: picked.mime,
        width: probed.width,
        height: probed.height,
        fps: current.fps,
        start: current.start,
        end: current.end,
        videoKbps: 3000,
        audioKbps: current.keepAudio ? AUDIO_KBPS : 0,
        includeAudio: current.keepAudio,
        onTick: (value) => {
          setTick(value);
          report({
            percent: value.percent,
            done: 0,
            total: 1,
            caption: `Recording ${formatDuration(value.mediaTime)} of ${formatDuration(current.end - current.start)}${
              value.remaining !== null ? ` - ${formatDuration(value.remaining)} left` : ""
            }`,
          });
        },
      });
      recorderRef.current = run;

      try {
        const outcome = await run.result;
        setNoAudio(!outcome.audio);
        return [
          {
            blob: outcome.blob,
            filename: withExtension(`${file.name.replace(/\.[^.]+$/, "")}-trim`, picked.format.ext),
            source: file,
            width: outcome.width,
            height: outcome.height,
            note: `${formatDuration(current.end - current.start)} kept of ${formatDuration(probed.duration)}`,
          },
        ];
      } finally {
        recorderRef.current = null;
      }
    },
    [support, picked, meta],
  );

  const { results, stage, percent, error, run, reset, isRunning } = useTransform({ transform, options });

  const result = results[0] ?? null;
  const resultUrl = useObjectUrl(result?.blob ?? null);

  const startExport = React.useCallback(() => {
    if (!source || isRunning) return;
    setCancelled(false);
    setNoAudio(false);
    setTick(null);
    void run([source]);
  }, [source, run, isRunning]);

  useShortcut(Boolean(source) && !isRunning, startExport);

  React.useEffect(() => {
    if (stage !== "complete" || !result || !source) return;
    recordJob(TOOL, {
      status: "success",
      fileName: source.name,
      fileCount: 1,
      inputBytes: source.size,
      outputBytes: result.blob.size,
      outputName: result.filename,
    });
  }, [stage, result, source]);

  React.useEffect(() => {
    if (stage !== "idle" || !error || !source) return;
    recordJob(TOOL, { status: "error", fileName: source.name, errorMessage: error });
  }, [stage, error, source]);

  /** Loop the preview inside the selection. */
  const onPreviewTimeUpdate = React.useCallback(() => {
    const player = playerRef.current;
    if (!player || !duration) return;
    if (player.currentTime < start || player.currentTime >= end - 0.02) {
      player.currentTime = start;
      void player.play().catch(() => undefined);
    }
  }, [start, end, duration]);

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
    recorderRef.current?.cancel("Reset.");
    recorderRef.current = null;
    setTick(null);
    setCancelled(false);
    setNoAudio(false);
    setPlaying(false);
    clear();
    reset();
  };

  const canExport = Boolean(source && duration > 0 && span >= 0.1 && picked?.supported && !isRunning);

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        <FileStage
          files={files}
          onAdd={add}
          onRemove={remove}
          onClear={clear}
          category="video"
          maxBytes={SITE.limits.video}
          emptyTitle="Drop a video to trim it."
          emptyDescription="MP4, WebM or MOV, up to 500 MB. The original file is never modified."
          dropzoneHint="One video at a time, up to 500 MB. Exporting the segment records in real time."
          error={error}
          stage={stage}
          percent={percent}
          onRetry={startExport}
          renderMeta={() => (meta ? `${meta.width} x ${meta.height} - ${formatDuration(meta.duration)}` : null)}
          controls={
            <div className="flex flex-col gap-4">
              {meta && duration > 0 ? (
                <>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Source length" value={formatDuration(duration)} />
                    <Stat label="Selection" value={formatDuration(span)} hint={`${span.toFixed(2)} seconds`} tone="brand" />
                    <Stat label="Kept" value={`${duration > 0 ? Math.round((span / duration) * 100) : 0}%`} />
                    <Stat label="Size estimate" value={formatBytes(estimate)} hint="at 3000 kbps" />
                  </dl>

                  <Timeline
                    duration={duration}
                    start={start}
                    end={end}
                    thumbs={thumbs}
                    disabled={isRunning}
                    onChange={clampRange}
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="In point" hint="Seconds from the start of the video.">
                      {({ id }) => (
                        <Input
                          id={id}
                          type="number"
                          min={0}
                          max={Number(duration.toFixed(2))}
                          step={0.1}
                          value={Number(start.toFixed(2))}
                          disabled={isRunning}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value)) clampRange(value, end);
                          }}
                          suffix={<>s</>}
                        />
                      )}
                    </Field>
                    <Field label="Out point" hint="The segment runs up to here.">
                      {({ id }) => (
                        <Input
                          id={id}
                          type="number"
                          min={0}
                          max={Number(duration.toFixed(2))}
                          step={0.1}
                          value={Number(end.toFixed(2))}
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

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => clampRange(0, duration)} disabled={isRunning}>
                      Whole video
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => clampRange(Math.max(0, start - 5), end)}
                      disabled={isRunning || start <= 0}
                    >
                      5s earlier
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => clampRange(start, Math.min(duration, end + 5))}
                      disabled={isRunning || end >= duration}
                    >
                      5s later
                    </Button>
                  </div>
                </>
              ) : null}

              <Field label="Output format" hint="The segment is re-encoded, so the container is re-chosen rather than copied.">
                {({ id }) => (
                  <Select id={id} value={formatId} onChange={(event) => setFormatId(event.target.value)}>
                    {VIDEO_FORMATS.map((format) => (
                      <option key={format.id} value={format.id}>
                        {format.label}
                        {support ? (support[format.capability] ? "" : " - not available here") : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Frame rate" hint="The source frame rate is the ceiling; nothing is invented.">
                {() => (
                  <Segmented
                    label="Frame rate"
                    size="sm"
                    value={String(fps)}
                    onChange={(value) => setFps(Number(value))}
                    options={FPS_CHOICES.map((value) => ({ value: String(value), label: String(value) }))}
                  />
                )}
              </Field>

              <Checkbox
                label="Keep the audio track"
                description="The soundtrack is carried across and re-encoded with the segment."
                checked={keepAudio}
                onChange={(event) => setKeepAudio(event.target.checked)}
              />
            </div>
          }
          action={
            <ProcessButton
              onClick={startExport}
              disabled={!canExport}
              loading={isRunning}
              label="Export segment"
              icon={<Scissors className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {isRunning && tick ? (
          <RecordingBar
            elapsed={tick.mediaTime}
            remaining={tick.remaining}
            onCancel={() => {
              setCancelled(true);
              recorderRef.current?.cancel("Recording cancelled.");
            }}
          />
        ) : null}

        {cancelled && !isRunning ? (
          <Notice tone="info" icon={<Info className="size-4" />}>
            Recording cancelled, so nothing was exported.
          </Notice>
        ) : null}

        {probeError ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
            {probeError}
          </Notice>
        ) : null}

        {sourceUrl && meta && duration > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-ink)]">Preview the selection</h3>
            <video
              ref={playerRef}
              src={sourceUrl}
              playsInline
              preload="auto"
              controls={false}
              onTimeUpdate={onPreviewTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className="max-h-[24rem] w-full rounded-xl border border-[var(--surface-line)] bg-black object-contain"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={togglePreview}>
                {playing ? "Pause preview" : `Play the ${formatDuration(span)} selection`}
              </Button>
              <span className="text-xs text-[var(--text-muted)]">
                The preview loops the selection only. {formatDuration(start)} to {formatDuration(end)}.
              </span>
            </div>
          </div>
        ) : null}

        {result && source ? (
          <ResultsPanel title="Trimmed video">
            <SizeComparisonStats
              beforeBytes={source.size}
              afterBytes={result.blob.size}
              beforeWidth={meta?.width}
              beforeHeight={meta?.height}
              afterWidth={result.width}
              afterHeight={result.height}
            />
            {noAudio ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                The browser did not release an audio track, so the export is silent.
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <DownloadButton blob={result.blob} filename={result.filename} label="Download segment" />
              {resultUrl ? <OpenButton blob={result.blob} filename={result.filename} /> : null}
            </div>
            {resultUrl ? (
              <div className="flex flex-col gap-1.5">
                <VideoPreview file={result.blob} src={resultUrl} controls />
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {result.filename} &middot; {result.note}
                </p>
              </div>
            ) : null}
          </ResultsPanel>
        ) : null}

        {source && !meta && !probeError ? (
          <ToolEmptyState
            title="Reading the video..."
            description="Decoding dimensions, duration and thumbnail frames."
          />
        ) : null}

        {probing && meta ? (
          <p className="text-xs text-[var(--text-muted)]" role="status">
            Building the thumbnail strip from real decoded frames...
          </p>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          The cut lands on the nearest real frame boundary, so the segment is at most one frame longer than you asked for
          (about 33 ms at 30 fps). Nothing is written back to your original file.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline                                                           */
/* ------------------------------------------------------------------ */

function Timeline({
  duration,
  start,
  end,
  thumbs,
  disabled,
  onChange,
}: {
  duration: number;
  start: number;
  end: number;
  thumbs: Thumbnail[];
  disabled: boolean;
  onChange: (start: number, end: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const dragging = React.useRef<"start" | "end" | null>(null);

  const timeFromClientX = React.useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  React.useEffect(() => {
    if (disabled) return;
    const onMove = (event: PointerEvent) => {
      const which = dragging.current;
      if (!which) return;
      event.preventDefault();
      const time = timeFromClientX(event.clientX);
      if (which === "start") onChange(Math.min(time, end - 0.1), end);
      else onChange(start, Math.max(time, start + 0.1));
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
  }, [disabled, end, start, onChange, timeFromClientX]);

  const onKey = (which: "start" | "end") => (event: React.KeyboardEvent) => {
    if (disabled) return;
    const step = event.shiftKey ? 1 : 0.1;
    let delta = 0;
    if (event.key === "ArrowLeft") delta = -step;
    else if (event.key === "ArrowRight") delta = step;
    else if (event.key === "Home") delta = -duration;
    else if (event.key === "End") delta = duration;
    else return;
    event.preventDefault();
    if (which === "start") onChange(Math.min(start + delta, end - 0.1), end);
    else onChange(start, Math.max(end + delta, start + 0.1));
  };

  const startPct = duration > 0 ? (start / duration) * 100 : 0;
  const endPct = duration > 0 ? (end / duration) * 100 : 100;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={trackRef}
        className="relative h-20 touch-none select-none overflow-hidden rounded-xl border border-[var(--surface-line)] bg-black"
      >
        <div className="absolute inset-0 flex">
          {thumbs.map((thumb, index) => (
            <div key={`${thumb.time}-${index}`} className="relative h-full flex-1 overflow-hidden">
              {thumb.ok ? (
                // Thumbnails are canvas data URLs; next/image cannot optimise them.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb.src}
                  alt={`Frame at ${thumb.time.toFixed(2)} seconds`}
                  draggable={false}
                  className="size-full object-cover"
                />
              ) : (
                <div className="grid size-full place-items-center bg-[var(--surface-card-2)] text-[9px] text-[var(--text-muted)]">
                  no frame
                </div>
              )}
            </div>
          ))}
          {thumbs.length === 0 ? (
            <div className="grid size-full place-items-center text-xs text-[var(--text-muted)]">
              Building thumbnail strip...
            </div>
          ) : null}
        </div>

        <div aria-hidden="true" className="absolute inset-y-0 bg-black/65" style={{ left: 0, width: `${startPct}%` }} />
        <div aria-hidden="true" className="absolute inset-y-0 bg-black/65" style={{ left: `${endPct}%`, right: 0 }} />
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
      aria-valuemax={Number(max.toFixed(2))}
      aria-valuenow={Number(value.toFixed(2))}
      aria-valuetext={`${value.toFixed(2)} seconds`}
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

/* ------------------------------------------------------------------ */
/*  Local bits                                                         */
/* ------------------------------------------------------------------ */

/** Ctrl/Command + Enter runs the primary action. */
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

function RecordingBar({
  elapsed,
  remaining,
  onCancel,
}: {
  elapsed: number;
  remaining: number | null;
  onCancel: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] px-3.5 py-3"
    >
      <span aria-hidden="true" className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-brand-500" />
        <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
      </span>
      <p className="text-[13px] font-medium text-[var(--text-ink)]">
        Recording... {formatDuration(elapsed)}
        {remaining !== null ? (
          <span className="text-[var(--text-muted)]"> &middot; {formatDuration(remaining)} left</span>
        ) : null}
      </p>
      <Button variant="danger" size="sm" onClick={onCancel} className="ml-auto">
        Cancel
      </Button>
    </div>
  );
}
