"use client";

import * as React from "react";
import { Info, Ruler, TriangleAlert } from "lucide-react";
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
import { Checkbox, Field, Input, Segmented, Select, Stat } from "@/components/ui/form";
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
  id: "video-resizer",
  category: "video",
  processing: "local",
};

const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const AUDIO_KBPS = 128;
const SCALE_STEPS = [25, 50, 75, 100, 150, 200] as const;

/** Common delivery heights, as a quick way to hit a platform's limit. */
const HEIGHT_PRESETS: ReadonlyArray<{ label: string; height: number }> = [
  { label: "2160p (4K)", height: 2160 },
  { label: "1440p (QHD)", height: 1440 },
  { label: "1080p (Full HD)", height: 1080 },
  { label: "720p (HD)", height: 720 },
  { label: "480p (SD)", height: 480 },
  { label: "360p", height: 360 },
];

interface Options {
  width: number;
  height: number;
  formatId: string;
  fps: number;
  keepAudio: boolean;
}

export default function VideoResizerWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  const [support, setSupport] = React.useState<MediaSupport | null>(null);
  const [meta, setMeta] = React.useState<VideoMetaLite | null>(null);
  const [metaError, setMetaError] = React.useState<string | null>(null);

  const [width, setWidth] = React.useState(0);
  const [height, setHeight] = React.useState(0);
  const [locked, setLocked] = React.useState(true);
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
    setMetaError(null);
    if (!source) return;
    void readVideoMeta(source)
      .then((value) => {
        if (!alive) return;
        setMeta(value);
        setWidth(even(value.width * 0.5));
        setHeight(even(value.height * 0.5));
      })
      .catch((error: unknown) => {
        if (alive) setMetaError(error instanceof Error ? error.message : "This video could not be read.");
      });
    return () => {
      alive = false;
    };
  }, [source]);

  const picked = React.useMemo(
    () => (support ? pickVideoMime(videoFormatById(formatId).mime, support) : null),
    [support, formatId],
  );

  const outWidth = even(width || 0);
  const outHeight = even(height || 0);
  const upscale = Boolean(meta && outWidth > meta.width);
  const estimate = meta ? estimateBytes(3000, keepAudio ? AUDIO_KBPS : 0, meta.duration) : 0;

  const setWidthKeepingRatio = React.useCallback(
    (next: number) => {
      const safe = Math.max(2, Math.round(next));
      setWidth(even(safe));
      if (locked && meta && meta.height > 0) {
        setHeight(even((safe * meta.height) / meta.width));
      }
    },
    [locked, meta],
  );

  const setHeightKeepingRatio = React.useCallback(
    (next: number) => {
      const safe = Math.max(2, Math.round(next));
      setHeight(even(safe));
      if (locked && meta && meta.width > 0) {
        setWidth(even((safe * meta.width) / meta.height));
      }
    },
    [locked, meta],
  );

  const applyScale = React.useCallback(
    (percent: number) => {
      if (!meta) return;
      setWidth(even((meta.width * percent) / 100));
      setHeight(even((meta.height * percent) / 100));
    },
    [meta],
  );

  const options = React.useMemo<Options>(
    () => ({ width: outWidth, height: outHeight, formatId, fps, keepAudio }),
    [outWidth, outHeight, formatId, fps, keepAudio],
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
      if (current.width < 2 || current.height < 2) {
        throw new Error("Pick a width and height of at least 2 pixels.");
      }
      const probed: VideoMetaLite = meta ?? (await readVideoMeta(file));

      const run = runCanvasRecorder({
        file,
        mime: picked.mime,
        width: current.width,
        height: current.height,
        fps: current.fps,
        videoKbps: 3000,
        audioKbps: current.keepAudio ? AUDIO_KBPS : 0,
        includeAudio: current.keepAudio,
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
            filename: withExtension(`${file.name.replace(/\.[^.]+$/, "")}-${outcome.width}x${outcome.height}`, picked.format.ext),
            source: file,
            width: outcome.width,
            height: outcome.height,
            note: `${formatDuration(outcome.duration)} · ${outcome.frames} frames`,
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
          emptyTitle="Drop a video to resize it."
          emptyDescription="Set a target width or height with the aspect ratio locked."
          dropzoneHint="One video at a time, up to 500 MB. Resizing still records in real time."
          error={error}
          stage={stage}
          percent={percent}
          onRetry={startExport}
          renderMeta={() => (meta ? `${meta.width} x ${meta.height} - ${formatDuration(meta.duration)}` : null)}
          controls={
            <div className="flex flex-col gap-4">
              {meta ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Source" value={`${meta.width} x ${meta.height}`} hint={`${meta.duration.toFixed(2)}s`} />
                  <Stat
                    label="Output"
                    value={`${outWidth} x ${outHeight}`}
                    hint={meta.height > 0 ? `${((outHeight / meta.height) * 100).toFixed(0)}% of source height` : undefined}
                    tone="brand"
                  />
                  <Stat label="Size estimate" value={formatBytes(estimate)} hint="at 3000 kbps" />
                  <Stat
                    label="Source size"
                    value={formatBytes(files[0]?.size ?? 0)}
                    hint="before re-encoding"
                  />
                </dl>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Width" hint="Pixels. Rounded up to an even number.">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={2}
                      max={7680}
                      step={2}
                      value={outWidth}
                      disabled={isRunning}
                      onChange={(event) => setWidthKeepingRatio(Number(event.target.value))}
                      suffix={<>px</>}
                    />
                  )}
                </Field>
                <Field label="Height" hint="Derived from the width while the ratio is locked.">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={2}
                      max={4320}
                      step={2}
                      value={outHeight}
                      disabled={isRunning}
                      onChange={(event) => setHeightKeepingRatio(Number(event.target.value))}
                      suffix={<>px</>}
                    />
                  )}
                </Field>
              </div>

              <Checkbox
                label="Lock the aspect ratio"
                description="Turning this off lets you force a shape, which stretches the picture."
                checked={locked}
                onChange={(event) => setLocked(event.target.checked)}
              />

              <Field label="Scale" hint="Preset steps computed from the real source dimensions.">
                {() => (
                  <div className="flex flex-wrap gap-1.5">
                    {SCALE_STEPS.map((step) => (
                      <Button
                        key={step}
                        size="sm"
                        variant="secondary"
                        onClick={() => applyScale(step)}
                        disabled={!meta || isRunning}
                      >
                        {step}%
                      </Button>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Target height" hint="Fits the width automatically, never upscaling above 4K.">
                {() => (
                  <div className="flex flex-wrap gap-1.5">
                    {HEIGHT_PRESETS.map((preset) => (
                      <Button
                        key={preset.height}
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!meta) return;
                          const nextHeight = Math.min(preset.height, meta.height);
                          setHeight(even(nextHeight));
                          setWidth(even((nextHeight * meta.width) / meta.height));
                        }}
                        disabled={!meta || isRunning}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                )}
              </Field>

              {upscale ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  You are scaling above {meta?.width}px, the source width. Upscaling cannot recover detail that was never
                  recorded, and re-encoding adds a little loss on top.
                </Notice>
              ) : null}

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

              <Field label="Frame rate" hint="The source frame rate is the ceiling.">
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
                description="The soundtrack is carried across and re-encoded."
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
              label="Resize video"
              icon={<Ruler className="size-4" aria-hidden="true" />}
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

        {metaError ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
            {metaError}
          </Notice>
        ) : null}

        {result && source ? (
          <ResultsPanel title="Resized video">
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
              <DownloadButton blob={result.blob} filename={result.filename} label="Download video" />
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

        {sourceUrl && !result ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-ink)]">Source</h3>
            <VideoPreview file={source} src={sourceUrl} controls />
            <p className="truncate text-xs text-[var(--text-muted)]">{source.name}</p>
          </div>
        ) : null}

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
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
