"use client";

import * as React from "react";
import { Sticker } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Slider, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import {
  addWatermark,
  formatPageList,
  getPdfPageCount,
  parsePageRange,
  type WatermarkMode,
} from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-watermark", category: "pdf", processing: "local" } as const;

const MODE_OPTIONS: ReadonlyArray<{ value: WatermarkMode; label: string }> = [
  { value: "single", label: "One mark" },
  { value: "tile", label: "Tiled" },
];

const COLOUR_PRESETS = [
  { value: "#d91f1f", label: "Red" },
  { value: "#6b7280", label: "Grey" },
  { value: "#2563eb", label: "Blue" },
  { value: "#111111", label: "Black" },
] as const;

interface Options {
  text: string;
  mode: WatermarkMode;
  opacity: number;
  fontSize: number;
  angle: number;
  color: string;
  pages: number[];
  outputName: string;
}

export default function PdfWatermarkWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const [text, setText] = React.useState("CONFIDENTIAL");
  const [mode, setMode] = React.useState<WatermarkMode>("single");
  const [opacity, setOpacity] = React.useState(0.18);
  const [fontSize, setFontSize] = React.useState(48);
  const [angle, setAngle] = React.useState(45);
  const [color, setColor] = React.useState("#d91f1f");
  const [rangeText, setRangeText] = React.useState("");
  const [outputName, setOutputName] = React.useState("watermarked");
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  React.useEffect(() => {
    if (!file) {
      setPageCount(null);
      setReadError(null);
      setRangeText("");
      return;
    }
    let cancelled = false;
    setPageCount(null);
    setReadError(null);
    void (async () => {
      try {
        const count = await getPdfPageCount(file);
        if (cancelled) return;
        setPageCount(count);
        if (count > 0) setRangeText(formatPageList(Array.from({ length: count }, (_, index) => index)));
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
    () => (pageCount === null ? null : parsePageRange(rangeText, pageCount)),
    [rangeText, pageCount],
  );
  const rangeError = parsed ? parsed.error : null;
  const colourValid = /^#[0-9a-f]{6}$/i.test(color);

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      report({ percent: null, done: 0, total: inputs.length, caption: "Stamping the watermark" });
      const result = await addWatermark(input, {
        text: options.text,
        mode: options.mode,
        opacity: options.opacity,
        fontSize: options.fontSize,
        angle: options.angle,
        color: options.color,
        pages: options.pages,
        margin: 24,
      });
      report({ percent: 100, done: inputs.length, total: inputs.length });
      return [
        {
          blob: result.blob,
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: `${result.watermarked} page${result.watermarked === 1 ? "" : "s"} stamped`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: {
        text,
        mode,
        opacity,
        fontSize,
        angle,
        color,
        pages: parsed?.indices ?? [],
        outputName,
      },
    });

  const bytesIn = file?.size ?? 0;
  const targetCount = parsed?.indices.length ?? 0;
  const textError = text.trim().length === 0 ? "Enter the text you want to stamp." : null;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${text}::${mode}::${angle}::${targetCount}::ok`;
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
  }, [stage, results, error, fileKey, file, text, mode, angle, targetCount, bytesIn]);

  const canRun = Boolean(file) && !readError && !rangeError && !textError && colourValid && targetCount > 0;

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
          dropzoneLabel="Drop a PDF here to watermark"
          dropzoneHint="One file at a time. The mark is drawn in the built-in Helvetica, so nothing needs embedding."
          renderMeta={() =>
            pageCount === null ? (readError ? <span className="text-brand-500">Unreadable</span> : "Reading…") : `${pageCount} pages`
          }
          controls={
            <div className="grid gap-4">
              <Field label="Watermark text" error={textError}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      reset();
                    }}
                    placeholder="CONFIDENTIAL"
                    spellCheck={false}
                    maxLength={120}
                  />
                )}
              </Field>

              <Field label="Mode" hint="Tiled repeats the text in a grid rotated by the angle below.">
                {() => (
                  <Segmented
                    label="Mode"
                    options={MODE_OPTIONS}
                    value={mode}
                    onChange={(value) => {
                      setMode(value);
                      reset();
                    }}
                  />
                )}
              </Field>

              <Field
                label={`Opacity — ${Math.round(opacity * 100)}%`}
                hint="Below about 12% the mark disappears on a busy page."
              >
                {({ id }) => (
                  <Slider
                    id={id}
                    min={5}
                    max={100}
                    step={1}
                    value={Math.round(opacity * 100)}
                    onChange={(event) => {
                      setOpacity(Number(event.target.value) / 100);
                      reset();
                    }}
                    aria-valuetext={`${Math.round(opacity * 100)} percent`}
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Font size" hint={`${fontSize} pt`}>
                  {({ id }) => (
                    <Slider
                      id={id}
                      min={10}
                      max={140}
                      step={2}
                      value={fontSize}
                      onChange={(event) => {
                        setFontSize(Number(event.target.value));
                        reset();
                      }}
                      aria-valuetext={`${fontSize} points`}
                    />
                  )}
                </Field>

                <Field label="Angle" hint={`${angle}° from horizontal`}>
                  {({ id }) => (
                    <Slider
                      id={id}
                      min={0}
                      max={180}
                      step={5}
                      value={angle}
                      onChange={(event) => {
                        setAngle(Number(event.target.value));
                        reset();
                      }}
                      aria-valuetext={`${angle} degrees`}
                    />
                  )}
                </Field>
              </div>

              <Field
                label="Colour"
                error={colourValid ? null : "Use a hex colour such as #d91f1f."}
                hint="Pick a preset or type your own."
              >
                {({ id }) => (
                  <div className="flex flex-wrap items-center gap-2">
                    {COLOUR_PRESETS.map((preset) => (
                      <Button
                        key={preset.value}
                        size="sm"
                        variant={color.toLowerCase() === preset.value ? "primary" : "secondary"}
                        onClick={() => {
                          setColor(preset.value);
                          reset();
                        }}
                        aria-pressed={color.toLowerCase() === preset.value}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <input
                      id={id}
                      type="color"
                      value={colourValid ? color : "#d91f1f"}
                      onChange={(event) => {
                        setColor(event.target.value);
                        reset();
                      }}
                      aria-label="Custom watermark colour"
                      className="size-8 cursor-pointer rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-0.5"
                    />
                  </div>
                )}
              </Field>

              <Field
                label="Pages"
                error={rangeError}
                hint={
                  rangeError
                    ? undefined
                    : `${targetCount} page${targetCount === 1 ? "" : "s"} will be stamped`
                }
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
                    placeholder="1-8"
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
                  <Stat label="Pages" value={pageCount ?? "…"} />
                  <Stat label="Will be stamped" value={targetCount} tone="brand" />
                </dl>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              label="Add watermark"
              icon={<Sticker className="size-4" aria-hidden="true" />}
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
          <section
            aria-label="Watermark preview"
            className="flex flex-col gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4"
          >
            <h3 className="text-[13px] font-medium text-[var(--text-ink)]">Preview</h3>
            <div className="relative mx-auto aspect-[1/1.414] w-full max-w-56 overflow-hidden rounded-lg border border-[var(--surface-line)] bg-white">
              {mode === "single" ? (
                <div className="absolute inset-0 grid place-items-center p-4">
                  <span
                    className="whitespace-nowrap text-center font-bold leading-tight"
                    style={{
                      color,
                      opacity,
                      fontSize: `${Math.max(9, Math.min(38, fontSize / 4))}px`,
                      transform: `rotate(${angle}deg)`,
                    }}
                  >
                    {text.trim() || "CONFIDENTIAL"}
                  </span>
                </div>
              ) : (
                <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
                  <div
                    className="absolute left-1/2 top-1/2 grid w-[220%] grid-cols-3 place-items-center gap-x-10 gap-y-8"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                      color,
                      opacity,
                    }}
                  >
                    {Array.from({ length: 12 }, (_, index) => (
                      <span
                        key={index}
                        className="whitespace-nowrap font-bold leading-none"
                        style={{ fontSize: `${Math.max(7, Math.min(24, fontSize / 6))}px` }}
                      >
                        {text.trim() || "CONFIDENTIAL"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              A rough indication of placement and legibility. The real mark is drawn on the page at{" "}
              {fontSize} pt, {Math.round(opacity * 100)}% opacity.
            </p>
          </section>

          {result ? (
            <ResultsPanel title="Watermarked document">
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Pages stamped" value={targetCount} tone="brand" />
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
          ) : (
            <Notice tone="info" icon={<Sticker className="size-4" aria-hidden="true" />}>
              The mark is drawn after the existing content, so it sits in front. Lower the opacity if
              the text underneath needs to stay readable. It cannot be removed again with this tool —
              keep the original.
            </Notice>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
