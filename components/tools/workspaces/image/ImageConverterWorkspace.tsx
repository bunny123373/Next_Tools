"use client";

import * as React from "react";
import { ArrowLeftRight, ImagePlus, TriangleAlert } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  OUTPUT_FORMATS,
  mimeLabel,
  probeEncoders,
  reencode,
  supportedOutputTypes,
  type OutputFormat,
  type OutputMime,
} from "@/lib/tools/engines/image";
import { sumSizes, withExtension } from "@/lib/utils/files";
import { formatBytes, percentSaved } from "@/lib/utils/format";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
import { BeforeAfter, SizeComparisonStats } from "@/components/tools/BeforeAfter";
import { DownloadButton, DownloadGroup } from "@/components/tools/DownloadButton";
import { ImagePreview } from "@/components/tools/FilePreview";
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
  id: "image-converter",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const MAX_FILES = 20;

type FormatValue = "jpeg" | "png" | "webp";

const FORMAT_BY_VALUE: Record<FormatValue, OutputFormat> = {
  jpeg: OUTPUT_FORMATS[0],
  png: OUTPUT_FORMATS[1],
  webp: OUTPUT_FORMATS[2],
};

const FORMAT_VALUE: Record<OutputMime, FormatValue> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

interface ConvertOptions {
  target: OutputFormat;
  quality: number;
  background: string;
}

