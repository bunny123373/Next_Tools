"use client";

import * as React from "react";
import { FileText, GripVertical, Plus, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  buildAccept,
  validateFiles,
  type FileCategory,
} from "@/lib/utils/files";
import { formatBytes } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/lib/utils/toast";
import { ToolEmptyState } from "./states";

/* ------------------------------------------------------------------ */
/*  File row                                                           */
/* ------------------------------------------------------------------ */

export interface FileRowProps {
  file: File;
  index: number;
  onRemove?: () => void;
  /** Drag handle for reordering (PDF merge, JPG→PDF ordering, …). */
  onDragStart?: () => void;
  onDrop?: () => void;
  dragging?: boolean;
  reorderable?: boolean;
  /** Extra metadata rendered under the name, e.g. "6 pages". */
  meta?: React.ReactNode;
  /** Right-hand slot, e.g. a per-file status or a download button. */
  trailing?: React.ReactNode;
  disabled?: boolean;
}

/** One line in the selected-files list. */
export function FileRow({
  file,
  index,
  onRemove,
  onDragStart,
  onDrop,
  dragging,
  reorderable,
  meta,
  trailing,
  disabled,
}: FileRowProps) {
  return (
    <li
      draggable={reorderable && !disabled}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        if (reorderable) event.preventDefault();
      }}
      onDrop={(event) => {
        if (reorderable) {
          event.preventDefault();
          onDrop?.();
        }
      }}
      onDragEnd={() => onDragStart?.()}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2.5",
        "transition-colors duration-150 hover:border-[var(--surface-line-strong)]",
        dragging && "opacity-40",
        reorderable && "cursor-grab active:cursor-grabbing",
      )}
    >
      {reorderable ? (
        <GripVertical
          aria-hidden="true"
          className="size-4 shrink-0 text-[var(--text-ink-dim,color-mix(in_srgb,var(--text-muted)_60%,transparent))]"
        />
      ) : (
        <FileText aria-hidden="true" className="size-4 shrink-0 text-[var(--text-muted)]" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-[var(--text-ink)]" title={file.name}>
          {file.name}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="font-mono tabular-nums">{formatBytes(file.size)}</span>
          {meta ? <span className="truncate">{meta}</span> : null}
        </p>
      </div>

      {trailing}

      {onRemove ? (
        <Tooltip content={`Remove ${file.name}`}>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </Tooltip>
      ) : null}

      <span className="sr-only">Item {index + 1}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Dropzone                                                           */
/* ------------------------------------------------------------------ */

export interface FileDropzoneProps {
  /** Which file family to accept. */
  category: FileCategory;
  /** Accept several files. */
  multiple?: boolean;
  /** Hard size ceiling per file, in bytes. */
  maxBytes: number;
  maxFiles?: number;
  /** Extra MIME types beyond the category defaults. */
  mimeAllow?: string[];
  /** Called with the validated files. Rejections are reported separately. */
  onAdd: (files: File[]) => void;
  /** Current queue, rendered beneath the drop area. */
  files?: File[];
  onRemove?: (index: number) => void;
  onClear?: () => void;
  onReorder?: (from: number, to: number) => void;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Hides the big drop area and shows only a compact "Add files" button. */
  compact?: boolean;
  reorderable?: boolean;
  disabled?: boolean;
  className?: string;
  /** Rendered under the file list (e.g. a merge action). */
  children?: React.ReactNode;
  /** Per-file metadata resolver, e.g. page count for PDFs. */
  renderMeta?: (file: File, index: number) => React.ReactNode;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * The shared upload surface: drag & drop, click-to-browse, keyboard activation,
 * type + size validation, per-file removal, clear-all and optional reordering.
 */
export function FileDropzone({
  category,
  multiple = false,
  maxBytes,
  maxFiles,
  mimeAllow,
  onAdd,
  files = [],
  onRemove,
  onClear,
  onReorder,
  label,
  hint,
  compact = false,
  reorderable = false,
  disabled = false,
  className,
  children,
  renderMeta,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const accept = buildAccept(category, mimeAllow);
  const limitLabel = maxFiles ? ` up to ${maxFiles} at a time` : "";
  const sizeLabel = maxBytes >= GB ? `${Math.round(maxBytes / GB)} GB` : `${Math.round(maxBytes / MB)} MB`;

  const handleFiles = React.useCallback(
    (incoming: FileList | File[] | null) => {
      if (disabled || !incoming) return;
      const list = Array.from(incoming);
      if (list.length === 0) return;

      onAdd(list);

      // Rejections are announced immediately; accepted files get a soft toast.
      // Validation itself lives in lib/utils/files so every tool behaves the same.
      const { files: accepted, errors } = validateFiles(list, { category, maxBytes, mimeAllow });
      const overLimit = maxFiles ? Math.max(0, files.length + accepted.length - maxFiles) : 0;

      if (errors.length > 0 || overLimit > 0) {
        const count = errors.length + overLimit;
        toast.error(
          count === 1 ? "File rejected" : `${count} files rejected`,
          errors[0]?.message ??
            `Only ${maxFiles} ${maxFiles === 1 ? "file is" : "files are"} allowed at a time.`,
        );
      } else if (accepted.length > 0) {
        toast.fileAdded(accepted.length, accepted.length === 1 ? list[0]?.name : undefined);
      }
    },
    [category, disabled, files.length, maxBytes, maxFiles, mimeAllow, multiple, onAdd],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const hasFiles = files.length > 0;

  if (compact) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files);
            // Allow re-picking the same file.
            event.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
            <Plus className="size-4" aria-hidden="true" />
            Add {multiple ? "files" : "file"}
          </Button>
          {hasFiles && onClear ? (
            <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
              Clear all
            </Button>
          ) : null}
          <span className="self-center text-[11px] text-[var(--text-muted)]">
            {categoryLabel(category, mimeAllow)} · max {sizeLabel}
          </span>
        </div>

        {hasFiles ? (
          <ul className="grid gap-1.5">
            {files.map((file, index) => (
              <FileRow
                key={`${file.name}-${index}-${file.size}`}
                file={file}
                index={index}
                onRemove={onRemove ? () => onRemove(index) : undefined}
                meta={renderMeta?.(file, index)}
                onDragStart={reorderable ? () => setDragIndex(index) : undefined}
                onDrop={reorderable ? () => {
                  if (dragIndex !== null && dragIndex !== index) onReorder?.(dragIndex, index);
                  setDragIndex(null);
                } : undefined}
                dragging={dragIndex === index}
                reorderable={reorderable}
                disabled={disabled}
              />
            ))}
          </ul>
        ) : null}

        {children}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={`Upload ${multiple ? "files" : "a file"}: ${label ?? categoryLabel(category, mimeAllow)}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={onDrop}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-3",
          "rounded-[14px] border-2 border-dashed px-6 py-12 text-center",
          "transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          dragging
            ? "border-brand-500 bg-brand-500/[0.07]"
            : "border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] hover:border-brand-500/50 hover:bg-[var(--surface-card-2)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid size-12 place-items-center rounded-xl border transition-colors duration-200",
            dragging
              ? "border-brand-500/40 bg-brand-500/15 text-brand-500"
              : "border-[var(--surface-line)] bg-[var(--surface-card)] text-[var(--text-muted)] group-hover:text-brand-500",
          )}
        >
          <UploadCloud className="size-5" />
        </span>

        <div className="space-y-1">
          <p className="text-[15px] font-medium text-[var(--text-ink)]">
            {dragging ? "Drop to upload" : (label ?? `Drop your ${multiple ? "files" : "file"} here`)}
          </p>
          <p className="text-[13px] text-[var(--text-muted)]">
            or <span className="font-medium text-brand-500">browse from your device</span>
          </p>
        </div>

        <p className="text-[11px] text-[var(--text-muted)]">
          {categoryLabel(category, mimeAllow)}
          {limitLabel} · max {sizeLabel} each
        </p>

        {hint ? <p className="max-w-sm text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
      </div>

      {hasFiles ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-[var(--text-ink)]" role="status">
              {files.length} {files.length === 1 ? "file" : "files"} selected
            </p>
            {onClear ? (
              <Button size="sm" variant="ghost" onClick={onClear} disabled={disabled}>
                Clear all
              </Button>
            ) : null}
          </div>

          <ul className="grid gap-1.5">
            {files.map((file, index) => (
              <FileRow
                key={`${file.name}-${index}-${file.size}`}
                file={file}
                index={index}
                onRemove={onRemove ? () => onRemove(index) : undefined}
                meta={renderMeta?.(file, index)}
                onDragStart={reorderable ? () => setDragIndex(index) : undefined}
                onDrop={reorderable ? () => {
                  if (dragIndex !== null && dragIndex !== index) onReorder?.(dragIndex, index);
                  setDragIndex(null);
                } : undefined}
                dragging={dragIndex === index}
                reorderable={reorderable}
                disabled={disabled}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {children}
    </div>
  );
}

/**
 * Human-readable acceptance label.
 *
 * When a tool passes a narrow `mimeAllow` alongside `category: "any"` — a
 * single-format converter does exactly that so it gets real type rejection —
 * the generic "Any file" label is misleading. Derive it from the MIME list so
 * the dropzone says "JPG" rather than "Any file".
 */
function categoryLabel(category: FileCategory, mimeAllow?: string[]): string {
  if (category === "any") {
    if (!mimeAllow?.length) return "Any file";
    const short = Array.from(
      new Set(
        mimeAllow.map((mime) => {
          const subtype = (mime.split("/")[1] ?? mime).toLowerCase();
          const known: Record<string, string> = {
            jpeg: "JPG",
            jpg: "JPG",
            png: "PNG",
            webp: "WebP",
            gif: "GIF",
            pdf: "PDF",
            mpeg: "MP3",
            mp3: "MP3",
            wav: "WAV",
            "x-wav": "WAV",
            quicktime: "MOV",
          };
          return known[subtype] ?? subtype.toUpperCase();
        }),
      ),
    );
    if (short.length === 0) return "Any file";
    if (short.length <= 3) return short.join(", ");
    return `${short.slice(0, 3).join(", ")} +${short.length - 3}`;
  }

  switch (category) {
    case "image":
      return "JPG, PNG, WebP, GIF, AVIF";
    case "pdf":
      return "PDF";
    case "video":
      return "MP4, WebM, MOV";
    case "audio":
      return "MP3, WAV, M4A, OGG, FLAC";
    case "text":
      return "TXT, MD, CSV, JSON, XML, HTML";
  }
}

/* ------------------------------------------------------------------ */
/*  Dropzone-only convenience wrapper                                  */
/* ------------------------------------------------------------------ */

export function SimpleDropzone({
  onAdd,
  category,
  maxBytes,
  multiple = false,
  disabled,
  className,
  children,
}: {
  onAdd: (files: File[]) => void;
  category: FileCategory;
  maxBytes: number;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  if (disabled) {
    return (
      <ToolEmptyState
        title="Processing…"
        description="This tool is busy. Your results will appear here in a moment."
        className={className}
      />
    );
  }
  return (
    <FileDropzone
      category={category}
      multiple={multiple}
      maxBytes={maxBytes}
      onAdd={onAdd}
      disabled={disabled}
      className={className}
    >
      {children}
    </FileDropzone>
  );
}
