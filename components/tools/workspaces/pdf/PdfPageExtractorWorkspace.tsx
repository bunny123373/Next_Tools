"use client";

import * as React from "react";
import { Check, Loader2, Scissors, X } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils/cn";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import {
  extractPdfPages,
  formatPageList,
  getPdfPageCount,
  parsePageRange,
  renderPageThumbnail,
  withPdfJsDocument,
} from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-page-extractor", category: "pdf", processing: "local" } as const;

/**
 * How many page thumbnails we render.
 *
 * Rendering a page means rasterising it, so a 900-page document would be an
 * unresponsive tab. The cap is stated in the UI and the range box still reaches
 * every page.
 */
export const THUMBNAIL_LIMIT = 60;

const THUMB_WIDTH = 150;

export interface PageThumbnail {
  /** Zero-based page index. */
  index: number;
  url: string;
}

export interface UsePageThumbnailsResult {
  thumbnails: PageThumbnail[];
  pageCount: number | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  caption: string;
  /** Pages that exist but were not rendered, because of the cap. */
  hiddenPages: number;
}

/**
 * Render the first `limit` pages of a PDF as small JPEG object URLs.
 *
 * Every URL is revoked when the file changes or the component unmounts, and the
 * pdf.js document is destroyed by `withPdfJsDocument` even if rendering throws.
 */
