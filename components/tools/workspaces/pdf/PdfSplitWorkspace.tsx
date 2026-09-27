"use client";

import * as React from "react";
import { Split } from "lucide-react";
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
import { Notice, ToolError } from "@/components/tools/states";
import { Field, Input, Segmented, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { getPdfPageCount, parsePageRange, planSplit, splitPdf, type SplitMode } from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-split", category: "pdf", processing: "local" } as const;

const MODE_OPTIONS: ReadonlyArray<{ value: SplitMode; label: string }> = [
  { value: "each", label: "Every page" },
  { value: "ranges", label: "Custom ranges" },
  { value: "selection", label: "My selection" },
];

const MODE_HELP: Record<SplitMode, string> = {
  each: "Produces one file per page, named after the page number.",
  ranges: "One file containing every page in the range you type. Use 1-3, 7, 9-12.",
  selection: "One file containing the pages you type here. Same syntax as custom ranges.",
};

interface Options {
  mode: SplitMode;
  rangeText: string;
}

export default function PdfSplitWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;

  const [mode, setMode] = React.useState<SplitMode>("each");
  const [rangeText, setRangeText] = React.useState("");
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);

  const singleFile = files[0];
  const fileKey = singleFile
    ? `${singleFile.name}:${singleFile.size}:${singleFile.lastModified}`
    : "";

  React.useEffect(() => {
    if (!singleFile) {
      setPageCount(null);
      setReadError(null);
      return;
    }
    let cancelled = false;
    setPageCount(null);
    setReadError(null);
    void (async () => {
      try {
        const count = await getPdfPageCount(singleFile);
        if (!cancelled) setPageCount(count);
      } catch (error) {
        if (cancelled) return;
        setReadError(error instanceof Error ? error.message : "This file could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, singleFile]);

  const parsed = React.useMemo(
    () => (pageCount === null ? null : parsePageRange(rangeText, pageCount)),
    [rangeText, pageCount],
  );
  const needsRange = mode === "ranges" || mode === "selection";
  const rangeError = needsRange && parsed ? parsed.error : null;
  const plan = React.useMemo(
    () => (pageCount === null || rangeError ? null : planSplit(pageCount, { mode, rangeText, selection: [] })),
    [pageCount, mode, rangeText, rangeError],
  );

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const outputs = [];
      for (let index = 0; index < inputs.length; index += 1) {
        const file = inputs[index]!;
        const produced = await splitPdf(
          file,
          { mode: options.mode, rangeText: options.rangeText, selection: [] },
          (done, total, caption) => {
            report({
              percent: total > 0 ? (done / total) * 100 : null,
              done: index,
              total: inputs.length,
              caption: `${file.name} — ${caption ?? ""}`,
            });
          },
        );
        outputs.push(
          ...produced.map((output) => ({
            blob: output.blob,
            filename: output.name,
            source: file,
            note: output.note,
          })),
        );
        report({
          percent: null,
          done: index + 1,
          total: inputs.length,
          caption: `${file.name} — ${produced.length} file${produced.length === 1 ? "" : "s"}`,
        });
      }
      return outputs;
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({ transform, options: { mode, rangeText } });

  const bytesIn = files.reduce((sum, file) => sum + file.size, 0);
  const emptyError =
    pageCount !== null && pageCount === 0
      ? "This PDF reports zero pages, so there is nothing to split."
      : readError;
  const canRun = files.length > 0 && pageCount !== null && !emptyError && !rangeError;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${mode}::${rangeText}::ok::${results.length}`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "success",
        fileName: singleFile?.name,
        fileCount: files.length,
        inputBytes: bytesIn,
        outputBytes: results.reduce((sum, r) => sum + r.blob.size, 0),
        outputName: results.length === 1 ? results[0]?.filename : `${results.length} files`,
      });
    } else if (error) {
      const key = `${fileKey}::${mode}::${rangeText}::err::${error}`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "error",
        fileName: singleFile?.name,
        fileCount: files.length,
        inputBytes: bytesIn,
        errorMessage: error,
      });
    }
  }, [stage, results, error, fileKey, mode, rangeText, singleFile, files.length, bytesIn]);

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

  const outputTotal = results.reduce((sum, result) => sum + result.blob.size, 0);

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
          category="pdf"
          multiple={false}
          maxBytes={SITE.limits.pdf}
          dropzoneLabel="Drop a PDF here to split it up"
          dropzoneHint="One file at a time. Add the next one once you have downloaded this batch."
          renderMeta={() =>
            pageCount === null ? (readError ? <span className="text-brand-500">Unreadable</span> : "Reading…") : `${pageCount} pages`
          }
          controls={
            <div className="grid gap-3">
              <Field label="Split mode" hint={MODE_HELP[mode]}>
                {({ id }) => (
                  <div id={id}>
                    <Segmented
                      label="Split mode"
                      options={MODE_OPTIONS}
                      value={mode}
                      onChange={(value) => {
                        setMode(value);
                        reset();
                      }}
                    />
                  </div>
                )}
              </Field>

              {needsRange ? (
                <Field
                  label="Pages"
                  error={rangeError}
                  hint={parsed?.error === null ? `${parsed.indices.length} page${parsed.indices.length === 1 ? "" : "s"} selected` : "Example: 1-3, 7, 9-12"}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={rangeText}
                      onChange={(event) => {
                        setRangeText(event.target.value);
                        reset();
                      }}
                      placeholder="1-3, 7, 9-12"
                      spellCheck={false}
                      inputMode="numeric"
                    />
                  )}
                </Field>
              ) : null}

              {files.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Pages in file" value={pageCount ?? "…"} />
                  <Stat
                    label="Files out"
                    value={plan ? (mode === "each" ? plan.indices.length : 1) : "…"}
                    hint={plan && mode === "each" ? "one per page" : undefined}
                  />
                </dl>
              ) : null}

              {readError ? (
                <ToolError detail={readError} title="This PDF could not be read." />
              ) : pageCount === 0 ? (
                <Notice tone="warning" title="Nothing to split.">
                  This PDF reports zero pages, so there is nothing to produce. Re-export it from the app
                  that created it.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              label="Split PDF"
              icon={<Split className="size-4" aria-hidden="true" />}
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
          {results.length === 1 ? (
            <ResultsPanel title="Split complete">
              <DownloadButton
                blob={results[0]!.blob}
                filename={results[0]!.filename}
                label="Download PDF"
                caption={`${formatBytes(results[0]!.blob.size)} · ${results[0]!.note ?? ""}`}
              />
            </ResultsPanel>
          ) : results.length > 1 ? (
            <ResultsPanel title={`${results.length} files ready`}>
              <DownloadGroup
                items={results.map((result) => ({ name: result.filename, blob: result.blob }))}
                zipName={singleFile ? singleFile.name.replace(/\.pdf$/i, "") : "split"}
                originalTotalBytes={bytesIn}
              />
            </ResultsPanel>
          ) : (
            <Notice tone="info" icon={<Split className="size-4" aria-hidden="true" />}>
              {mode === "each"
                ? "Every page becomes its own PDF, keeping the original page size and rotation."
                : "Each part is built by copying the original pages, so nothing is re-encoded."}
            </Notice>
          )}
          {results.length > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {formatBytes(outputTotal)} across {results.length} output
              {results.length === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      </div>
    </ToolShell>
  );
}
