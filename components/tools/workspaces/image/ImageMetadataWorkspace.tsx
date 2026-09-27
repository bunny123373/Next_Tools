"use client";

import * as React from "react";
import { Info, ScanEye, TriangleAlert } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import { readImageMetadata, type ImageMetadata } from "@/lib/tools/engines/image";
import { getExtension } from "@/lib/utils/files";
import { formatBytes } from "@/lib/utils/format";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  useTransform,
  type TransformFn,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { Stat } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-metadata",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

/** The viewer has no options — the file is the only input. */
type InspectOptions = Record<string, never>;

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--surface-line)] py-2 last:border-b-0">
      <dt className="shrink-0 text-[13px] text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono text-[13px] text-[var(--text-ink)]">
        {value}
      </dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
      <h4 className="mb-1 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** A human-readable version of the report, for copy and download. */
function reportText(file: File, meta: ImageMetadata): string {
  const lines: string[] = [];
  const add = (key: string, value: string) => lines.push(`${key.padEnd(22)}${value}`);

  add("File", file.name);
  add("Detected format", meta.format);
  add("MIME type", meta.mimeType);
  add("Size", `${meta.byteLength} bytes (${formatBytes(meta.byteLength)})`);
  add(
    "Stored dimensions",
    meta.width && meta.height ? `${meta.width} × ${meta.height}px` : "not found in header",
  );
  add(
    "Decoded dimensions",
    meta.decoded ? `${meta.decoded.width} × ${meta.decoded.height}px` : "not decoded",
  );
  add("Decodable here", meta.decodeError ? "no" : "yes");

  if (meta.exif) {
    lines.push("", "EXIF");
    add("Orientation", meta.exif.orientationLabel ?? "—");
    add("DateTimeOriginal", meta.exif.dateTimeOriginal ?? "—");
    add("Make", meta.exif.make ?? "—");
    add("Model", meta.exif.model ?? "—");
    add("Exposure time", meta.exif.exposureTime ?? "—");
    add("Aperture", meta.exif.fNumber ?? "—");
    add("ISO", meta.exif.iso !== null ? String(meta.exif.iso) : "—");
    add("Focal length", meta.exif.focalLength ?? "—");
    add("Software", meta.exif.software ?? "—");
    add("Tags read", String(meta.exif.tagCount));
    add("GPS block", meta.exif.gpsPresent ? "present" : "absent");
    if (meta.exif.gps) {
      add("GPS latitude", meta.exif.gps.latitude.toFixed(6));
      add("GPS longitude", meta.exif.gps.longitude.toFixed(6));
    }
  } else {
    lines.push("", "EXIF: no Exif data found in this file.");
  }

  if (meta.png) {
    lines.push("", "PNG chunks");
    add("Bit depth", String(meta.png.bitDepth));
    add("Colour type", meta.png.colorType);
    add("Interlace", meta.png.interlace);
    add("Physical density", meta.png.dpi ? `${meta.png.dpi.x} × ${meta.png.dpi.y} dpi` : "not declared");
    add("Embedded Exif", meta.png.hasExif ? "yes" : "no");
    add("Chunks", meta.png.chunks.map((chunk) => chunk.type).join(", ") || "—");
    for (const entry of meta.png.text) add(`tEXt ${entry.key}`, entry.value);
  }

  if (meta.webp) {
    lines.push("", "WebP chunks");
    add("Chunks", meta.webp.chunks.map((chunk) => chunk.type).join(", ") || "—");
    add("Alpha channel", meta.webp.hasAlpha ? "yes" : "no");
    add("ICC profile", meta.webp.hasIcc ? "yes" : "no");
    add("XMP metadata", meta.webp.hasXmp ? "yes" : "no");
    add("Animation", meta.webp.hasAnimation ? "yes" : "no");
    add("Embedded Exif", meta.webp.hasExif ? "yes" : "no");
  }

  if (meta.notes.length > 0) {
    lines.push("", "Notes");
    for (const note of meta.notes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}

export default function ImageMetadataWorkspace() {
  const { files, add, remove, clear } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
  });

  const file = files[0];
  const options = React.useMemo<InspectOptions>(() => ({}), []);

  // The parsed report is written during the transform and read back on render,
  // so the file is parsed exactly once per inspection.
  const metaRef = React.useRef<Map<string, ImageMetadata>>(new Map());

  const transform = React.useCallback<TransformFn<InspectOptions>>(
    async (files, _options, report) => {
      const results: TransformResult[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const current = files[index];
        if (!current) continue;

        report({
          percent: files.length > 1 ? (index / files.length) * 100 : null,
          done: index,
          total: files.length,
          caption: `Reading headers of ${current.name}`,
        });

        const meta = await readImageMetadata(current);
        metaRef.current.set(fileKey(current), meta);

        results.push({
          blob: new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }),
          filename: `${current.name}.metadata.json`,
          source: current,
          width: meta.width ?? undefined,
          height: meta.height ?? undefined,
          note: `${meta.format} · ${formatBytes(current.size)}`,
        });

        report({
          percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
          done: index + 1,
          total: files.length,
        });
      }

      return results;
    },
    [],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  const start = React.useCallback(() => {
    if (!file || isRunning) return;
    reported.current = null;
    void run([file]);
  }, [file, isRunning, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
  }, [reset, clear]);

  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(TOOL, {
        status: "success",
        fileName: file?.name,
        inputBytes: file?.size,
      });
    }
    if (error && reported.current !== error) {
      reported.current = error;
      recordJob(TOOL, {
        status: "error",
        fileName: file?.name,
        inputBytes: file?.size,
        errorMessage: error,
      });
    }
  }, [stage, results, error, file]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [start]);

  const json = results[0];
  const meta = React.useMemo(
    () => (file && json?.source ? (metaRef.current.get(fileKey(json.source)) ?? null) : null),
    [file, json],
  );

  const text = file && meta ? reportText(file, meta) : null;
  const textName = file ? `${file.name.replace(/\.[^.]+$/, "")}.metadata.txt` : "metadata.txt";
  const ext = file ? getExtension(file.name) : "";
  const orientation = meta?.exif?.orientation ?? null;
  const rotated = orientation !== null && orientation >= 5 && orientation <= 8;
  const storedDiffers =
    meta?.width && meta?.height && meta.decoded
      ? meta.width !== meta.decoded.width || meta.height !== meta.decoded.height
      : false;

  return (
    <ToolShell>
      <FileStage
        files={files}
        onAdd={add}
        onRemove={remove}
        onClear={clear}
        category="image"
        maxBytes={SITE.limits.image}
        stage={stage}
        percent={percent}
        done={done}
        total={total}
        caption={caption}
        error={error}
        onRetry={start}
        dropzoneLabel="Drop an image here to inspect it"
        dropzoneHint="One file at a time. JPEG, PNG, WebP, GIF and BMP headers are parsed here; any other format is measured by decoding the pixels."
        emptyTitle="Drop your files here to get started."
        emptyDescription="A read-only inspector. It parses the JPEG Exif segment, the PNG chunk table and the WebP RIFF header, and says plainly when there is no metadata to find."
        action={
          <ProcessButton
            label="Inspect metadata"
            icon={<ScanEye className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {error ? (
        <ToolError
          className="mt-6"
          title="The file could not be inspected."
          detail={error}
          onRetry={start}
        >
          <p className="max-w-md text-[13px] text-[var(--text-muted)]">
            A truncated file often still has a readable header. If nothing could be parsed at all,
            the file is probably not an image, or its first bytes are damaged.
          </p>
        </ToolError>
      ) : null}

      {meta && file ? (
        <div className="mt-6 flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Format"
              value={meta.format}
              hint={ext ? `.${ext} filename` : "from magic bytes"}
            />
            <Stat
              label="Stored size"
              value={meta.width && meta.height ? `${meta.width}×${meta.height}` : "—"}
              hint="from the file header"
            />
            <Stat
              label="File size"
              value={formatBytes(meta.byteLength)}
              hint={`${meta.byteLength.toLocaleString()} bytes`}
            />
            <Stat
              label="MIME type"
              value={meta.mimeType.replace(/^image\//, "").toUpperCase() || "unknown"}
              hint="reported by the browser"
            />
          </dl>

          {storedDiffers && meta.decoded ? (
            <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
              The header stores {meta.width} × {meta.height}px, but viewers display{" "}
              {meta.decoded.width} × {meta.decoded.height}px
              {rotated && meta.exif?.orientationLabel
                ? `, because EXIF orientation ${orientation} means “${meta.exif.orientationLabel}”`
                : ""}
              . Both numbers are correct — they answer different questions.
            </Notice>
          ) : null}

          {meta.decodeError ? (
            <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
              The header was read, but this browser cannot decode the pixels: {meta.decodeError} A
              site you upload to may still be able to display it.
            </Notice>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="EXIF">
              {meta.exif ? (
                <dl>
                  <Row
                    label="Orientation"
                    value={
                      orientation !== null
                        ? `${orientation} — ${meta.exif.orientationLabel}`
                        : "not recorded"
                    }
                  />
                  <Row label="Captured" value={meta.exif.dateTimeOriginal ?? "not recorded"} />
                  <Row label="Make" value={meta.exif.make ?? "not recorded"} />
                  <Row label="Model" value={meta.exif.model ?? "not recorded"} />
                  <Row label="Exposure" value={meta.exif.exposureTime ?? "not recorded"} />
                  <Row label="Aperture" value={meta.exif.fNumber ?? "not recorded"} />
                  <Row
                    label="ISO"
                    value={meta.exif.iso !== null ? String(meta.exif.iso) : "not recorded"}
                  />
                  <Row label="Focal length" value={meta.exif.focalLength ?? "not recorded"} />
                  <Row label="Software" value={meta.exif.software ?? "not recorded"} />
                  <Row
                    label="GPS"
                    value={
                      meta.exif.gps
                        ? `${meta.exif.gps.latitude.toFixed(5)}, ${meta.exif.gps.longitude.toFixed(5)}`
                        : meta.exif.gpsPresent
                          ? "present but incomplete"
                          : "absent"
                    }
                  />
                  <Row label="Tags read" value={String(meta.exif.tagCount)} />
                </dl>
              ) : (
                <p className="py-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
                  No EXIF data found in this file. That is the honest answer for a screenshot, an
                  exported asset, or anything that has already been through an image editor or a
                  messaging app — all of them write a fresh file with no Exif block.
                </p>
              )}
            </Panel>

            {meta.png ? (
              <Panel title="PNG chunks">
                <dl>
                  <Row label="Dimensions" value={`${meta.png.width} × ${meta.png.height}px`} />
                  <Row label="Bit depth" value={String(meta.png.bitDepth)} />
                  <Row label="Colour type" value={meta.png.colorType} />
                  <Row label="Interlace" value={meta.png.interlace} />
                  <Row
                    label="Physical density"
                    value={meta.png.dpi ? `${meta.png.dpi.x} × ${meta.png.dpi.y} dpi` : "not declared"}
                  />
                  <Row label="Embedded Exif" value={meta.png.hasExif ? "yes" : "no"} />
                  <Row
                    label="Chunks"
                    value={meta.png.chunks.map((chunk) => chunk.type).join(" · ") || "none recorded"}
                  />
                  {meta.png.text.map((entry) => (
                    <Row key={entry.key} label={`tEXt · ${entry.key}`} value={entry.value} />
                  ))}
                </dl>
              </Panel>
            ) : meta.webp ? (
              <Panel title="WebP chunks">
                <dl>
                  <Row label="Dimensions" value={`${meta.webp.width} × ${meta.webp.height}px`} />
                  <Row
                    label="Chunks"
                    value={meta.webp.chunks.map((chunk) => chunk.type).join(" · ") || "none recorded"}
                  />
                  <Row label="Alpha channel" value={meta.webp.hasAlpha ? "yes" : "no"} />
                  <Row label="ICC profile" value={meta.webp.hasIcc ? "yes" : "no"} />
                  <Row label="XMP metadata" value={meta.webp.hasXmp ? "yes" : "no"} />
                  <Row label="Animation" value={meta.webp.hasAnimation ? "yes" : "no"} />
                  <Row label="Embedded Exif" value={meta.webp.hasExif ? "yes" : "no"} />
                </dl>
              </Panel>
            ) : (
              <Panel title="Container">
                <dl>
                  <Row label="Format" value={meta.format} />
                  <Row label="Signature" value="matched by magic bytes, not by extension" />
                  <Row
                    label="Decoded here"
                    value={meta.decoded ? `${meta.decoded.width} × ${meta.decoded.height}px` : "no"}
                  />
                  <Row label="Header parser" value={`none for ${meta.format}`} />
                </dl>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
                  There is no container parser for {meta.format} here, so the dimensions above come
                  from decoding the pixels. That is a real measurement — it just means the browser
                  had to do more work first.
                </p>
              </Panel>
            )}
          </div>

          {meta.notes.length > 0 ? (
            <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
              {meta.notes.map((note) => (
                <span key={note} className="block">
                  {note}
                </span>
              ))}
            </Notice>
          ) : null}

          {meta.exif?.gps ? (
            <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
              This file carries GPS coordinates. Nothing was uploaded to read them — but be aware that
              sending the file anywhere else will send them with it.
            </Notice>
          ) : null}

          <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
            Any tool here that re-encodes through the canvas — the compressor, the resizer, every
            converter — writes a file with no EXIF, no GPS and no embedded colour profile. That is
            usually what you want. If you need to keep the metadata, keep the original file.
          </Notice>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton value={text} label="Copy report" what="Metadata report copied" />
              <DownloadButton
                text={text}
                mime="text/plain;charset=utf-8"
                filename={textName}
                label="Download report (.txt)"
                variant="secondary"
              />
              <DownloadButton
                blob={json?.blob ?? null}
                filename={json?.filename ?? "metadata.json"}
                label="Download raw JSON"
                variant="secondary"
              />
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
              {text}
            </pre>
          </div>
        </div>
      ) : null}
    </ToolShell>
  );
}
