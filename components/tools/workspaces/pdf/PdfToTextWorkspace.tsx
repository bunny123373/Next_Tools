"use client";

import * as React from "react";
import { Copy, ScrollText, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { CopyButton, DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatNumber } from "@/lib/utils/format";
import { baseName } from "@/lib/utils/files";
import { toast } from "@/lib/utils/toast";
import {
  extractPdfText,
  getPdfPageCount,
  PAGE_SEPARATOR_LABEL,
  parsePageRange,
  type PageSeparator,
} from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-to-text", category: "pdf", processing: "local" } as const;

const SEPARATOR_OPTIONS: ReadonlyArray<{ value: PageSeparator; label: string }> = (
  ["none", "blank-line", "page-header", "form-feed"] as const
).map((value) => ({ value, label: PAGE_SEPARATOR_LABEL[value] }));

interface Options {
  pages: number[] | null;
  separator: PageSeparator;
}

const SCANNED_MESSAGE =
  "This looks like a scanned PDF: it has no embedded text layer. It needs OCR, which is not available in the browser. Try the AI tools or a server-side OCR setup.";

export default function PdfToTextWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [rangeText, setRangeText] = React.useState("");
  const [separator, setSeparator] = React.useState<PageSeparator>("blank-line");
  const [text, setText] = React.useState("");
  const [words, setWords] = React.useState(0);
  const [characters, setCharacters] = React.useState(0);
  const [pagesWithText, setPagesWithText] = React.useState(0);
  const [pagesRead, setPagesRead] = React.useState(0);
  const [noTextLayer, setNoTextLayer] = React.useState(false);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  React.useEffect(() => {
    setPageCount(null);
    setReadError(null);
    setText("");
    setWords(0);
    setCharacters(0);
    setPagesWithText(0);
    setPagesRead(0);
    setNoTextLayer(false);
    if (!file) {
      setRangeText("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const count = await getPdfPageCount(file);
        if (cancelled) return;
        setPageCount(count);
        setRangeText("");
      } catch (error) {
        if (cancelled) return;
        setReadError(error instanceof Error ? error.message : "This file could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, file]);

  const parsed = React.useMemo(
    () => (rangeText.trim() === "" || pageCount === null ? null : parsePageRange(rangeText, pageCount)),
    [rangeText, pageCount],
  );
  const rangeError = parsed ? parsed.error : null;

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      report({ percent: null, done: 0, total: 1, caption: "Reading the text layer" });

      const result = await extractPdfText(
        input,
        { pages: options.pages, separator: options.separator },
        (done, total) => {
          report({
            percent: null,
            done: 0,
            total: 1,
            caption: `Extracted page ${done} of ${total}`,
          });
        },
      );

      if (result.pagesWithText === 0) {
        setNoTextLayer(true);
        setText("");
        setWords(0);
        setCharacters(0);
        setPagesRead(result.pagesRead);
        setPagesWithText(0);
        throw new Error(SCANNED_MESSAGE);
      }

      setNoTextLayer(false);
      setText(result.text);
      setWords(result.totalWords);
      setCharacters(result.totalCharacters);
      setPagesRead(result.pagesRead);
      setPagesWithText(result.pagesWithText);
      report({ percent: 100, done: 1, total: 1, caption: "Finished" });

      return [
        {
          blob: new Blob([result.text], { type: "text/plain;charset=utf-8" }),
          filename: `${baseName(input.name) || "document"}.txt`,
          source: input,
          note: `${formatNumber(result.totalWords)} words`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: { pages: parsed?.indices ?? null, separator },
    });

  const bytesIn = file?.size ?? 0;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${separator}::${results[0]?.blob.size}::ok`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
        status: "success",
        fileName: file?.name,
        fileCount: 1,
        inputBytes: bytesIn,
        outputBytes: results[0]?.blob.size,
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
  }, [stage, results, error, fileKey, separator, file, bytesIn]);

  const canRun = Boolean(file) && !readError && !rangeError;

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

  const partial = pagesRead > 0 && pagesWithText > 0 && pagesWithText < pagesRead;

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
          emptyTitle="Drop a PDF to read its text."
          emptyDescription="This reads the embedded text layer. A scanned page has none, and we will say so."
          dropzoneHint="One file at a time. Nothing is uploaded and no text is stored anywhere."
          renderMeta={() =>
            pageCount === null ? (readError ? <span className="text-brand-500">Unreadable</span> : "Reading…") : `${pageCount} pages`
          }
          controls={
            <div className="grid gap-4">
              <Field
                label="Pages"
                error={rangeError}
                hint={rangeError ? undefined : "Leave empty for the whole document. Example: 1-4, 9"}
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
                    placeholder="1-4, 9"
                    spellCheck={false}
                    inputMode="numeric"
                  />
                )}
              </Field>

              <Field label="Page separator" hint="Applied between pages in the output.">
                {({ id }) => (
                  <Select
                    id={id}
                    value={separator}
                    onChange={(event) => {
                      setSeparator(event.target.value as PageSeparator);
                      reset();
                    }}
                  >
                    {SEPARATOR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {file ? (
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Pages in file" value={pageCount ?? "…"} />
                  <Stat
                    label="Will read"
                    value={parsed ? parsed.indices.length : (pageCount ?? 0)}
                    tone="brand"
                  />
                </dl>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              label="Extract text"
              icon={<ScrollText className="size-4" aria-hidden="true" />}
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
          {noTextLayer ? (
            <ToolError
              title="No text layer in this PDF."
              detail={SCANNED_MESSAGE}
              onRetry={start}
            >
              <p className="max-w-md text-[13px] text-[var(--text-muted)]">
                A scanned page is a picture of text, so there is nothing for the browser to read. We
                would rather tell you that than hand you an empty .txt file that looks like a success.
              </p>
            </ToolError>
          ) : text ? (
            <ResultsPanel title="Extracted text">
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Words" value={formatNumber(words)} tone="brand" />
                <Stat label="Characters" value={formatNumber(characters)} />
                <Stat
                  label="Pages with text"
                  value={`${pagesWithText} / ${pagesRead}`}
                  hint={partial ? "the rest have no text layer" : undefined}
                />
                <Stat label="Output" value={`${formatNumber(characters)} chars`} />
              </dl>

              {partial ? (
                <Notice
                  tone="warning"
                  icon={<TriangleAlert className="size-4" aria-hidden="true" />}
                  title="Some pages have no text layer."
                >
                  {pagesRead - pagesWithText} of the {pagesRead} pages you selected contain no extractable
                  text. They are most likely scans, and they are missing from the output below.
                </Notice>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={text.length === 0}
                  onClick={() => void toast.copy(text, "Text copied to your clipboard")}
                >
                  <Copy className="size-4" aria-hidden="true" />
                  Copy all text
                </Button>
                <CopyButton value={text} label="Copy" what="Text copied to your clipboard" />
                {results[0] ? (
                  <>
                    <DownloadButton
                      blob={results[0].blob}
                      filename={results[0].filename}
                      mime="text/plain;charset=utf-8"
                      label="Download .txt"
                      caption={results[0].note ?? undefined}
                    />
                    <OpenButton
                      blob={results[0].blob}
                      filename={results[0].filename}
                    />
                  </>
                ) : null}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Result</span>
                <textarea
                  readOnly
                  value={text}
                  rows={14}
                  spellCheck={false}
                  aria-label="Extracted text"
                  className="w-full resize-y rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-xs leading-relaxed text-[var(--text-ink)]"
                />
              </label>
            </ResultsPanel>
          ) : (
            <Notice tone="info" icon={<ScrollText className="size-4" aria-hidden="true" />}>
              PDF.js reads the text layer directly, so line breaks follow where the glyphs actually sit
              on the page. This is not OCR: a scanned document has no text layer and will be reported
              as such rather than returning an empty file.
            </Notice>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
