"use client";

import * as React from "react";
import { Images } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton, DownloadGroup } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Field, Input, Segmented, Slider, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { baseName } from "@/lib/utils/files";
import {
  formatPageList,
  parsePageRange,
  renderPageToImage,
  withPdfJsDocument,
  type ImageOutputFormat,
} from "@/lib/tools/engines/pdf";
import {
  PageThumbnailGrid,
  ThumbnailStatus,
  usePageThumbnails,
  THUMBNAIL_LIMIT,
} from "./PdfPageExtractorWorkspace";

const TOOL = { id: "pdf-to-jpg", category: "pdf", processing: "local" } as const;

const DPI_OPTIONS = [72, 96, 150, 200, 300, 600] as const;

const DPI_SEGMENT: ReadonlyArray<{ value: string; label: string }> = DPI_OPTIONS.map((value) => ({
  value: String(value),
  label: String(value),
}));

const FORMAT_OPTIONS: ReadonlyArray<{ value: ImageOutputFormat; label: string }> = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
];

const DPI_HINT: Record<number, string> = {
  72: "Screen resolution. Smallest files.",
  96: "Slightly above screen. Good for on-screen reading.",
  150: "Comfortable for documents read on a screen.",
  200: "Sharper; noticeably larger files.",
  300: "The usual floor for printing.",
  600: "Very large files. Only for fine line art.",
};

interface Options {
  pages: number[];
  dpi: number;
  format: ImageOutputFormat;
  quality: number;
}

