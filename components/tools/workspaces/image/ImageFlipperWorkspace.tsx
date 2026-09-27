"use client";

import * as React from "react";
import { FlipHorizontal } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  loadBitmap,
  mimeLabel,
  outputTypeFor,
  flip,
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
import { Field, Segmented, Slider } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-flipper",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type Direction = "horizontal" | "vertical" | "both";

interface FlipOptions {
  direction: Direction;
  type: OutputMime;
  quality: number;
}

function axesFor(direction: Direction) {
  return {
    horizontal: direction === "horizontal" || direction === "both",
    vertical: direction === "vertical" || direction === "both",
  };
}

const transform: TransformFn<FlipOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];
  const axes = axesFor(options.direction);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Flipping ${file.name}`,
    });

    const encoded = await flip(file, {
      horizontal: axes.horizontal,
      vertical: axes.vertical,
      type: options.type,
      quality: options.type === "image/png" ? undefined : options.quality / 100,
      background: options.type === "image/jpeg" ? "#ffffff" : null,
    });

    results.push({
      blob: encoded.blob,
      filename: withExtension(file.name, EXT_FOR_MIME[options.type] ?? "png"),
      source: file,
      width: encoded.width,
      height: encoded.height,
      note: axes.vertical && axes.horizontal ? "mirrored on both axes" : axes.horizontal ? "mirrored left to right" : "mirrored top to bottom",
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

/** The preview box the live canvas is fitted into, in CSS pixels. */
const PREVIEW_BOX = { width: 520, height: 300 };

export default function ImageFlipperWorkspace() {
  const [direction, setDirection] = React.useState<Direction>("horizontal");
  const [quality, setQuality] = React.useState(92);
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
  const axes = axesFor(direction);

  const options = React.useMemo<FlipOptions>(() => ({ direction, type, quality }), [direction, type, quality]);

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  // Live preview. The mirror is drawn through the same matrix the export uses,
  // so what you see is what the encoder will write.
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

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser blocked the canvas preview.");
        ctx.filter = "none";
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (type === "image/jpeg") {
          // JPEG has no alpha channel; white matches what the export fills with.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(axes.horizontal ? -1 : 1, axes.vertical ? -1 : 1);
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
  }, [file, axes.horizontal, axes.vertical, type]);

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
        fileCount: results.length,
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
        dropzoneLabel="Drop an image here to flip it"
        dropzoneHint="One image at a time. The preview below updates as you change direction."
        emptyTitle="Drop your files here to get started."
        emptyDescription="Mirror an image left to right, top to bottom, or both — with a live preview before you save."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Direction</span>
              <Segmented<Direction>
                label="Flip direction"
                value={direction}
                onChange={setDirection}
                options={[
                  { value: "horizontal", label: "Horizontal" },
                  { value: "vertical", label: "Vertical" },
                  { value: "both", label: "Both" },
                ]}
              />
              <p className="text-xs text-[var(--text-muted)]">
                {direction === "horizontal"
                  ? "Mirrors left to right — the fix for a selfie shot the wrong way round."
                  : direction === "vertical"
                    ? "Mirrors top to bottom — for a scan that came out the wrong way up."
                    : "Mirrors on both axes, which is the same as a 180° rotation."}
              </p>
            </div>

            {type === "image/png" ? (
              <Notice tone="info">
                PNG output is lossless, so there is no quality setting — every pixel is written as it
                is.
              </Notice>
            ) : (
              <Field
                label={`Output quality — ${quality}%`}
                hint="Flipping re-encodes the image. 92 and above keeps the recompression effectively invisible."
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
            label="Flip"
            icon={<FlipHorizontal className="size-4" aria-hidden="true" />}
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
              aria-label={`Live preview of ${file.name} flipped ${
                direction === "both" ? "horizontally and vertically" : direction
              }`}
              className="max-h-72 max-w-full"
            />
          </div>
          <figcaption className="text-xs text-[var(--text-muted)]">
            Live preview, drawn with the same transform the export uses — at preview size rather
            than full resolution.
          </figcaption>
          {previewError ? (
            <Notice tone="warning">{previewError}</Notice>
          ) : null}
        </figure>
      ) : null}

      {result?.source ? (
        <ResultsPanel title="Flipped image" className="mt-6">
          <div className="flex flex-col gap-4">
            <BeforeAfter
              beforeBlob={result.source}
              afterBlob={result.blob}
              beforeBytes={result.source.size}
              afterBytes={result.blob.size}
              afterWidth={result.width}
              afterHeight={result.height}
              beforeLabel="Original"
              afterLabel="Flipped"
            />
            {grew ? (
              <Notice tone="warning">
                The flipped file is {formatBytes(result.blob.size - result.source.size)} larger than
                the source. That is a real difference in re-encoding, not a bug — lower the quality
                if size matters more than the last few percent of fidelity.
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
