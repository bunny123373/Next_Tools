"use client";

import * as React from "react";
import { Image as ImageIcon, Info, Sticker, TriangleAlert, Type } from "lucide-react";
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
import { Checkbox, Field, Input, Segmented, Select, Slider, Stat } from "@/components/ui/form";
import { cn } from "@/lib/utils/cn";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { sanitizeFilename, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  VIDEO_FORMATS,
  detectVideoSupport,
  estimateBytes,
  pickVideoMime,
  probeVideo,
  runCanvasRecorder,
  videoFormatById,
  type MediaSupport,
  type TranscodeTick,
  type VideoMetaLite,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "video-watermark",
  category: "video",
  processing: "local",
};

const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const AUDIO_KBPS = 128;
const MARGIN = 0.04;

/** Nine anchor points, laid out as a 3 x 3 grid in normalised frame space. */
const POSITIONS = [
  { id: "top-left", label: "Top left" },
  { id: "top-centre", label: "Top centre" },
  { id: "top-right", label: "Top right" },
  { id: "middle-left", label: "Middle left" },
  { id: "centre", label: "Centre" },
  { id: "middle-right", label: "Middle right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-centre", label: "Bottom centre" },
  { id: "bottom-right", label: "Bottom right" },
] as const;

type PositionId = (typeof POSITIONS)[number]["id"];

