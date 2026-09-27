"use client";

import * as React from "react";
import { Crop, Info } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  clampRect,
  crop,
  mimeLabel,
  outputTypeFor,
  readImageSize,
  type CropRect,
  type OutputMime,
} from "@/lib/tools/engines/image";
import { withExtension } from "@/lib/utils/files";
import { formatBytes, percentSaved } from "@/lib/utils/format";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
import { BeforeAfter } from "@/components/tools/BeforeAfter";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Slider } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-cropper",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Aspect presets. `null` means the selection is free. */
const ASPECTS = [
  { value: "free", label: "Free", ratio: null },
  { value: "1:1", label: "1:1", ratio: 1 },
  { value: "4:3", label: "4:3", ratio: 4 / 3 },
  { value: "3:2", label: "3:2", ratio: 3 / 2 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
] as const;

type AspectValue = (typeof ASPECTS)[number]["value"];

const ASPECT_RATIO: Record<AspectValue, number | null> = {
  free: null,
  "1:1": 1,
  "4:3": 4 / 3,
  "3:2": 3 / 2,
  "16:9": 16 / 9,
};

/** Corner and edge handles, in image-pixel delta terms. */
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLE_LABEL: Record<Handle, string> = {
  nw: "top left",
  n: "top",
  ne: "top right",
  e: "right",
  se: "bottom right",
  s: "bottom",
  sw: "bottom left",
  w: "left",
};

/** Pointer positions inside the image, in image pixels. */
interface DragState {
  kind: "move" | "resize";
  handle?: Handle;
  startX: number;
  startY: number;
  origin: CropRect;
}

interface CropOptions {
  rect: CropRect;
  type: OutputMime;
  quality: number;
  background: string;
}

const transform: TransformFn<CropOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Cropping ${file.name}`,
    });

    const encoded = await crop(file, {
      rect: options.rect,
      type: options.type,
      quality: options.type === "image/png" ? undefined : options.quality / 100,
      background: options.type === "image/jpeg" ? options.background : null,
    });

    results.push({
      blob: encoded.blob,
      filename: withExtension(file.name, EXT_FOR_MIME[options.type] ?? "png"),
      source: file,
      width: encoded.width,
      height: encoded.height,
      note: `from ${options.rect.width} × ${options.rect.height}px of the original`,
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

/** Smallest selection we let a drag or keypress produce, in image pixels. */
const MIN_SIDE = 8;

export default function ImageCropperWorkspace() {
  const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
  const [rect, setRect] = React.useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [aspect, setAspect] = React.useState<AspectValue>("free");
  const [quality, setQuality] = React.useState(92);
  const [background, setBackground] = React.useState("#ffffff");
  const [cropError, setCropError] = React.useState<string | null>(null);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<DragState | null>(null);

  const { files, add, remove, clear } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
  });

  const file = files[0];
  const imageUrl = useObjectUrl(file);
  const type: OutputMime = file ? outputTypeFor(file, file.name) : "image/png";
  const outputLabel = type === "image/png" ? "PNG" : type === "image/webp" ? "WebP" : "JPEG";
  const sourceLabel = file ? mimeLabel(file.type) : "the source";
  const reformat = Boolean(file) && file?.type !== type;

  const options = React.useMemo<CropOptions>(
    () => ({ rect, type, quality, background }),
    [rect, type, quality, background],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  const firstKey = file ? `${file.name}:${file.size}:${file.lastModified}` : null;
  const firstRef = React.useRef<File | undefined>(undefined);
  firstRef.current = file;

  React.useEffect(() => {
    const current = firstRef.current;
    if (!current) {
      setNatural(null);
      return;
    }
    let active = true;
    void readImageSize(current)
      .then((size) => {
        if (!active) return;
        setNatural(size);
        setRect({ x: 0, y: 0, width: size.width, height: size.height });
        setCropError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setNatural(null);
        setCropError(
          caught instanceof Error
            ? caught.message
            : "The browser could not read that image's dimensions.",
        );
      });
    return () => {
      active = false;
    };
  }, [firstKey]);

  /* ---------------------------------------------------------------- */
  /*  Selection maths                                                   */
  /* ---------------------------------------------------------------- */

  const ratio = ASPECT_RATIO[aspect];

  /**
   * Apply a drag or keypress to the selection.
   *
   * With an aspect preset the "other" dimension is derived from the one that
   * moved, anchored on the opposite edge or corner, and the result is clamped to
   * the image — so the selection can never leave the picture.
   */
  const applyResize = React.useCallback(
    (origin: CropRect, handle: Handle, dx: number, dy: number): CropRect => {
      if (!natural) return origin;

      const west = handle.includes("w");
      const east = handle.includes("e");
      const north = handle.startsWith("n");
      const south = handle.startsWith("s");

      let x = origin.x;
      let y = origin.y;
      let width = origin.width;
      let height = origin.height;

      if (east) width = origin.width + dx;
      if (west) {
        width = origin.width - dx;
        x = origin.x + dx;
      }
      if (south) height = origin.height + dy;
      if (north) {
        height = origin.height - dy;
        y = origin.y + dy;
      }

      width = Math.max(MIN_SIDE, Math.round(width));
      height = Math.max(MIN_SIDE, Math.round(height));

      if (ratio) {
        if (east || west) {
          height = Math.max(MIN_SIDE, Math.round(width / ratio));
        } else {
          width = Math.max(MIN_SIDE, Math.round(height * ratio));
        }
      }

      // Push the box back inside the image.
      if (x < 0) {
        x = 0;
      }
      if (y < 0) {
        y = 0;
      }
      if (x + width > natural.width) x = Math.max(0, natural.width - width);
      if (y + height > natural.height) y = Math.max(0, natural.height - height);
      width = Math.min(width, natural.width);
      height = Math.min(height, natural.height);

      return clampRect({ x, y, width, height }, natural);
    },
    [natural, ratio],
  );

  /** Client coordinates → image pixels, using the rendered frame size. */
  const toImageSpace = React.useCallback(
    (clientX: number, clientY: number) => {
      const frame = frameRef.current;
      if (!frame || !natural) return null;
      const box = frame.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return null;
      return {
        x: ((clientX - box.left) / box.width) * natural.width,
        y: ((clientY - box.top) / box.height) * natural.height,
      };
    },
    [natural],
  );

  const beginDrag = (event: React.PointerEvent, kind: "move" | "resize", handle?: Handle) => {
    if (!natural) return;
    const point = toImageSpace(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      handle,
      startX: point.x,
      startY: point.y,
      origin: rect,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !natural) return;
    const point = toImageSpace(event.clientX, event.clientY);
    if (!point) return;
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;

    if (drag.kind === "move") {
      setRect(
        clampRect(
          {
            x: drag.origin.x + dx,
            y: drag.origin.y + dy,
            width: drag.origin.width,
            height: drag.origin.height,
          },
          natural,
        ),
      );
      return;
    }
    if (drag.handle) setRect(applyResize(drag.origin, drag.handle, dx, dy));
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current) {
      const target = event.currentTarget as HTMLElement;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  /** Arrow keys: move with no handle, resize with one. Shift = 10px. */
  const onKeyDown = (event: React.KeyboardEvent, handle?: Handle) => {
    if (!natural) return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    const [dx, dy] = move;
    if (handle) {
      setRect((current) => applyResize(current, handle, dx, dy));
    } else {
      setRect((current) =>
        clampRect(
          { x: current.x + dx, y: current.y + dy, width: current.width, height: current.height },
          natural,
        ),
      );
    }
  };

  const setField = (key: "x" | "y" | "width" | "height", raw: string) => {
    if (!natural) return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    const next: CropRect = { ...rect, [key]: parsed };
    if (ratio && (key === "width" || key === "height")) {
      // Keep the preset when a dimension is typed directly.
      if (key === "width") {
        next.height = Math.max(MIN_SIDE, Math.round(parsed / ratio));
      } else {
        next.width = Math.max(MIN_SIDE, Math.round(parsed * ratio));
      }
    }
    setRect(clampRect(next, natural));
  };

  const selectAll = () => {
    if (!natural) return;
    setAspect("free");
    setRect({ x: 0, y: 0, width: natural.width, height: natural.height });
  };

  const centreSquare = () => {
    if (!natural) return;
    setAspect("1:1");
    const side = Math.min(natural.width, natural.height);
    setRect({
      x: Math.round((natural.width - side) / 2),
      y: Math.round((natural.height - side) / 2),
      width: side,
      height: side,
    });
  };

  const centreLandscape = () => {
    if (!natural) return;
    setAspect("16:9");
    const width = Math.min(natural.width, Math.round(natural.height * (16 / 9)));
    const height = Math.round(width / (16 / 9));
    setRect({
      x: Math.round((natural.width - width) / 2),
      y: Math.round((natural.height - height) / 2),
      width,
      height,
    });
  };

  const start = React.useCallback(() => {
    if (!file || isRunning || !natural) return;
    reported.current = null;
    void run([file]);
  }, [file, isRunning, natural, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
    setCropError(null);
    setAspect("free");
  }, [reset, clear]);

  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(TOOL, {
        status: "success",
        fileName: results[0]?.filename,
        inputBytes: file?.size,
        outputBytes: results[0]?.blob.size,
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

  const result = results[0];
  const ready = natural !== null && rect.width > 0 && rect.height > 0;
  // Percentages of the source, for the readout.
  const coverage =
    natural && natural.width > 0 && natural.height > 0
      ? (rect.width * rect.height) / (natural.width * natural.height)
      : 0;

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
        dropzoneLabel="Drop an image here to crop it"
        dropzoneHint="One image at a time. Drag the selection to move it, drag a handle to resize, or type exact numbers."
        emptyTitle="Drop your files here to get started."
        emptyDescription="Drag out a selection or type the numbers. Handles work with a mouse, a finger and the arrow keys."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            {cropError ? <Notice tone="warning">{cropError}</Notice> : null}

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Aspect ratio</span>
              <Segmented<AspectValue>
                label="Aspect ratio"
                size="sm"
                value={aspect}
                onChange={setAspect}
                options={ASPECTS.map((item) => ({ value: item.value, label: item.label }))}
              />
              <p className="text-xs text-[var(--text-muted)]">
                {ratio
                  ? "Resizing keeps this shape. Changing a handle drags the opposite edge along."
                  : "Free selection: width and height are independent."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="X">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={rect.x || ""}
                    placeholder="—"
                    suffix="px"
                    onChange={(event) => setField("x", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Y">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={rect.y || ""}
                    placeholder="—"
                    suffix="px"
                    onChange={(event) => setField("y", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Width">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={rect.width || ""}
                    placeholder="—"
                    suffix="px"
                    onChange={(event) => setField("width", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Height">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={rect.height || ""}
                    placeholder="—"
                    suffix="px"
                    onChange={(event) => setField("height", event.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={selectAll} disabled={!natural}>
                Whole image
              </Button>
              <Button size="sm" variant="secondary" onClick={centreSquare} disabled={!natural}>
                Centre square
              </Button>
              <Button size="sm" variant="secondary" onClick={centreLandscape} disabled={!natural}>
                Centre 16:9
              </Button>
            </div>

            {type === "image/png" ? (
              <Notice tone="info">
                PNG output is lossless, so there is no quality setting — every pixel of the selection
                is written as it is.
              </Notice>
            ) : (
              <Field
                label={`Output quality — ${quality}%`}
                hint="Cropping re-encodes the kept region. 92 and above keeps the recompression effectively invisible."
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={40}
                    max={100}
                    step={1}
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                  />
                )}
              </Field>
            )}

            {type === "image/jpeg" ? (
              <Field
                label="Background for the cropped region"
                hint="JPEG has no alpha channel, so any transparency the browser's decode produced is filled with this colour."
              >
                {({ id, describedBy }) => (
                  <div className="flex items-center gap-2">
                    <input
                      id={id}
                      type="color"
                      aria-describedby={describedBy}
                      value={background}
                      onChange={(event) => setBackground(event.target.value)}
                      className="h-10 w-16 cursor-pointer rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-1"
                    />
                    <span className="font-mono text-xs uppercase text-[var(--text-muted)]">
                      {background}
                    </span>
                  </div>
                )}
              </Field>
            ) : null}

            <p className="text-xs text-[var(--text-muted)]">
              Output format: {outputLabel}
              {reformat
                ? ` — this browser cannot re-encode ${sourceLabel}, so the crop is written as ${outputLabel}.`
                : ", the same as the source."}
            </p>
          </div>
        }
        action={
          <ProcessButton
            label="Crop to selection"
            icon={<Crop className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file || !ready}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {file && imageUrl ? (
        <figure className="mt-5 flex flex-col gap-2">
          <div className="flex justify-center">
            <div ref={frameRef} className="relative inline-block max-w-full">
              <img
                src={imageUrl}
                alt={file.name}
                draggable={false}
                className="block max-h-[26rem] w-auto max-w-full select-none"
              />

              {/* Dimmed area outside the selection, as four plain bands — a
                  clip-path hole is cleverer but far harder to verify. */}
              {ready ? (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                  <div
                    className="absolute left-0 top-0 w-full bg-black/55"
                    style={{ height: `${(rect.y / (natural?.height ?? 1)) * 100}%` }}
                  />
                  <div
                    className="absolute bottom-0 w-full bg-black/55"
                    style={{
                      top: `${((rect.y + rect.height) / (natural?.height ?? 1)) * 100}%`,
                    }}
                  />
                  <div
                    className="absolute left-0 top-0 bg-black/55"
                    style={{
                      width: `${(rect.x / (natural?.width ?? 1)) * 100}%`,
                      height: `${((rect.y + rect.height) / (natural?.height ?? 1)) * 100}%`,
                    }}
                  />
                  <div
                    className="absolute right-0 top-0 bg-black/55"
                    style={{
                      left: `${((rect.x + rect.width) / (natural?.width ?? 1)) * 100}%`,
                      height: `${((rect.y + rect.height) / (natural?.height ?? 1)) * 100}%`,
                    }}
                  />
                </div>
              ) : null}

              {ready ? (
                <div
                  className="absolute"
                  style={{
                    left: `${(rect.x / (natural?.width ?? 1)) * 100}%`,
                    top: `${(rect.y / (natural?.height ?? 1)) * 100}%`,
                    width: `${(rect.width / (natural?.width ?? 1)) * 100}%`,
                    height: `${(rect.height / (natural?.height ?? 1)) * 100}%`,
                  }}
                >
                  {/* The move region: a real focusable control so the selection
                      can be nudged with the arrow keys. */}
                  <button
                    type="button"
                    aria-label={`Crop selection, ${rect.width} by ${rect.height} pixels at ${rect.x}, ${rect.y}. Use the arrow keys to move it.`}
                    onPointerDown={(event) => beginDrag(event, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(event) => onKeyDown(event)}
                    className="absolute inset-0 cursor-move border border-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                    style={{ touchAction: "none" }}
                  />

                  {(
                    [
                      ["nw", "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
                      ["n", "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize"],
                      ["ne", "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
                      ["e", "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
                      ["se", "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
                      ["s", "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize"],
                      ["sw", "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
                      ["w", "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
                    ] as const
                  ).map(([handle, position]) => (
                    <button
                      key={handle}
                      type="button"
                      aria-label={`Resize from the ${HANDLE_LABEL[handle]}. Arrow keys resize, hold shift for 10 pixels.`}
                      onPointerDown={(event) => beginDrag(event, "resize", handle)}
                      onPointerMove={onPointerMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => onKeyDown(event, handle)}
                      className={`absolute z-10 size-3.5 rounded-[3px] border border-black/60 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${position}`}
                      style={{ touchAction: "none" }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <figcaption className="text-xs text-[var(--text-muted)]">
            {natural ? (
              <>
                Source{" "}
                <span className="font-mono tabular-nums text-[var(--text-ink)]">
                  {natural.width} × {natural.height}px
                </span>{" "}
                · selection{" "}
                <span className="font-mono tabular-nums text-[var(--text-ink)]">
                  {rect.width} × {rect.height}px
                </span>{" "}
                at {rect.x}, {rect.y} ·{" "}
                <span className="font-mono tabular-nums text-[var(--text-ink)]">
                  {(coverage * 100).toFixed(1)}%
                </span>{" "}
                of the picture. Arrow keys move the selection, or resize it when a handle has focus.
              </>
            ) : (
              "Reading the image dimensions…"
            )}
          </figcaption>
          <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
            The browser decodes the image with its EXIF rotation already applied, so the crop matches
            what you see. The output carries no metadata.
          </Notice>
        </figure>
      ) : null}

      {result?.source ? (
        <ResultsPanel title="Cropped image" className="mt-6">
          <div className="flex flex-col gap-4">
            <BeforeAfter
              beforeBlob={result.source}
              afterBlob={result.blob}
              beforeBytes={result.source.size}
              afterBytes={result.blob.size}
              beforeWidth={natural?.width}
              beforeHeight={natural?.height}
              afterWidth={result.width}
              afterHeight={result.height}
              beforeLabel="Original"
              afterLabel="Cropped"
            />
            <DownloadButton
              blob={result.blob}
              filename={result.filename}
              caption={`${result.width} × ${result.height}px · ${formatBytes(result.blob.size)} · ${percentSaved(result.source.size, result.blob.size).toFixed(1)}% smaller than the original file`}
            />
          </div>
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
