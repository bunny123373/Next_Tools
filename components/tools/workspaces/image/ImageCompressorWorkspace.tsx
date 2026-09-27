"use client";

import * as React from "react";
import { ImageDown, TriangleAlert } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  OUTPUT_FORMATS,
  formatForMime,
  probeEncoders,
  reencode,
  supportedOutputTypes,
  type OutputFormat,
  type OutputMime,
} from "@/lib/tools/engines/image";
import { sumSizes, withExtension } from "@/lib/utils/files";
import { formatBytes, percentSaved } from "@/lib/utils/format";
import { useFiles } from "@/lib/hooks";
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
import { Field, Slider } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-compressor",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const MAX_FILES = 20;

const WEBP = OUTPUT_FORMATS[2];
const JPEG = OUTPUT_FORMATS[0];
const PNG = OUTPUT_FORMATS[1];

type TargetChoice = "auto" | "webp" | "jpeg" | "png";

const TARGET_BY_CHOICE: Record<Exclude<TargetChoice, "auto">, OutputFormat> = {
  webp: WEBP,
  jpeg: JPEG,
  png: PNG,
};

const CHOICES = [
  { value: "auto", label: "Auto" },
  { value: "webp", label: "WebP" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
] as const;

interface CompressOptions {
  choice: TargetChoice;
  quality: number;
  encoders: Record<OutputMime, boolean>;
}

/**
 * "Auto" means WebP when this browser can write it — the smallest option for the
 * photographs people compress — and the source's own format otherwise. The
 * choice is made per file and the resolved type is reported back, so the user
 * can see what actually happened.
 */
function resolveTarget(choice: TargetChoice, file: File, encoders: Record<OutputMime, boolean>) {
  if (choice !== "auto") return TARGET_BY_CHOICE[choice];
  if (encoders["image/webp"]) return WEBP;
  return formatForMime(file.type) ?? PNG;
}

const transform: TransformFn<CompressOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    const target = resolveTarget(options.choice, file, options.encoders);

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Compressing ${file.name} → ${target.label}`,
    });

    const encoded = await reencode(file, {
      type: target.mime,
      quality: target.lossy ? options.quality / 100 : undefined,
      // Transparency is a real feature of PNG and WebP; do not flatten it.
      background: null,
    });

    results.push({
      blob: encoded.blob,
      filename: withExtension(file.name, target.ext),
      source: file,
      width: encoded.width,
      height: encoded.height,
      note: `${encoded.width} × ${encoded.height}px · ${target.label}`,
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

export default function ImageCompressorWorkspace() {
  const [quality, setQuality] = React.useState(75);
  const [choice, setChoice] = React.useState<TargetChoice>("auto");
  const [encoders, setEncoders] = React.useState<Record<OutputMime, boolean> | null>(null);

  const { files, add, remove, clear, totalBytes } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const options = React.useMemo<CompressOptions>(
    () => ({
      choice,
      quality,
      // Before the probe resolves, assume no WebP so "auto" keeps the source
      // format — the safe answer, and the notice explains it if it applies.
      encoders: encoders ?? { "image/jpeg": true, "image/png": true, "image/webp": false },
    }),
    [choice, quality, encoders],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  React.useEffect(() => {
    let active = true;
    void probeEncoders().then((report) => {
      if (active) setEncoders(report);
    });
    return () => {
      active = false;
    };
  }, []);

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
        outputBytes: sumSizes(results.map((item) => ({ size: item.blob.size }))),
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

  const single = results.length === 1 ? results[0] : null;
  const singleTarget = single?.note?.split(" · ")[1] ?? "";
  const grew = single?.source ? single.blob.size > single.source.size : false;
  const outputBytes = sumSizes(results.map((item) => ({ size: item.blob.size })));
  const netSaved = totalBytes - outputBytes;
  const grewCount = results.filter(
    (item) => item.source && item.blob.size > item.source.size,
  ).length;

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
        dropzoneLabel="Drop images here to compress"
        dropzoneHint={`JPG, PNG, WebP, GIF, BMP or AVIF, up to ${MAX_FILES} files per batch. Quality is the only knob — dimensions never change.`}
        emptyTitle="Drop your files here to get started."
        emptyDescription="Re-encode up to 20 images at a lower quality and see the real byte difference for every one."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <Field
              label={`Quality — ${quality}%`}
              hint="Lower is smaller. Below 60 artefacts become visible in smooth areas; above 90 you are mostly paying for a second generation of JPEG."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={10}
                  max={100}
                  step={1}
                  value={quality}
                  onChange={(event) => setQuality(Number(event.target.value))}
                />
              )}
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-[13px] font-medium text-[var(--text-ink)]">Output type</legend>
              <div className="flex flex-wrap gap-2">
                {CHOICES.map((option) => {
                  const unavailable =
                    option.value !== "auto" &&
                    encoders !== null &&
                    !encoders[TARGET_BY_CHOICE[option.value].mime];
                  const active = choice === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      disabled={unavailable}
                      onClick={() => setChoice(option.value)}
                      title={unavailable ? "Not supported in this browser" : undefined}
                      className={[
                        "h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                        active
                          ? "border-brand-500 bg-brand-500 text-white"
                          : "border-[var(--surface-line)] bg-[var(--surface-card)] text-[var(--text-muted)] hover:border-[var(--surface-line-strong)] hover:text-[var(--text-ink)]",
                      ].join(" ")}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                {choice === "auto" ? (
                  encoders?.["image/webp"] ? (
                    "Auto writes WebP, which is usually the smallest option for photographs. For screenshots and flat graphics, PNG often wins — pick it explicitly."
                  ) : (
                    "Auto keeps each file's own format, because this browser has no WebP encoder."
                  )
                ) : choice === "png" ? (
                  "PNG ignores the quality slider: it is lossless, so a PNG compressed here is a losslessly re-encoded PNG. Use this to strip metadata, not to save bytes."
                ) : (
                  `${TARGET_BY_CHOICE[choice].label} is a lossy format, so the quality slider applies.`
                )}
              </p>
            </fieldset>

            {encoders && supportedOutputTypes().length < OUTPUT_FORMATS.length ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                This browser can only write{" "}
                {supportedOutputTypes()
                  .map((item) => item.label)
                  .join(" and ")}
                . The unavailable formats are disabled above rather than failing at download time.
              </Notice>
            ) : null}
          </div>
        }
        action={
          <ProcessButton
            label="Compress"
            icon={<ImageDown className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={files.length === 0}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {results.length > 0 ? (
        <ResultsPanel
          title={results.length === 1 ? "Compressed image" : `Compressed ${results.length} images`}
          className="mt-6"
        >
          {single?.source ? (
            <div className="flex flex-col gap-4">
              <BeforeAfter
                beforeBlob={single.source}
                afterBlob={single.blob}
                beforeBytes={single.source.size}
                afterBytes={single.blob.size}
                afterWidth={single.width}
                afterHeight={single.height}
                beforeLabel="Original"
                afterLabel={`${singleTarget} ${quality}%`}
              />
              {grew ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  The re-encoded file is larger than the one you dropped in. That happens when the
                  source is already well compressed, or is a format that does not suit the picture. No
                  saving happened, so no saving is claimed — try a lower quality, or keep the original.
                </Notice>
              ) : null}
              <DownloadButton
                blob={single.blob}
                filename={single.filename}
                caption={
                  grew
                    ? `${formatBytes(single.blob.size)} · ${formatBytes(single.blob.size - single.source.size)} larger than the original`
                    : `${formatBytes(single.blob.size)} · ${percentSaved(single.source.size, single.blob.size).toFixed(1)}% smaller`
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <SizeComparisonStats beforeBytes={totalBytes} afterBytes={outputBytes} />
              {grewCount > 0 ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  {grewCount} of {results.length} files came out larger than their originals. The
                  per-file rows below show which ones, and by how much.
                </Notice>
              ) : null}
              <ul className="grid gap-1.5">
                {results.map((item, index) => {
                  const source = item.source;
                  const larger = source ? item.blob.size > source.size : false;
                  return (
                    <li
                      key={`${item.filename}-${index}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-ink)]">
                        {item.filename}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                        {source ? formatBytes(source.size) : "—"} → {formatBytes(item.blob.size)}
                      </span>
                      <span
                        className={[
                          "font-mono text-[11px] font-semibold tabular-nums",
                          larger ? "text-amber-500" : "text-emerald-500",
                        ].join(" ")}
                      >
                        {source && larger
                          ? `+${(((item.blob.size - source.size) / source.size) * 100).toFixed(1)}%`
                          : source
                            ? `−${percentSaved(source.size, item.blob.size).toFixed(1)}%`
                            : "—"}
                      </span>
                      <span className="w-full text-[11px] text-[var(--text-muted)] sm:w-auto">
                        {item.note}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName="compressed-images"
                originalTotalBytes={totalBytes}
              />
              <p className="text-xs text-[var(--text-muted)]">
                {netSaved > 0
                  ? `The batch is ${formatBytes(netSaved)} smaller in total.`
                  : `The batch is ${formatBytes(Math.abs(netSaved))} larger in total. Raising the quality or choosing a different output type usually flips this.`}
              </p>
            </div>
          )}
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
