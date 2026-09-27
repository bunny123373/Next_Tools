"use client";

import * as React from "react";
import { Ruler, TriangleAlert } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import { outputTypeFor, readImageSize, reencode, type OutputMime } from "@/lib/tools/engines/image";
import { withExtension } from "@/lib/utils/files";
import { formatBytes, percentSaved } from "@/lib/utils/format";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
import { BeforeAfter, SizeComparisonStats } from "@/components/tools/BeforeAfter";
import { DownloadButton, DownloadGroup } from "@/components/tools/DownloadButton";
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
import { Checkbox, Field, Input, Slider } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-resizer",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const MAX_FILES = 20;

/** Upper bound for a typed dimension — generous, but canvas-hostile beyond it. */
const MAX_EDGE = 20000;

const PRESETS = [25, 50, 75, 100, 200] as const;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface ResizeOptions {
  width: number;
  height: number;
  quality: number;
}

const transform: TransformFn<ResizeOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];
  const width = Math.max(1, Math.min(MAX_EDGE, options.width));
  const height = Math.max(1, Math.min(MAX_EDGE, options.height));

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Resizing ${file.name}`,
    });

    const type: OutputMime = outputTypeFor(file, file.name);
    const natural = await readImageSize(file);
    const encoded = await reencode(file, {
      type,
      quality: type === "image/png" ? undefined : options.quality / 100,
      width,
      height,
      // JPEG has no alpha channel; white matches what most viewers show.
      background: type === "image/jpeg" ? "#ffffff" : null,
    });

    results.push({
      blob: encoded.blob,
      filename: withExtension(file.name, EXT_FOR_MIME[type] ?? "png"),
      source: file,
      width: encoded.width,
      height: encoded.height,
      note: `${natural.width} × ${natural.height}px → ${encoded.width} × ${encoded.height}px`,
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

interface Source {
  name: string;
  width: number;
  height: number;
}

export default function ImageResizerWorkspace() {
  const [source, setSource] = React.useState<Source | null>(null);
  const [width, setWidth] = React.useState(0);
  const [height, setHeight] = React.useState(0);
  const [maintainAspect, setMaintainAspect] = React.useState(true);
  const [lockedRatio, setLockedRatio] = React.useState<number | null>(null);
  const [allowUpscale, setAllowUpscale] = React.useState(false);
  const [quality, setQuality] = React.useState(92);
  const [readError, setReadError] = React.useState<string | null>(null);

  const { files, add, remove, clear, totalBytes } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  // The first file's identity, so adding to a batch does not wipe a target size
  // the user has already typed.
  const firstRef = React.useRef<File | undefined>(undefined);
  firstRef.current = files[0];
  const firstKey = files[0] ? `${files[0].name}:${files[0].size}:${files[0].lastModified}` : null;

  const ratio = source && source.height > 0 ? source.width / source.height : 1;
  const effectiveRatio = lockedRatio ?? ratio;

  // The effective target is what the engine will actually render: upscaling is
  // clamped away unless the user opted in.
  const requested = { width: Math.max(1, width), height: Math.max(1, height) };
  const target =
    allowUpscale || !source
      ? requested
      : {
          width: Math.min(requested.width, source.width),
          height: Math.min(requested.height, source.height),
        };

  const ready = width > 0 && height > 0;

  const options = React.useMemo<ResizeOptions>(
    () => ({ width: target.width, height: target.height, quality }),
    [target.width, target.height, quality],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  // Read the true dimensions of the first file so the fields start from real
  // numbers. The file itself is never modified.
  React.useEffect(() => {
    const file = firstRef.current;
    if (!file) {
      setSource(null);
      return;
    }
    let active = true;
    void readImageSize(file)
      .then((size) => {
        if (!active) return;
        setSource({ name: file.name, width: size.width, height: size.height });
        setWidth(size.width);
        setHeight(size.height);
        setReadError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setSource(null);
        setReadError(
          caught instanceof Error
            ? caught.message
            : "The browser could not read that image's dimensions.",
        );
      });
    return () => {
      active = false;
    };
  }, [firstKey]);

  const setWidthField = (next: number) => {
    setWidth(Math.min(MAX_EDGE, Math.max(1, Math.round(next))));
    if (maintainAspect) {
      setHeight(
        Math.min(MAX_EDGE, Math.max(1, Math.round(Math.min(MAX_EDGE, next) / effectiveRatio))),
      );
    }
  };

  const setHeightField = (next: number) => {
    setHeight(Math.min(MAX_EDGE, Math.max(1, Math.round(next))));
    if (maintainAspect) {
      setWidth(
        Math.min(MAX_EDGE, Math.max(1, Math.round(Math.min(MAX_EDGE, next) * effectiveRatio))),
      );
    }
  };

  const applyPreset = (factor: number) => {
    if (!source) return;
    setWidth(Math.max(1, Math.round(source.width * factor)));
    setHeight(Math.max(1, Math.round(source.height * factor)));
  };

  const reported = React.useRef<string | null>(null);

  const start = React.useCallback(() => {
    if (files.length === 0 || isRunning || !ready) return;
    reported.current = null;
    void run(files);
  }, [files, isRunning, ready, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
    setReadError(null);
    setLockedRatio(null);
  }, [reset, clear]);

  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(TOOL, {
        status: "success",
        fileName: results[0]?.filename,
        fileCount: results.length,
        inputBytes: totalBytes,
        outputBytes: results.reduce((sum, item) => sum + item.blob.size, 0),
      });
    }
    if (error && reported.current !== error) {
      reported.current = error;
      recordJob(TOOL, {
        status: "error",
        fileName: files[0]?.name,
        fileCount: files.length,
        inputBytes: totalBytes,
        errorMessage: error,
      });
    }
  }, [stage, results, error, files, totalBytes]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [start]);

  const upscaling =
    source ? target.width < requested.width || target.height < requested.height : false;
  const sourceUrl = useObjectUrl(files[0]);
  const single = results.length === 1 ? results[0] : null;
  const singleGrew = single?.source ? single.blob.size > single.source.size : false;
  const outputBytes = results.reduce((sum, item) => sum + item.blob.size, 0);
  const outputType: OutputMime = files[0] ? outputTypeFor(files[0], files[0].name) : "image/png";
  const outputName =
    outputType === "image/png" ? "PNG" : outputType === "image/webp" ? "WebP" : "JPEG";

  return (
    <ToolShell>
      <FileStage
        files={files}
        onAdd={add}
        onRemove={remove}
        onClear={clear}
        category="image"
        multiple
        maxFiles={MAX_FILES}
        maxBytes={SITE.limits.image}
        stage={stage}
        percent={percent}
        done={done}
        total={total}
        caption={caption}
        error={error}
        onRetry={start}
        dropzoneLabel="Drop images here to resize"
        dropzoneHint={`Up to ${MAX_FILES} files. The target size is applied to every file and each keeps its own format — output is ${outputName}.`}
        emptyTitle="Drop your files here to get started."
        emptyDescription="Resize by exact pixels, by percentage, or by locking the aspect ratio. Works on a batch of up to 20 images."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            {readError ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                {readError} The file will be processed at the size you type below.
              </Notice>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Scale to</span>
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={!source}
                  onClick={() => applyPreset(preset / 100)}
                  className="h-8 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] px-3 font-mono text-xs text-[var(--text-ink)] transition-colors duration-150 hover:border-[var(--surface-line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {preset}%
                </button>
              ))}
              {source ? (
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  source {source.width} × {source.height}px
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Width" hint="Pixels">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_EDGE}
                    value={width || ""}
                    placeholder="—"
                    suffix="px"
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      if (Number.isFinite(next)) setWidthField(next);
                    }}
                  />
                )}
              </Field>
              <Field label="Height" hint="Pixels">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_EDGE}
                    value={height || ""}
                    placeholder="—"
                    suffix="px"
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      if (Number.isFinite(next)) setHeightField(next);
                    }}
                  />
                )}
              </Field>
            </div>

            <div className="flex flex-col gap-2.5">
              <Checkbox
                label="Keep aspect ratio"
                description="Editing one field recomputes the other from the current ratio."
                checked={maintainAspect}
                onChange={(event) => setMaintainAspect(event.target.checked)}
              />
              <Checkbox
                label="Lock the current ratio"
                description={
                  !maintainAspect
                    ? "Turn on “Keep aspect ratio” first — the lock only means something while the two fields are linked."
                    : lockedRatio
                      ? `Pinned at ${lockedRatio.toFixed(3)}:1. Later resizes keep this shape instead of the source's.`
                      : "Freeze the ratio you have right now, so later resizes keep this shape rather than the source's."
                }
                disabled={!maintainAspect}
                checked={lockedRatio !== null}
                onChange={(event) => {
                  if (!event.target.checked) {
                    setLockedRatio(null);
                    return;
                  }
                  if (width > 0 && height > 0) setLockedRatio(width / height);
                }}
              />
              <Checkbox
                label="Allow upscaling"
                description="Off by default: enlarging past an image's own pixels cannot add detail, it only adds bytes."
                checked={allowUpscale}
                onChange={(event) => setAllowUpscale(event.target.checked)}
              />
            </div>

            {outputType === "image/png" ? null : (
              <Field
                label={`Output quality — ${quality}%`}
                hint="Resizing re-encodes the image. 92 and above keeps the resample effectively invisible."
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

            {upscaling ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                You asked for {requested.width} × {requested.height}px, which is larger than the
                source ({source?.width} × {source?.height}px). Upscaling is off, so the source size is
                used. Tick “Allow upscaling” if you want the bigger file.
              </Notice>
            ) : null}
          </div>
        }
        action={
          <ProcessButton
            label="Resize"
            icon={<Ruler className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={files.length === 0 || !ready}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {sourceUrl && source ? (
        <figure className="mt-5 flex flex-col gap-2">
          <div className="checkerboard flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <img
              src={sourceUrl}
              alt={`${source.name}, shown at its target size of ${target.width} by ${target.height} pixels`}
              className="h-auto max-h-72 w-auto max-w-full object-contain"
              style={{ width: "100%", maxWidth: `${target.width}px` }}
            />
          </div>
          <figcaption className="text-xs text-[var(--text-muted)]">
            Layout preview: the browser scales the{" "}
            <span className="font-mono tabular-nums">
              {source.width} × {source.height}px
            </span>{" "}
            original down to{" "}
            <span className="font-mono tabular-nums text-[var(--text-ink)]">
              {target.width} × {target.height}px
            </span>
            . The downloaded file is rendered at full resolution, so it is sharper than this preview
            — not different from it.
          </figcaption>
        </figure>
      ) : null}

      {results.length > 0 ? (
        <ResultsPanel
          title={results.length === 1 ? "Resized image" : `Resized ${results.length} images`}
          className="mt-6"
        >
          {single?.source ? (
            <div className="flex flex-col gap-4">
              <BeforeAfter
                beforeBlob={single.source}
                afterBlob={single.blob}
                beforeBytes={single.source.size}
                afterBytes={single.blob.size}
                beforeWidth={source?.width}
                beforeHeight={source?.height}
                afterWidth={single.width}
                afterHeight={single.height}
                beforeLabel="Original"
                afterLabel="Resized"
              />
              {singleGrew ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  The resized file is larger than the source — which happens when the target is close
                  to the original size and the re-encode is at high quality. Lower the quality or
                  pick a smaller target.
                </Notice>
              ) : null}
              <DownloadButton
                blob={single.blob}
                filename={single.filename}
                caption={
                  singleGrew
                    ? `${single.width} × ${single.height}px · ${formatBytes(single.blob.size)} · ${formatBytes(single.blob.size - single.source.size)} larger than the source`
                    : `${single.width} × ${single.height}px · ${formatBytes(single.blob.size)} · ${percentSaved(single.source.size, single.blob.size).toFixed(1)}% smaller`
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <SizeComparisonStats beforeBytes={totalBytes} afterBytes={outputBytes} />
              <ul className="grid gap-1.5">
                {results.map((item, index) => (
                  <li
                    key={`${item.filename}-${index}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-ink)]">
                      {item.filename}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {item.width} × {item.height}px · {formatBytes(item.blob.size)}
                    </span>
                    <span className="w-full text-[11px] text-[var(--text-muted)] sm:w-auto">
                      {item.note}
                    </span>
                  </li>
                ))}
              </ul>
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName="resized-images"
                originalTotalBytes={totalBytes}
              />
            </div>
          )}
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
