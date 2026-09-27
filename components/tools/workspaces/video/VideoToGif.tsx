"use client";

import * as React from "react";
import { FileImage, Info, TriangleAlert } from "lucide-react";
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
import { ImagePreview } from "@/components/tools/FilePreview";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select, Slider, Stat } from "@/components/ui/form";
import { cn } from "@/lib/utils/cn";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  CancelledError,
  captureThumbnails,
  clamp,
  createGifWriter,
  probeVideo,
  seekVideo,
  type Thumbnail,
  type VideoMetaLite,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "video-to-gif",
  category: "video",
  processing: "local",
};

const THUMBNAILS = 16;
/** Hard cap. Past this an animated GIF is painful to share, so we stop and say so. */
const MAX_FRAMES = 800;
const WIDTHS = [120, 240, 320, 480, 640, 800] as const;

const LOOPS = [
  { value: "once", label: "Once" },
  { value: "forever", label: "Forever" },
  { value: "3", label: "3x" },
  { value: "5", label: "5x" },
] as const;

const QUALITY = [
  { value: "high", label: "High" },
  { value: "balanced", label: "Balanced" },
  { value: "small", label: "Small" },
] as const;

interface Options {
  start: number;
  end: number;
  fps: number;
  width: number;
  loop: string;
  colors: number;
  quality: "high" | "balanced" | "small";
}

interface GifStats {
  captured: number;
  skipped: number;
  expected: number;
  capped: boolean;
}

