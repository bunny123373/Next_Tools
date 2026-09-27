"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils/cn";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import {
  formatPageList,
  parsePageRange,
  renderPagePreview,
  rotatePdfPages,
  type RotateAngle,
} from "@/lib/tools/engines/pdf";
import {
  PageThumbnailGrid,
  ThumbnailStatus,
  usePageThumbnails,
  THUMBNAIL_LIMIT,
} from "./PdfPageExtractorWorkspace";

const TOOL = { id: "pdf-rotator", category: "pdf", processing: "local" } as const;

const ANGLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "90", label: "90°" },
  { value: "180", label: "180°" },
  { value: "270", label: "270°" },
];

const PREVIEW_WIDTH = 320;

interface Options {
  pages: number[] | "all";
  angle: RotateAngle;
  outputName: string;
}

export default function PdfRotatorWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const { thumbnails, pageCount, status, error: previewError, caption: previewCaption, hiddenPages } =
    usePageThumbnails(file, THUMBNAIL_LIMIT);

  const [scope, setScope] = React.useState<"all" | "selection">("all");
  const [selection, setSelection] = React.useState<Set<number>>(() => new Set());
  const [rangeText, setRangeText] = React.useState("");
  const [angle, setAngle] = React.useState<RotateAngle>(90);
  const [outputName, setOutputName] = React.useState("rotated");

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  React.useEffect(() => {
    setSelection(new Set());
    setRangeText("");
  }, [fileKey]);

  const parsed = React.useMemo(
    () => (pageCount === null ? null : parsePageRange(rangeText, pageCount)),
    [rangeText, pageCount],
  );
  const rangeError = scope === "selection" && parsed ? parsed.error : null;

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

  const targetCount = scope === "all" ? (pageCount ?? 0) : selection.size;
  const previewIndex = scope === "all" ? 0 : Math.min(...(selection.size > 0 ? [...selection] : [0]));

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      if (options.pages !== "all" && options.pages.length === 0) {
        throw new Error("Select at least one page, or switch back to all pages.");
      }
      report({ percent: null, done: 0, total: inputs.length, caption: "Applying the rotation" });
      const result = await rotatePdfPages(input, options.pages, options.angle);
      report({ percent: 100, done: inputs.length, total: inputs.length });
      return [
        {
          blob: result.blob,
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: `${result.rotated} of ${result.pageCount} page${result.rotated === 1 ? "" : "s"} rotated ${options.angle}°`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: {
        pages: scope === "all" ? "all" : [...selection].sort((a, b) => a - b),
        angle,
        outputName,
      },
    });

  const bytesIn = file?.size ?? 0;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${angle}::${targetCount}::ok`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "success",
        fileName: file?.name,
        fileCount: 1,
        inputBytes: bytesIn,
        outputBytes: results.reduce((sum, r) => sum + r.blob.size, 0),
        outputName: results[0]?.filename,
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
  }, [stage, results, error, fileKey, file, angle, targetCount, bytesIn]);

  const canRun = Boolean(file) && (scope === "all" || targetCount > 0) && !rangeError;

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

  const result = results[0];

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
            dropzoneLabel="Drop a PDF here to rotate"
            dropzoneHint={`One file at a time. The preview shows the first ${THUMBNAIL_LIMIT} pages.`}
            controls={
              <div className="grid gap-4">
                <Field label="Which pages" hint="All pages is usually right for a scanned document.">
                  {() => (
                    <Segmented
                      label="Which pages"
                      options={[
                        { value: "all", label: `All ${pageCount ?? ""} pages`.trim() },
                        { value: "selection", label: "Only selected" },
                      ]}
                      value={scope}
                      onChange={(value) => {
                        setScope(value);
                        reset();
                      }}
                    />
                  )}
                </Field>

                <Field label="Turn" hint="Each turn is relative to the current rotation, so four 90° turns come back to the start.">
                  {() => (
                    <Segmented
                      label="Turn"
                      options={ANGLE_OPTIONS}
                      value={String(angle)}
                      onChange={(value) => {
                        setAngle(Number(value) as RotateAngle);
                        reset();
                      }}
                    />
                  )}
                </Field>

                {scope === "selection" ? (
                  <Field
                    label="Pages"
                    error={rangeError}
                    hint={
                      rangeError
                        ? undefined
                        : `${selection.size} page${selection.size === 1 ? "" : "s"} selected`
                    }
                  >
                    {({ id, describedBy, invalid }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        aria-invalid={invalid || undefined}
                        value={rangeText}
                        onChange={(event) => {
                          applyRange(event.target.value);
                          reset();
                        }}
                        placeholder="2-4, 9"
                        spellCheck={false}
                        inputMode="numeric"
                        className="h-10 w-full rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                      />
                    )}
                  </Field>
                ) : null}

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

                {file ? (
                  <dl className="grid grid-cols-2 gap-2">
                    <Stat label="Pages" value={pageCount ?? "…"} />
                    <Stat label="Will rotate" value={targetCount} tone="brand" />
                  </dl>
                ) : null}
              </div>
            }
            action={
              <ProcessButton
                label="Rotate pages"
                icon={<RotateCw className="size-4" aria-hidden="true" />}
                onClick={start}
                disabled={!canRun}
                loading={isRunning}
              />
            }
            secondary={
              <Button
                variant="ghost"
                onClick={() => {
                  setScope("all");
                  selectNone();
                  reset();
                }}
                disabled={isRunning}
              >
                Reset options
              </Button>
            }
            stage={stage}
            percent={percent}
            done={done}
            total={total}
            caption={caption}
            error={error}
            onRetry={start}
          />

          <div className="flex flex-col gap-4">
            {file ? <RotationPreview file={file} pageIndex={previewIndex} angle={angle} /> : null}

            {result ? (
              <ResultsPanel title="Rotated document">
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Pages rotated" value={targetCount} tone="brand" />
                  <Stat label="Size" value={formatBytes(result.blob.size)} />
                </dl>
                <div className="flex flex-wrap items-center gap-2">
                  <DownloadButton
                    blob={result.blob}
                    filename={result.filename}
                    label="Download PDF"
                    caption={result.note ?? undefined}
                  />
                  <OpenButton blob={result.blob} filename={result.filename} />
                </div>
              </ResultsPanel>
            ) : (
              <Notice tone="info" icon={<RotateCw className="size-4" aria-hidden="true" />}>
                Rotation is written into each page&apos;s dictionary rather than re-rendering anything,
                so the file size barely changes and no pixels are recompressed.
              </Notice>
            )}
          </div>
        </div>

        {file && scope === "selection" ? (
          <section aria-label="Page picker" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text-ink)]">Pages to rotate</h3>
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
              disabled={isRunning}
            />
          </section>
        ) : null}
      </div>
    </ToolShell>
  );
}

/**
 * Live preview of the first affected page.
 *
 * The page is rendered from the real file with PDF.js, and the chosen turn is
 * applied as a CSS transform on the image — which is exactly what the reader
 * will do with the /Rotate value, so the preview cannot lie about the result.
 */
function RotationPreview({
  file,
  pageIndex,
  angle,
}: {
  file: File;
  pageIndex: number;
  angle: RotateAngle;
}) {
  const [blob, setBlob] = React.useState<Blob | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const url = useObjectUrl(blob);

  React.useEffect(() => {
    let cancelled = false;
    setBlob(null);
    setError(null);
    void (async () => {
      try {
        const preview = await renderPagePreview(file, pageIndex, PREVIEW_WIDTH);
        if (!cancelled) setBlob(preview);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "The preview could not be rendered.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, pageIndex]);

  const quarterTurn = angle === 90 || angle === 270;

  return (
    <section
      aria-label="Rotation preview"
      className="flex flex-col gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium text-[var(--text-ink)]">
          Preview — page {pageIndex + 1} turned {angle}°
        </h3>
        {quarterTurn ? (
          <span className="text-[11px] text-[var(--text-muted)]">portrait ⇄ landscape</span>
        ) : null}
      </div>

      {error ? (
        <p className="text-[13px] text-brand-500">{error}</p>
      ) : url ? (
        <div
          className={cn(
            "mx-auto flex items-center justify-center overflow-hidden rounded-lg border border-[var(--surface-line)] bg-[var(--surface-canvas)]",
            quarterTurn ? "aspect-[3/4] w-40" : "aspect-[4/3] w-56",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Page ${pageIndex + 1} of ${file.name} rotated ${angle} degrees`}
            className="max-h-full max-w-full object-contain transition-transform duration-200"
            style={{ transform: `rotate(${angle}deg)`, transformOrigin: "center" }}
          />
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">Rendering preview…</p>
      )}
    </section>
  );
}
