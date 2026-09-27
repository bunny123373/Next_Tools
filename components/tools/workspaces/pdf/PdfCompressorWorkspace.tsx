"use client";

import * as React from "react";
import { Gauge, Info } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Checkbox, Field, Select, Slider, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes, formatPercent, percentSaved } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import { compressPdf, type CompressOptions, type CompressReport } from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-compress", category: "pdf", processing: "local" } as const;

const MAX_FILES = 30;

const DIMENSION_OPTIONS = [
  { value: "0", label: "Do not resize images (structure cleanup only)" },
  { value: "1000", label: "1000 px — good for screen reading" },
  { value: "1400", label: "1400 px — good for most documents" },
  { value: "2000", label: "2000 px — sharp on paper" },
  { value: "3000", label: "3000 px — near print quality" },
] as const;

interface Options extends CompressOptions {
  outputName: string;
}

export default function PdfCompressorWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: true,
    maxFiles: MAX_FILES,
  });
  const { files } = queue;

  const [quality, setQuality] = React.useState(0.72);
  const [maxDimension, setMaxDimension] = React.useState(1400);
  const [stripMetadata, setStripMetadata] = React.useState(false);
  const [outputName, setOutputName] = React.useState("compressed");
  const [report, setReport] = React.useState<CompressReport | null>(null);

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, reportProgress) => {
      const outputs = [];
      let last: CompressReport | null = null;
      let inputTotal = 0;
      let outputTotal = 0;
      let images = 0;
      let imagesFound = 0;
      let streams = 0;
      let orphans = 0;

      for (let index = 0; index < inputs.length; index += 1) {
        const file = inputs[index]!;
        const result = await compressPdf(
          file,
          {
            jpegQuality: options.jpegQuality,
            maxDimension: options.maxDimension,
            stripMetadata: options.stripMetadata,
          },
          (progress) => {
            reportProgress({
              percent: null,
              done: index,
              total: inputs.length,
              caption: `${file.name} — ${progress.detail}`,
            });
          },
        );
        last = result.report;
        inputTotal += result.report.bytesBefore;
        outputTotal += result.report.bytesAfter;
        images += result.report.imagesDownsampled;
        imagesFound += result.report.imagesTotal;
        streams += result.report.streamsRecompressed;
        orphans += result.report.orphanedObjectsRemoved;

        outputs.push({
          blob: result.blob,
          filename: withExtension(
            inputs.length === 1 ? options.outputName : `${file.name.replace(/\.pdf$/i, "")}-compressed`,
            "pdf",
          ),
          source: file,
          note: `${formatBytes(result.report.bytesBefore)} → ${formatBytes(result.report.bytesAfter)}`,
        });

        reportProgress({
          percent: null,
          done: index + 1,
          total: inputs.length,
          caption: `${file.name} — done`,
        });
      }

      if (last && inputs.length === 1) {
        setReport(last);
      } else if (last) {
        setReport({
          ...last,
          bytesBefore: inputTotal,
          bytesAfter: outputTotal,
          imagesDownsampled: images,
          imagesTotal: imagesFound,
          streamsRecompressed: streams,
          orphanedObjectsRemoved: orphans,
          grew: outputTotal > inputTotal,
        });
      }

      return outputs;
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: { jpegQuality: quality, maxDimension, stripMetadata, outputName },
    });

  const resetAll = React.useCallback(() => {
    reset();
    setReport(null);
  }, [reset]);

  React.useEffect(() => {
    resetAll();
    // Changing an option invalidates the previous measurement.
  }, [quality, maxDimension, stripMetadata, resetAll]);

  const bytesIn = files.reduce((sum, file) => sum + file.size, 0);
  const fileKey = files.map((file) => `${file.name}:${file.size}`).join("|");

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::ok::${results.map((r) => r.filename).join(",")}`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "success",
        fileName: files.length === 1 ? files[0]?.name : `${files.length} PDFs`,
        fileCount: files.length,
        inputBytes: bytesIn,
        outputBytes: results.reduce((sum, r) => sum + r.blob.size, 0),
        outputName: results.length === 1 ? results[0]?.filename : `${results.length} files`,
      });
    } else if (error) {
      const key = `${fileKey}::err::${error}`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "error",
        fileName: files.length === 1 ? files[0]?.name : `${files.length} PDFs`,
        fileCount: files.length,
        inputBytes: bytesIn,
        errorMessage: error,
      });
    }
  }, [stage, results, error, fileKey, files, bytesIn]);

  const start = React.useCallback(() => {
    if (files.length === 0) return;
    void run(files);
  }, [files, run]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [start]);

  const saved = report ? percentSaved(report.bytesBefore, report.bytesAfter) : 0;
  const didNothing = Boolean(report && (report.grew || saved < 0.1));

  return (
    <ToolShell>
      <div className="grid gap-6 lg:grid-cols-2">
        <FileStage
          files={files}
          onAdd={(incoming) => {
            queue.add(incoming);
            resetAll();
          }}
          onRemove={(index) => {
            queue.remove(index);
            resetAll();
          }}
          onClear={() => {
            queue.clear();
            resetAll();
          }}
          category="pdf"
          multiple
          maxFiles={MAX_FILES}
          maxBytes={SITE.limits.pdf}
          emptyTitle="Drop a PDF to shrink it."
          emptyDescription="Scanned and image-heavy documents give the biggest real reductions."
          dropzoneHint={`Up to ${MAX_FILES} files at a time. Only raster images are re-encoded — text and vector art are left alone.`}
          controls={
            <div className="grid gap-4">
              <Field
                label={`JPEG quality — ${Math.round(quality * 100)}%`}
                hint="Lower quality means a smaller file and softer photos. 70% is a good default; below 50% artefacts become obvious."
              >
                {({ id }) => (
                  <Slider
                    id={id}
                    min={30}
                    max={95}
                    step={1}
                    value={Math.round(quality * 100)}
                    onChange={(event) => setQuality(Number(event.target.value) / 100)}
                    aria-valuetext={`${Math.round(quality * 100)} percent`}
                  />
                )}
              </Field>

              <Field
                label="Maximum image size"
                hint="Images larger than this on their longest edge are downscaled and re-encoded as JPEG."
              >
                {({ id }) => (
                  <Select
                    id={id}
                    value={String(maxDimension)}
                    onChange={(event) => setMaxDimension(Number(event.target.value))}
                  >
                    {DIMENSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Checkbox
                label="Also remove document metadata"
                description="Clears the title, author, producer and dates, and drops the XMP stream."
                checked={stripMetadata}
                onChange={(event) => setStripMetadata(event.target.checked)}
              />

              <Field label="Output name" hint="Used for a single input file.">
                {({ id }) => (
                  <input
                    id={id}
                    value={outputName}
                    onChange={(event) => setOutputName(event.target.value)}
                    spellCheck={false}
                    className="h-10 w-full rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                  />
                )}
              </Field>
            </div>
          }
          action={
            <ProcessButton
              label="Compress"
              icon={<Gauge className="size-4" aria-hidden="true" />}
              onClick={start}
              disabled={files.length === 0}
              loading={isRunning}
            />
          }
          secondary={<ResetButton onClick={resetAll} />}
          stage={stage}
          percent={percent}
          done={done}
          total={total}
          caption={caption}
          error={error}
          onRetry={start}
        />

        <div className="flex flex-col gap-4">
          {report ? (
            <ResultsPanel title="Compression report">
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Before" value={formatBytes(report.bytesBefore)} />
                <Stat
                  label="After"
                  value={formatBytes(report.bytesAfter)}
                  tone={didNothing ? "default" : "success"}
                />
                <Stat
                  label="Saved"
                  value={saved > 0 ? formatPercent(saved) : "0%"}
                  hint={didNothing ? undefined : "of the original size"}
                  tone={didNothing ? "default" : "brand"}
                />
                <Stat
                  label="Images re-encoded"
                  value={`${report.imagesDownsampled} / ${report.imagesTotal}`}
                  hint={report.imagesSkipped > 0 ? `${report.imagesSkipped} left untouched` : undefined}
                />
              </dl>

              {didNothing ? (
                <Notice tone="warning" title="This PDF is already well optimised.">
                  No further reduction was possible in the browser. That normally means the images are
                  already small enough for the limit you chose, or the file is mostly vector drawing and
                  text where there is nothing to re-encode. The original is still the better download.
                </Notice>
              ) : (
                <Notice tone="success" title="A real reduction.">
                  {formatBytes(report.bytesBefore - report.bytesAfter)} was removed by re-encoding{" "}
                  {report.imagesDownsampled} embedded image
                  {report.imagesDownsampled === 1 ? "" : "s"}
                  {report.streamsRecompressed > 0
                    ? ` and re-deflating ${report.streamsRecompressed} content stream${report.streamsRecompressed === 1 ? "" : "s"}`
                    : ""}
                  {report.orphanedObjectsRemoved > 0
                    ? `, and dropping ${report.orphanedObjectsRemoved} orphaned object${report.orphanedObjectsRemoved === 1 ? "" : "s"}`
                    : ""}
                  .
                </Notice>
              )}

              {results.length === 1 ? (
                <DownloadButton
                  blob={results[0]!.blob}
                  filename={results[0]!.filename}
                  label="Download compressed PDF"
                  caption={`${formatBytes(results[0]!.blob.size)} from ${formatBytes(report.bytesBefore)}`}
                />
              ) : null}
            </ResultsPanel>
          ) : (
            <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
              This tool decodes every raster image it understands, downscales it to the limit you set
              and re-encodes it as JPEG. It does not re-encode vector art, subset fonts, or change a
              colour space — a text-only PDF will usually come out the same size, and we will tell you
              so rather than invent a saving.
            </Notice>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