export default function VideoToGifWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;

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

  const [selection, setSelection] = React.useState<{ key: string; start: number; end: number } | null>(null);
  const start = selection?.key === probeKey ? selection.start : 0;
  const end = selection?.key === probeKey ? selection.end : 0;

  const [fps, setFps] = React.useState(12);
  const [width, setWidth] = React.useState(480);
  const [loop, setLoop] = React.useState("forever");
  const [colors, setColors] = React.useState(256);
  const [quality, setQuality] = React.useState<"high" | "balanced" | "small">("balanced");

  const [stats, setStats] = React.useState<GifStats | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const cancelRef = React.useRef(false);

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
        // A GIF is only usable over a short range, so default to the first
        // five seconds rather than the whole file.
        setSelection({ key: probeKey, start: 0, end: Math.min(duration, 5) });
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

  const duration = meta?.duration ?? 0;
  const span = Math.max(0, end - start);
  const height = meta && width > 0 ? Math.max(2, Math.round((width * meta.height) / meta.width / 2) * 2) : 0;
  const expected = span > 0 ? Math.min(MAX_FRAMES, Math.round(span * fps)) : 0;
  const capped = span > 0 && Math.round(span * fps) > MAX_FRAMES;
  // Rough, and labelled as such: LZW on typical video frames lands near 3 bits
  // per pixel. The real size depends entirely on how compressible the content is.
  const sizeEstimate = expected > 0 && height > 0 ? (expected * width * height * 3) / 8 : 0;

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
    () => ({ start, end, fps, width, loop, colors, quality }),
    [start, end, fps, width, loop, colors, quality],
  );

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const file = batch[0];
      if (!file) throw new Error("Choose a video first.");
      if (current.end - current.start < 0.1) {
        throw new Error("The range is too short. Drag the out point further right.");
      }

      const probe = await probeVideo(file);
      const video = probe.element;
      const canvas = document.createElement("canvas");
      const outHeight =
        probe.meta.width > 0 ? Math.max(2, Math.round((current.width * probe.meta.height) / probe.meta.width / 2) * 2) : 0;
      canvas.width = current.width;
      canvas.height = outHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        probe.dispose();
        throw new Error("This browser could not create a 2D canvas context.");
      }

      const repeat = current.loop === "once" ? -1 : current.loop === "forever" ? 0 : Number(current.loop);
      const writer = await createGifWriter({
        width: current.width,
        height: outHeight,
        fps: current.fps,
        repeat,
        colors: current.colors,
        quality: current.quality,
      });

      const wanted = Math.min(MAX_FRAMES, Math.round((current.end - current.start) * current.fps));
      let captured = 0;
      let skipped = 0;
      let hitCap = false;
      const interval = 1000 / Math.max(1, current.fps);

      try {
        // ------------------------------------------------------------------
        // One shared palette, sampled from three frames, so colours do not
        // shift between frames the way they would with a per-frame palette.
        // ------------------------------------------------------------------
        const sample = document.createElement("canvas");
        sample.width = current.width;
        sample.height = outHeight;
        const sampleContext = sample.getContext("2d", { willReadFrequently: true });
        if (sampleContext) {
          const band = outHeight / 3;
          const sampleTimes = [0.2, 0.5, 0.8].map(
            (fraction) => current.start + (current.end - current.start) * fraction,
          );
          for (let index = 0; index < sampleTimes.length; index += 1) {
            await seekVideo(video, sampleTimes[index] ?? current.start);
            sampleContext.drawImage(
              video,
              0,
              Math.round(index * band),
              probe.meta.width,
              Math.max(1, Math.round(band)),
              0,
              Math.round(index * band),
              current.width,
              Math.max(1, Math.round(band)),
            );
          }
          writer.setPalette(sampleContext.getImageData(0, 0, current.width, outHeight).data);
        }

        // ------------------------------------------------------------------
        // Play the range and capture each newly composited frame.
        // ------------------------------------------------------------------
        video.muted = true;
        await seekVideo(video, current.start);
        await video.play().catch(() => {
          throw new Error("The browser refused to play this video, so no frames could be captured.");
        });

        const useFrameCallback = typeof video.requestVideoFrameCallback === "function";
        let lastCapture = -Infinity;
        await new Promise<void>((resolve) => {
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            video.pause();
            resolve();
          };
          const step = () => {
            if (finished) return;
            if (cancelRef.current) {
              finish();
              return;
            }
            const now = performance.now();
            if (now - lastCapture >= interval - 1.5) {
              if (video.readyState < 2 || video.videoWidth === 0) {
                skipped += 1;
              } else {
                lastCapture = now;
                context.drawImage(video, 0, 0, current.width, outHeight);
                writer.addFrame(context.getImageData(0, 0, current.width, outHeight).data);
                captured += 1;
                if (captured >= wanted) hitCap = wanted >= MAX_FRAMES;
                setStats({ captured, skipped, expected: wanted, capped: hitCap });
                report({
                  percent: wanted > 0 ? Math.min(100, (captured / wanted) * 100) : null,
                  done: 0,
                  total: 1,
                  caption: `Captured ${captured} of ${wanted} frames${
                    skipped > 0 ? ` · ${skipped} frames the browser could not supply` : ""
                  }`,
                });
              }
            }
            if (captured >= wanted || video.currentTime >= current.end || video.ended) {
              finish();
              return;
            }
            if (useFrameCallback) video.requestVideoFrameCallback(step);
            else requestAnimationFrame(step);
          };
          step();
        });

        if (cancelRef.current) throw new CancelledError("GIF capture cancelled.");

        const blob = writer.finish();
        setStats({ captured, skipped, expected: wanted, capped: hitCap });
        return [
          {
            blob,
            filename: withExtension(`${file.name.replace(/\.[^.]+$/, "")}-${current.fps}fps`, "gif"),
            source: file,
            width: current.width,
            height: outHeight,
            note: `${captured} frames at ${current.width} x ${outHeight} · ${formatBytes(blob.size)}`,
          },
        ];
      } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        probe.dispose();
      }
    },
    [],
  );

  const { results, stage, percent, error, run, reset, isRunning } = useTransform({ transform, options });

  const result = results[0] ?? null;
  const resultUrl = useObjectUrl(result?.blob ?? null);

  const startExport = React.useCallback(() => {
    if (!source || isRunning) return;
    setCancelled(false);
    setStats(null);
    cancelRef.current = false;
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
    cancelRef.current = true;
    setStats(null);
    setCancelled(false);
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
          emptyTitle="Drop a video to turn into a GIF."
          emptyDescription="Choose a range, a frame rate and a width. You will see the real frame count as it builds."
          dropzoneHint="One video at a time, up to 500 MB. Frames are captured live, so this takes as long as the range."
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
                    <Stat label="GIF length" value={formatDuration(span)} tone="brand" />
                    <Stat
                      label="Frames wanted"
                      value={String(expected)}
                      hint={capped ? `capped at ${MAX_FRAMES}` : `${fps} fps`}
                    />
                    <Stat label="Output size" value={width > 0 ? `${width} x ${height}` : "-"} hint="even height" />
                    <Stat
                      label="Size estimate"
                      value={formatBytes(sizeEstimate)}
                      hint="rough, before encoding"
                    />
                  </dl>

                  <RangeBar
                    duration={duration}
                    start={start}
                    end={end}
                    thumbs={thumbs}
                    disabled={isRunning}
                    onChange={clampRange}
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Start" hint="Seconds into the video.">
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
                    <Field label="End" hint="Keep the range short: it is the single biggest factor in file size.">
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
                </>
              ) : null}

              <Field
                label={`Frame rate - ${fps} fps`}
                hint="Above 20 fps a GIF is usually too large to be worth it. Frames the browser cannot supply are skipped, not duplicated."
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={5}
                    max={30}
                    step={1}
                    value={fps}
                    onChange={(event) => setFps(Number(event.target.value))}
                  />
                )}
              </Field>

              <Field label="Width" hint="Height follows the source aspect ratio, rounded to an even number.">
                {() => (
                  <Segmented
                    label="Width"
                    size="sm"
                    value={String(width)}
                    onChange={(value) => setWidth(Number(value))}
                    options={WIDTHS.map((value) => ({ value: String(value), label: String(value) }))}
                  />
                )}
              </Field>

              <Field label="Loop" hint="GIF stores the repeat count in the file itself.">
                {() => (
                  <Segmented
                    label="Loop"
                    size="sm"
                    value={loop}
                    onChange={setLoop}
                    options={LOOPS.map((item) => ({ value: item.value, label: item.label }))}
                  />
                )}
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Palette size" hint="GIF is limited to 256 colours, so gradients will band.">
                  {({ id }) => (
                    <Select id={id} value={String(colors)} onChange={(event) => setColors(Number(event.target.value))}>
                      <option value="64">64 colours (smallest)</option>
                      <option value="128">128 colours</option>
                      <option value="256">256 colours (best)</option>
                    </Select>
                  )}
                </Field>
                <Field label="Colour quality" hint="High uses 5-6-5 sampling; Small uses 4-4-4 and compresses harder.">
                  {() => (
                    <Segmented
                      label="Colour quality"
                      size="sm"
                      value={quality}
                      onChange={(value) => setQuality(value as "high" | "balanced" | "small")}
                      options={QUALITY.map((item) => ({ value: item.value, label: item.label }))}
                    />
                  )}
                </Field>
              </div>

              {capped ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  {Math.round(span * fps)} frames were requested, which is over the {MAX_FRAMES}-frame cap. The GIF will stop
                  at {MAX_FRAMES} frames. Shorten the range or lower the frame rate to fit it all in.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              onClick={startExport}
              disabled={!source || isRunning || !meta || span < 0.1}
              loading={isRunning}
              label="Create GIF"
              icon={<FileImage className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {isRunning ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] px-3.5 py-3"
          >
            <span aria-hidden="true" className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-brand-500" />
              <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
            </span>
            <p className="text-[13px] font-medium text-[var(--text-ink)]">
              Capturing frames... {stats ? `${stats.captured} of ${stats.expected}` : "starting"}
              {stats && stats.skipped > 0 ? (
                <span className="text-[var(--text-muted)]"> · {stats.skipped} skipped</span>
              ) : null}
            </p>
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setCancelled(true);
                cancelRef.current = true;
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        {cancelled && !isRunning ? (
          <Notice tone="info" icon={<Info className="size-4" />}>
            Capture cancelled, so no GIF was produced.
          </Notice>
        ) : null}

        {probeError ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
            {probeError}
          </Notice>
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

        {result && source ? (
          <ResultsPanel title="Your GIF">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Size" value={formatBytes(result.blob.size)} tone="brand" />
              <Stat label="Dimensions" value={`${result.width} x ${result.height}`} />
              <Stat label="Frames captured" value={String(stats?.captured ?? 0)} hint={`of ${stats?.expected ?? 0} wanted`} />
              <Stat
                label="Frames skipped"
                value={String(stats?.skipped ?? 0)}
                hint={stats?.skipped ? "the browser could not decode them" : "none"}
              />
            </dl>
            {stats?.capped ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                The 800-frame cap was reached, so the GIF stops there rather than running longer.
              </Notice>
            ) : null}
            {stats && stats.captured < stats.expected ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                {stats.expected - stats.captured} requested frame(s) could not be captured. The browser only hands over
                frames it actually decoded, and a high requested rate on a slow machine will not reach it.
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <DownloadButton blob={result.blob} filename={result.filename} label="Download GIF" />
              {resultUrl ? <OpenButton blob={result.blob} filename={result.filename} /> : null}
            </div>
            {resultUrl ? (
              <div className="flex flex-col gap-1.5">
                <ImagePreview src={resultUrl} alt={`Animated GIF ${result.filename}`} checkerboard={false} />
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {result.filename} &middot; {result.note}
                </p>
              </div>
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          The size estimate is a rough guide based on frame count and pixel count. The real file depends on how compressible
          your footage is: flat graphics compress far better than film grain.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Range selector                                                     */
/* ------------------------------------------------------------------ */

function RangeBar({
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

  const timeFrom = React.useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
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
  }, [disabled, end, start, onChange, timeFrom]);

  const onKey = (which: "start" | "end") => (event: React.KeyboardEvent) => {
    if (disabled) return;
    const step = event.shiftKey ? 1 : 0.1;
    let delta = 0;
    if (event.key === "ArrowLeft") delta = -step;
    else if (event.key === "ArrowRight") delta = step;
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
        className="relative h-16 touch-none select-none overflow-hidden rounded-xl border border-[var(--surface-line)] bg-black"
      >
        <div className="absolute inset-0 flex">
          {thumbs.map((thumb, index) => (
            <div key={`${thumb.time}-${index}`} className="h-full flex-1 overflow-hidden">
              {thumb.ok ? (
                // Thumbnails are canvas data URLs; next/image cannot optimise them.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb.src}
                  alt={`Frame at ${thumb.time.toFixed(2)} seconds`}
                  draggable={false}
                  className="size-full object-cover"
                />
              ) : null}
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
        <RangeHandle
          label="GIF start"
          value={start}
          max={duration}
          pct={startPct}
          disabled={disabled}
          onPointerDown={() => {
            dragging.current = "start";
          }}
          onKeyDown={onKey("start")}
        />
        <RangeHandle
          label="GIF end"
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
        <span>{formatDuration(start)}</span>
        <span className="font-mono tabular-nums">{formatDuration(end - start)} selected</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}

function RangeHandle({
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
