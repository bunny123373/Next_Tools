"use client";

import * as React from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { SITE } from "@/lib/site";
import { sumSizes, type FileCategory } from "@/lib/utils/files";
import { formatBytes } from "@/lib/utils/format";
import { useFiles } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/tools/FileDropzone";
import { ProgressBar, type ProcessingStage } from "@/components/tools/ProgressBar";
import { ToolEmptyState, ToolError, ToolSuccess } from "@/components/tools/states";

/* ------------------------------------------------------------------ */
/*  Transform pipeline                                                 */
/* ------------------------------------------------------------------ */

export interface TransformResult {
  /** The processed file. */
  blob: Blob;
  /** Sanitised output filename. */
  filename: string;
  /** The input it came from, for pairing before/after. */
  source?: File;
  width?: number;
  height?: number;
  /** Free-form per-file note, e.g. "6 pages" or "3 s". */
  note?: string;
}

/** What a tool's transform reports back while it runs. */
export interface TransformProgress {
  /** 0–100, or null when the real ratio is not knowable. */
  percent: number | null;
  /** Files finished so far. */
  done: number;
  total: number;
  /** Current file name or step. */
  caption?: string;
}

export type TransformFn<O> = (
  files: File[],
  options: O,
  report: (progress: TransformProgress) => void,
) => Promise<TransformResult[]>;

/** "idle" is the pre-start state; the other four come from ProgressBar. */
export type PipelineStage = ProcessingStage | "idle";

export interface UseTransformOptions<O> {
  transform: TransformFn<O>;
  options: O;
}

/**
 * The processing state machine shared by every file tool.
 *
 * Progress is batch-aware: `done / total` is always real, and `percent` is only
 * set when the transform itself can report it. Nothing is faked.
 */
export function useTransform<O>({ transform, options }: UseTransformOptions<O>) {
  const [results, setResults] = React.useState<TransformResult[]>([]);
  const [stage, setStage] = React.useState<PipelineStage>("idle");
  const [percent, setPercent] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [caption, setCaption] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);

  const runId = React.useRef(0);
  const isRunning = stage === "preparing" || stage === "processing" || stage === "finalizing";

  const run = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0 || isRunning) return;
      const id = ++runId.current;

      setStage("preparing");
      setError(null);
      setResults([]);
      setDone(0);
      setTotal(files.length);
      setPercent(files.length > 1 ? 0 : null);
      setCaption("");

      // Yield once so the "preparing" state actually paints before we block.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      setStage("processing");

      try {
        const report = (progress: TransformProgress) => {
          if (id !== runId.current) return;
          setDone(progress.done);
          setTotal(progress.total);
          setPercent(progress.percent);
          setCaption(progress.caption ?? "");
        };

        const output = await transform(files, options, report);
        if (id !== runId.current) return;

        setStage("finalizing");
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

        setResults(output);
        setDone(files.length);
        setStage("complete");
        setPercent(100);
        toast.processingComplete(
          output.length === 1 ? "Processing complete" : `${output.length} files ready`,
        );
      } catch (caught) {
        if (id !== runId.current) return;
        setStage("idle");
        setPercent(null);
        setError(
          caught instanceof Error
            ? caught.message
            : "Something went wrong. Please try again.",
        );
      }
    },
    [transform, options, isRunning],
  );

  const reset = React.useCallback(() => {
    runId.current += 1;
    setResults([]);
    setStage("idle");
    setPercent(null);
    setDone(0);
    setTotal(0);
    setCaption("");
    setError(null);
  }, []);

  return { results, stage, percent, done, total, caption, error, run, reset, isRunning, setError };
}

/* ------------------------------------------------------------------ */
/*  File stage — dropzone + controls + actions + progress               */
/* ------------------------------------------------------------------ */

