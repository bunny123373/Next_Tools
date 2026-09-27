"use client";

import * as React from "react";
import { ImagePlus } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Field, Segmented, Select, Slider, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import {
  imagesToPdf,
  ORIENTATION_LABEL,
  PAPER_SIZE_LABEL,
  type PdfOrientation,
  type PdfPaperSize,
} from "@/lib/tools/engines/pdf";

const TOOL = { id: "png-to-pdf", category: "pdf", processing: "local" } as const;

const MAX_FILES = 60;
const ACCEPT = ["image/png"];

const PAPER_OPTIONS: ReadonlyArray<{ value: PdfPaperSize; label: string }> = (
  ["a4", "letter", "fit"] as const
).map((value) => ({ value, label: PAPER_SIZE_LABEL[value] }));

const ORIENTATION_OPTIONS: ReadonlyArray<{ value: PdfOrientation; label: string }> = (
  ["auto", "portrait", "landscape"] as const
).map((value) => ({ value, label: ORIENTATION_LABEL[value] }));

interface Options {
  paperSize: PdfPaperSize;
  orientation: PdfOrientation;
  margin: number;
  outputName: string;
}

export default function PngToPdfWorkspace() {
  const queue = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
    multiple: true,
    maxFiles: MAX_FILES,
    mimeAllow: ACCEPT,
  });
  const { files } = queue;

  const [paperSize, setPaperSize] = React.useState<PdfPaperSize>("a4");
  const [orientation, setOrientation] = React.useState<PdfOrientation>("auto");
  const [margin, setMargin] = React.useState(24);
  const [outputName, setOutputName] = React.useState("images");

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const result = await imagesToPdf(
        inputs,
        { paperSize: options.paperSize, orientation: options.orientation, margin: options.margin },
        (done, total, caption) => {
          report({
            percent: total > 0 ? (done / total) * 100 : null,
            done,
            total,
            caption,
          });
        },
      );
      const name = options.outputName.trim() || baseName(inputs[0]?.name ?? "images") || "images";
      return [
        {
          blob: result.blob,
          filename: withExtension(name, "pdf"),
          source: inputs[0],
          note: `${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${formatPageSummary(result.pageSizes)}`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: { paperSize, orientation, margin, outputName },
    });

  const bytesIn = files.reduce((sum, file) => sum + file.size, 0);
  const fileKey = files.map((file) => `${file.name}:${file.size}`).join("|");

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${paperSize}::${orientation}::${margin}::ok`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "success",
        fileName: files[0]?.name,
        fileCount: files.length,
        inputBytes: bytesIn,
        outputBytes: results.reduce((sum, r) => sum + r.blob.size, 0),
        outputName: results[0]?.filename,
      });
    } else if (error) {
      const key = `${fileKey}::${paperSize}::${orientation}::${margin}::err::${error}`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "error",
        fileName: files[0]?.name,
        fileCount: files.length,
        inputBytes: bytesIn,
        errorMessage: error,
      });
    }
  }, [stage, results, error, fileKey, paperSize, orientation, margin, files, bytesIn]);

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

  const result = results[0];

  return (
    <ToolShell>
      <div className="grid gap-6 lg:grid-cols-2">
        <FileStage
          files={files}
          onAdd={(incoming) => {
            queue.add(incoming);
            reset();
          }}
          onRemove={(index) => {
            queue.remove(index);
            reset();
          }}
          onClear={() => {
            queue.clear();
            reset();
          }}
          onReorder={(from, to) => {
            queue.move(from, to);
            reset();
          }}
          category="image"
          mimeAllow={ACCEPT}
          multiple
          maxFiles={MAX_FILES}
          maxBytes={SITE.limits.image}
          reorderable
          emptyTitle="Drop your PNG images to get started."
          emptyDescription="Each image becomes one page. Drag the list to change the page order."
          dropzoneHint={`PNG only, up to ${MAX_FILES} at a time. Images are embedded losslessly, so the PDF will be close to the sum of the originals.`}
          controls={
            <div className="grid gap-4">
              <Field label="Page size">
                {({ id }) => (
                  <div id={id}>
                    <Segmented
                      label="Page size"
                      options={PAPER_OPTIONS}
                      value={paperSize}
                      onChange={(value) => {
                        setPaperSize(value);
                        reset();
                      }}
                    />
                  </div>
                )}
              </Field>

              <Field
                label="Orientation"
                hint={
                  paperSize === "fit"
                    ? "Ignored in fit-to-image mode — each page already matches its image."
                    : "Auto rotates a wide screenshot onto a landscape page."
                }
              >
                {({ id }) => (
                  <Select
                    id={id}
                    value={orientation}
                    disabled={paperSize === "fit"}
                    onChange={(event) => {
                      setOrientation(event.target.value as PdfOrientation);
                      reset();
                    }}
                  >
                    {ORIENTATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                label={`Margin — ${margin} pt`}
                hint="White border around each image. A4 is 595 × 842 points."
              >
                {({ id }) => (
                  <Slider
                    id={id}
                    min={0}
                    max={50}
                    step={2}
                    value={margin}
                    disabled={paperSize === "fit"}
                    onChange={(event) => {
                      setMargin(Number(event.target.value));
                      reset();
                    }}
                    aria-valuetext={`${margin} points`}
                  />
                )}
              </Field>

              <Field label="Output name">
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

              {files.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Images" value={files.length} />
                  <Stat label="Pages out" value={files.length} hint="one page per image" />
                </dl>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              label="Create PDF"
              icon={<ImagePlus className="size-4" aria-hidden="true" />}
              onClick={start}
              disabled={files.length === 0}
              loading={isRunning}
            />
          }
          secondary={<ResetButton onClick={reset} />}
          stage={stage}
          percent={percent}
          done={done}
          total={total}
          caption={caption}
          error={error}
          onRetry={start}
        />

        <div className="flex flex-col gap-4">
          {result ? (
            <ResultsPanel title="PDF ready">
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Pages" value={results[0]?.note?.split(" · ")[0] ?? "—"} />
                <Stat label="Size" value={formatBytes(result.blob.size)} />
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <DownloadButton
                  blob={result.blob}
                  filename={result.filename}
                  label="Download PDF"
                  caption={formatBytes(result.blob.size)}
                />
                <OpenButton blob={result.blob} filename={result.filename} />
              </div>
            </ResultsPanel>
          ) : (
            <Notice tone="info" icon={<ImagePlus className="size-4" aria-hidden="true" />}>
              PNG is already a compressed lossless format, so the PDF will be about the same size as the
              images you dropped in. Convert to JPG first if you need a smaller file.
            </Notice>
          )}
        </div>
      </div>
    </ToolShell>
  );
}

function formatPageSummary(sizes: { width: number; height: number }[]): string {
  if (sizes.length === 0) return "";
  const first = sizes[0]!;
  const uniform = sizes.every(
    (size) =>
      Math.round(size.width) === Math.round(first.width) &&
      Math.round(size.height) === Math.round(first.height),
  );
  const label = `${Math.round(first.width)} × ${Math.round(first.height)} pt`;
  return uniform ? label : `${label} (varies)`;
}