/** Shared by this tool and the four focused single-format converters. */
const convert: TransformFn<ConvertOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Encoding ${file.name}`,
    });

    const encoded = await reencode(file, {
      type: options.target.mime,
      quality: options.target.lossy ? options.quality / 100 : undefined,
      // PNG and WebP keep transparency; JPEG does not, so the fill matters there.
      background: options.target.mime === "image/jpeg" ? options.background : null,
    });

    results.push({
      blob: encoded.blob,
      filename: withExtension(file.name, options.target.ext),
      source: file,
      width: encoded.width,
      height: encoded.height,
      note: `${encoded.width} × ${encoded.height}px`,
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

/** Runs the codec probe once and reports what this browser can write. */
function useEncoders() {
  const [encoders, setEncoders] = React.useState<Record<OutputMime, boolean> | null>(null);
  React.useEffect(() => {
    let active = true;
    void probeEncoders().then((report) => {
      if (active) setEncoders(report);
    });
    return () => {
      active = false;
    };
  }, []);
  return encoders;
}

function totalOutputBytes(results: TransformResult[]) {
  return sumSizes(results.map((item) => ({ size: item.blob.size })));
}

export default function ImageConverterWorkspace() {
  const [format, setFormat] = React.useState<FormatValue>("jpeg");
  const [quality, setQuality] = React.useState(90);
  const [background, setBackground] = React.useState("#ffffff");
  const encoders = useEncoders();

  const { files, add, remove, clear, totalBytes } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const options = React.useMemo<ConvertOptions>(
    () => ({ target: FORMAT_BY_VALUE[format], quality, background }),
    [format, quality, background],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform: convert, options });

  const reported = React.useRef<string | null>(null);

  const start = React.useCallback(() => {
    if (files.length === 0 || isRunning) return;
    reported.current = null;
    void run(files);
  }, [files, isRunning, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
  }, [reset, clear]);

  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(TOOL, {
        status: "success",
        fileName: results[0]?.filename,
        fileCount: results.length,
        inputBytes: totalBytes,
        outputBytes: totalOutputBytes(results),
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

  const source = files[0];
  const sourceUrl = useObjectUrl(source);
  const target = FORMAT_BY_VALUE[format];
  const targetReady = encoders ? encoders[target.mime] : true;
  const available = (encoders ? supportedOutputTypes() : OUTPUT_FORMATS)
    .map((item) => item.label)
    .join(" / ");

  const single = results.length === 1 ? results[0] : null;
  const grew = single?.source ? single.blob.size > single.source.size : false;

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
        dropzoneLabel="Drop images here to convert"
        dropzoneHint={`Any browser-readable image in, ${available} out. Up to ${MAX_FILES} files per batch.`}
        emptyTitle="Drop your files here to get started."
        emptyDescription="Convert JPG, PNG, WebP, GIF, BMP or AVIF to JPEG, PNG or WebP. Everything happens in this tab."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            {/* A radiogroup carries its own accessible name, so it is labelled
                with a span rather than a <label for>. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Output format</span>
              <Segmented<FormatValue>
                label="Output format"
                value={format}
                onChange={setFormat}
                options={OUTPUT_FORMATS.map((item) => ({
                  value: FORMAT_VALUE[item.mime],
                  label: item.label,
                  title:
                    encoders && !encoders[item.mime] ? "Not supported in this browser" : undefined,
                }))}
              />
            </div>

            {target.lossy ? (
              <Field
                label={`Quality — ${quality}%`}
                hint="Above 90 the file grows quickly for little visible gain. Below 70 artefacts start to show."
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
            ) : (
              <Notice tone="info">
                PNG is lossless, so there is no quality setting — the canvas writes every pixel as it
                is. The file will usually be larger than a JPEG of the same image.
              </Notice>
            )}

            {format === "jpeg" ? (
              <Field
                label="Background for transparent areas"
                hint="JPEG cannot store transparency, so transparent pixels are filled with this colour."
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

            {!targetReady ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                This browser cannot write {target.label}. It can write {available} — pick one of
                those, or use the Image Compressor, which picks a codec for you.
              </Notice>
            ) : null}
          </div>
        }
        action={
          <ProcessButton
            label="Convert"
            icon={<ArrowLeftRight className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={files.length === 0 || !targetReady}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {sourceUrl ? (
        <ImagePreview
          src={sourceUrl}
          alt={source?.name ?? "Selected image"}
          className="mt-5"
          caption={
            source ? (
              <span>
                {source.name} ·{" "}
                <span className="font-mono tabular-nums">{formatBytes(source.size)}</span>
              </span>
            ) : null
          }
        />
      ) : null}

      {results.length > 0 ? (
        <ResultsPanel title={`Converted (${results.length})`} className="mt-6">
          {single?.source ? (
            <div className="flex flex-col gap-4">
              <BeforeAfter
                beforeBlob={single.source}
                afterBlob={single.blob}
                beforeBytes={single.source.size}
                afterBytes={single.blob.size}
                afterWidth={single.width}
                afterHeight={single.height}
                beforeLabel="Source"
                afterLabel={target.label}
              />
              {grew ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  This {target.label} is larger than the source file. Lower the quality, or keep the
                  original — a well-compressed source has nothing to give.
                </Notice>
              ) : null}
              <DownloadButton
                blob={single.blob}
                filename={single.filename}
                caption={
                  grew
                    ? `${formatBytes(single.blob.size)} · ${formatBytes(single.blob.size - single.source.size)} larger than the source`
                    : `${formatBytes(single.blob.size)} · ${percentSaved(single.source.size, single.blob.size).toFixed(1)}% smaller`
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <SizeComparisonStats beforeBytes={totalBytes} afterBytes={totalOutputBytes(results)} />
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName="converted-images"
                originalTotalBytes={totalBytes}
              />
            </div>
          )}
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Single-format converter                                            */
/*  Shared by the four focused tools (JPG→PNG, PNG→JPG, JPG→WebP and     */
/*  WebP→JPG) so the controls, states and downloads stay identical.     */
/* ------------------------------------------------------------------ */

export interface SingleFormatConverterProps {
  tool: Pick<Tool, "id" | "category" | "processing">;
  /** MIME types accepted as input. Anything else is rejected by validation. */
  acceptMimes: string[];
  /** Name of the input format, for copy. */
  sourceLabel: string;
  target: OutputFormat;
  defaultQuality: number;
  /** True for targets with no alpha channel. */
  needsBackground: boolean;
  /** A codec the browser also needs in order to *read* the input, if any. */
  inputCodec?: OutputMime;
  zipName: string;
  dropLabel: string;
  dropHint: string;
  actionLabel: string;
}

export function SingleFormatConverter({
  tool,
  acceptMimes,
  sourceLabel,
  target,
  defaultQuality,
  needsBackground,
  inputCodec,
  zipName,
  dropLabel,
  dropHint,
  actionLabel,
}: SingleFormatConverterProps) {
  const [quality, setQuality] = React.useState(defaultQuality);
  const [background, setBackground] = React.useState("#ffffff");
  const encoders = useEncoders();

  const { files, add, remove, clear, totalBytes } = useFiles({
    category: "any",
    maxBytes: SITE.limits.image,
    multiple: true,
    maxFiles: MAX_FILES,
    mimeAllow: acceptMimes,
  });

  const options = React.useMemo<ConvertOptions>(
    () => ({ target, quality, background }),
    [target, quality, background],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform: convert, options });

  const reported = React.useRef<string | null>(null);

  const start = React.useCallback(() => {
    if (files.length === 0 || isRunning) return;
    reported.current = null;
    void run(files);
  }, [files, isRunning, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
  }, [reset, clear]);

  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(tool, {
        status: "success",
        fileName: results[0]?.filename,
        fileCount: results.length,
        inputBytes: totalBytes,
        outputBytes: totalOutputBytes(results),
      });
    }
    if (error && reported.current !== error) {
      reported.current = error;
      recordJob(tool, {
        status: "error",
        fileName: files[0]?.name,
        fileCount: files.length,
        inputBytes: totalBytes,
        errorMessage: error,
      });
    }
  }, [tool, stage, results, error, files, totalBytes]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [start]);

  const targetReady = encoders ? encoders[target.mime] : true;
  const inputReady = !inputCodec || !encoders ? true : encoders[inputCodec];
  const blocked = !targetReady || !inputReady;
  const available = (encoders ? supportedOutputTypes() : OUTPUT_FORMATS)
    .map((item) => item.label)
    .join(" and ");
  const single = results.length === 1 ? results[0] : null;
  const grew = single?.source ? single.blob.size > single.source.size : false;

  return (
    <ToolShell>
      <FileStage
        files={files}
        onAdd={add}
        onRemove={remove}
        onClear={clear}
        category="any"
        mimeAllow={acceptMimes}
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
        dropzoneLabel={dropLabel}
        dropzoneHint={dropHint}
        emptyTitle="Drop your files here to get started."
        emptyDescription={`Reads ${sourceLabel} files and writes ${target.label}. Nothing is uploaded.`}
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <Notice tone="info" icon={<ImagePlus className="size-4" aria-hidden="true" />}>
              {sourceLabel} in, {target.label} out — same pixel dimensions,{" "}
              {target.lossy
                ? "re-encoded at the quality you set."
                : "encoded losslessly with no quality setting."}
            </Notice>

            {target.lossy ? (
              <Field
                label={`Quality — ${quality}%`}
                hint="80–85 is a good default for photos on the web. 92 and above is close to invisible re-compression."
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
            ) : null}

            {needsBackground ? (
              <Field
                label="Background for transparent areas"
                hint="JPEG has no alpha channel, so transparency is filled with this colour."
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

            {!targetReady ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                This browser cannot write {target.label} — it has no {target.label} encoder. It can
                write {available}. Nothing is downloaded, because a file with the wrong extension and
                the wrong bytes inside it is worse than no file.
              </Notice>
            ) : null}

            {!inputReady ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                This browser has no {mimeLabel(inputCodec ?? "")} support at all, so it cannot decode{" "}
                {sourceLabel} files. That is a browser limitation, not something this tool can work
                around — try a current Chrome, Firefox, Edge or Safari.
              </Notice>
            ) : null}
          </div>
        }
        action={
          <ProcessButton
            label={actionLabel}
            icon={<ArrowLeftRight className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={files.length === 0 || blocked}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {results.length > 0 ? (
        <ResultsPanel title={`Converted to ${target.label} (${results.length})`} className="mt-6">
          {single?.source ? (
            <div className="flex flex-col gap-4">
              <BeforeAfter
                beforeBlob={single.source}
                afterBlob={single.blob}
                beforeBytes={single.source.size}
                afterBytes={single.blob.size}
                afterWidth={single.width}
                afterHeight={single.height}
                beforeLabel={`Original ${sourceLabel}`}
                afterLabel={target.label}
              />
              {grew ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  The {target.label} came out larger than the source. That is real: {target.label} is
                  a poor fit for this image, and the tool is telling you rather than dressing up a
                  regression as a saving.
                </Notice>
              ) : null}
              <DownloadButton
                blob={single.blob}
                filename={single.filename}
                caption={
                  grew
                    ? `${formatBytes(single.blob.size)} · ${formatBytes(single.blob.size - single.source.size)} larger than the source`
                    : `${formatBytes(single.blob.size)} · ${percentSaved(single.source.size, single.blob.size).toFixed(1)}% smaller`
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <SizeComparisonStats beforeBytes={totalBytes} afterBytes={totalOutputBytes(results)} />
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName={zipName}
                originalTotalBytes={totalBytes}
              />
            </div>
          )}
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