export default function PdfToJpgWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const { thumbnails, pageCount, status, error: previewError, caption: previewCaption, hiddenPages } =
    usePageThumbnails(file, THUMBNAIL_LIMIT);

  const [selection, setSelection] = React.useState<Set<number>>(() => new Set());
  const [rangeText, setRangeText] = React.useState("");
  const [dpi, setDpi] = React.useState(150);
  const [format, setFormat] = React.useState<ImageOutputFormat>("jpeg");
  const [quality, setQuality] = React.useState(0.85);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  React.useEffect(() => {
    setSelection(new Set());
    setRangeText("");
  }, [fileKey]);

  const parsed = React.useMemo(
    () => (pageCount === null ? null : parsePageRange(rangeText, pageCount)),
    [rangeText, pageCount],
  );
  const rangeError = parsed ? parsed.error : null;

  const applyRange = (value: string) => {
    setRangeText(value);
    if (pageCount === null) return;
    const next = parsePageRange(value, pageCount);
    setSelection(next.error ? new Set() : new Set(next.indices));
  };

  const toggle = (index: number) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      setRangeText(formatPageList([...next]));
      return next;
    });
  };
  const selectAllShown = () => {
    setSelection((current) => {
      const next = new Set(current);
      for (const thumbnail of thumbnails) next.add(thumbnail.index);
      setRangeText(formatPageList([...next]));
      return next;
    });
  };
  const selectNone = () => {
    setSelection(new Set());
    setRangeText("");
  };
  const invert = () => {
    setSelection((current) => {
      const next = new Set<number>();
      for (let index = 0; index < (pageCount ?? 0); index += 1) {
        if (!current.has(index)) next.add(index);
      }
      setRangeText(formatPageList([...next]));
      return next;
    });
  };

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      if (options.pages.length === 0) {
        throw new Error("Select at least one page, or type a range such as 1-3, 7.");
      }
      const stem = baseName(input.name) || "page";
      const extension = options.format === "jpeg" ? "jpg" : "png";
      const scale = options.dpi / 72;
      const outputs = [];
      const total = options.pages.length;

      const rendered = await withPdfJsDocument(input, async (doc) => {
        const collected: { blob: Blob; width: number; height: number }[] = [];
        for (let position = 0; position < total; position += 1) {
          const pageNumber = options.pages[position]! + 1;
          const image = await renderPageToImage(doc, options.pages[position]!, {
            scale,
            format: options.format,
            quality: options.quality,
          });
          collected.push(image);
          report({
            percent: (position / total) * 100,
            done: 0,
            total: 1,
            caption: `Rendered page ${pageNumber} of ${total}`,
          });
        }
        return collected;
      });

      for (let position = 0; position < rendered.length; position += 1) {
        const pageNumber = options.pages[position]! + 1;
        const padded = String(pageNumber).padStart(String(total).length, "0");
        outputs.push({
          blob: rendered[position]!.blob,
          filename: `${stem}-${padded}.${extension}`,
          source: input,
          note: `${rendered[position]!.width} × ${rendered[position]!.height} px`,
        });
      }

      return outputs;
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: { pages: [...selection].sort((a, b) => a - b), dpi, format, quality },
    });

  const bytesIn = file?.size ?? 0;
  const selectedCount = selection.size;
  const outputBytes = results.reduce((sum, result) => sum + result.blob.size, 0);

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${dpi}::${format}::${selectedCount}::ok`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "success",
        fileName: file?.name,
        fileCount: results.length,
        inputBytes: bytesIn,
        outputBytes: outputBytes,
        outputName: results.length === 1 ? results[0]?.filename : `${results.length} images`,
      });
    } else if (error) {
      const key = `${fileKey}::err::${error}`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "error",
        fileName: file?.name,
        fileCount: 1,
        inputBytes: bytesIn,
        errorMessage: error,
      });
    }
  }, [stage, results, error, fileKey, file, dpi, format, bytesIn, outputBytes, selectedCount]);

  const canRun = Boolean(file) && selectedCount > 0 && !rangeError;

  const start = React.useCallback(() => {
    if (!canRun) return;
    void run(files);
  }, [canRun, files, run]);

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

  return (
    <ToolShell>
      <div className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <FileStage
            files={files}
            onAdd={(incoming) => {
              queue.add(incoming);
              reset();
            }}
            onRemove={() => {
              queue.remove(0);
              reset();
            }}
            onClear={() => {
              queue.clear();
              reset();
            }}
            category="pdf"
            multiple={false}
            maxBytes={SITE.limits.pdf}
            emptyTitle="Drop a PDF to render as images."
            emptyDescription="Click the pages you want, set a resolution, and export."
            dropzoneHint={`One file at a time. The preview shows the first ${THUMBNAIL_LIMIT} pages.`}
            controls={
              <div className="grid gap-4">
                <Field
                  label="Pages"
                  error={rangeError}
                  hint={
                    rangeError
                      ? undefined
                      : selectedCount > 0
                        ? `${selectedCount} page${selectedCount === 1 ? "" : "s"} selected`
                        : "Example: 1-3, 7, 9-12"
                  }
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={rangeText}
                      onChange={(event) => {
                        applyRange(event.target.value);
                        reset();
                      }}
                      placeholder="1-3, 7, 9-12"
                      spellCheck={false}
                      inputMode="numeric"
                    />
                  )}
                </Field>

                <Field label="Resolution" hint={DPI_HINT[dpi]}>
                  {() => (
                    <Segmented
                      label="Resolution"
                      options={DPI_SEGMENT}
                      value={String(dpi)}
                      onChange={(value) => {
                        setDpi(Number(value));
                        reset();
                      }}
                      size="sm"
                    />
                  )}
                </Field>

                <Field label="Output format" hint="JPEG for photographs, PNG for text and line art.">
                  {({ id }) => (
                    <div id={id}>
                      <Segmented
                        label="Output format"
                        options={FORMAT_OPTIONS}
                        value={format}
                        onChange={(value) => {
                          setFormat(value);
                          reset();
                        }}
                      />
                    </div>
                  )}
                </Field>

                {format === "jpeg" ? (
                  <Field
                    label={`JPEG quality — ${Math.round(quality * 100)}%`}
                    hint="Applies to JPEG only. PNG is always lossless."
                  >
                    {({ id }) => (
                      <Slider
                        id={id}
                        min={40}
                        max={100}
                        step={1}
                        value={Math.round(quality * 100)}
                        onChange={(event) => {
                          setQuality(Number(event.target.value) / 100);
                          reset();
                        }}
                        aria-valuetext={`${Math.round(quality * 100)} percent`}
                      />
                    )}
                  </Field>
                ) : null}

                {file ? (
                  <dl className="grid grid-cols-2 gap-2">
                    <Stat label="Pages" value={pageCount ?? "…"} />
                    <Stat label="Selected" value={selectedCount} tone="brand" />
                  </dl>
                ) : null}
              </div>
            }
            action={
              <ProcessButton
                label="Export images"
                icon={<Images className="size-4" aria-hidden="true" />}
                onClick={start}
                disabled={!canRun}
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
            {results.length > 0 ? (
              <ResultsPanel title={`${results.length} image${results.length === 1 ? "" : "s"} ready`}>
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Images" value={results.length} />
                  <Stat label="Total size" value={formatBytes(outputBytes)} />
                </dl>
                {results.length === 1 ? (
                  <DownloadButton
                    blob={results[0]!.blob}
                    filename={results[0]!.filename}
                    label="Download image"
                    caption={formatBytes(results[0]!.blob.size)}
                  />
                ) : (
                  <DownloadGroup
                    items={results.map((result) => ({ name: result.filename, blob: result.blob }))}
                    zipName={`${baseName(files[0]?.name ?? "pages")}-images`}
                    originalTotalBytes={bytesIn}
                  />
                )}
              </ResultsPanel>
            ) : (
              <Notice tone="info" icon={<Images className="size-4" aria-hidden="true" />}>
                Pages are rendered with PDF.js at the resolution you choose. A4 at 300 DPI is about
                2480 × 3508 pixels per page, so check your page count before exporting a long document.
              </Notice>
            )}
          </div>
        </div>

        {file ? (
          <section aria-label="Page picker" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text-ink)]">Choose the pages to export</h3>
              <ThumbnailStatus
                status={status}
                caption={previewCaption}
                hiddenPages={hiddenPages}
                error={previewError}
              />
            </div>
            <PageThumbnailGrid
              thumbnails={thumbnails}
              pageCount={pageCount}
              selected={selection}
              onToggle={toggle}
              onSelectAll={selectAllShown}
              onSelectNone={selectNone}
              onInvert={invert}
              disabled={isRunning}
            />
          </section>
        ) : null}
      </div>
    </ToolShell>
  );
}
