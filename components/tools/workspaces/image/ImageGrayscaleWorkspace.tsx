"use client";

import * as React from "react";
import { Contrast, Info } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  grayscale,
  loadBitmap,
  mimeLabel,
  outputTypeFor,
  supportsCanvasFilter,
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
  id: "image-grayscale",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface GrayscaleOptions {
  amount: number;
  type: OutputMime;
  quality: number;
  background: string;
}

const transform: TransformFn<GrayscaleOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Converting ${file.name}`,
    });

    const encoded = await grayscale(file, {
      amount: options.amount,
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
      note: `${options.amount}% desaturated`,
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

/** Rec. 601 luma — the same weighting the CSS grayscale() filter uses. */
function blendToGray(data: Uint8ClampedArray, amount: number) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] += (luma - data[i]) * amount;
    data[i + 1] += (luma - data[i + 1]) * amount;
    data[i + 2] += (luma - data[i + 2]) * amount;
  }
}

export default function ImageGrayscaleWorkspace() {
  const [amount, setAmount] = React.useState(100);
  const [quality, setQuality] = React.useState(92);
  const [background, setBackground] = React.useState("#ffffff");
  const [filterSupported, setFilterSupported] = React.useState<boolean | null>(null);
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

  const options = React.useMemo<GrayscaleOptions>(
    () => ({ amount, type, quality, background }),
    [amount, type, quality, background],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  React.useEffect(() => {
    setFilterSupported(supportsCanvasFilter());
  }, []);

  // The preview mirrors the export's two paths: the native filter where it
  // exists, and the same per-pixel blend where it does not.
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
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
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

        if (amount > 0) {
          if (filterSupported) {
            ctx.filter = `grayscale(${amount}%)`;
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            ctx.filter = "none";
          } else {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            blendToGray(pixels.data, amount / 100);
            ctx.putImageData(pixels, 0, 0);
          }
        } else {
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        }
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
  }, [file, amount, filterSupported, background, type]);

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
    setAmount(100);
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
        dropzoneLabel="Drop an image here to desaturate it"
        dropzoneHint="One image at a time. Dimensions are unchanged — every pixel is blended toward its own grey value."
        emptyTitle="Drop your files here to get started."
        emptyDescription="Not just a black and white switch: a real 0–100% strength control, with a live preview."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <Field
              label={`Grayscale strength — ${amount}%`}
              hint="0% leaves the image untouched. 100% is fully monochrome. In between you get a desaturated look that keeps a hint of colour."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={0}
                  max={100}
                  step={1}
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value))}
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
                hint="Expect little size change: JPEG and WebP encoders do not save much by dropping chroma."
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

            <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
              {filterSupported
                ? "This browser implements canvas filters, so the conversion uses grayscale(N%) directly — fast and exact."
                : "This browser has no canvas filter support, so each pixel is blended toward its Rec. 601 luma value instead. Same result, slower — which is why you are not getting a fake effect with a different look."}
            </Notice>

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
            label="Convert to grayscale"
            icon={<Contrast className="size-4" aria-hidden="true" />}
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
              aria-label={`Live preview of ${file.name} at ${amount} percent grayscale`}
              className="max-h-72 max-w-full"
            />
          </div>
          <figcaption className="text-xs text-[var(--text-muted)]">
            Live preview at preview size. Grey value is 0.299·R + 0.587·G + 0.114·B, the same
            weighting the CSS filter uses.
          </figcaption>
        </figure>
      ) : null}

      {result?.source ? (
        <ResultsPanel title="Grayscale image" className="mt-6">
          <div className="flex flex-col gap-4">
            <BeforeAfter
              beforeBlob={result.source}
              afterBlob={result.blob}
              beforeBytes={result.source.size}
              afterBytes={result.blob.size}
              afterWidth={result.width}
              afterHeight={result.height}
              beforeLabel="Original"
              afterLabel={`${amount}% gray`}
            />
            {grew ? (
              <Notice tone="warning">
                The grayscale file is {formatBytes(result.blob.size - result.source.size)} larger
                than the source. Dropping colour barely changes a lossy file's size — use the Image
                Compressor if you need it smaller.
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