export interface FileStageProps {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onReorder?: (from: number, to: number) => void;
  category: FileCategory;
  multiple?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  mimeAllow?: string[];
  reorderable?: boolean;
  /** The main action. Omit to render a dropzone-only stage. */
  action?: React.ReactNode;
  /** Secondary action (reset, etc.). */
  secondary?: React.ReactNode;
  /** Control strip between the file list and the actions. */
  controls?: React.ReactNode;
  stage?: PipelineStage;
  percent?: number | null;
  done?: number;
  total?: number;
  caption?: string;
  error?: string | null;
  onRetry?: () => void;
  dropzoneLabel?: React.ReactNode;
  dropzoneHint?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  renderMeta?: (file: File, index: number) => React.ReactNode;
  /** Hide the dropzone while work is in flight. */
  lockWhileRunning?: boolean;
}

/** Left/top half of a file tool: choose files, tweak options, start the job. */
export function FileStage({
  files,
  onAdd,
  onRemove,
  onClear,
  onReorder,
  category,
  multiple = false,
  maxFiles,
  maxBytes = SITE.limits.image,
  mimeAllow,
  reorderable,
  action,
  secondary,
  controls,
  stage,
  percent,
  done = 0,
  total = 0,
  caption,
  error,
  onRetry,
  dropzoneLabel,
  dropzoneHint,
  emptyTitle,
  emptyDescription,
  className,
  renderMeta,
  lockWhileRunning = true,
}: FileStageProps) {
  const running = stage === "preparing" || stage === "processing" || stage === "finalizing";
  const totalBytes = sumSizes(files);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {files.length === 0 && !running && emptyTitle ? (
        <ToolEmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <FileDropzone
          category={category}
          multiple={multiple}
          maxFiles={maxFiles}
          maxBytes={maxBytes}
          mimeAllow={mimeAllow}
          onAdd={onAdd}
          files={files}
          onRemove={onRemove}
          onClear={onClear}
          onReorder={onReorder}
          reorderable={reorderable}
          disabled={running && lockWhileRunning}
          label={dropzoneLabel}
          hint={dropzoneHint}
          renderMeta={renderMeta}
        >
          {totalBytes > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
              <span className="font-mono tabular-nums">{formatBytes(totalBytes)}</span> total
            </p>
          ) : null}
        </FileDropzone>
      )}

      {controls}

      {action || secondary ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {action}
          {secondary}
        </div>
      ) : null}

      {running || stage === "complete" ? (
        <ProgressBar
          stage={stage ?? "preparing"}
          percent={percent}
          detail={total > 1 ? `${done} / ${total} files completed` : undefined}
          caption={caption}
        />
      ) : null}

      {error ? <ToolError onRetry={onRetry} detail={error} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Primary action button with a shortcut hint                          */
/* ------------------------------------------------------------------ */

export function ProcessButton({
  onClick,
  disabled,
  loading,
  label,
  icon,
  hint = "Ctrl + Enter",
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  icon?: React.ReactNode;
  /** Set false when Ctrl+Enter is not wired up on this tool. */
  shortcut?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 sm:flex-row sm:items-center", className)}>
      <Button variant="primary" onClick={onClick} disabled={disabled} loading={loading} className="w-full sm:w-auto">
        {icon ?? <Sparkles className="size-4" aria-hidden="true" />}
        {label}
      </Button>
      <span className="text-[11px] text-[var(--text-muted)]">
        or press{" "}
        <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">
          {hint}
        </kbd>
      </span>
    </div>
  );
}

export function ResetButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" onClick={onClick} className={className}>
      <RotateCcw className="size-4" aria-hidden="true" />
      Reset
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Results panel                                                      */
/* ------------------------------------------------------------------ */

export function ResultsPanel({
  children,
  title = "Result",
  className,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)} aria-label={title}>
      <h3 className="text-sm font-semibold text-[var(--text-ink)]">{title}</h3>
      {children}
    </section>
  );
}

export { ToolSuccess, ToolError, ToolEmptyState };
