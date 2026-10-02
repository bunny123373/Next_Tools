"use client";

import * as React from "react";
import { CheckCircle2, Eraser, Info, TriangleAlert } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  mimeLabel,
  outputTypeFor,
  stripMetadata,
  type OutputMime,
  type RemovedTag,
  type StripMetadataResult,
} from "@/lib/tools/engines/image";
import { formatBytes } from "@/lib/utils/format";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
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
import { Field, Slider, Stat } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-metadata-remover",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

interface StripOptions {
  type: OutputMime;
  quality: number;
  background: string;
}

/** The report is written during the transform and read back on render, so the
 *  file is parsed and verified exactly once per run. */
function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function Group({ title, tags }: { title: string; tags: RemovedTag[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
      <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        {title}
      </h4>
      <ul className="flex flex-col gap-1">
        {tags.map((tag) => (
          <li key={`${tag.source}-${tag.label}`} className="flex items-baseline justify-between gap-4 text-[13px]">
            <span className="min-w-0 truncate text-[var(--text-muted)]">{tag.label}</span>
            {tag.value ? (
              <span className="max-w-[50%] truncate text-right font-mono text-[12px] text-[var(--text-ink)]">
                {tag.value}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ImageMetadataRemoverWorkspace() {
  const [quality, setQuality] = React.useState(92);
  const [background, setBackground] = React.useState("#ffffff");

  const { files, add, remove, clear } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
  });

  const file = files[0];
  const type: OutputMime = file ? outputTypeFor(file, file.name) : "image/png";
  const isLossless = type === "image/png";
  const outputName = type === "image/png" ? "PNG" : type === "image/webp" ? "WebP" : "JPEG";

  const options = React.useMemo<StripOptions>(
    () => ({ type, quality, background }),
    [type, quality, background],
  );

  /**
   * Per-instance, not module-level. A module map would keep every Blob the tool
   * ever produced alive for the life of the page and would leak reports across
   * component instances. It is cleared whenever the run resets.
   */
  const reportRef = React.useRef<Map<string, StripMetadataResult>>(new Map());

  const transform = React.useCallback<TransformFn<StripOptions>>(
    async (files, runOptions, report) => {
      const results: TransformResult[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const current = files[index];
        if (!current) continue;

        report({
          percent: files.length > 1 ? (index / files.length) * 100 : null,
          done: index,
          total: files.length,
          caption: `Stripping metadata from ${current.name}`,
        });

        const outcome = await stripMetadata(current, current.name, {
          type: runOptions.type,
          quality: runOptions.type === "image/png" ? undefined : runOptions.quality / 100,
          background: runOptions.type === "image/jpeg" ? runOptions.background : null,
        });

        results.push({
          blob: outcome.blob,
          filename: outcome.filename,
          source: current,
          width: outcome.width,
          height: outcome.height,
          note: outcome.removed.length
            ? `${outcome.removed.length} tag${outcome.removed.length === 1 ? "" : "s"} removed`
            : "no metadata found",
        });
        reportRef.current.set(fileKey(current), outcome);

        report({
          percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
          done: index + 1,
          total: files.length,
        });
      }

      return results;
    },
    [],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  const start = React.useCallback(() => {
    if (!file || isRunning) return;
    reported.current = null;
    void run([file]);
  }, [file, isRunning, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reportRef.current.clear();
    reset();
    clear();
    setQuality(92);
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
  const outcome =
    file && result?.source ? (reportRef.current.get(fileKey(result.source)) ?? null) : null;

  const bySource = React.useMemo(() => {
    const map = new Map<string, RemovedTag[]>();
    for (const tag of outcome?.removed ?? []) {
      const list = map.get(tag.source) ?? [];
      list.push(tag);
      map.set(tag.source, list);
    }
    return [...map.entries()];
  }, [outcome]);

  const gpsTag = outcome?.removed.find((tag) => tag.source === "GPS");
  const delta = outcome ? outcome.afterBytes - outcome.beforeBytes : 0;

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
        dropzoneLabel="Drop an image here to strip its metadata"
        dropzoneHint="One file at a time. Everything happens in this tab — the image is never uploaded."
        emptyTitle="Drop a photo here to clean it."
        emptyDescription="Removes EXIF, GPS, IPTC and XMP data, and shows you exactly what was taken out. Nothing leaves your device."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            {isLossless ? (
              <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
                The output is PNG, which is lossless — removing metadata will not alter a single pixel.
                There is no quality setting because there is nothing to trade.
              </Notice>
            ) : (
              <Field
                label={`Output quality — ${quality}%`}
                hint="Re-encoding a JPEG is what makes this possible, and it is slightly lossy. This is the one real trade-off in the tool; the original file is never modified."
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={60}
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

            <p className="text-xs text-[var(--text-muted)]">
              Output format: {outputName}
              {file && file.type !== type
                ? ` — this browser cannot re-encode ${mimeLabel(file.type)}, so the result is written as ${outputName}.`
                : ", the same as the source."}
            </p>
          </div>
        }
        action={
          <ProcessButton
            label="Remove metadata"
            icon={<Eraser className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {error ? (
        <ToolError
          className="mt-6"
          title="The file could not be cleaned."
          detail={error}
          onRetry={start}
        >
          <p className="max-w-md text-[13px] text-[var(--text-muted)]">
            A browser cannot re-encode some formats. If the file is damaged or in a format this
            browser does not decode, convert it to JPEG or PNG first with the Image Converter and
            then strip it.
          </p>
        </ToolError>
      ) : null}

      {outcome && result ? (
        <ResultsPanel title="Clean copy" className="mt-6">
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Tags removed"
                value={String(outcome.removed.length)}
                hint={
                  outcome.wasAlreadyClean
                    ? "nothing was embedded"
                    : `from ${bySource.length} block${bySource.length === 1 ? "" : "s"}`
                }
              />
              <Stat
                label="Size"
                value={formatBytes(outcome.afterBytes)}
                hint={`was ${formatBytes(outcome.beforeBytes)}`}
              />
              <Stat
                label="Dimensions"
                value={`${outcome.width}×${outcome.height}`}
                hint="unchanged"
              />
              <Stat
                label="Verified clean"
                value={outcome.verified ? "yes" : "check below"}
                hint="read back after writing"
              />
            </dl>

            {outcome.wasAlreadyClean ? (
              <Notice tone="info" icon={<CheckCircle2 className="size-4" aria-hidden="true" />}>
                This file had no embedded metadata to begin with — screenshots, exports and files
                that have already been through an editor usually arrive this way. The clean copy is
                still produced, but nothing was actually removed.
              </Notice>
            ) : null}

            {bySource.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {bySource.map(([source, tags]) => (
                  <Group key={source} title={source} tags={tags} />
                ))}
              </div>
            ) : null}

            {gpsTag ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" aria-hidden="true" />}>
                {gpsTag.value && !gpsTag.value.startsWith("block")
                  ? `This photo carried GPS coordinates at ${gpsTag.value}. `
                  : "This photo carried a GPS block. "}
                They were removed here, on your device, and the location was never sent anywhere.
                Keep the clean copy rather than the original when you publish it.
              </Notice>
            ) : null}

            {!outcome.verified ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" aria-hidden="true" />}>
                Reading the output back found metadata that should not be there. The clean copy has
                still been produced, but treat it with suspicion and check it with the Metadata
                Viewer before publishing.
              </Notice>
            ) : null}

            {delta > 0 && outcome.lossy ? (
              <Notice tone="info">
                The clean copy is {formatBytes(delta)} larger than the original, which is normal:
                JPEG is re-compressed from scratch and the original was encoded more efficiently.
                Use the Image Compressor if size matters.
              </Notice>
            ) : null}

            <DownloadButton
              blob={result.blob}
              filename={result.filename}
              caption={`${outcome.width} × ${outcome.height}px · ${formatBytes(outcome.afterBytes)} · no embedded metadata`}
            />
          </div>
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
