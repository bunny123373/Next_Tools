"use client";

import * as React from "react";
import { Crop as CropIcon, Info, TriangleAlert } from "lucide-react";
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
import { Notice } from "@/components/tools/states";
import { SizeComparisonStats } from "@/components/tools/BeforeAfter";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Segmented, Select, Stat } from "@/components/ui/form";
import { cn } from "@/lib/utils/cn";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  VIDEO_FORMATS,
  detectVideoSupport,
  even,
  estimateBytes,
  pickVideoMime,
  readVideoMeta,
  runCanvasRecorder,
  videoFormatById,
  type MediaSupport,
  type TranscodeTick,
  type VideoMetaLite,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "video-cropper",
  category: "video",
  processing: "local",
};

const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const AUDIO_KBPS = 128;

interface Preset {
  id: string;
  label: string;
  /** width / height, or null for the free-form mode. */
  ratio: number | null;
}

const PRESETS: readonly Preset[] = [
  { id: "16x9", label: "16:9", ratio: 16 / 9 },
  { id: "9x16", label: "9:16", ratio: 9 / 16 },
  { id: "1x1", label: "1:1", ratio: 1 },
  { id: "4x3", label: "4:3", ratio: 4 / 3 },
  { id: "2.39", label: "2.39:1", ratio: 2.39 },
  { id: "free", label: "Free", ratio: null },
];

/** Normalised crop rectangle, 0-1 in both axes. */
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Options {
  crop: CropRect;
  formatId: string;
  fps: number;
  keepAudio: boolean;
}

/** Largest rectangle of `ratio` that fits inside a source of `sourceRatio`. */
function fitPresetToSource(ratio: number, sourceRatio: number): CropRect {
  if (Math.abs(ratio - sourceRatio) < 0.002) return { x: 0, y: 0, w: 1, h: 1 };
  if (ratio > sourceRatio) {
    const w = 1;
    const h = sourceRatio / ratio;
    return { x: 0, y: (1 - h) / 2, w, h };
  }
  const h = 1;
  const w = ratio / sourceRatio;
  return { x: (1 - w) / 2, y: 0, w, h };
}

