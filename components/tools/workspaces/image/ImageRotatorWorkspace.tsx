"use client";

import * as React from "react";
import { Info, RotateCcw, RotateCw } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  loadBitmap,
  mimeLabel,
  outputTypeFor,
  rotate,
  type OutputMime,
} from "@/lib/tools/engines/image";
import { withExtension } from "@/lib/utils/files";
import { formatBytes, percentSaved } from "@/lib/utils/format";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
import { BeforeAfter } from "@/components/tools/BeforeAfter";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Slider } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-rotator",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface RotateOptions {
  degrees: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  type: OutputMime;
  quality: number;
  background: string;
}

const transform: TransformFn<RotateOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Rotating ${file.name}`,
    });

    const encoded = await rotate(file, {
      degrees: options.degrees,
      flipHorizontal: options.flipHorizontal,
      flipVertical: options.flipVertical,
      type: options.type,
      quality: options.type === "image/png" ? undefined : options.quality / 100,
      background: options.type === "image/jpeg" ? options.background : null,
    });

    results.push({
      blob: encoded.blob,
      filename: withExtension(file.name, EXT_FOR_MIME[options.type] ?? "png"),
      source: file,
      width: encoded.width,
      height: encoded.height,
      note: `${options.degrees}°${options.flipHorizontal ? " · mirrored H" : ""}${options.flipVertical ? " · mirrored V" : ""}`,
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

const PREVIEW_BOX = { width: 520, height: 300 };

/** Canvas size for a rotated result — quarter turns swap the dimensions. */
function rotatedSize(width: number, height: number, degrees: number) {
  const normalised = ((degrees % 360) + 360) % 360;
  if (normalised % 90 === 0) {
    return normalised % 180 === 0 ? { width, height } : { width: height, height: width };
  }
  const rad = (normalised * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: Math.max(1, width * cos + height * sin),
    height: Math.max(1, width * sin + height * cos),
  };
}

export default function ImageRotatorWorkspace() {
  const [degrees, setDegrees] = React.useState(90);
  const [flipHorizontal, setFlipHorizontal] = React.useState(false);
  const [flipVertical, setFlipVertical] = React.useState(false);
  const [quality, setQuality] = React.useState(92);
  const [background, setBackground] = React.useState("#ffffff");
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const { files, add, remove, clear } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
  });

  const file = files[0];
  const type: OutputMime = file ? outputTypeFor(file, file.name) : "image/png";
  const sourceLabel = file ? mimeLabel(file.type) : "the source";
  const outputName = type === "image/png" ? "PNG" : type === "image/webp" ? "WebP" : "JPEG";
  const reformat = Boolean(file) && file?.type !== type;

  const options = React.useMemo<RotateOptions>(
    () => ({ degrees, flipHorizontal, flipVertical, type, quality, background }),
    [degrees, flipHorizontal, flipVertical, type, quality, background],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !file) return;
    let active = true;

    void (async () => {
      try {
        const bitmap = await loadBitmap(file);
        if (!active) {
          bitmap.close();
          return;
        }
        const result = rotatedSize(bitmap.width, bitmap.height, degrees);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale =
          Math.min(PREVIEW_BOX.width / result.width, PREVIEW_BOX.height / result.height) * dpr;
        canvas.width = Math.max(1, Math.round(result.width * scale));
        canvas.height = Math.max(1, Math.round(result.height * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser blocked the canvas preview.");
        ctx.filter = "none";
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (type === "image/jpeg") {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
        ctx.drawImage(bitmap, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
        ctx.restore();
        if (active) setPreviewError(null);
        bitmap.close();
      } catch (caught) {
        if (!active) return;
        setPreviewError(
          caught instanceof Error ? caught.message : "The preview could not be rendered.",
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [file, degrees, flipHorizontal, flipVertical, background, type]);

  const step = (amount: number) =>
    setDegrees((current) => {
      const next = (current + amount) % 360;
      return next < 0 ? next + 360 : next;
    });

  const start = React.useCallback(() => {
    if (!file || isRunning) return;
    reported.current = null;
    void run([file]);
  }, [file, isRunning, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
    setPreviewError(null);
    setDegrees(90);
    setFlipHorizontal(false);
    setFlipVertical(false);
  }, [reset, clear]);

  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(TOOL, {
        status: "success",
        fileName: results[0]?.filename,
        inputBytes: file?.size,
        outputBytes: results[0]?.blob.size,
      });
    }
    if (error && reported.current !== error) {
      reported.current = error;
      recordJob(TOOL, {
        status: "error",
        fileName: file?.name,
        inputBytes: file?.size,
        errorMessage: error,
      });
    }
  }, [stage, results, error, file]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [start]);

  const result = results[0];
  const grew = result?.source ? result.blob.size > result.source.size : false;
  const onQuarter = degrees % 90 === 0;

  return (
    <ToolShell>
      <FileStage
        files={files}
        onAdd={add}
        onRemove={remove}
        onClear={clear}
        category="image"
        maxBytes={SITE.limits.image}
        stage={stage}
        percent={percent}
        done={done}
        total={total}
        caption={caption}
        error={error}
        onRetry={start}
        dropzoneLabel="Drop an image here to rotate it"
        dropzoneHint="One image at a time. 90° turns swap the width and height; free angles grow the canvas to the rotated bounding box."
        emptyTitle="Drop your files here to get started."
        emptyDescription="Rotate in 90° steps or by any angle, optionally mirroring in the same pass, with a live preview."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => step(-90)} disabled={!file}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Rotate left 90°
              </Button>
              <Button size="sm" onClick={() => step(90)} disabled={!file}>
                <RotateCw className="size-4" aria-hidden="true" />
                Rotate right 90°
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDegrees(0)} disabled={!file || degrees === 0}>
                Straighten
              </Button>
            </div>

            <Field
              label={`Free angle — ${degrees}°`}
              hint="Rotation is applied first, then the mirror below, in the rotated frame. The angle accumulates from the 90° buttons."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={-180}
                  max={180}
                  step={1}
                  value={degrees}
                  onChange={(event) => setDegrees(Number(event.target.value))}
                />
              )}
            </Field>

            <div className="flex flex-col gap-2.5">
              <Checkbox
                label="Mirror horizontally"
                description="Applied in the rotated frame, so it mirrors the already-rotated picture."
                checked={flipHorizontal}
                onChange={(event) => setFlipHorizontal(event.target.checked)}
              />
              <Checkbox
                label="Mirror vertically"
                description="Use this to turn an upside-down scan the right way up in one pass."
                checked={flipVertical}
                onChange={(event) => setFlipVertical(event.target.checked)}
              />
            </div>

            {type === "image/png" ? (
              <Notice tone="info">
                PNG output is lossless, so there is no quality setting — every pixel is written as it
                is.
              </Notice>
            ) : (
              <Field
                label={`Output quality — ${quality}%`}
                hint="Rotating re-encodes the image. 92 and above keeps the recompression effectively invisible."
              >
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
            )}

            {type === "image/jpeg" ? (
              <Field
                label="Background for the corners left empty"
                hint="A free angle leaves gaps at the corners of the new canvas. JPEG has no alpha channel, so those pixels are filled with this colour."
              >
                {({ id, describedBy }) => (
                  <div className="flex items-center gap-2">
                    <input
                      id={id}
                      type="color"
                      aria-describedby={describedBy}
                      value={background}
                      onChange={(event) => setBackground(event.target.value)}
                      className="h-10 w-16 cursor-pointer rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-1"
                    />
                    <span className="font-mono text-xs uppercase text-[var(--text-muted)]">
                      {background}
                    </span>
                  </div>
                )}
              </Field>
            ) : null}

            {onQuarter ? null : (
              <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
                {degrees}° is not a quarter turn, so the canvas grows to the rotated bounding box and
                the corners have no image data. The background colour fills them for JPEG; PNG and
                WebP keep them transparent.
              </Notice>
            )}

            <p className="text-xs text-[var(--text-muted)]">
              Output format: {outputName}
              {reformat
                ? ` — this browser cannot re-encode ${sourceLabel}, so the result is written as ${outputName}.`
                : ", the same as the source."}
            </p>
          </div>
        }
        action={
          <ProcessButton
            label="Rotate"
            icon={<RotateCw className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {file ? (
        <figure className="mt-5 flex flex-col gap-2">
          <div className="checkerboard flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Live preview of ${file.name} rotated ${degrees} degrees${
                flipHorizontal ? " and mirrored horizontally" : ""
              }${flipVertical ? " and mirrored vertically" : ""}`}
              className="max-h-72 max-w-full"
            />
          </div>
          <figcaption className="text-xs text-[var(--text-muted)]">
            Live preview at preview size. The download is rendered at the full{" "}
            {result ? `${result.width} × ${result.height}px` : "original"} resolution.
          </figcaption>
          {previewError ? <Notice tone="warning">{previewError}</Notice> : null}
        </figure>
      ) : null}

      {result?.source ? (
        <ResultsPanel title="Rotated image" className="mt-6">
          <div className="flex flex-col gap-4">
            <BeforeAfter
              beforeBlob={result.source}
              afterBlob={result.blob}
              beforeBytes={result.source.size}
              afterBytes={result.blob.size}
              afterWidth={result.width}
              afterHeight={result.height}
              beforeLabel="Original"
              afterLabel={`Rotated ${degrees}°`}
            />
            {grew ? (
              <Notice tone="warning">
                The rotated file is{" "}
                {formatBytes(result.blob.size - result.source.size)} larger than the source. Re-encoding
                is the cause, not the rotation — drop the quality to 85 or so and check again.
              </Notice>
            ) : null}
            <DownloadButton
              blob={result.blob}
              filename={result.filename}
              caption={`${result.width} × ${result.height}px · ${formatBytes(result.blob.size)} · ${percentSaved(result.source.size, result.blob.size).toFixed(1)}% smaller`}
            />
          </div>
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
