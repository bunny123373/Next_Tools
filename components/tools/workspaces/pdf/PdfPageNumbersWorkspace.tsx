"use client";

import * as React from "react";
import { ListOrdered } from "lucide-react";
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
import { Checkbox, Field, Input, Segmented, Slider, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import {
  addPageNumbers,
  getPdfPageCount,
  NUMBER_FORMAT_LABEL,
  NUMBER_POSITIONS,
  POSITION_LABEL,
  pageNumberLabel,
  type NumberFormat,
  type NumberPosition,
} from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-page-numbers", category: "pdf", processing: "local" } as const;

const POSITION_OPTIONS: ReadonlyArray<{ value: NumberPosition; label: string }> =
  NUMBER_POSITIONS.map((value) => ({ value, label: POSITION_LABEL[value] }));

const FORMAT_OPTIONS: ReadonlyArray<{ value: NumberFormat; label: string }> = (
  ["page-of", "number", "dashes"] as const
).map((value) => ({ value, label: NUMBER_FORMAT_LABEL[value] }));

interface Options {
  position: NumberPosition;
  format: NumberFormat;
  startAt: number;
  skipFirstPage: boolean;
  fontSize: number;
  margin: number;
  outputName: string;
}

export default function PdfPageNumbersWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const [position, setPosition] = React.useState<NumberPosition>("bottom-center");
  const [format, setFormat] = React.useState<NumberFormat>("page-of");
  const [startAt, setStartAt] = React.useState(1);
  const [skipFirstPage, setSkipFirstPage] = React.useState(false);
  const [fontSize, setFontSize] = React.useState(11);
  const [margin, setMargin] = React.useState(28);
  const [outputName, setOutputName] = React.useState("numbered");
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  React.useEffect(() => {
    if (!file) {
      setPageCount(null);
      setReadError(null);
      return;
    }
    let cancelled = false;
    setPageCount(null);
    setReadError(null);
    void (async () => {
      try {
        const count = await getPdfPageCount(file);
        if (!cancelled) setPageCount(count);
      } catch (error) {
        if (cancelled) return;
        setReadError(error instanceof Error ? error.message : "This file could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, file]);

  const startError =
    !Number.isInteger(startAt) || startAt < 0
      ? "The starting number has to be a whole number of 0 or more."
      : null;

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      report({ percent: null, done: 0, total: inputs.length, caption: "Drawing the page numbers" });
      const result = await addPageNumbers(input, {
        position: options.position,
        format: options.format,
        startAt: options.startAt,
        skipFirstPage: options.skipFirstPage,
        fontSize: options.fontSize,
        margin: options.margin,
      });
      report({ percent: 100, done: inputs.length, total: inputs.length });
      return [
        {
          blob: result.blob,
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: `${result.numbered} page${result.numbered === 1 ? "" : "s"} numbered`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: { position, format, startAt, skipFirstPage, fontSize, margin, outputName },
    });

  const bytesIn = file?.size ?? 0;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${position}::${format}::${startAt}::ok`;
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
  }, [stage, results, error, fileKey, file, position, format, startAt, bytesIn]);

  const canRun = Boolean(file) && !readError && !startError;

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
  const numberedCount = pageCount === null ? 0 : skipFirstPage ? Math.max(0, pageCount - 1) : pageCount;
  const sample = pageNumberLabel(format, startAt + (skipFirstPage ? 1 : 0), pageCount ?? numberedCount);

  return (
    <ToolShell>
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
          dropzoneLabel="Drop a PDF here to number its pages"
          dropzoneHint="One file at a time. Numbers are drawn with the built-in Helvetica, so nothing needs embedding."
          renderMeta={() =>
            pageCount === null ? (readError ? <span className="text-brand-500">Unreadable</span> : "Reading…") : `${pageCount} pages`
          }
          controls={
            <div className="grid gap-4">
              <Field label="Position">
                {() => (
                  <Segmented
                    label="Position"
                    options={POSITION_OPTIONS}
                    value={position}
                    onChange={(value) => {
                      setPosition(value);
                      reset();
                    }}
                    size="sm"
                  />
                )}
              </Field>

              <Field label="Format">
                {() => (
                  <Segmented
                    label="Format"
                    options={FORMAT_OPTIONS}
                    value={format}
                    onChange={(value) => {
                      setFormat(value);
                      reset();
                    }}
                    size="sm"
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Start at"
                  error={startError}
                  hint="Use 1 for the first page, or continue from an earlier volume."
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="number"
                      min={0}
                      step={1}
                      value={startAt}
                      onChange={(event) => {
                        setStartAt(Number(event.target.value));
                        reset();
                      }}
                    />
                  )}
                </Field>

                <Field label="Font size" hint={`${fontSize} pt`}>
                  {({ id }) => (
                    <Slider
                      id={id}
                      min={7}
                      max={24}
                      step={1}
                      value={fontSize}
                      onChange={(event) => {
                        setFontSize(Number(event.target.value));
                        reset();
                      }}
                      aria-valuetext={`${fontSize} points`}
                    />
                  )}
                </Field>
              </div>

              <Field label="Margin" hint={`${margin} pt from the page edge`}>
                {({ id }) => (
                  <Slider
                    id={id}
                    min={10}
                    max={72}
                    step={2}
                    value={margin}
                    onChange={(event) => {
                      setMargin(Number(event.target.value));
                      reset();
                    }}
                    aria-valuetext={`${margin} points`}
                  />
                )}
              </Field>

              <Checkbox
                label="Skip the first page"
                description="The usual treatment for a cover — page 1 keeps no number, page 2 gets the first number."
                checked={skipFirstPage}
                onChange={(event) => {
                  setSkipFirstPage(event.target.checked);
                  reset();
                }}
              />

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
                  <Stat label="Will be numbered" value={numberedCount} tone="brand" />
                </dl>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              label="Add page numbers"
              icon={<ListOrdered className="size-4" aria-hidden="true" />}
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
          {result ? (
            <ResultsPanel title="Numbered document">
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Pages numbered" value={numberedCount} tone="brand" />
                <Stat
                  label="Size"
                  value={formatBytes(result.blob.size)}
                  hint={bytesIn > 0 ? `from ${formatBytes(bytesIn)}` : undefined}
                />
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
            <div className="flex flex-col gap-4">
              <Notice tone="info" icon={<ListOrdered className="size-4" aria-hidden="true" />}>
                The number is drawn onto each page with pdf-lib using Helvetica from the PDF standard
                fonts, so the result opens the same way on every reader. Nothing else in the document
                is touched.
              </Notice>
              {pageCount !== null ? (
                <section
                  aria-label="Numbering preview"
                  className="flex flex-col gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4"
                >
                  <h3 className="text-[13px] font-medium text-[var(--text-ink)]">What will be drawn</h3>
                  <dl className="grid grid-cols-2 gap-2">
                    <Stat label="First label" value={pageNumberLabel(format, startAt, pageCount)} />
                    <Stat label="Last label" value={pageNumberLabel(format, startAt + numberedCount - 1, pageCount)} />
                  </dl>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {POSITION_LABEL[position]}, {fontSize} pt, {margin} pt from the edge
                    {skipFirstPage ? ", first page skipped" : ""}. Sample on page 2:{" "}
                    <span className="font-mono text-[var(--text-ink)]">{sample}</span>
                  </p>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
