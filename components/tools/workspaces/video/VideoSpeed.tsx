"use client";

import * as React from "react";
import { Gauge, Info, TriangleAlert } from "lucide-react";
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
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  VIDEO_FORMATS,
  detectVideoSupport,
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
  id: "video-speed",
  category: "video",
  processing: "local",
};

const RATE_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4] as const;
const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const AUDIO_KBPS = 128;

interface Options {
  rate: number;
  preservePitch: boolean;
  formatId: string;
  fps: number;
  keepAudio: boolean;
}

export default function VideoSpeedWorkspace() {
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

  const [rate, setRate] = React.useState(2);
  const [preservePitchWanted, setPreservePitchWanted] = React.useState(true);
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

  // `preservesPitch` is a real property check on a real element, not a guess
  // from the user agent. Safari has never implemented it.
  const preservePitchSupported = React.useMemo(() => {
    if (typeof HTMLVideoElement === "undefined") return false;
    const element = document.createElement("video");
    return "preservesPitch" in element || "webkitPreservesPitch" in element;
  }, []);
  const preservePitch = preservePitchWanted && preservePitchSupported;

  const picked = React.useMemo(
    () => (support ? pickVideoMime(videoFormatById(formatId).mime, support) : null),
    [support, formatId],
  );

  const outDuration = meta ? meta.duration / rate : 0;
  const wallTime = meta ? meta.duration / rate : 0;
  const estimate = meta ? estimateBytes(3000, keepAudio ? AUDIO_KBPS : 0, outDuration) : 0;
  // Below 1x the canvas only changes `rate` times per source second, so the
  // capture rate drops with it; above 1x frames are dropped instead.
  const captureFps = Math.max(1, Math.min(fps, Math.round(fps * Math.min(rate, 1))));

  const options = React.useMemo<Options>(
    () => ({ rate, preservePitch, formatId, fps, keepAudio }),
    [rate, preservePitch, formatId, fps, keepAudio],
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
      if (probed.width < 2 || probed.height < 2) {
        throw new Error("This video reports no picture dimensions, so it cannot be re-encoded.");
      }

      const run = runCanvasRecorder({
        file,
        mime: picked.mime,
        width: probed.width,
        height: probed.height,
        fps: current.fps,
        playbackRate: current.rate,
        preservePitch: current.preservePitch && current.keepAudio,
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
            filename: withExtension(
              `${file.name.replace(/\.[^.]+$/, "")}-${String(current.rate).replace(".", "p")}x`,
              picked.format.ext,
            ),
            source: file,
            width: outcome.width,
            height: outcome.height,
            note: `${formatDuration(outcome.duration)} · ${outcome.frames} frames · ${
              outcome.skipped > 0 ? `${outcome.skipped} frames the browser could not supply` : "no dropped frames"
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
          emptyTitle="Drop a video to change its speed."
          emptyDescription="Speed it up, slow it down, and choose what happens to the pitch."
          dropzoneHint="One video at a time, up to 500 MB. The export records in real time at the new speed."
          error={error}
          stage={stage}
          percent={percent}
          onRetry={startExport}
          renderMeta={() => (meta ? `${meta.width} x ${meta.height} - ${formatDuration(meta.duration)}` : null)}
          controls={
            <div className="flex flex-col gap-4">
              {meta ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Original length" value={formatDuration(meta.duration)} />
                  <Stat label="New length" value={formatDuration(outDuration)} tone="brand" />
                  <Stat
                    label="Export time"
                    value={formatDuration(wallTime)}
                    hint={rate >= 1 ? "faster than the clip" : "slower than the clip"}
                  />
                  <Stat label="Size estimate" value={formatBytes(estimate)} hint="at 3000 kbps" />
                </dl>
              ) : null}

              <Field label="Speed" hint="Below 1x is slow motion; above 1x drops frames rather than duplicating them.">
                {() => (
                  <Segmented
                    label="Speed"
                    size="sm"
                    value={String(rate)}
                    onChange={(value) => setRate(Number(value))}
                    options={RATE_PRESETS.map((value) => ({ value: String(value), label: `${value}x` }))}
                  />
                )}
              </Field>

              <Field
                label={`Custom rate - ${rate.toFixed(2)}x`}
                hint={`Frame sampling drops to ${captureFps} fps at this rate so slow motion is smooth.`}
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={25}
                    max={400}
                    step={5}
                    value={Math.round(rate * 100)}
                    onChange={(event) => setRate(Number(event.target.value) / 100)}
                  />
                )}
              </Field>

              {rate !== 1 ? (
                <Notice tone="info" icon={<Info className="size-4" />}>
                  {rate > 1
                    ? `At ${rate}x, ${formatDuration(meta?.duration ?? 0)} of footage becomes ${formatDuration(outDuration)} of output. The export takes about ${formatDuration(wallTime)}.`
                    : `At ${rate}x the export takes about ${formatDuration(wallTime)} of real time, because the browser encodes as fast as the video plays.`}
                </Notice>
              ) : null}

              <Checkbox
                label="Keep the audio track"
                description="Without audio there is no pitch to worry about."
                checked={keepAudio}
                onChange={(event) => setKeepAudio(event.target.checked)}
              />

              <Checkbox
                label="Preserve pitch while changing speed"
                description="Uses HTMLMediaElement.preservesPitch on the source element, so the compensation is baked into the recorded audio. Chrome, Edge and Firefox support it; Safari does not, and there the toggle has no effect."
                checked={preservePitch}
                disabled={!keepAudio || !preservePitchSupported}
                onChange={(event) => setPreservePitchWanted(event.target.checked)}
              />

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

              <Field label="Output frame rate" hint="Above 1x the source rate is the ceiling; below 1x the rate scales down.">
                {() => (
                  <Segmented
                    label="Output frame rate"
                    size="sm"
                    value={String(fps)}
                    onChange={(value) => setFps(Number(value))}
                    options={FPS_CHOICES.map((value) => ({ value: String(value), label: String(value) }))}
                  />
                )}
              </Field>
            </div>
          }
          action={
            <ProcessButton
              onClick={startExport}
              disabled={!source || isRunning || !picked?.supported || !meta}
              loading={isRunning}
              label="Change speed"
              icon={<Gauge className="size-4" aria-hidden="true" />}
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
          <ResultsPanel title="Speed-changed video">
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
