"use client";

import * as React from "react";
import { Clapperboard, Info, TriangleAlert } from "lucide-react";
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
import { Checkbox, Field, Segmented, Select, Slider, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration, percentSaved } from "@/lib/utils/format";
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
  id: "video-compressor",
  category: "video",
  processing: "local",
};

const SCALES = [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1] as const;
const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const AUDIO_KBPS = 128;

interface Options {
  formatId: string;
  scale: number;
  kbps: number;
  fps: number;
  keepAudio: boolean;
}

export default function VideoCompressorWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  const [support, setSupport] = React.useState<MediaSupport | null>(null);
  const [meta, setMeta] = React.useState<VideoMetaLite | null>(null);
  const [metaError, setMetaError] = React.useState<string | null>(null);

  const [formatId, setFormatId] = React.useState("webm-vp9");
  const [scale, setScale] = React.useState(0.5);
  const [kbps, setKbps] = React.useState(1000);
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
    let alive = true;
    setMeta(null);
    setMetaError(null);
    if (!source) return;
    void readVideoMeta(source)
      .then((value) => {
        if (alive) setMeta(value);
      })
      .catch((error: unknown) => {
        if (alive) setMetaError(error instanceof Error ? error.message : "This video could not be read.");
      });
    return () => {
      alive = false;
    };
  }, [source]);

  React.useEffect(() => {
    const preset = videoFormatById(formatId).bitrates;
    if (!preset.includes(kbps)) setKbps(preset[2] ?? preset[0]);
  }, [formatId, kbps]);

  const picked = React.useMemo(
    () => (support ? pickVideoMime(videoFormatById(formatId).mime, support) : null),
    [support, formatId],
  );

  const outWidth = meta ? even(meta.width * scale) : 0;
  const outHeight = meta ? even(meta.height * scale) : 0;
  const estimate = meta ? estimateBytes(kbps, keepAudio ? AUDIO_KBPS : 0, meta.duration) : 0;
  const willGrow = Boolean(source && estimate > 0 && estimate >= source.size);

  const options = React.useMemo<Options>(
    () => ({ formatId, scale, kbps, fps, keepAudio }),
    [formatId, scale, kbps, fps, keepAudio],
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
              value.remaining !== null ? ` · ${formatDuration(value.remaining)} left` : ""
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
            } · ${outcome.frames} frames`,
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
          emptyTitle="Drop a video to compress it."
          emptyDescription="MP4, WebM or MOV, up to 500 MB. The file never leaves your device."
          dropzoneHint="One video at a time, up to 500 MB. Re-encoding happens in real time, so keep this tab visible while it runs."
          error={error}
          stage={stage}
          percent={percent}
          onRetry={start}
          renderMeta={() => (meta ? `${meta.width} x ${meta.height} - ${formatDuration(meta.duration)}` : null)}
          controls={
            <div className="flex flex-col gap-4">
              {meta ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Dimensions" value={`${meta.width} x ${meta.height}`} hint="decoded from the container" />
                  <Stat label="Duration" value={formatDuration(meta.duration)} hint="read from the container" />
                  <Stat label="File size" value={formatBytes(files[0]?.size ?? 0)} hint="as uploaded" />
                  <Stat
                    label="Output estimate"
                    value={formatBytes(estimate)}
                    hint={`${outWidth} x ${outHeight} at ${kbps} kbps`}
                    tone={willGrow ? "default" : "success"}
                  />
                </dl>
              ) : null}

              {willGrow ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="This will not shrink the file.">
                  At {kbps} kbps the estimate is {formatBytes(estimate)}, which is larger than the{" "}
                  {formatBytes(files[0]?.size ?? 0)} input. Drop the resolution or the bitrate if you want a smaller file.
                </Notice>
              ) : null}

              <Field
                label="Output format"
                hint="Availability comes from this browser's MediaRecorder, checked when the page loaded."
              >
                {({ id, describedBy }) => (
                  <div className="flex flex-col gap-2">
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={formatId}
                      onChange={(event) => setFormatId(event.target.value)}
                    >
                      {VIDEO_FORMATS.map((format) => (
                        <option key={format.id} value={format.id}>
                          {format.label}
                          {support ? (support[format.capability] ? "" : " - not available here") : ""}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-[var(--text-muted)]">
                      {formatId === "mp4-h264"
                        ? "MP4/H.264 needs Chrome 126+ or Edge. Firefox cannot record it."
                        : formatId === "ogv-theora"
                          ? "Ogg Theora plays in Firefox and most desktop players, but not on iOS."
                          : "WebM is the most widely recordable format in Chrome and Firefox."}
                    </p>
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
                hint={`Output ${outWidth || "-"} x ${outHeight || "-"} px, rounded up to even numbers.`}
              >
                {({ id, describedBy }) => (
                  <div className="flex flex-col gap-2">
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={10}
                      max={100}
                      step={5}
                      value={Math.round(scale * 100)}
                      onChange={(event) => setScale(Number(event.target.value) / 100)}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {SCALES.map((preset) => (
                        <Button
                          key={preset}
                          size="sm"
                          variant={Math.abs(scale - preset) < 0.001 ? "primary" : "secondary"}
                          onClick={() => setScale(preset)}
                          aria-pressed={Math.abs(scale - preset) < 0.001}
                        >
                          {Math.round(preset * 100)}%
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </Field>

              <Field
                label={`Target bitrate - ${kbps} kbps`}
                hint="MediaRecorder treats this as a target, not a guarantee."
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={100}
                    max={8000}
                    step={100}
                    value={kbps}
                    onChange={(event) => setKbps(Number(event.target.value))}
                  />
                )}
              </Field>

              <Field label="Frame rate" hint="Lower frame rate is the cheapest way to shrink a file.">
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
                description="The source soundtrack is re-encoded alongside the video."
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
              label="Compress video"
              icon={<Clapperboard className="size-4" aria-hidden="true" />}
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
            Recording cancelled, so nothing was exported. Adjust a setting and try again.
          </Notice>
        ) : null}

        {metaError ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
            {metaError}
          </Notice>
        ) : null}

        {result && source ? (
          <ResultsPanel title="Compressed video">
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
                The browser did not release an audio track for this file, so the export is silent.
              </Notice>
            ) : null}
            {result.blob.size > source.size ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                The result is {percentSaved(source.size, result.blob.size).toFixed(1)}% larger than the input. Re-encoding an
                already-compressed file often does this; try a lower bitrate or a smaller resolution.
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
