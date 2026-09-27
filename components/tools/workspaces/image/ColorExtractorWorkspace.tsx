"use client";

import * as React from "react";
import { Lock, LockOpen, Palette, Trash2, X } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  extractPalette,
  sampleColorAtRatio,
  type PaletteResult,
} from "@/lib/tools/engines/image";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
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
import { Field, Slider, Stat } from "@/components/ui/form";
import { toast } from "@/lib/utils/toast";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "color-extractor",
  category: "image",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

type ExtractOptions = Record<string, never>;

interface Swatch {
  id: string;
  hex: string;
  share: number;
  locked: boolean;
  /** True for colours read from a single pixel rather than clustered. */
  sampled: boolean;
}

let swatchSeq = 0;

function nextId() {
  swatchSeq += 1;
  return `sw-${swatchSeq}`;
}

const transform: TransformFn<ExtractOptions> = async (files, _options, report) => {
  const results: TransformResult[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    report({
      percent: files.length > 1 ? (index / files.length) * 100 : null,
      done: index,
      total: files.length,
      caption: `Clustering colours in ${file.name}`,
    });

    // The report is the deliverable: a palette, written as CSS custom
    // properties. There is no image to export here.
    const palette = await extractPalette(file, 8);
    const body = palette.swatches
      .map(
        (swatch, position) =>
          `  --image-color-${position + 1}: ${swatch.hex}; /* ${(swatch.share * 100).toFixed(1)}% of pixels */`,
      )
      .join("\n");

    results.push({
      blob: new Blob([`:root {\n${body}\n}\n`], { type: "text/plain;charset=utf-8" }),
      filename: `${file.name.replace(/\.[^.]+$/, "")}.palette.css`,
      source: file,
      note: `${palette.swatches.length} colours`,
    });

    report({
      percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
      done: index + 1,
      total: files.length,
    });
  }

  return results;
};

