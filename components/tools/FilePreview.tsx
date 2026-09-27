"use client";

import * as React from "react";
import { FileAudio, FileImage, FileText, FileVideo, Music } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { getExtension } from "@/lib/utils/files";
import { Badge } from "@/components/ui/badge";
import { useObjectUrl } from "@/lib/hooks";

/* ------------------------------------------------------------------ */
/*  Image                                                              */
/* ------------------------------------------------------------------ */

export interface ImagePreviewProps {
  src: string;
  alt: string;
  className?: string;
  /** Checkerboard behind transparent PNG/WebP. */
  checkerboard?: boolean;
  imgClassName?: string;
  /** Rendered as a caption under the image. */
  caption?: React.ReactNode;
  sizes?: string;
}

export function ImagePreview({
  src,
  alt,
  className,
  checkerboard = true,
  imgClassName,
  caption,
  sizes = "(max-width: 768px) 100vw, 50vw",
}: ImagePreviewProps) {
  return (
    <figure className={cn("m-0 flex flex-col gap-2", className)}>
      <div
        className={cn(
          "relative flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3",
          checkerboard && "checkerboard",
        )}
      >
        {/* Decorative here: every surrounding control is already labelled. */}
        <img
          src={src}
          alt={alt}
          sizes={sizes}
          className={cn("max-h-[26rem] w-auto max-w-full object-contain", imgClassName)}
          onError={(event) => {
            (event.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      {caption ? <figcaption className="text-xs text-[var(--text-muted)]">{caption}</figcaption> : null}
    </figure>
  );
}

/** Small square thumbnail for file lists. */
export function ImageThumb({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
      <img src={src} alt={alt} className="size-full object-cover" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Media players                                                      */
/* ------------------------------------------------------------------ */

export function AudioPreview({
  file,
  src,
  className,
}: {
  file: File | Blob;
  src: string;
  className?: string;
}) {
  const name = file instanceof File ? file.name : "audio";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] text-brand-500"
        >
          <Music className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[var(--text-ink)]">{name}</p>
          <p className="text-[11px] text-[var(--text-muted)]">
            {file.size ? formatBytes(file.size) : null}
            {file instanceof File && getExtension(file.name) ? ` · .${getExtension(file.name)}` : null}
          </p>
        </div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied audio, no captions apply */}
      <audio controls src={src} className="w-full">
        <track kind="captions" />
      </audio>
    </div>
  );
}

export function VideoPreview({
  file,
  src,
  className,
  controls = true,
  caption: captionOverride,
}: {
  file: File | Blob;
  src: string;
  className?: string;
  controls?: boolean;
  /** Replaces the default "name · size" caption. */
  caption?: React.ReactNode;
}) {
  const name = file instanceof File ? file.name : "video";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied video, no captions apply */}
      <video
        controls={controls}
        playsInline
        preload="metadata"
        src={src}
        className="max-h-[26rem] w-full rounded-xl border border-[var(--surface-line)] bg-black object-contain"
      />
      <p className="truncate text-xs text-[var(--text-muted)]">
        {captionOverride ?? (
          <>
            {name}
            {file.size ? ` · ${formatBytes(file.size)}` : null}
          </>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Generic file preview (PDF and anything else)                        */
/* ------------------------------------------------------------------ */

export function FilePreviewCard({
  file,
  className,
  meta,
  children,
}: {
  file: File | Blob;
  className?: string;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const name = file instanceof File ? file.name : "file";
  const ext = file instanceof File ? getExtension(file.name) : "";
  const Icon = ext === "pdf" ? FileText : ext === "mp3" || ext === "wav" ? FileAudio : FileText;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] text-[var(--text-muted)]"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-[var(--text-ink)]">{name}</p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {file.size ? `${formatBytes(file.size)}` : null}
          {ext ? ` · .${ext}` : null}
        </p>
        {meta}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auto preview — picks the right renderer for the file type           */
/* ------------------------------------------------------------------ */

export type PreviewKind = "image" | "audio" | "video" | "pdf" | "generic";

export function detectPreviewKind(file: File): PreviewKind {
  const ext = getExtension(file.name);
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf" || ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov", "mkv", "ogv"].includes(ext)) return "video";
  return "generic";
}

/** Convenience: creates and revokes an object URL for `file`. */
export function AutoFilePreview({ file, className }: { file: File; className?: string }) {
  const kind = React.useMemo(() => detectPreviewKind(file), [file]);
  const url = useObjectUrl(file);

  if (!url) return null;

  switch (kind) {
    case "image":
      return <ImagePreview src={url} alt={file.name} className={className} />;
    case "audio":
      return <AudioPreview file={file} src={url} className={className} />;
    case "video":
      return <VideoPreview file={file} src={url} className={className} />;
    case "pdf":
      return <FilePreviewCard file={file} className={className} />;
    default:
      return <FilePreviewCard file={file} className={className} />;
  }
}

/* ------------------------------------------------------------------ */
/*  File-type badge                                                     */
/* ------------------------------------------------------------------ */

export function FileTypeBadge({ file }: { file: File }) {
  const ext = getExtension(file.name);
  return (
    <Badge tone="outline" className="uppercase">
      {ext || "file"}
    </Badge>
  );
}

export { FileAudio, FileImage, FileText, FileVideo };