export default function VideoCropperWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  const [support, setSupport] = React.useState<MediaSupport | null>(null);
  const [meta, setMeta] = React.useState<VideoMetaLite | null>(null);
  const [probeError, setProbeError] = React.useState<string | null>(null);

  const [presetId, setPresetId] = React.useState("16x9");
  const [crop, setCrop] = React.useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const [formatId, setFormatId] = React.useState("webm-vp9");
  const [fps, setFps] = React.useState(30);
  const [keepAudio, setKeepAudio] = React.useState(true);

  const [tick, setTick] = React.useState<TranscodeTick | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const [noAudio, setNoAudio] = React.useState(false);
  const recorderRef = React.useRef<{ cancel: (reason?: string) => void } | null>(null);

  React.useEffect(() => {
    let alive = true;
    void detectVideoSupport().then((value) => alive && setSupport(value));
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    let alive = true;
    setMeta(null);
    setProbeError(null);
    if (!source) return;
    void readVideoMeta(source)
      .then((value) => alive && setMeta(value))
      .catch((error: unknown) => {
        if (alive) setProbeError(error instanceof Error ? error.message : "This video could not be read.");
      });
    return () => {
      alive = false;
    };
  }, [source]);

  const sourceRatio = meta && meta.height > 0 ? meta.width / meta.height : 16 / 9;

  const applyPreset = React.useCallback(
    (id: string) => {
      setPresetId(id);
      const preset = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
      if (preset?.ratio) setCrop(fitPresetToSource(preset.ratio, sourceRatio));
    },
    [sourceRatio],
  );

  // Re-fit when the source aspect ratio changes under a locked preset.
  React.useEffect(() => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset?.ratio) return;
    setCrop(fitPresetToSource(preset.ratio, sourceRatio));
  }, [presetId, sourceRatio]);

  const picked = React.useMemo(
    () => (support ? pickVideoMime(videoFormatById(formatId).mime, support) : null),
    [support, formatId],
  );

  const cropPixels = meta
    ? {
        x: Math.round(crop.x * meta.width),
        y: Math.round(crop.y * meta.height),
        w: even(crop.w * meta.width),
        h: even(crop.h * meta.height),
      }
    : { x: 0, y: 0, w: 0, h: 0 };
  const estimate = meta ? estimateBytes(3000, keepAudio ? AUDIO_KBPS : 0, meta.duration) : 0;

  const options = React.useMemo<Options>(
    () => ({ crop, formatId, fps, keepAudio }),
    [crop, formatId, fps, keepAudio],
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
      const probed: VideoMetaLite = meta ?? (await readVideoMeta(file));

      const sx = Math.round(current.crop.x * probed.width);
      const sy = Math.round(current.crop.y * probed.height);
      const sw = even(current.crop.w * probed.width);
      const sh = even(current.crop.h * probed.height);
      if (sw < 2 || sh < 2) throw new Error("The crop rectangle is too small to encode.");

      const run = runCanvasRecorder({
        file,
        mime: picked.mime,
        width: sw,
        height: sh,
        fps: current.fps,
        videoKbps: 3000,
        audioKbps: current.keepAudio ? AUDIO_KBPS : 0,
        includeAudio: current.keepAudio,
        sourceRect: { x: sx, y: sy, width: sw, height: sh },
        onTick: (value) => {
          setTick(value);
          report({
            percent: value.percent,
            done: 0,
            total: 1,
            caption: `Recording ${formatDuration(value.mediaTime)} of ${formatDuration(probed.duration)}${
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
            filename: withExtension(`${file.name.replace(/\.[^.]+$/, "")}-crop`, picked.format.ext),
            source: file,
            width: outcome.width,
            height: outcome.height,
            note: `${formatDuration(outcome.duration)} · ${sw} x ${sh} px`,
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

  const handleReset = () => {
    recorderRef.current?.cancel("Reset.");
    recorderRef.current = null;
    setTick(null);
    setCancelled(false);
    setNoAudio(false);
    clear();
    reset();
    applyPreset("16x9");
  };

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
          emptyTitle="Drop a video to crop it."
          emptyDescription="Pick a ratio, drag the rectangle over a live frame, then export."
          dropzoneHint="One video at a time, up to 500 MB. Exporting records in real time."
          error={error}
          stage={stage}
          percent={percent}
          onRetry={startExport}
          renderMeta={() => (meta ? `${meta.width} x ${meta.height} - ${formatDuration(meta.duration)}` : null)}
          controls={
            <div className="flex flex-col gap-4">
              {meta ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="Source" value={`${meta.width} x ${meta.height}`} />
                  <Stat
                    label="Cropped output"
                    value={`${cropPixels.w} x ${cropPixels.h}`}
                    hint="rounded to even numbers"
                    tone="brand"
                  />
                  <Stat label="Size estimate" value={formatBytes(estimate)} hint="at 3000 kbps" />
                </dl>
              ) : null}

              <Field label="Aspect ratio" hint="Presets fit the largest rectangle of that shape inside the frame.">
                {() => (
                  <Segmented
                    label="Aspect ratio"
                    size="sm"
                    value={presetId}
                    onChange={applyPreset}
                    options={PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
                  />
                )}
              </Field>

              <Field label="Output format" hint="Driven by real MediaRecorder support in this browser.">
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

              <Field label="Frame rate">
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
                description="The soundtrack is carried across and re-encoded with the cropped video."
                checked={keepAudio}
                onChange={(event) => setKeepAudio(event.target.checked)}
              />
            </div>
          }
          action={
            <ProcessButton
              onClick={startExport}
              disabled={!source || isRunning || !picked?.supported || !meta}
              loading={isRunning}
              label="Export crop"
              icon={<CropIcon className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {sourceUrl && meta ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-ink)]">Crop rectangle</h3>
            <CropSurface
              src={sourceUrl}
              label={source.name}
              crop={crop}
              locked={presetId !== "free"}
              disabled={isRunning}
              onChange={setCrop}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Drag inside the rectangle to move it, or drag the corner to resize in Free mode. Arrow keys nudge by 1% and
              Shift + arrow resizes. The rule-of-thirds grid helps you line things up.
            </p>
          </div>
        ) : null}

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

        {result && source ? (
          <ResultsPanel title="Cropped video">
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
              <DownloadButton blob={result.blob} filename={result.filename} label="Download crop" />
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

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Crop surface                                                       */
/* ------------------------------------------------------------------ */

function CropSurface({
  src,
  label,
  crop,
  locked,
  disabled,
  onChange,
}: {
  src: string;
  label: string;
  crop: CropRect;
  locked: boolean;
  disabled: boolean;
  onChange: (rect: CropRect) => void;
}) {
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ mode: "move" | "resize"; startX: number; startY: number; rect: CropRect } | null>(
    null,
  );
  const [dragging, setDragging] = React.useState(false);

  const pointFrom = React.useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, []);

  React.useEffect(() => {
    if (disabled) return;
    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      event.preventDefault();
      const point = pointFrom(event.clientX, event.clientY);
      const dx = point.x - state.startX;
      const dy = point.y - state.startY;
      if (state.mode === "move") {
        onChange({
          ...state.rect,
          x: Math.min(1 - state.rect.w, Math.max(0, state.rect.x + dx)),
          y: Math.min(1 - state.rect.h, Math.max(0, state.rect.y + dy)),
        });
      } else {
        onChange({
          ...state.rect,
          w: Math.min(1 - state.rect.x, Math.max(0.05, state.rect.w + dx)),
          h: Math.min(1 - state.rect.y, Math.max(0.05, state.rect.h + dy)),
        });
      }
    };
    const onUp = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [disabled, onChange, pointFrom]);

  const begin = (mode: "move" | "resize") => (event: React.PointerEvent) => {
    if (disabled) return;
    event.preventDefault();
    const point = pointFrom(event.clientX, event.clientY);
    drag.current = { mode, startX: point.x, startY: point.y, rect: crop };
    setDragging(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const step = event.shiftKey ? 0.04 : 0.01;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = -step;
    else if (event.key === "ArrowDown") dy = step;
    else return;
    event.preventDefault();
    if (event.shiftKey && !locked) {
      onChange({
        ...crop,
        w: Math.min(1 - crop.x, Math.max(0.05, crop.w + dx)),
        h: Math.min(1 - crop.y, Math.max(0.05, crop.h + dy)),
      });
    } else {
      onChange({
        ...crop,
        x: Math.min(1 - crop.w, Math.max(0, crop.x + dx)),
        y: Math.min(1 - crop.h, Math.max(0, crop.y + dy)),
      });
    }
  };

  const pct = (value: number) => `${value * 100}%`;

  return (
    <div
      ref={frameRef}
      className="relative touch-none select-none overflow-hidden rounded-xl border border-[var(--surface-line)] bg-black"
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied video, no captions apply */}
      <video src={src} playsInline preload="auto" muted className="block max-h-[24rem] w-full object-contain" />
      <span className="sr-only">{label}</span>

      <div className="absolute inset-0" aria-hidden="true">
        <div
          className="absolute inset-0 bg-black/60"
          style={{ clipPath: `polygon(0% 0%, 0% 100%, ${pct(crop.x)} 100%, ${pct(crop.x)} 0%)` }}
        />
        <div
          className="absolute inset-0 bg-black/60"
          style={{
            clipPath: `polygon(${pct(crop.x)} 0%, 100% 0%, 100% 100%, ${pct(crop.x)} 100%, ${pct(crop.x + crop.w)} 100%, ${pct(crop.x + crop.w)} 0%)`,
          }}
        />
        <div
          className="absolute inset-0 bg-black/60"
          style={{
            clipPath: `polygon(${pct(crop.x)} 0%, ${pct(crop.x + crop.w)} 0%, ${pct(crop.x + crop.w)} ${pct(crop.y)}, ${pct(crop.x)} ${pct(crop.y)})`,
          }}
        />
        <div
          className="absolute inset-0 bg-black/60"
          style={{
            clipPath: `polygon(${pct(crop.x)} ${pct(crop.y + crop.h)}, ${pct(crop.x + crop.w)} ${pct(crop.y + crop.h)}, ${pct(crop.x + crop.w)} 100%, ${pct(crop.x)} 100%)`,
          }}
        />
      </div>

      <div
        className="pointer-events-none absolute grid grid-cols-3 grid-rows-3 border-2 border-brand-500"
        style={{
          left: pct(crop.x),
          top: pct(crop.y),
          width: pct(crop.w),
          height: pct(crop.h),
        }}
        aria-hidden="true"
      >
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className="border border-white/15" />
        ))}
      </div>

      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Crop position and size"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(crop.x * 100)}
        aria-valuetext={`left ${Math.round(crop.x * 100)} percent, top ${Math.round(crop.y * 100)} percent, width ${Math.round(crop.w * 100)} percent, height ${Math.round(crop.h * 100)} percent`}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={begin("move")}
        className={cn(
          "absolute touch-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white",
          dragging ? "cursor-grabbing" : "cursor-move",
          disabled && "pointer-events-none opacity-60",
        )}
        style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
      />

      {!locked ? (
        <div
          onPointerDown={begin("resize")}
          role="presentation"
          aria-hidden="true"
          className="absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-brand-500"
          style={{ left: pct(crop.x + crop.w), top: pct(crop.y + crop.h) }}
        />
      ) : null}
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