export function usePageThumbnails(file: File | null, limit: number): UsePageThumbnailsResult {
  const [thumbnails, setThumbnails] = React.useState<PageThumbnail[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [status, setStatus] = React.useState<UsePageThumbnailsResult["status"]>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [caption, setCaption] = React.useState("");

  const key = file ? `${file.name}:${file.size}:${file.lastModified}` : "";

  React.useEffect(() => {
    setThumbnails([]);
    setPageCount(null);
    setError(null);
    setCaption("");
    if (!file) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    const urls: string[] = [];
    setStatus("loading");

    void (async () => {
      try {
        const count = await getPdfPageCount(file);
        if (cancelled) return;
        setPageCount(count);

        const visible = Math.min(count, limit);
        const collected: PageThumbnail[] = [];
        await withPdfJsDocument(file, async (doc) => {
          for (let index = 0; index < visible; index += 1) {
            if (cancelled) return;
            setCaption(`Rendering page ${index + 1} of ${visible}`);
            const blob = await renderPageThumbnail(doc, index, THUMB_WIDTH);
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            urls.push(url);
            collected.push({ index, url });
            setThumbnails([...collected]);
          }
        });

        if (cancelled) return;
        setCaption("");
        setStatus("ready");
      } catch (caught) {
        if (cancelled) return;
        setStatus("error");
        setError(caught instanceof Error ? caught.message : "This PDF could not be previewed.");
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [key, limit, file]);

  return {
    thumbnails,
    pageCount,
    status,
    error,
    caption,
    hiddenPages: pageCount === null ? 0 : Math.max(0, pageCount - thumbnails.length),
  };
}

/* ------------------------------------------------------------------ */
/*  Shared page grid                                                   */
/* ------------------------------------------------------------------ */

/**
 * The clickable page grid used by the extractor, the rotator and the
 * PDF-to-image exporter.
 *
 * It lives in this file because these workspaces are the only ones that need
 * it, and the contract gives each tool exactly one workspace file. Import it
 * from `./PdfPageExtractorWorkspace` rather than re-implementing it.
 */
export function PageThumbnailGrid({
  thumbnails,
  pageCount,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onInvert,
  disabled = false,
  emptyLabel = "No pages to show yet.",
}: {
  thumbnails: PageThumbnail[];
  pageCount: number | null;
  selected: ReadonlySet<number>;
  onToggle: (index: number) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  onInvert?: () => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  if (thumbnails.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--surface-line-strong)] px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {onSelectAll || onSelectNone || onInvert ? (
        <div className="flex flex-wrap gap-2">
          {onSelectAll ? (
            <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={disabled}>
              Select all shown
            </Button>
          ) : null}
          {onSelectNone ? (
            <Button size="sm" variant="ghost" onClick={onSelectNone} disabled={disabled}>
              Clear
            </Button>
          ) : null}
          {onInvert ? (
            <Button size="sm" variant="ghost" onClick={onInvert} disabled={disabled}>
              Invert
            </Button>
          ) : null}
        </div>
      ) : null}

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {thumbnails.map((thumbnail) => {
          const active = selected.has(thumbnail.index);
          return (
            <li key={thumbnail.index}>
              <button
                type="button"
                role="checkbox"
                aria-checked={active}
                disabled={disabled}
                onClick={() => onToggle(thumbnail.index)}
                aria-label={`Page ${thumbnail.index + 1}${active ? ", selected" : ""}`}
                className={cn(
                  "group relative flex w-full flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                  active
                    ? "border-brand-500 bg-brand-500/10"
                    : "border-[var(--surface-line)] bg-[var(--surface-card-2)] hover:border-[var(--surface-line-strong)]",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    active ? "border-brand-500 bg-brand-500" : "border-[var(--surface-line-strong)]",
                  )}
                  aria-hidden="true"
                >
                  {active ? <Check className="size-2.5 text-white" strokeWidth={3.5} /> : null}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnail.url}
                  alt=""
                  width={THUMB_WIDTH}
                  className="w-full rounded bg-white/5 object-contain"
                  loading="lazy"
                  decoding="async"
                />
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  {thumbnail.index + 1}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {pageCount !== null && thumbnails.length < pageCount ? (
        <p className="text-[11px] text-[var(--text-muted)]">
          Showing the first {thumbnails.length} of {pageCount} pages. Use the page range box to reach
          the rest.
        </p>
      ) : null}
    </div>
  );
}

/** Small status line shared by the grids while pdf.js is rasterising. */
export function ThumbnailStatus({
  status,
  caption,
  hiddenPages,
  error,
}: Pick<UsePageThumbnailsResult, "status" | "caption" | "hiddenPages" | "error">) {
  if (status === "error" && error) {
    return <ToolError title="The page previews could not be rendered." detail={error} />;
  }
  if (status === "loading") {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {caption || "Rendering page previews…"}
      </p>
    );
  }
  if (status === "ready" && hiddenPages > 0) {
    return (
      <p className="text-[11px] text-[var(--text-muted)]">
        {hiddenPages} further page{hiddenPages === 1 ? "" : "s"} not previewed — use the page range box
        to select {hiddenPages === 1 ? "it" : "them"}.
      </p>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Workspace                                                          */
/* ------------------------------------------------------------------ */

interface Options {
  selection: number[];
  outputName: string;
}

export default function PdfPageExtractorWorkspace() {
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
  const [outputName, setOutputName] = React.useState("extracted");

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
      if (options.selection.length === 0) {
        throw new Error("Select at least one page, or type a range such as 1-3, 7.");
      }
      report({ percent: null, done: 0, total: inputs.length, caption: "Copying the selected pages" });
      const result = await extractPdfPages(input, options.selection);
      report({ percent: 100, done: inputs.length, total: inputs.length });
      return [
        {
          blob: result.blob,
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: `${result.pageCount} page${result.pageCount === 1 ? "" : "s"} extracted`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: { selection: [...selection].sort((a, b) => a - b), outputName },
    });

  const bytesIn = file?.size ?? 0;
  const selectedCount = selection.size;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::ok::${results[0]?.filename}::${selectedCount}`;
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
  }, [stage, results, error, fileKey, file, bytesIn, selectedCount]);

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

  const result = results[0];

  return (
    <ToolShell>
      <div className="flex flex-col gap-6">
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
          emptyTitle="Drop a PDF to pick pages from."
          emptyDescription="Click the pages you want, or type a range. Both stay in sync."
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
                      : "Example: 2-4, 9"
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
                    placeholder="2-4, 9"
                    spellCheck={false}
                    inputMode="numeric"
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

              {file ? (
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Pages in file" value={pageCount ?? "…"} />
                  <Stat label="Selected" value={selectedCount} tone="brand" />
                </dl>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              label="Extract pages"
              icon={<Scissors className="size-4" aria-hidden="true" />}
              onClick={start}
              disabled={!canRun}
              loading={isRunning}
            />
          }
          secondary={
            <Button
              variant="ghost"
              onClick={() => {
                selectNone();
                reset();
              }}
              disabled={isRunning || selectedCount === 0}
            >
              <X className="size-4" aria-hidden="true" />
              Clear selection
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

        {file ? (
          <section aria-label="Page picker" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text-ink)]">Page picker</h3>
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

        {result ? (
          <ResultsPanel title="Extracted document">
            <dl className="grid grid-cols-2 gap-2">
              <Stat label="Pages kept" value={selectedCount} tone="brand" />
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
        ) : file ? (
          <Notice tone="info" icon={<Scissors className="size-4" aria-hidden="true" />}>
            Selected pages are copied into a brand new document. The pages you drop are left out
            entirely, so their images and fonts are not copied and the result is usually smaller.
          </Notice>
        ) : null}
      </div>
    </ToolShell>
  );
}
