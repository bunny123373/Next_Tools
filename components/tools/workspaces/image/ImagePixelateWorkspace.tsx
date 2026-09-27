"use client";

import * as React from "react";
import { LayoutGrid, TriangleAlert } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  loadBitmap,
  mimeLabel,
  outputTypeFor,
  pixelate,
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
import { Field, Slider } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-pixelate",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface PixelateOptions {
  block: number;
  type: OutputMime;
  quality: number;
  background: string;
}

const transform: TransformFn<PixelateOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Pixelating ${file.name}`,
    });

    const encoded = await pixelate(file, {
      pixelSize: options.block,
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
      note: `${options.block}px blocks · ${Math.max(1, Math.round(encoded.width / options.block))} × ${Math.max(1, Math.round(encoded.height / options.block))} grid`,
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

export default function ImagePixelateWorkspace() {
  const [block, setBlock] = React.useState(14);
  const [quality, setQuality] = React.useState(90);
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

  const options = React.useMemo<PixelateOptions>(
    () => ({ block, type, quality, background }),
    [block, type, quality, background],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  // The preview runs the same two steps as the export: downscale to a coarse
  // grid, then upscale with smoothing off so the browser draws hard squares.
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
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale =
          Math.min(PREVIEW_BOX.width / bitmap.width, PREVIEW_BOX.height / bitmap.height) * dpr;
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));

        const small = document.createElement("canvas");
        // The block size is in source pixels, so it scales with the preview.
        const previewBlock = Math.max(2, block * scale);
        small.width = Math.max(1, Math.round(bitmap.width / previewBlock));
        small.height = Math.max(1, Math.round(bitmap.height / previewBlock));
        const smallCtx = small.getContext("2d");
        if (!smallCtx) throw new Error("This browser blocked the canvas preview.");
        smallCtx.imageSmoothingEnabled = true;
        smallCtx.imageSmoothingQuality = "high";
        if (type === "image/jpeg") {
          smallCtx.fillStyle = background;
          smallCtx.fillRect(0, 0, small.width, small.height);
        }
        smallCtx.drawImage(bitmap, 0, 0, small.width, small.height);

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser blocked the canvas preview.");
        if (type === "image/jpeg") {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, width, height);
        } else {
          ctx.clearRect(0, 0, width, height);
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, width, height);
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
  }, [file, block, background, type]);

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
  const resultWidth = result?.width ?? 0;
  const resultHeight = result?.height ?? 0;
  const gridWidth = resultWidth > 0 ? Math.max(1, Math.round(resultWidth / block)) : 0;
  const gridHeight = resultHeight > 0 ? Math.max(1, Math.round(resultHeight / block)) : 0;

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
        dropzoneLabel="Drop an image here to pixelate it"
        dropzoneHint="One image at a time. The output keeps the source's pixel dimensions, so it drops straight back into a layout."
        emptyTitle="Drop your files here to get started."
        emptyDescription="A real mosaic: the image is downscaled to a grid of large blocks and scaled back up with smoothing off, so the detail is genuinely gone."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <Field
              label={`Block size — ${block}px`}
              hint="The size of one square in pixels of the source image. Small values look like a mosaic; 40–80px on a small image gives you pixel art."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={2}
                  max={120}
                  step={1}
                  value={block}
                  onChange={(event) => setBlock(Number(event.target.value))}
                />
              )}
            </Field>

            {type === "image/png" ? (
              <Notice tone="info">
                PNG output is lossless, so there is no quality setting — every pixel is written as it
                is.
              </Notice>
            ) : (
              <Field
                label={`Output quality — ${quality}%`}
                hint="Large flat blocks compress extremely well, so this is usually a big saving regardless of the setting."
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
                label="Background for transparent areas"
                hint="JPEG has no alpha channel, so transparent pixels are filled with this colour."
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

            {previewError ? <Notice tone="warning">{previewError}</Notice> : null}

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
            label="Pixelate"
            icon={<LayoutGrid className="size-4" aria-hidden="true" />}
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
              aria-label={`Live preview of ${file.name} pixelated into ${block} pixel blocks`}
              className="max-h-72 max-w-full"
            />
          </div>
          <figcaption className="text-xs text-[var(--text-muted)]">
            Live preview at preview size, with the block size scaled to match. Zoom the downloaded
            file and you can count the squares — the detail really is gone.
          </figcaption>
        </figure>
      ) : null}

      {result?.source ? (
        <ResultsPanel title="Pixelated image" className="mt-6">
          <div className="flex flex-col gap-4">
            <BeforeAfter
              beforeBlob={result.source}
              afterBlob={result.blob}
              beforeBytes={result.source.size}
              afterBytes={result.blob.size}
              afterWidth={result.width}
              afterHeight={result.height}
              beforeLabel="Original"
              afterLabel={`${block}px blocks`}
            />
            <p className="text-xs text-[var(--text-muted)]">
              The {resultWidth} × {resultHeight}px image is now a{" "}
              <span className="font-mono tabular-nums text-[var(--text-ink)]">
                {gridWidth} × {gridHeight}
              </span>{" "}
              grid of {block}px squares, each one a single averaged colour.
            </p>
            {grew ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                The result is {formatBytes(result.blob.size - result.source.size)} larger than the
                source. Fine-grained blocks at high quality can do that — raise the block size or drop
                the quality.
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
