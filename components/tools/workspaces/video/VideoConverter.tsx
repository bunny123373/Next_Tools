"use client";

import * as React from "react";
import { CheckCircle2, Info, SlidersHorizontal, TriangleAlert, Video as VideoIcon, XCircle } from "lucide-react";
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
import { Checkbox, Field, Segmented, Slider, Stat } from "@/components/ui/form";
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
  id: "video-converter",
  category: "video",
  processing: "local",
};

const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const AUDIO_KBPS = 128;

interface Options {
  formatId: string;
  scale: number;
  kbps: number;
  fps: number;
  keepAudio: boolean;
}

/** Plain-language notes per format, so the picker is more than a list of names. */
const FORMAT_NOTES: Record<string, string> = {
  "mp4-h264": "Plays everywhere, including iOS. Needs Chrome 126+ or Edge to record it - Firefox and Safari cannot.",
  "webm-vp9": "Best quality per bit in Chrome. Plays in Chrome, Firefox and Edge; not in iOS Safari.",
  "webm-vp8": "The most compatible WebM codec. Slightly larger than VP9 at the same visual quality.",
  "ogv-theora": "Open, royalty-free and supported by Firefox. Not recognised by iOS or most phones.",
};

export default function VideoConverterWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  const [support, setSupport] = React.useState<MediaSupport | null>(null);
  // Probe results are tagged with the file they describe, so changing the file
  // invalidates them by derivation rather than by resetting state in an effect.
  const [probe, setProbe] = React.useState<{ key: string; meta: VideoMetaLite | null; error: string | null }>({
    key: "",
    meta: null,
    error: null,
  });
  const probeKey = source ? `${source.name}:${source.size}:${source.lastModified}` : "";
  const meta = probe.key === probeKey ? probe.meta : null;
  const metaError = probe.key === probeKey ? probe.error : null;

  const [formatId, setFormatId] = React.useState("webm-vp9");
  const [scale, setScale] = React.useState(1);
  const [kbps, setKbps] = React.useState(3000);
  const [fps, setFps] = React.useState(30);
  const [keepAudio, setKeepAudio] = React.useState(true);

  const [tick, setTick] = React.useState<TranscodeTick | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const [noAudio, setNoAudio] = React.useState(false);
  const recorderRef = React.useRef<{ cancel: (reason?: string) => void } | null>(null);

  React.useEffect(() => {
    let alive = true;
    void detectVideoSupport().then((value) => {
      if (alive) setSupport(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!source) return;
    let alive = true;
    void readVideoMeta(source)
      .then((value) => {
        if (alive) setProbe({ key: probeKey, meta: value, error: null });
      })
      .catch((error: unknown) => {
        if (alive) {
          setProbe({
            key: probeKey,
            meta: null,
            error: error instanceof Error ? error.message : "This video could not be read.",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [source, probeKey]);

  // Keep the bitrate inside the chosen format's supported range, derived
  // during render rather than by writing state back from an effect.
  const format = videoFormatById(formatId);
  const effectiveKbps = format.bitrates.includes(kbps)
    ? kbps
    : (format.bitrates[Math.min(3, format.bitrates.length - 1)] ?? format.bitrates[0]);

  const picked = React.useMemo(
    () => (support ? pickVideoMime(videoFormatById(formatId).mime, support) : null),
    [support, formatId],
  );

  const outWidth = meta ? even(meta.width * scale) : 0;
  const outHeight = meta ? even(meta.height * scale) : 0;
  const estimate = meta ? estimateBytes(effectiveKbps, keepAudio ? AUDIO_KBPS : 0, meta.duration) : 0;

  const options = React.useMemo<Options>(
    () => ({ formatId, scale, kbps: effectiveKbps, fps, keepAudio }),
    [formatId, scale, effectiveKbps, fps, keepAudio],
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
      if (!picked.supported) {
        throw new Error(picked.warning ?? "This browser cannot encode video.");
      }
      const probed: VideoMetaLite = meta ?? (await readVideoMeta(file));
      const width = even(probed.width * current.scale);
      const height = even(probed.height * current.scale);
      if (!(width > 0) || !(height > 0)) {
        throw new Error("This video reports no picture dimensions, so it cannot be re-encoded.");
      }

      const run = runCanvasRecorder({
        file,
        mime: picked.mime,
        width,
        height,
        fps: current.fps,
        videoKbps: current.kbps,
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
            filename: withExtension(file.name, picked.format.ext),
            source: file,
            width: outcome.width,
            height: outcome.height,
            note: `${formatDuration(outcome.duration)} · ${
              outcome.audio ? "audio kept" : "no audio track"
            }`,
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

  const start = React.useCallback(() => {
    if (!source || isRunning) return;
    setCancelled(false);
    setNoAudio(false);
    setTick(null);
    void run([source]);
  }, [source, run, isRunning]);

  useShortcut(Boolean(source) && !isRunning, start);

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
          emptyTitle="Drop a video to convert it."
          emptyDescription="MP4, WebM or MOV, up to 500 MB. Nothing is uploaded."
          dropzoneHint="One video at a time, up to 500 MB. Conversion records in real time, so keep this tab visible."
          error={error}
          stage={stage}
          percent={percent}
          onRetry={start}
          renderMeta={() => (meta ? `${meta.width} x ${meta.height} - ${formatDuration(meta.duration)}` : null)}
          controls={
            <div className="flex flex-col gap-4">
              {meta ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Source" value={`${meta.width} x ${meta.height}`} />
                  <Stat label="Output" value={outWidth ? `${outWidth} x ${outHeight}` : "-"} hint="even dimensions" />
                  <Stat label="Duration" value={formatDuration(meta.duration)} />
                  <Stat label="Size estimate" value={formatBytes(estimate)} hint={`${effectiveKbps} kbps video`} tone="brand" />
                </dl>
              ) : null}

              <Field
                label="Output format"
                hint="Each row reflects a real MediaRecorder.isTypeSupported check from this browser."
              >
                {() => (
                  <div role="radiogroup" aria-label="Output format" className="flex flex-col gap-2">
                    {VIDEO_FORMATS.map((format) => {
                      const available = support ? support[format.capability] : null;
                      const active = formatId === format.id;
                      return (
                        <button
                          key={format.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={available === false}
                          onClick={() => setFormatId(format.id)}
                          className={cn(
                            "flex flex-col gap-1 rounded-[10px] border px-3.5 py-3 text-left transition-colors duration-150",
                            active
                              ? "border-brand-500 bg-brand-500/[0.08]"
                              : "border-[var(--surface-line)] bg-[var(--surface-card-2)] hover:border-[var(--surface-line-strong)]",
                            available === false && "cursor-not-allowed opacity-55 hover:border-[var(--surface-line)]",
                          )}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium text-[var(--text-ink)]">{format.label}</span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                                available === true
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                                  : available === false
                                    ? "border-[var(--surface-line-strong)] bg-[var(--surface-card)] text-[var(--text-muted)]"
                                    : "border-[var(--surface-line)] text-[var(--text-muted)]",
                              )}
                            >
                              {available === true ? (
                                <CheckCircle2 className="size-3" aria-hidden="true" />
                              ) : available === false ? (
                                <XCircle className="size-3" aria-hidden="true" />
                              ) : null}
                              {available === null ? "checking..." : available ? "available" : "not available"}
                            </span>
                            {format.webFriendly ? (
                              <span className="rounded-md border border-[var(--surface-line)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                plays on iOS
                              </span>
                            ) : null}
                          </span>
                          <span className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                            {FORMAT_NOTES[format.id]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>

              {picked?.warning ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  {picked.warning}
                </Notice>
              ) : null}

              <Field
                label={`Resolution - ${Math.round(scale * 100)}%`}
                hint={`Output ${outWidth || "-"} x ${outHeight || "-"} px. Converting at the source size keeps the least detail.`}
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={25}
                    max={100}
                    step={5}
                    value={Math.round(scale * 100)}
                    onChange={(event) => setScale(Number(event.target.value) / 100)}
                  />
                )}
              </Field>

              <Field label="Frame rate" hint="Converting never invents frames: the source frame rate is the ceiling.">
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

              <Field label={`Target bitrate - ${effectiveKbps} kbps`} hint="Higher means closer to the source quality.">
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={200}
                    max={10000}
                    step={100}
                    value={effectiveKbps}
                    onChange={(event) => setKbps(Number(event.target.value))}
                  />
                )}
              </Field>

              <Checkbox
                label="Keep the audio track"
                description="Re-encoded by the browser into the target container's audio codec."
                checked={keepAudio}
                onChange={(event) => setKeepAudio(event.target.checked)}
              />
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={!source || isRunning || !picked?.supported}
              loading={isRunning}
              label="Convert video"
              icon={<VideoIcon className="size-4" aria-hidden="true" />}
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
          <ResultsPanel title="Converted video">
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
              <DownloadButton
                blob={result.blob}
                filename={result.filename}
                label="Download video"
                caption={`${picked?.label ?? "video"} · ${result.note ?? ""}`}
              />
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
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-ink)]">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Source
            </h3>
            <VideoPreview file={source} src={sourceUrl} controls />
            <p className="truncate text-xs text-[var(--text-muted)]">{source.name}</p>
          </div>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          Conversion re-encodes every frame, so the output is never bit-identical to the input. A little quality is the price
          of changing container, and no browser-native path avoids it.
        </Notice>

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
