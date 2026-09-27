"use client";

import * as React from "react";
import { ImagePlus, Sticker, Type, Upload, X } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  FONT_STACKS,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_LABELS,
  mimeLabel,
  outputTypeFor,
  watermark,
  type OutputMime,
  type LogoWatermark,
  type TextWatermark,
  type WatermarkOptions,
  type WatermarkPosition,
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
import { Checkbox, Field, Input, Select, Slider } from "@/components/ui/form";
import { toast } from "@/lib/utils/toast";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "image-watermark",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type Mode = "text" | "logo";

interface MarkOptions {
  mode: Mode;
  text: string;
  color: string;
  sizePercent: number;
  rotation: number;
  opacity: number;
  position: WatermarkPosition;
  bold: boolean;
  italic: boolean;
  fontFamily: string;
  logo: File | null;
  logoWidthPercent: number;
  type: OutputMime;
  quality: number;
  background: string;
}

const transform: TransformFn<MarkOptions> = async (files, options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Stamping ${file.name}`,
    });

    const spec: LogoWatermark | TextWatermark =
      options.mode === "logo" && options.logo
        ? {
            mode: "logo",
            logo: options.logo,
            widthPercent: options.logoWidthPercent,
            rotation: options.rotation,
            opacity: options.opacity,
            position: options.position,
          }
        : {
            mode: "text",
            text: options.text,
            color: options.color,
            sizePercent: options.sizePercent,
            rotation: options.rotation,
            opacity: options.opacity,
            position: options.position,
            bold: options.bold,
            italic: options.italic,
            fontFamily: options.fontFamily,
          };

    const encoded = await watermark(file, {
      ...spec,
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
      note: options.mode === "logo" ? "logo watermark" : `“${options.text.trim()}” watermark`,
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

const PREVIEW_BOX = { width: 520, height: 320 };

/** 3×3 anchor grid. */
function PositionPicker({
  value,
  onChange,
}: {
  value: WatermarkPosition;
  onChange: (position: WatermarkPosition) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Watermark position"
      className="grid w-fit grid-cols-3 gap-1.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-1.5"
    >
      {WATERMARK_POSITIONS.map((position) => {
        const active = position === value;
        return (
          <button
            key={position}
            type="button"
            role="radio"
            aria-checked={active}
            title={WATERMARK_POSITION_LABELS[position]}
            onClick={() => onChange(position)}
            className={[
              "grid size-8 place-items-center rounded-lg border transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
              active
                ? "border-brand-500 bg-brand-500/15"
                : "border-[var(--surface-line)] hover:border-[var(--surface-line-strong)]",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className={[
                "size-2.5 rounded-[2px]",
                active ? "bg-brand-500" : "bg-[var(--text-muted)]",
              ].join(" ")}
            />
            <span className="sr-only">{WATERMARK_POSITION_LABELS[position]}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function ImageWatermarkWorkspace() {
  const [mode, setMode] = React.useState<Mode>("text");
  const [text, setText] = React.useState("© Your Name");
  const [color, setColor] = React.useState("#ffffff");
  const [sizePercent, setSizePercent] = React.useState(6);
  const [rotation, setRotation] = React.useState(0);
  const [opacity, setOpacity] = React.useState(60);
  const [position, setPosition] = React.useState<WatermarkPosition>("bottom-right");
  const [bold, setBold] = React.useState(true);
  const [italic, setItalic] = React.useState(false);
  const [fontFamily, setFontFamily] = React.useState<string>(FONT_STACKS[0].value);
  const [logo, setLogo] = React.useState<File | null>(null);
  const [logoWidthPercent, setLogoWidthPercent] = React.useState(25);
  const [quality, setQuality] = React.useState(92);
  const [background, setBackground] = React.useState("#ffffff");
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const logoInputRef = React.useRef<HTMLInputElement>(null);

  const { files, add, remove, clear } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
  });

  const file = files[0];
  const type: OutputMime = file ? outputTypeFor(file, file.name) : "image/png";
  const sourceLabel = file ? mimeLabel(file.type) : "the source";
  const outputName = type === "image/png" ? "PNG" : type === "image/webp" ? "WebP" : "JPEG";
  const reformat = Boolean(file) && file?.type !== type;
  const logoUrl = useObjectUrl(logo);

  const options = React.useMemo<MarkOptions>(
    () => ({
      mode,
      text,
      color,
      sizePercent,
      rotation,
      opacity,
      position,
      bold,
      italic,
      fontFamily,
      logo,
      logoWidthPercent,
      type,
      quality,
      background,
    }),
    [
      mode,
      text,
      color,
      sizePercent,
      rotation,
      opacity,
      position,
      bold,
      italic,
      fontFamily,
      logo,
      logoWidthPercent,
      type,
      quality,
      background,
    ],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  const markReady = mode === "logo" ? logo !== null : text.trim().length > 0;

  // The preview goes through the same engine call as the export, bounded to a
  // preview size. Text and logo sizes are relative to the image, so what you
  // see is what the encoder writes.
  const previewSpec = React.useMemo<WatermarkOptions | null>(() => {
    if (!file || !markReady) return null;
    const base =
      mode === "logo" && logo
        ? {
            mode: "logo" as const,
            logo,
            widthPercent: logoWidthPercent,
            rotation,
            opacity,
            position,
          }
        : {
            mode: "text" as const,
            text,
            color,
            sizePercent,
            rotation,
            opacity,
            position,
            bold,
            italic,
            fontFamily,
          };
    return {
      ...base,
      type: "image/jpeg",
      background: type === "image/jpeg" ? background : null,
      maxWidth: PREVIEW_BOX.width,
      maxHeight: PREVIEW_BOX.height,
    };
  }, [
    file,
    markReady,
    mode,
    logo,
    logoWidthPercent,
    rotation,
    opacity,
    position,
    text,
    color,
    sizePercent,
    bold,
    italic,
    fontFamily,
    type,
    background,
  ]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !file || !previewSpec) return;
    let active = true;
    const timer = setTimeout(() => {
      setPreviewBusy(true);
      void watermark(file, previewSpec)
        .then(async (encoded) => {
          if (!active) return;
          const url = URL.createObjectURL(encoded.blob);
          try {
            const image = new Image();
            await new Promise<void>((resolve, reject) => {
              image.onload = () => resolve();
              image.onerror = () => reject(new Error("The preview could not be drawn."));
              image.src = url;
            });
            if (!active) return;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const scale =
              Math.min(PREVIEW_BOX.width / encoded.width, PREVIEW_BOX.height / encoded.height) * dpr;
            canvas.width = Math.max(1, Math.round(encoded.width * scale));
            canvas.height = Math.max(1, Math.round(encoded.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("This browser blocked the canvas preview.");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            setPreviewError(null);
          } finally {
            URL.revokeObjectURL(url);
          }
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setPreviewError(
            caught instanceof Error ? caught.message : "The preview could not be rendered.",
          );
        })
        .finally(() => {
          if (active) setPreviewBusy(false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [file, previewSpec]);

  const start = React.useCallback(() => {
    if (!file || isRunning || !markReady) return;
    reported.current = null;
    void run([file]);
  }, [file, isRunning, markReady, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
    setPreviewError(null);
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
  const grew = result?.source ? result.blob.size > result.source.size : false;

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
        dropzoneLabel="Drop an image here to watermark it"
        dropzoneHint="One image at a time, plus a logo file if you chose logo mode. Both stay on your device."
        emptyTitle="Drop your files here to get started."
        emptyDescription="Stamp text or your own logo onto an image at one of nine positions, with opacity, size and rotation control."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Watermark type</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={mode === "text" ? "primary" : "secondary"}
                  aria-pressed={mode === "text"}
                  onClick={() => setMode("text")}
                >
                  <Type className="size-4" aria-hidden="true" />
                  Text
                </Button>
                <Button
                  size="sm"
                  variant={mode === "logo" ? "primary" : "secondary"}
                  aria-pressed={mode === "logo"}
                  onClick={() => setMode("logo")}
                >
                  <ImagePlus className="size-4" aria-hidden="true" />
                  Logo image
                </Button>
              </div>
            </div>

            {mode === "text" ? (
              <>
                <Field label="Text" hint="Drawn with a thin dark outline so it stays readable on light images.">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={text}
                      maxLength={120}
                      placeholder="© Your Name"
                      onChange={(event) => setText(event.target.value)}
                    />
                  )}
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Colour">
                    {({ id }) => (
                      <div className="flex items-center gap-2">
                        <input
                          id={id}
                          type="color"
                          value={color}
                          onChange={(event) => setColor(event.target.value)}
                          className="h-10 w-16 cursor-pointer rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-1"
                        />
                        <span className="font-mono text-xs uppercase text-[var(--text-muted)]">
                          {color}
                        </span>
                      </div>
                    )}
                  </Field>
                  <Field label="Font" hint="The first available family in the stack is used.">
                    {({ id, describedBy }) => (
                      <Select
                        id={id}
                        aria-describedby={describedBy}
                        value={fontFamily}
                        onChange={(event) => setFontFamily(event.target.value)}
                      >
                        {FONT_STACKS.map((font) => (
                          <option key={font.value} value={font.value}>
                            {font.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>

                <Field
                  label={`Font size — ${sizePercent}% of the shorter side`}
                  hint="Relative sizing, so the mark looks the same on a thumbnail and a 24-megapixel photo."
                >
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={1}
                      max={30}
                      step={1}
                      value={sizePercent}
                      onChange={(event) => setSizePercent(Number(event.target.value))}
                    />
                  )}
                </Field>

                <div className="flex flex-col gap-2.5">
                  <Checkbox
                    label="Bold"
                    checked={bold}
                    onChange={(event) => setBold(event.target.checked)}
                  />
                  <Checkbox
                    label="Italic"
                    checked={italic}
                    onChange={(event) => setItalic(event.target.checked)}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    event.target.value = "";
                    if (!picked) return;
                    if (picked.size > SITE.limits.image) {
                      toast.rejected(
                        `"${picked.name}" is larger than the ${Math.round(
                          SITE.limits.image / 1024 / 1024,
                        )} MB limit.`,
                      );
                      return;
                    }
                    setLogo(picked);
                    setPreviewError(null);
                  }}
                />
                {logo ? (
                  <div className="flex items-center gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] p-3">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={`Logo to overlay: ${logo.name}`}
                        className="checkerboard size-12 rounded-lg border border-[var(--surface-line)] object-contain"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[var(--text-ink)]">
                        {logo.name}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {formatBytes(logo.size)}
                      </p>
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove logo ${logo.name}`}
                      onClick={() => setLogo(null)}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => logoInputRef.current?.click()}>
                    <Upload className="size-4" aria-hidden="true" />
                    Choose a logo image
                  </Button>
                )}

                <Field
                  label={`Logo width — ${logoWidthPercent}% of the image`}
                  hint="The logo keeps its own aspect ratio."
                >
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={5}
                      max={80}
                      step={1}
                      value={logoWidthPercent}
                      disabled={!logo}
                      onChange={(event) => setLogoWidthPercent(Number(event.target.value))}
                    />
                  )}
                </Field>
              </div>
            )}

            {/* The picker is a radiogroup with its own accessible name, so it is
                labelled with a span rather than a <label for>. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Position</span>
              <PositionPicker value={position} onChange={setPosition} />
              <p className="text-xs text-[var(--text-muted)]">
                Anchored 4% in from the edge, so the mark survives a platform that trims the image.
              </p>
            </div>

            <Field
              label={`Opacity — ${opacity}%`}
              hint="Below 20% a logo is easy to crop out; above 80% it covers the picture."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={5}
                  max={100}
                  step={1}
                  value={opacity}
                  onChange={(event) => setOpacity(Number(event.target.value))}
                />
              )}
            </Field>

            <Field
              label={`Rotation — ${rotation}°`}
              hint="Rotation is about the mark's own centre, so the anchor point stays put."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={-180}
                  max={180}
                  step={1}
                  value={rotation}
                  onChange={(event) => setRotation(Number(event.target.value))}
                />
              )}
            </Field>

            {type === "image/png" ? (
              <Notice tone="info">
                PNG output is lossless and keeps transparency — the right choice for a logo, and the
                reason there is no quality setting.
              </Notice>
            ) : (
              <>
                <Field
                  label={`Output quality — ${quality}%`}
                  hint="Adding a mark re-encodes the image. 92 and above keeps the recompression effectively invisible."
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
                {type === "image/jpeg" ? (
                  <Field
                    label="Background for transparent areas"
                    hint="JPEG has no alpha channel, so transparency in the source or the logo is filled with this colour."
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
              </>
            )}

            {previewError ? <Notice tone="warning">{previewError}</Notice> : null}

            <p className="text-xs text-[var(--text-muted)]">
              Output format: {outputName}
              {reformat
                ? ` — this browser cannot re-encode ${sourceLabel}, so the result is written as ${outputName}.`
                : ", the same as the source."}
            </p>
          </div>
        }
        action={
          <ProcessButton
            label="Add watermark"
            icon={<Sticker className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file || !markReady}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {file ? (
        <figure className="mt-5 flex flex-col gap-2">
          <div className="checkerboard relative flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Live preview of ${file.name} with the watermark applied`}
              className="max-h-80 max-w-full"
            />
            {previewBusy ? (
              <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[11px] text-white">
                Updating preview…
              </span>
            ) : null}
          </div>
          <figcaption className="text-xs text-[var(--text-muted)]">
            Live preview, rendered by the same code as the export at a bounded size. The download is
            the full-resolution version.
          </figcaption>
          {!markReady ? (
            <Notice tone="warning">
              {mode === "logo"
                ? "Choose a logo image to see the preview."
                : "Type some text to see the preview."}
            </Notice>
          ) : null}
        </figure>
      ) : null}

      {result?.source ? (
        <ResultsPanel title="Watermarked image" className="mt-6">
          <div className="flex flex-col gap-4">
            <BeforeAfter
              beforeBlob={result.source}
              afterBlob={result.blob}
              beforeBytes={result.source.size}
              afterBytes={result.blob.size}
              afterWidth={result.width}
              afterHeight={result.height}
              beforeLabel="Original"
              afterLabel="Watermarked"
            />
            {grew ? (
              <Notice tone="warning">
                The watermarked file is {formatBytes(result.blob.size - result.source.size)} larger
                than the source — the mark adds detail the encoder has to spend bits on. Lower the
                quality to 85 if size matters.
              </Notice>
            ) : null}
            <DownloadButton
              blob={result.blob}
              filename={result.filename}
              caption={`${result.width} × ${result.height}px · ${formatBytes(result.blob.size)} · ${percentSaved(result.source.size, result.blob.size).toFixed(1)}% smaller`}
            />
          </div>
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