const GRID: Record<PositionId, { x: number; y: number }> = {
  "top-left": { x: 0, y: 0 },
  "top-centre": { x: 0.5, y: 0 },
  "top-right": { x: 1, y: 0 },
  "middle-left": { x: 0, y: 0.5 },
  centre: { x: 0.5, y: 0.5 },
  "middle-right": { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 1 },
  "bottom-centre": { x: 0.5, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

interface Options {
  kind: "text" | "image";
  text: string;
  colour: string;
  outline: boolean;
  position: PositionId;
  sizePercent: number;
  opacity: number;
  offsetX: number;
  offsetY: number;
  tiled: boolean;
  logo: File | null;
  formatId: string;
  fps: number;
  keepAudio: boolean;
}

export default function VideoWatermarkWorkspace() {
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
  const probeError = probe.key === probeKey ? probe.error : null;

  const [kind, setKind] = React.useState<"text" | "image">("text");
  const [text, setText] = React.useState("Balu Tools");
  const [colour, setColour] = React.useState("#ffffff");
  const [outline, setOutline] = React.useState(true);
  const [position, setPosition] = React.useState<PositionId>("bottom-right");
  const [sizePercent, setSizePercent] = React.useState(8);
  const [opacity, setOpacity] = React.useState(70);
  const [offsetX, setOffsetX] = React.useState(0);
  const [offsetY, setOffsetY] = React.useState(0);
  const [tiled, setTiled] = React.useState(false);
  const [logo, setLogo] = React.useState<File | null>(null);
  const [logoError, setLogoError] = React.useState<string | null>(null);
  const [logoState, setLogoState] = React.useState<{ file: File | null; bitmap: ImageBitmap | null }>({
    file: null,
    bitmap: null,
  });
  const logoBitmap = logoState.file === logo ? logoState.bitmap : null;
  const logoInputRef = React.useRef<HTMLInputElement | null>(null);

  const [formatId, setFormatId] = React.useState("webm-vp9");
  const [fps, setFps] = React.useState(30);
  const [keepAudio, setKeepAudio] = React.useState(true);

  const [tick, setTick] = React.useState<TranscodeTick | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const [noAudio, setNoAudio] = React.useState(false);
  const recorderRef = React.useRef<{ cancel: (reason?: string) => void } | null>(null);
  const previewRef = React.useRef<HTMLCanvasElement | null>(null);

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
    void probeVideo(source)
      .then((result) => {
        result.dispose();
        if (alive) setProbe({ key: probeKey, meta: result.meta, error: null });
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

  // Decode the logo once; bitmaps are cheap to reuse across every frame. A
  // replacement file supersedes the previous bitmap by identity, so no reset
  // pass through an effect is needed.
  React.useEffect(() => {
    if (!logo) return;
    let alive = true;
    void createImageBitmap(logo)
      .then((bitmap) => {
        if (alive) setLogoState({ file: logo, bitmap });
        else bitmap.close();
      })
      .catch(() => {
        if (alive) setLogoError("That image could not be decoded. PNG and JPEG logos work best.");
      });
    return () => {
      alive = false;
    };
  }, [logo]);

  React.useEffect(
    () => () => {
      logoState.bitmap?.close();
    },
    [logoState.bitmap],
  );

  const picked = React.useMemo(
    () => (support ? pickVideoMime(videoFormatById(formatId).mime, support) : null),
    [support, formatId],
  );

  const estimate = meta ? estimateBytes(3000, keepAudio ? AUDIO_KBPS : 0, meta.duration) : 0;

  const options = React.useMemo<Options>(
    () => ({
      kind,
      text,
      colour,
      outline,
      position,
      sizePercent,
      opacity,
      offsetX,
      offsetY,
      tiled,
      logo,
      formatId,
      fps,
      keepAudio,
    }),
    [kind, text, colour, outline, position, sizePercent, opacity, offsetX, offsetY, tiled, logo, formatId, fps, keepAudio],
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
      if (current.kind === "text" && current.text.trim().length === 0) {
        throw new Error("Type some watermark text first.");
      }
      if (current.kind === "image" && !logoBitmap) {
        throw new Error("Choose a logo image, or switch back to text.");
      }
      const probed: VideoMetaLite = meta ?? (await probeVideo(file).then((probe) => {
        const value = probe.meta;
        probe.dispose();
        return value;
      }));
      if (probed.width < 2 || probed.height < 2) {
        throw new Error("This video reports no picture dimensions, so it cannot be re-encoded.");
      }

      const draw = buildOverlayPainter({
        kind: current.kind,
        text: current.text,
        colour: current.colour,
        outline: current.outline,
        position: current.position,
        sizePercent: current.sizePercent,
        opacity: current.opacity,
        offsetX: current.offsetX,
        offsetY: current.offsetY,
        tiled: current.tiled,
        bitmap: current.kind === "image" ? logoBitmap : null,
      });

      const run = runCanvasRecorder({
        file,
        mime: picked.mime,
        width: probed.width,
        height: probed.height,
        fps: current.fps,
        videoKbps: 3000,
        audioKbps: current.keepAudio ? AUDIO_KBPS : 0,
        includeAudio: current.keepAudio,
        overlay: draw,
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
            filename: withExtension(`${file.name.replace(/\.[^.]+$/, "")}-watermarked`, picked.format.ext),
            source: file,
            width: outcome.width,
            height: outcome.height,
            note: `${formatDuration(outcome.duration)} · watermark burned in`,
          },
        ];
      } finally {
        recorderRef.current = null;
      }
    },
    [support, picked, meta, logoBitmap],
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

  // Live preview of the composited watermark over the first frame.
  React.useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !meta || !sourceUrl) return;
    const video = document.createElement("video");
    video.src = sourceUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let alive = true;

    const paint = () => {
      if (!alive || video.readyState < 2) return;
      const width = video.videoWidth || meta.width;
      const height = video.videoHeight || meta.height;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      buildOverlayPainter({
        kind,
        text,
        colour,
        outline,
        position,
        sizePercent,
        opacity,
        offsetX,
        offsetY,
        tiled,
        bitmap: kind === "image" ? logoBitmap : null,
      })(context, { width: canvas.width, height: canvas.height });
    };

    const onSeek = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 4);
    };
    video.addEventListener("loadeddata", paint);
    video.addEventListener("seeked", paint);
    video.src = sourceUrl;
    onSeek();
    return () => {
      alive = false;
      video.removeEventListener("loadeddata", paint);
      video.removeEventListener("seeked", paint);
      video.removeAttribute("src");
      video.load();
    };
  }, [sourceUrl, meta, kind, text, colour, outline, position, sizePercent, opacity, offsetX, offsetY, tiled, logoBitmap]);

  const handleReset = () => {
    recorderRef.current?.cancel("Reset.");
    recorderRef.current = null;
    setTick(null);
    setCancelled(false);
    setNoAudio(false);
    setLogo(null);
    setLogoState({ file: null, bitmap: null });
    setLogoError(null);
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
          emptyTitle="Drop a video to watermark it."
          emptyDescription="Add text or your own logo. It is burned into the pixels, so it cannot be removed afterwards."
          dropzoneHint="One video at a time, up to 500 MB. Watermarking records in real time."
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
                  <Stat label="Size estimate" value={formatBytes(estimate)} hint="at 3000 kbps" />
                  <Stat label="Export time" value={formatDuration(meta.duration)} hint="records in real time" />
                </dl>
              ) : null}

              <Field label="Watermark type" hint="Text is simplest; an image gives you your own logo.">
                {() => (
                  <Segmented
                    label="Watermark type"
                    value={kind}
                    onChange={(value) => setKind(value as "text" | "image")}
                    options={[
                      { value: "text", label: "Text", icon: <Type className="size-3.5" aria-hidden="true" /> },
                      { value: "image", label: "Image", icon: <ImageIcon className="size-3.5" aria-hidden="true" /> },
                    ]}
                  />
                )}
              </Field>

              {kind === "text" ? (
                <>
                  <Field label="Text" hint="Keep it short: long text at small sizes turns to mush once encoded.">
                    {({ id }) => (
                      <Input
                        id={id}
                        value={text}
                        maxLength={80}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="Your name or studio"
                      />
                    )}
                  </Field>
                  <Field label="Colour" hint="A contrasting outline keeps light text readable over bright footage.">
                    {({ id }) => (
                      <div className="flex items-center gap-2">
                        <input
                          id={id}
                          type="color"
                          value={colour}
                          onChange={(event) => setColour(event.target.value)}
                          className="h-10 w-14 cursor-pointer rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-1"
                        />
                        <span className="font-mono text-xs text-[var(--text-muted)]">{colour}</span>
                      </div>
                    )}
                  </Field>
                  <Checkbox
                    label="Draw a contrasting outline"
                    description="Thick dark stroke behind the letters, so the text survives any background."
                    checked={outline}
                    onChange={(event) => setOutline(event.target.checked)}
                  />
                </>
              ) : (
                <Field
                  label="Logo image"
                  hint="PNG with transparency composites correctly. Keep it under 2 MB."
                  error={logoError}
                >
                  {({ id, describedBy }) => (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id={id}
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        aria-describedby={describedBy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (!file) return;
                          if (file.size > 8 * 1024 * 1024) {
                            setLogoError("That logo is over 8 MB. Please use a smaller file.");
                            return;
                          }
                          setLogoError(null);
                          setLogo(file);
                        }}
                      />
                      <Button size="sm" variant="secondary" onClick={() => logoInputRef.current?.click()}>
                        {logo ? "Replace logo" : "Choose logo"}
                      </Button>
                      {logo ? (
                        <span className="truncate text-xs text-[var(--text-muted)]">
                          {sanitizeFilename(logo.name)} · {formatBytes(logo.size)}
                        </span>
                      ) : null}
                      {logo ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setLogo(null);
                            setLogoState({ file: null, bitmap: null });
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  )}
                </Field>
              )}

              <Field label="Position" hint="Nine anchor points, plus an offset nudge in either direction.">
                {() => (
                  <div
                    role="radiogroup"
                    aria-label="Watermark position"
                    className="grid w-fit grid-cols-3 gap-1.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-1.5"
                  >
                    {POSITIONS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={position === item.id}
                        onClick={() => setPosition(item.id)}
                        className={cn(
                          "grid size-11 place-items-center rounded-lg transition-colors duration-150",
                          position === item.id
                            ? "bg-brand-500 text-white"
                            : "text-[var(--text-muted)] hover:bg-[var(--surface-line)] hover:text-[var(--text-ink)]",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="size-3 rounded-sm border-2 border-current"
                        />
                        <span className="sr-only">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              <Field
                label={`Size - ${sizePercent}% of frame height`}
                hint="A percentage, so the same settings look the same on 720p and 4K."
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={2}
                    max={40}
                    step={1}
                    value={sizePercent}
                    onChange={(event) => setSizePercent(Number(event.target.value))}
                  />
                )}
              </Field>

              <Field label={`Opacity - ${opacity}%`} hint="Below about 40% is hard to read on busy footage.">
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={5}
                    max={100}
                    step={5}
                    value={opacity}
                    onChange={(event) => setOpacity(Number(event.target.value))}
                  />
                )}
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nudge left / right" hint="Moves the anchor horizontally, as a percentage of frame width.">
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={-20}
                      max={20}
                      step={1}
                      value={offsetX}
                      onChange={(event) => setOffsetX(Number(event.target.value))}
                    />
                  )}
                </Field>
                <Field label="Nudge up / down" hint="Moves the anchor vertically, as a percentage of frame height.">
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={-20}
                      max={20}
                      step={1}
                      value={offsetY}
                      onChange={(event) => setOffsetY(Number(event.target.value))}
                    />
                  )}
                </Field>
              </div>

              <Checkbox
                label="Tile diagonally across the frame"
                description="Repeats the watermark on a 45-degree grid, which is much harder to crop around."
                checked={tiled}
                onChange={(event) => setTiled(event.target.checked)}
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
              label="Apply watermark"
              icon={<Sticker className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {sourceUrl && meta ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-ink)]">Live preview</h3>
            <canvas
              ref={previewRef}
              className="max-h-[24rem] w-full rounded-xl border border-[var(--surface-line)] bg-black object-contain"
              aria-label="Preview of the watermarked first frame"
              role="img"
            />
            <p className="text-xs text-[var(--text-muted)]">
              This is the first frame with the watermark composited at full size. The export applies the same overlay to
              every frame.
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
          <ResultsPanel title="Watermarked video">
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

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Overlay painter                                                    */
/* ------------------------------------------------------------------ */

