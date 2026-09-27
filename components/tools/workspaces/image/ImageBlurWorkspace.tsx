"use client";

import * as React from "react";
import { TriangleAlert, Wand2 } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  blur,
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
import { Notice, ToolError } from "@/components/tools/states";
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
  id: "image-blur",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface BlurOptions {
  radius: number;
  type: OutputMime;
  quality: number;
  background: string;
}

const transform: TransformFn<BlurOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Blurring ${file.name}`,
    });

    const encoded = await blur(file, {
      radius: options.radius,
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
      note: `${options.radius}px radius`,
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

export default function ImageBlurWorkspace() {
  const [radius, setRadius] = React.useState(10);
  const [quality, setQuality] = React.useState(92);
  const [background, setBackground] = React.useState("#ffffff");
  const [supported, setSupported] = React.useState<boolean | null>(null);
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
  const canBlur = supported ?? true;

  const options = React.useMemo<BlurOptions>(
    () => ({ radius, type, quality, background }),
    [radius, type, quality, background],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  // Feature detection runs on the client because it needs a real canvas. Until
  // it resolves we assume support so the UI is not blocked for a frame.
  React.useEffect(() => {
    setSupported(supportsCanvasFilter());
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !file || !canBlur) return;
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
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (type === "image/jpeg") {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // The radius is in source pixels, so it scales with the preview for the
        // two to look the same.
        const previewRadius = radius * (canvas.width / bitmap.width);
        ctx.filter = `blur(${Math.max(0, previewRadius)}px)`;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        ctx.filter = "none";
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
  }, [file, radius, canBlur, background, type]);

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

  return (
    <ToolShell>
      {supported === false ? (
        <ToolError
          className="mb-5"
          title="This browser cannot render a real blur."
          detail="The CanvasRenderingContext2D.filter property is not implemented here, and a blur cannot be faked honestly with a different effect."
        >
          <p className="max-w-lg text-[13px] text-[var(--text-muted)]">
            Chrome, Firefox, Edge and Safari 18 and newer all support it. If you are on one of
            those, reload the page — a cached older build of the browser is the usual cause. In the
            meantime, the Image Pixelate tool produces a similarly non-reversible effect.
          </p>
        </ToolError>
      ) : null}

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
        dropzoneLabel="Drop an image here to blur it"
        dropzoneHint="One image at a time. The radius is in pixels of the source image, so it means the same thing on a phone photo and a thumbnail."
        emptyTitle="Drop your files here to get started."
        emptyDescription="A true Gaussian blur through the canvas filter, with a live preview and an honest fallback message where filters are unavailable."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <Field
              label={`Blur radius — ${radius}px`}
              hint="10–20px is enough for a background behind text. 30px and up fully obscures detail. The image keeps its original dimensions."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={0}
                  max={40}
                  step={1}
                  value={radius}
                  onChange={(event) => setRadius(Number(event.target.value))}
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
                hint="Blurring re-encodes the image, and a blurred image compresses extremely well — this is often a big saving on its own."
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
                label="Background the blur fades into"
                hint="A canvas filter samples outside the shape it applies to. This colour fills the border so the edge does not fade to black."
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
            label="Blur"
            icon={<Wand2 className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file || !canBlur}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {file && canBlur ? (
        <figure className="mt-5 flex flex-col gap-2">
          <div className="checkerboard flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Live preview of ${file.name} with a ${radius} pixel blur`}
              className="max-h-72 max-w-full"
            />
          </div>
          <figcaption className="text-xs text-[var(--text-muted)]">
            Live preview, using the same canvas filter the export uses. The radius is scaled to the
            preview so the two look the same; the download is at full resolution.
          </figcaption>
        </figure>
      ) : null}

      {result?.source ? (
        <ResultsPanel title="Blurred image" className="mt-6">
          <div className="flex flex-col gap-4">
            <BeforeAfter
              beforeBlob={result.source}
              afterBlob={result.blob}
              beforeBytes={result.source.size}
              afterBytes={result.blob.size}
              afterWidth={result.width}
              afterHeight={result.height}
              beforeLabel="Original"
              afterLabel={`Blurred ${radius}px`}
            />
            {grew ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                The blurred file is larger than the source. That is unusual — a blurred image usually
                compresses far better — so the quality setting is probably too high for this
                content.
              </Notice>
            ) : (
              <Notice tone="success">
                Blurring alone took {formatBytes(result.source.size - result.blob.size)} off the file
                size at {radius}px.
              </Notice>
            )}
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
