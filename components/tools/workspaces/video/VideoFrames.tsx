"use client";

import * as React from "react";
import { Images as ImagesIcon, Info, TriangleAlert } from "lucide-react";
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
import { DownloadGroup } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Slider, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, downloadBlob } from "@/lib/utils/files";
import { toast } from "@/lib/utils/toast";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import { drawVideoFrame, probeVideo, type VideoMetaLite } from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "video-frames",
  category: "video",
  processing: "local",
};

const MAX_FRAMES = 200;
const COUNT_PRESETS = [5, 10, 20, 50, 100] as const;

type Mode = "count" | "times";

interface Options {
  mode: Mode;
  count: number;
  times: string;
  format: "jpeg" | "png";
  quality: number;
  scale: number;
}

export default function VideoFramesWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;

  const [meta, setMeta] = React.useState<VideoMetaLite | null>(null);
  const [probeError, setProbeError] = React.useState<string | null>(null);

  const [mode, setMode] = React.useState<Mode>("count");
  const [count, setCount] = React.useState(10);
  const [times, setTimes] = React.useState("");
  const [format, setFormat] = React.useState<"jpeg" | "png">("jpeg");
  const [quality, setQuality] = React.useState(85);
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    let alive = true;
    setMeta(null);
    setProbeError(null);
    if (!source) return;
    void probeVideo(source)
      .then((probe) => {
        probe.dispose();
        if (alive) setMeta(probe.meta);
      })
      .catch((error: unknown) => {
        if (alive) setProbeError(error instanceof Error ? error.message : "This video could not be read.");
      });
    return () => {
      alive = false;
    };
  }, [source]);

  const duration = meta?.duration ?? 0;

  const parsedTimes = React.useMemo(
    () =>
      times
        .split(/[,\s]+/)
        .map((part) => Number(part))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .slice(0, MAX_FRAMES),
    [times],
  );

  const planned =
    mode === "count"
      ? Math.min(MAX_FRAMES, Math.max(1, Math.round(count)))
      : parsedTimes.length;

  const options = React.useMemo<Options>(
    () => ({ mode, count, times, format, quality: quality / 100, scale }),
    [mode, count, times, format, quality, scale],
  );

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const file = batch[0];
      if (!file) throw new Error("Choose a video first.");
      const probe = await probeVideo(file);
      const video = probe.element;
      const length = probe.meta.duration;
      if (!(length > 0)) {
        probe.dispose();
        throw new Error("The browser could not determine this video's length.");
      }

      const targets: number[] =
        current.mode === "count"
          ? Array.from({ length: Math.min(MAX_FRAMES, Math.max(1, Math.round(current.count))) }, (_, index) => {
              const step = length / Math.min(MAX_FRAMES, Math.max(1, Math.round(current.count)));
              return Math.min(Math.max(0, length - 0.02), index * step + step / 2);
            })
          : times
              .split(/[,\s]+/)
              .map((part) => Number(part))
              .filter((value) => Number.isFinite(value) && value >= 0)
              .slice(0, MAX_FRAMES);

      if (targets.length === 0) {
        probe.dispose();
        throw new Error("No valid timestamps were given. Enter numbers in seconds, separated by commas.");
      }

      const outWidth = Math.max(1, Math.round(probe.meta.width * current.scale));
      const outHeight = Math.max(1, Math.round((outWidth * probe.meta.height) / probe.meta.width));
      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;

      const mime = current.format === "png" ? "image/png" : "image/jpeg";
      const ext = current.format === "png" ? "png" : "jpg";
      const stem = baseName(file.name);
      const results: TransformResult[] = [];
      const skipped: number[] = [];

      try {
        for (let index = 0; index < targets.length; index += 1) {
          const time = Math.min(Math.max(0, length - 0.02), targets[index] ?? 0);
          const name = `${stem}-frame-${String(index + 1).padStart(3, "0")}-${time.toFixed(2)}s.${ext}`;
          try {
            await drawVideoFrame(video, time, canvas);
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, mime, current.format === "png" ? undefined : current.quality),
            );
            if (!blob || blob.size === 0) {
              skipped.push(index + 1);
            } else {
              results.push({
                blob,
                filename: name,
                source: file,
                width: outWidth,
                height: outHeight,
                note: `frame at ${time.toFixed(2)}s`,
              });
            }
          } catch {
            skipped.push(index + 1);
          }
          report({
            percent: ((index + 1) / targets.length) * 100,
            done: results.length,
            total: targets.length,
            caption: `Frame ${index + 1} of ${targets.length} at ${time.toFixed(2)}s`,
          });
        }
      } finally {
        video.removeAttribute("src");
        video.load();
        probe.dispose();
      }

      if (results.length === 0) {
        throw new Error("The browser could not decode a frame at any of the requested timestamps.");
      }
      if (skipped.length > 0) {
        toast.warning(
          `${skipped.length} frame(s) skipped`,
          "The browser could not decode those timestamps, usually a sparse keyframe. They are listed as missing rather than replaced.",
        );
      }
      return results;
    },
    [],
  );

  const { results, stage, percent, done, total, error, run, reset, isRunning } = useTransform({ transform, options });

  const urls = useObjectUrlList(results.map((item) => item.blob));
  const totalBytes = results.reduce((sum, item) => sum + item.blob.size, 0);

  const start = React.useCallback(() => {
    if (!source || isRunning) return;
    void run([source]);
  }, [source, run, isRunning]);

  useShortcut(Boolean(source) && !isRunning, start);

  React.useEffect(() => {
    if (stage !== "complete" || results.length === 0 || !source) return;
    recordJob(TOOL, {
      status: "success",
      fileName: source.name,
      fileCount: 1,
      inputBytes: source.size,
      outputBytes: totalBytes,
      outputName: `${results.length} frames`,
    });
  }, [stage, results, source, totalBytes]);

  React.useEffect(() => {
    if (stage !== "idle" || !error || !source) return;
    recordJob(TOOL, { status: "error", fileName: source.name, errorMessage: error });
  }, [stage, error, source]);

  const handleReset = () => {
    clear();
    reset();
  };

  const canRun = Boolean(source && meta && planned > 0 && !isRunning);

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
          emptyTitle="Drop a video to pull frames from."
          emptyDescription="This is instant: it seeks to a timestamp, paints one frame and saves a still."
          dropzoneHint="One video at a time, up to 500 MB. Up to 200 frames per export."
          error={error}
          stage={stage}
          percent={percent}
          done={done}
          total={total}
          onRetry={start}
          renderMeta={() => (meta ? `${meta.width} x ${meta.height} - ${formatDuration(meta.duration)}` : null)}
          controls={
            <div className="flex flex-col gap-4">
              {meta ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Length" value={formatDuration(meta.duration)} />
                  <Stat label="Frames planned" value={String(planned)} tone="brand" />
                  <Stat
                    label="Output size"
                    value={
                      meta.width > 0
                        ? `${Math.round(meta.width * scale)} x ${Math.round((meta.width * scale * meta.height) / meta.width)}`
                        : "-"
                    }
                    hint={format === "png" ? "lossless PNG" : `JPEG quality ${quality}%`}
                  />
                  <Stat
                    label="Cap"
                    value={`${MAX_FRAMES} frames`}
                    hint={planned >= MAX_FRAMES ? "split the job for more" : "plenty of room"}
                  />
                </dl>
              ) : null}

              <Field label="How to pick the frames" hint="Evenly spaced, or exact timestamps you type in.">
                {() => (
                  <Segmented
                    label="Frame selection"
                    value={mode}
                    onChange={(value) => setMode(value as Mode)}
                    options={[
                      { value: "count", label: "Evenly spaced" },
                      { value: "times", label: "Exact timestamps" },
                    ]}
                  />
                )}
              </Field>

              {mode === "count" ? (
                <>
                  <Field
                    label={`Number of frames - ${count}`}
                    hint={`Spread across ${formatDuration(duration)}; the first sits at the midpoint of each interval.`}
                  >
                    {({ id, describedBy }) => (
                      <Slider
                        id={id}
                        aria-describedby={describedBy}
                        min={1}
                        max={MAX_FRAMES}
                        step={1}
                        value={Math.min(MAX_FRAMES, count)}
                        onChange={(event) => setCount(Number(event.target.value))}
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-1.5">
                    {COUNT_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        size="sm"
                        variant={count === preset ? "primary" : "secondary"}
                        onClick={() => setCount(preset)}
                        aria-pressed={count === preset}
                      >
                        {preset}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <Field
                  label="Timestamps in seconds"
                  hint={`Comma or space separated, up to ${MAX_FRAMES}. Example: 0, 2.5, 7, 12.5`}
                  error={times.trim().length > 0 && parsedTimes.length === 0 ? "No valid numbers found." : null}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={times}
                      placeholder="0, 2.5, 7, 12.5"
                      onChange={(event) => setTimes(event.target.value)}
                    />
                  )}
                </Field>
              )}

              <Field label="Image format" hint="PNG is lossless and much larger; JPEG is right for photographs.">
                {() => (
                  <Segmented
                    label="Image format"
                    value={format}
                    onChange={(value) => setFormat(value as "jpeg" | "png")}
                    options={[
                      { value: "jpeg", label: "JPEG" },
                      { value: "png", label: "PNG" },
                    ]}
                  />
                )}
              </Field>

              {format === "jpeg" ? (
                <Field label={`JPEG quality - ${quality}%`} hint="85% is visually close to the source for most footage.">
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={40}
                      max={100}
                      step={1}
                      value={quality}
                      onChange={(event) => setQuality(Number(event.target.value))}
                    />
                  )}
                </Field>
              ) : null}

              <Field
                label={`Output scale - ${Math.round(scale * 100)}%`}
                hint="Shrink to keep the files small. The source frame rate is not involved: each still is one frame."
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
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={!canRun}
              loading={isRunning}
              label="Extract frames"
              icon={<ImagesIcon className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {probeError ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
            {probeError}
          </Notice>
        ) : null}

        {results.length > 0 ? (
          <ResultsPanel title={`${results.length} frame${results.length === 1 ? "" : "s"} captured`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Frames" value={String(results.length)} tone="brand" />
              <Stat label="Total size" value={formatBytes(totalBytes)} />
              <Stat
                label="Dimensions"
                value={`${results[0]?.width ?? 0} x ${results[0]?.height ?? 0}`}
                hint="each frame"
              />
              <Stat
                label="Source"
                value={formatBytes(source?.size ?? 0)}
                hint="not modified"
              />
            </dl>

            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {results.map((item, index) => (
                <li key={item.filename} className="flex flex-col gap-1">
                  <span className="overflow-hidden rounded-lg border border-[var(--surface-line)] bg-black">
                    {urls[index] ? (
                      <img
                        src={urls[index]}
                        alt={item.note ?? `Frame ${index + 1}`}
                        className="aspect-video w-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">{item.note}</span>
                </li>
              ))}
            </ul>

            <DownloadGroup
              items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
              zipName={`${baseName(source?.name ?? "frames")}-frames.zip`}
            />

            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                for (const item of results) downloadBlob(item.blob, item.filename);
                toast.downloadReady(`${results.length} frames`);
              }}
            >
              Save all {results.length} frames at once
            </Button>
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          Each frame lands on the nearest boundary the decoder can present, which is not always the exact millisecond you
          asked for. Nothing is re-encoded, so this finishes in seconds even on a long video.
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

/**
 * Object URLs for a list of blobs, revoked whenever the list changes or the
 * component unmounts. `useObjectUrl` handles one blob; a contact sheet needs
 * one URL per frame.
 */
function useObjectUrlList(blobs: Blob[]): (string | null)[] {
  const [urls, setUrls] = React.useState<(string | null)[]>([]);
  React.useEffect(() => {
    const created = blobs.map((blob) => URL.createObjectURL(blob));
    setUrls(created);
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [blobs]);
  return urls;
}
