"use client";

import * as React from "react";
import { Check, Copy, Download, ExternalLink, FileDown, Loader2, Pencil, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { downloadBlob, downloadDataUrl, downloadText, sanitizeFilename } from "@/lib/utils/files";
import { formatBytes } from "@/lib/utils/format";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ */
/*  Primary download button                                            */
/* ------------------------------------------------------------------ */

export interface DownloadButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** Any of these decides which download path we take. */
  blob?: Blob | null;
  dataUrl?: string | null;
  text?: string | null;
  filename: string;
  /** Text-based downloads get this MIME type. */
  mime?: string;
  label?: React.ReactNode;
  /** Shown under the button, e.g. "412 KB · 68% smaller". */
  caption?: React.ReactNode;
  /** Ask the browser to open the result in a new tab instead of saving it. */
  open?: boolean;
}

function resolve(blob: Blob | null | undefined, dataUrl: string | null | undefined, text: string | null | undefined): Blob | string | null {
  if (blob) return blob;
  if (dataUrl) return dataUrl;
  if (typeof text === "string") return text;
  return null;
}

/**
 * The standard download affordance. Handles blob, data-URL and text results,
 * toasts on completion, and sanitises the filename.
 */
export function DownloadButton({
  blob,
  dataUrl,
  text,
  filename,
  mime = "application/octet-stream",
  label = "Download",
  caption,
  open = false,
  disabled,
  ...props
}: DownloadButtonProps) {
  const value = resolve(blob, dataUrl, text);
  const ready = value !== null;

  const onClick = () => {
    if (value === null) return;
    if (typeof value === "string" && value.startsWith("data:")) {
      if (open) window.open(value, "_blank", "noopener,noreferrer");
      else {
        downloadDataUrl(value, filename);
        toast.downloadReady(filename);
      }
      return;
    }
    if (typeof value === "string") {
      if (open) {
        // Open text output in a read-only tab rather than saving it.
        const url = URL.createObjectURL(new Blob([value], { type: mime }));
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        toast.success("Opened in a new tab");
      } else {
        downloadText(value, filename, mime);
        toast.downloadReady(filename);
      }
      return;
    }
    if (open) {
      const url = URL.createObjectURL(value);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Opened in a new tab");
    } else {
      downloadBlob(value, filename);
      toast.downloadReady(filename, value.size);
    }
  };

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <Button
        variant="primary"
        onClick={onClick}
        disabled={disabled || !ready}
        className="w-full sm:w-auto"
        {...props}
      >
        {open ? <ExternalLink className="size-4" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
        {label}
      </Button>
      {caption ? (
        <p className="text-center text-xs text-[var(--text-muted)] sm:text-left">{caption}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Copy / open / rename cluster                                       */
/* ------------------------------------------------------------------ */

export function CopyButton({
  value,
  label = "Copy",
  what = "Copied to clipboard",
  size = "sm",
  variant = "secondary",
  className,
}: {
  value: string | null;
  label?: React.ReactNode;
  what?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  return (
    <Tooltip content="Copy the result to your clipboard">
      <Button
        size={size}
        variant={variant}
        disabled={!value}
        onClick={() => value && toast.copy(value, what)}
        aria-label={typeof label === "string" ? label : "Copy result"}
        className={className}
      >
        <Copy className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </Button>
    </Tooltip>
  );
}

export function OpenButton({
  blob,
  dataUrl,
  filename,
  size = "sm",
  variant = "secondary",
  className,
}: {
  blob?: Blob | null;
  dataUrl?: string | null;
  filename?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const ready = Boolean(blob || dataUrl);
  return (
    <Tooltip content="Open the result in a new tab">
      <Button
        size={size}
        variant={variant}
        disabled={!ready}
        className={className}
        aria-label="Open result in a new tab"
        onClick={() => {
          if (dataUrl) return window.open(dataUrl, "_blank", "noopener,noreferrer");
          if (blob) {
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }
        }}
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Open</span>
      </Button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/*  Rename output                                                       */
/* ------------------------------------------------------------------ */

export function RenameOutput({
  value,
  onChange,
  suffix = "output",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Appended when the user clears the field, e.g. "image-compressed". */
  suffix?: string;
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const id = React.useId();

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    const cleaned = sanitizeFilename(draft);
    onChange(cleaned || suffix);
    setEditing(false);
  };

  if (!editing) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className={className}
        onClick={() => setEditing(true)}
        aria-label={`Rename output file, currently ${value}`}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        <span className="hidden truncate sm:inline">{value}</span>
      </Button>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <label htmlFor={id} className="sr-only">
        Output filename
      </label>
      <input
        id={id}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onBlur={commit}
        className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2 text-xs focus:border-brand-500 focus:outline-none"
      />
      <Button size="icon-sm" variant="ghost" onClick={commit} aria-label="Save filename">
        <Check className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Batch download group                                                */
/* ------------------------------------------------------------------ */

export interface DownloadGroupProps {
  /** Individual results. */
  items: { name: string; blob: Blob }[];
  /** Name of the ZIP produced by "Download all". */
  zipName: string;
  /** Total input bytes, used for the "you saved X" caption. */
  originalTotalBytes?: number;
  className?: string;
  disabled?: boolean;
}

/**
 * Batch download cluster: individual saves plus a single ZIP.
 * JSZip is only imported when the user actually asks for the archive.
 */
export function DownloadGroup({
  items,
  zipName,
  originalTotalBytes,
  className,
  disabled,
}: DownloadGroupProps) {
  const [zipping, setZipping] = React.useState(false);
  const [zipProgress, setZipProgress] = React.useState<number | null>(null);

  const outputTotal = items.reduce((sum, item) => sum + item.blob.size, 0);
  const saved = originalTotalBytes ? originalTotalBytes - outputTotal : 0;

  const downloadZip = async () => {
    setZipping(true);
    setZipProgress(0);
    try {
      const { downloadZipBatch } = await import("@/lib/utils/files");
      await downloadZipBatch(items, zipName, (percent) => setZipProgress(percent));
      toast.downloadReady(`${zipName}.zip`, undefined);
    } catch (error) {
      toast.error("Couldn't build the ZIP", (error as Error).message);
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={disabled || items.length === 0} onClick={downloadZip} loading={zipping}>
          {zipping ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileDown className="size-4" aria-hidden="true" />}
          Download all ({items.length})
        </Button>
        <span className="text-xs text-[var(--text-muted)]">
          {formatBytes(outputTotal)}
          {saved > 0 ? ` · ${formatBytes(saved)} smaller` : ""}
        </span>
      </div>

      {zipping ? (
        <div
          role="progressbar"
          aria-valuenow={zipProgress ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Building ZIP"
          className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-card-2)]"
        >
          <span
            className="block h-full rounded-full bg-brand-500 transition-[width] duration-200"
            style={{ width: `${zipProgress ?? 0}%` }}
          />
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="grid gap-1.5">
          {items.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-ink)]">
                {item.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                {formatBytes(item.blob.size)}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Download ${item.name}`}
                onClick={() => {
                  downloadBlob(item.blob, item.name);
                  toast.downloadReady(item.name, item.blob.size);
                }}
              >
                <Download className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  "Processed locally" pill used next to download actions            */
/* ------------------------------------------------------------------ */

export function LocalOnlyPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2 py-1 text-[11px] text-[var(--text-muted)]",
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      Runs in your browser
    </span>
  );
}