interface OverlaySpec {
  kind: "text" | "image";
  text: string;
  colour: string;
  outline: boolean;
  position: PositionId;
  sizePercent: number;
  opacity: number;
  offsetX: number;
  offsetY: number;
  tiled: boolean;
  bitmap: ImageBitmap | null;
}

/**
 * Build the function that paints the watermark onto a frame. Returned as a
 * closure so the recorder can call it once per frame with no allocation.
 */
function buildOverlayPainter(
  spec: OverlaySpec,
): (context: CanvasRenderingContext2D, frame: { width: number; height: number }) => void {
  const anchor = GRID[spec.position];

  return (context, frame) => {
    const targetHeight = Math.max(8, (spec.sizePercent / 100) * frame.height);
    context.save();
    context.globalAlpha = Math.min(1, Math.max(0, spec.opacity / 100));

    if (spec.tiled) {
      const step = Math.max(targetHeight * 2.4, 24);
      context.translate(frame.width / 2, frame.height / 2);
      context.rotate(-Math.PI / 4);
      const reach = Math.hypot(frame.width, frame.height);
      for (let y = -reach; y <= reach; y += step) {
        for (let x = -reach; x <= reach; x += step) {
          paintOnce(context, spec, x, y, targetHeight);
        }
      }
    } else {
      const centreX = (anchor.x + spec.offsetX / 100) * frame.width;
      const centreY = (anchor.y + spec.offsetY / 100) * frame.height;
      paintOnce(context, spec, centreX, centreY, targetHeight);
    }

    context.restore();
  };
}

function paintOnce(
  context: CanvasRenderingContext2D,
  spec: OverlaySpec,
  centreX: number,
  centreY: number,
  targetHeight: number,
): void {
  const marginX = targetHeight * MARGIN;
  const marginY = targetHeight * MARGIN;

  if (spec.kind === "image") {
    if (!spec.bitmap) return;
    const ratio = spec.bitmap.width / spec.bitmap.height;
    const width = targetHeight * ratio;
    context.drawImage(
      spec.bitmap,
      centreX - width / 2,
      centreY - targetHeight / 2,
      width,
      targetHeight,
    );
    return;
  }

  const value = spec.text.trim();
  if (!value) return;
  const fontSize = targetHeight;
  context.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (spec.outline) {
    context.lineWidth = Math.max(2, fontSize * 0.14);
    context.strokeStyle = "rgba(0, 0, 0, 0.75)";
    context.lineJoin = "round";
    context.strokeText(value, centreX, centreY, Math.max(40, fontSize * 24 - marginX * 2));
  }
  context.fillStyle = spec.colour;
  context.fillText(value, centreX, centreY, Math.max(40, fontSize * 24 - marginX * 2));
  void marginY;
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
