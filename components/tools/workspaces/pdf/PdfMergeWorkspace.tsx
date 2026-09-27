"use client";

import * as React from "react";
import { Combine, FileStack } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice, ToolSuccess } from "@/components/tools/states";
import { Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import { getPdfPageCount, mergePdfFiles } from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-merge", category: "pdf", processing: "local" } as const;

const MAX_FILES = 30;

interface Options {
  outputName: string;
}

interface FileFacts {
  pages: number | null;
  error: string | null;
}

export default function PdfMergeWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: true,
    maxFiles: MAX_FILES,
  });
  const { files } = queue;

  const [outputName, setOutputName] = React.useState("merged");
  const [facts, setFacts] = React.useState<Record<string, FileFacts>>({});
  const [reading, setReading] = React.useState(false);

  // A stable identity for the current queue, so the page-count lookups below
  // never report a count against the wrong file.
  const fileKey = React.useMemo(
    () => files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|"),
    [files],
  );

  React.useEffect(() => {
    if (files.length === 0) {
      setFacts({});
      return;
    }
    let cancelled = false;
    setReading(true);
    void (async () => {
      const entries = await Promise.all(
        files.map(async (file, index) => {
          try {
            return [fileKeyOf(file, index), { pages: await getPdfPageCount(file), error: null }] as const;
          } catch (error) {
            return [
              fileKeyOf(file, index),
              {
                pages: null,
                error: error instanceof Error ? error.message : "This file could not be read.",
              },
            ] as const;
          }
        }),
      );
      if (cancelled) return;
      setFacts(Object.fromEntries(entries));
      setReading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      report({ percent: null, done: 0, total: inputs.length, caption: "Preparing" });
      const merged = await mergePdfFiles(inputs, (done, total, caption) => {
        report({ percent: total > 0 ? (done / total) * 100 : null, done, total, caption });
      });
      report({ percent: 100, done: inputs.length, total: inputs.length });
      const result: TransformResult = {
        blob: merged.blob,
        filename: withExtension(options.outputName, "pdf"),
        source: inputs[0],
        note: `${merged.pageCount} pages from ${merged.fileCount} files`,
      };
      return [result];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({ transform, options: { outputName } });

  const bytesIn = files.reduce((sum, file) => sum + file.size, 0);
  const totalPages = files.reduce((sum, file, index) => sum + (facts[fileKeyOf(file, index)]?.pages ?? 0), 0);
  const unreadable = files.filter((file, index) => facts[fileKeyOf(file, index)]?.error).length;
  const canMerge = files.length >= 2 && unreadable === 0;

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
        outputName: results[0]?.filename,
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
    if (!canMerge) return;
    void run(files);
  }, [canMerge, files, run]);

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
          category="pdf"
          multiple
          maxFiles={MAX_FILES}
          maxBytes={SITE.limits.pdf}
          reorderable
          dropzoneLabel="Drop two or more PDFs here"
          dropzoneHint={`Up to ${MAX_FILES} files at a time. Password-protected PDFs cannot be merged until the password is removed.`}
          renderMeta={(file, index) => {
            const fact = facts[fileKeyOf(file, index)];
            if (!fact) return reading ? "Reading…" : undefined;
            if (fact.error) return <span className="text-brand-500">Unreadable</span>;
            return `${fact.pages ?? 0} page${fact.pages === 1 ? "" : "s"}`;
          }}
          controls={
            <div className="grid gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Output name</span>
                <input
                  value={outputName}
                  onChange={(event) => setOutputName(event.target.value)}
                  spellCheck={false}
                  aria-label="Output file name"
                  className="h-10 w-full rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                />
              </label>
              {files.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Files" value={files.length} />
                  <Stat label="Total pages" value={reading ? "…" : totalPages} />
                </dl>
              ) : null}
              {unreadable > 0 ? (
                <Notice tone="warning" title="Some files could not be read.">
                  {unreadable} of the {files.length} selected {unreadable === 1 ? "file is" : "files are"}{" "}
                  damaged or password-protected. Remove {unreadable === 1 ? "it" : "them"} to merge the rest.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              label="Merge PDFs"
              icon={<Combine className="size-4" aria-hidden="true" />}
              onClick={start}
              disabled={!canMerge}
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
            <ResultsPanel title="Merged document">
              <ToolSuccess
                title={result.filename}
                description={`${formatBytes(result.blob.size)}${
                  result.note ? ` · ${result.note}` : ""
                }`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <DownloadButton
                  blob={result.blob}
                  filename={result.filename}
                  label="Download PDF"
                  caption={`${formatBytes(result.blob.size)} · ${result.note ?? ""}`}
                />
                <OpenButton blob={result.blob} filename={result.filename} />
              </div>
            </ResultsPanel>
          ) : (
            <Notice tone="info" icon={<FileStack className="size-4" aria-hidden="true" />}>
              The merged file is assembled page by page in this tab. Nothing is uploaded, and the page
              order is exactly the order of the list on the left.
            </Notice>
          )}
        </div>
      </div>
    </ToolShell>
  );
}

function fileKeyOf(file: File, index: number): string {
  return `${file.name}:${file.size}:${file.lastModified}:${index}`;
}