export default function ColorExtractorWorkspace() {
  const [count, setCount] = React.useState(6);
  const [swatches, setSwatches] = React.useState<Swatch[]>([]);
  const [sampledPixels, setSampledPixels] = React.useState(0);
  const [sampleSize, setSampleSize] = React.useState<{ width: number; height: number } | null>(null);
  const [sampleError, setSampleError] = React.useState<string | null>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);
  /** Colours the user locked or sampled, which survive re-extraction. */
  const pinnedRef = React.useRef<Swatch[]>([]);

  const { files, add, remove, clear } = useFiles({
    category: "image",
    maxBytes: SITE.limits.image,
  });

  const file = files[0];
  const options = React.useMemo<ExtractOptions>(() => ({}), []);
  const imageUrl = useObjectUrl(file);

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  // Re-cluster whenever the file or the requested count changes. Locked and
  // sampled swatches are pinned, so a re-extraction never throws away a colour
  // the user deliberately kept.
  const extract = React.useCallback(
    async (target: File, wanted: number) => {
      setSampleError(null);
      try {
        const palette: PaletteResult = await extractPalette(target, wanted);
        setSampledPixels(palette.sampledPixels);
        setSampleSize(palette.sampleSize);
        const kept = pinnedRef.current;
        setSwatches([
          ...kept,
          ...palette.swatches
            .filter((swatch) => !kept.some((pin) => pin.hex === swatch.hex))
            .map((swatch) => ({
              id: nextId(),
              hex: swatch.hex,
              share: swatch.share,
              locked: false,
              sampled: false,
            })),
        ]);
      } catch (caught) {
        setSampleError(
          caught instanceof Error ? caught.message : "The palette could not be extracted.",
        );
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!file) {
      setSwatches([]);
      setSampledPixels(0);
      setSampleSize(null);
      return;
    }
    const timer = setTimeout(() => {
      void extract(file, count);
    }, 180);
    return () => clearTimeout(timer);
  }, [file, count, extract]);

  // Keep the pinned list in step with the visible swatches so a re-extraction
  // reproduces exactly what the user chose to keep.
  React.useEffect(() => {
    pinnedRef.current = swatches.filter(
      (swatch) => swatch.locked || swatch.sampled,
    );
  }, [swatches]);

  const start = React.useCallback(() => {
    if (!file || isRunning) return;
    reported.current = null;
    void run([file]);
  }, [file, isRunning, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    reset();
    clear();
    setSwatches([]);
    setSampleError(null);
    pinnedRef.current = [];
  }, [reset, clear]);

  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(TOOL, {
        status: "success",
        fileName: file?.name,
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

  const onImageClick = async (event: React.MouseEvent<HTMLElement>) => {
    const node = imageRef.current;
    if (!file || !node) return;
    const rect = node.getBoundingClientRect();
    const ratioX = (event.clientX - rect.left) / rect.width;
    const ratioY = (event.clientY - rect.top) / rect.height;
    try {
      const sampled = await sampleColorAtRatio(file, ratioX, ratioY);
      setSwatches((current) => {
        if (current.some((swatch) => swatch.hex === sampled.hex)) return current;
        return [
          ...current,
          {
            id: nextId(),
            hex: sampled.hex,
            share: 0,
            locked: true,
            sampled: true,
          },
        ];
      });
    } catch (caught) {
      setSampleError(
        caught instanceof Error ? caught.message : "That pixel could not be sampled.",
      );
    }
  };

  const toggleLock = (id: string) => {
    setSwatches((current) =>
      current.map((swatch) =>
        swatch.id === id ? { ...swatch, locked: !swatch.locked } : swatch,
      ),
    );
  };

  const removeSwatch = (id: string) => {
    setSwatches((current) => current.filter((swatch) => swatch.id !== id));
  };

  const clearSampled = () => {
    setSwatches((current) => current.filter((swatch) => !swatch.sampled));
  };

  const report = results[0];
  const cssText =
    swatches.length > 0
      ? `:root {\n${swatches
          .map(
            (swatch, position) =>
              `  --image-color-${position + 1}: ${swatch.hex};${
                swatch.sampled ? " /* sampled */" : ` /* ${(swatch.share * 100).toFixed(1)}% */`
              }`,
          )
          .join("\n")}\n}\n`
      : null;
  const jsonText =
    swatches.length > 0
      ? JSON.stringify(
          {
            source: file?.name ?? null,
            swatches: swatches.map((swatch) => ({
              hex: swatch.hex,
              share: swatch.sampled ? null : Number(swatch.share.toFixed(4)),
              source: swatch.sampled ? "sampled" : "cluster",
              locked: swatch.locked,
            })),
          },
          null,
          2,
        )
      : null;

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
        dropzoneLabel="Drop an image here to extract its colours"
        dropzoneHint="One image at a time. Click the preview to sample an exact pixel colour."
        emptyTitle="Drop your files here to get started."
        emptyDescription="Median-cut clustering pulls a real palette out of the image, ordered by how much of the picture each colour covers."
        controls={
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <Field
              label={`Colours to extract — ${count}`}
              hint="More colours means each one covers less of the image. Clusters that are very small are usually compression noise near edges."
            >
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={3}
                  max={12}
                  step={1}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
              )}
            </Field>

            {sampledPixels > 0 ? (
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat
                  label="Pixels sampled"
                  value={formatNumber(sampledPixels)}
                  hint={sampleSize ? `from a ${sampleSize.width} × ${sampleSize.height}px downscale` : undefined}
                />
                <Stat label="Swatches" value={String(swatches.length)} hint="clustered + pinned" />
                <Stat
                  label="Sampled"
                  value={String(swatches.filter((swatch) => swatch.sampled).length)}
                  hint="exact pixel values"
                />
              </dl>
            ) : null}

            {sampleError ? <Notice tone="warning">{sampleError}</Notice> : null}
          </div>
        }
        action={
          <ProcessButton
            label="Extract palette"
            icon={<Palette className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {file && imageUrl ? (
        <div className="mt-5 flex flex-col gap-4">
          <figure className="flex flex-col gap-2">
            <button
              type="button"
              onClick={(event) => void onImageClick(event)}
              className="checkerboard flex min-h-32 cursor-crosshair items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              aria-label={`Sample a colour from ${file.name}. Click the image at the pixel you want.`}
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt={file.name}
                draggable={false}
                className="max-h-72 w-auto max-w-full select-none object-contain"
              />
            </button>
            <figcaption className="text-xs text-[var(--text-muted)]">
              Click anywhere on the image to add that exact pixel colour. Sampled colours are read
              from a render capped at 4096px, so on a very large photo a sample is the average
              colour of a small region rather than a single sensor pixel.
            </figcaption>
          </figure>

          {swatches.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Extracted palette">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-ink)]">Palette</h3>
                <div className="flex flex-wrap gap-2">
                  {swatches.some((swatch) => swatch.sampled) ? (
                    <Button size="sm" variant="ghost" onClick={clearSampled}>
                      <X className="size-3.5" aria-hidden="true" />
                      Clear sampled
                    </Button>
                  ) : null}
                </div>
              </div>

              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {swatches.map((swatch) => (
                  <li
                    key={swatch.id}
                    className="flex flex-col gap-1.5 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-2"
                  >
                    <button
                      type="button"
                      onClick={() => void toast.copy(swatch.hex, `${swatch.hex} copied`)}
                      className="checkerboard flex h-16 w-full items-end justify-end rounded-lg p-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                      aria-label={`Copy ${swatch.hex}`}
                      title="Copy this hex value"
                    >
                      {swatch.locked ? (
                        <Lock className="size-3.5 text-white" aria-hidden="true" />
                      ) : null}
                    </button>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={[
                          "font-mono text-[11px]",
                          swatch.locked ? "text-brand-500" : "text-[var(--text-ink)]",
                        ].join(" ")}
                      >
                        {swatch.hex}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => toggleLock(swatch.id)}
                          aria-label={swatch.locked ? `Unlock ${swatch.hex}` : `Lock ${swatch.hex}`}
                          aria-pressed={swatch.locked}
                          className="grid size-6 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-line)] hover:text-[var(--text-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
                        >
                          {swatch.locked ? (
                            <Lock className="size-3" aria-hidden="true" />
                          ) : (
                            <LockOpen className="size-3" aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSwatch(swatch.id)}
                          aria-label={`Delete ${swatch.hex}`}
                          className="grid size-6 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-line)] hover:text-[var(--text-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
                        >
                          <Trash2 className="size-3" aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {swatch.sampled ? "sampled pixel" : `${(swatch.share * 100).toFixed(1)}% of pixels`}
                    </p>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-[var(--text-muted)]">
                Locked and sampled swatches survive a re-extraction. Deleting one removes it for good.
              </p>
            </section>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <ToolError
          className="mt-6"
          title="The palette could not be extracted."
          detail={error}
          onRetry={start}
        />
      ) : null}

      {report ? (
        <ResultsPanel title="Palette report" className="mt-6">
          <Notice tone="success">
            The palette is ready as CSS custom properties —{" "}
            <span className="font-mono">{report.filename}</span> ·{" "}
            <span className="font-mono">{formatBytes(report.blob.size)}</span>, {report.note}.
            Nothing was uploaded; the clustering ran on a downscale of your file in this tab.
          </Notice>
          <div className="flex flex-wrap gap-2">
            <DownloadButton
              blob={report.blob}
              filename={report.filename}
              label="Download palette (.css)"
            />
            <DownloadButton
              text={jsonText}
              mime="application/json"
              filename={file ? file.name.replace(/\.[^.]+$/, "") + ".palette.json" : "palette.json"}
              label="Download JSON"
              variant="secondary"
            />
            <CopyButton value={cssText} label="Copy CSS" what="CSS custom properties copied" />
          </div>
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
