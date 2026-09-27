"use client";

import * as React from "react";
import { Info, Split as SplitIcon, TriangleAlert } from "lucide-react";
import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformProgress,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadGroup } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Segmented, Select, Slider, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  analyseAudio,
  applyFades,
  decodeAudio,
  encodeMp3,
  encodeWav,
  estimateMp3Bytes,
  planSilenceRemoval,
  sliceBuffer,
  type AudioAnalysis,
  type Mp3Bitrate,
  type SilencePlan,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "audio-splitter",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];
const PART_PRESETS = [2, 3, 4, 5, 8, 10] as const;
const MAX_PARTS = 200;

type Mode = "fixed" | "equal" | "silence";
type OutputFormat = "wav" | "mp3";

interface Options {
  mode: Mode;
  fixedSeconds: number;
  parts: number;
  thresholdDb: number;
  minSilence: number;
  crossfadeMs: number;
  format: OutputFormat;
  bitDepth: WavBitDepth;
  kbps: Mp3Bitrate;
}

interface TrackInfo {
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  ok: boolean;
}

interface Plan {
  ranges: { start: number; end: number }[];
  /** Only set in silence mode. */
  silence?: SilencePlan;
}

export default function AudioSplitterWorkspace() {
  const { files, add, remove, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const [tracks, setTracks] = React.useState<TrackInfo[]>([]);
  const [plan, setPlan] = React.useState<Plan | null>(null);

  const [mode, setMode] = React.useState<Mode>("fixed");
  const [fixedSeconds, setFixedSeconds] = React.useState(60);
  const [parts, setParts] = React.useState(4);
  const [thresholdDb, setThresholdDb] = React.useState(-45);
  const [minSilence, setMinSilence] = React.useState(0.6);
  const [crossfadeMs, setCrossfadeMs] = React.useState(10);
  const [format, setFormat] = React.useState<OutputFormat>("wav");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);

  const single = files.length === 1;
  const source = files[0] ?? null;

  // Decode the first file to plan the cut points from real durations.
  React.useEffect(() => {
    let alive = true;
    if (!single || !source) {
      setPlan(null);
      if (files.length === 0) setTracks([]);
      return;
    }
    void decodeAudio(source)
      .then((buffer) => {
        if (!alive) return;
        const analysis: AudioAnalysis = analyseAudio(buffer);
        setTracks([
          {
            name: source.name,
            duration: analysis.duration,
            sampleRate: analysis.sampleRate,
            channels: analysis.channels,
            ok: analysis.duration > 0,
          },
        ]);
        const ranges = buildRanges(buffer, mode, {
          fixedSeconds,
          parts,
          thresholdDb,
          minSilence,
        });
        setPlan(ranges);
      })
      .catch(() => {
        if (alive) setTracks([]);
      });
    return () => {
      alive = false;
    };
  }, [single, source, mode, fixedSeconds, parts, thresholdDb, minSilence, files.length]);

  // For batch mode we only need durations, not a cut plan.
  React.useEffect(() => {
    if (single) return;
    let alive = true;
    void Promise.all(
      files.map(async (file): Promise<TrackInfo> => {
        try {
          const analysis = analyseAudio(await decodeAudio(file));
          return {
            name: file.name,
            duration: analysis.duration,
            sampleRate: analysis.sampleRate,
            channels: analysis.channels,
            ok: analysis.duration > 0,
          };
        } catch {
          return { name: file.name, duration: 0, sampleRate: 0, channels: 0, ok: false };
        }
      }),
    ).then((value) => {
      if (alive) setTracks(value);
    });
    return () => {
      alive = false;
    };
  }, [files, single]);

  const plannedParts = plan?.ranges.length ?? 0;
  const plannedSilence = plan?.silence ?? null;
  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const estimate =
    format === "mp3"
      ? estimateMp3Bytes(kbps, totalDuration)
      : Math.round(
          totalDuration *
            (tracks[0]?.sampleRate ?? 44100) *
            (tracks[0]?.channels === 1 ? 1 : 2) *
            (bitDepth / 8),
        ) + 44;

  const options = React.useMemo<Options>(
    () => ({
      mode,
      fixedSeconds,
      parts,
      thresholdDb,
      minSilence,
      crossfadeMs: crossfadeMs / 1000,
      format,
      bitDepth,
      kbps,
    }),
    [mode, fixedSeconds, parts, thresholdDb, minSilence, crossfadeMs, format, bitDepth, kbps],
  );

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const results: TransformResult[] = [];
      for (let fileIndex = 0; fileIndex < batch.length; fileIndex += 1) {
        const file = batch[fileIndex]!;
        report({
          percent: (fileIndex / batch.length) * 100,
          done: fileIndex,
          total: batch.length,
          caption: `Decoding ${file.name}`,
        });

        const buffer = await decodeAudio(file);
        if (buffer.length === 0) {
          throw new Error(`${file.name} has no decodable audio.`);
        }
        const ranges = buildRanges(buffer, current.mode, {
          fixedSeconds: current.fixedSeconds,
          parts: current.parts,
          thresholdDb: current.thresholdDb,
          minSilence: current.minSilence,
        });
        const stem = baseName(file.name);
        const fade = current.crossfadeMs;

        for (let partIndex = 0; partIndex < ranges.ranges.length; partIndex += 1) {
          const range = ranges.ranges[partIndex]!;
          const slice = sliceBuffer(buffer, range.start, range.end);
          // Crossfades stop the join point from clicking when the parts are
          // played back one after another.
          if (fade > 0) applyFades(slice, fade, fade);

          const blob =
            current.format === "mp3"
              ? await encodeMp3(slice, current.kbps)
              : encodeWav(slice, current.bitDepth, {});

          const partNumber = String(partIndex + 1).padStart(3, "0");
          results.push({
            blob,
            filename: withExtension(`${stem}-part${partNumber}`, current.format),
            source: file,
            note: `${formatDuration(range.start)} to ${formatDuration(range.end)} · ${formatDuration(slice.duration)}`,
          });

          report({
            percent: ((fileIndex + (partIndex + 1) / ranges.ranges.length) / batch.length) * 100,
            done: results.length,
            total: 0,
            caption: `${file.name} part ${partIndex + 1} of ${ranges.ranges.length}`,
          });
        }
      }
      return results;
    },
    [],
  );

  const { results, stage, percent, error, run, reset, isRunning } = useTransform({ transform, options });

  const outputBytes = results.reduce((sum, item) => sum + item.blob.size, 0);
  // Object URLs for a contact-sheet of the parts, revoked on change/unmount.
  const partUrls = useObjectUrlList(results.map((item) => item.blob));

  const start = React.useCallback(() => {
    if (files.length === 0 || isRunning) return;
    void run(files);
  }, [files, run, isRunning]);

  useShortcut(files.length > 0 && !isRunning && (single ? plannedParts > 0 : true), start);

  React.useEffect(() => {
    if (stage !== "complete" || results.length === 0) return;
    recordJob(TOOL, {
      status: "success",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: results.length,
      inputBytes: totalBytes,
      outputBytes,
      outputName: `${results.length} parts`,
    });
  }, [stage, results, files.length, files, totalBytes, outputBytes]);

  React.useEffect(() => {
    if (stage !== "idle" || !error) return;
    recordJob(TOOL, {
      status: "error",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: files.length,
      errorMessage: error,
    });
  }, [stage, error, files]);

  const handleReset = () => {
    setPlan(null);
    clear();
    reset();
  };

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        <FileStage
          files={files}
          onAdd={add}
          onRemove={remove}
          onClear={clear}
          category="audio"
          multiple
          maxFiles={MAX_FILES}
          maxBytes={SITE.limits.audio}
          emptyTitle="Drop audio to split it."
          emptyDescription="Fixed chunks, equal parts, or cuts at the silences we actually find in the samples."
          dropzoneHint={`Up to ${MAX_FILES} files, ${Math.round(SITE.limits.audio / 1024 / 1024)} MB each. Cap: ${MAX_PARTS} parts per file.`}
          error={error}
          stage={stage}
          percent={percent}
          onRetry={start}
          renderMeta={(file) => {
            const track = tracks.find((item) => item.name === file.name);
            if (!track) return null;
            if (!track.ok) return <span className="text-brand-500">cannot decode</span>;
            return `${formatDuration(track.duration)} · ${track.sampleRate} Hz · ${track.channels === 1 ? "mono" : `${track.channels}ch`}`;
          }}
          controls={
            <div className="flex flex-col gap-4">
              <Field label="Split mode" hint="Fixed and equal modes are arithmetic; silence mode reads the samples.">
                {() => (
                  <Segmented
                    label="Split mode"
                    value={mode}
                    onChange={(value) => setMode(value as Mode)}
                    options={[
                      { value: "fixed", label: "Every N seconds" },
                      { value: "equal", label: "Into N parts" },
                      { value: "silence", label: "At silence" },
                    ]}
                  />
                )}
              </Field>

              {mode === "fixed" ? (
                <Field
                  label={`Chunk length - ${fixedSeconds} s`}
                  hint="The last chunk is shorter than the others when the file does not divide evenly."
                >
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={5}
                      max={600}
                      step={5}
                      value={fixedSeconds}
                      onChange={(event) => setFixedSeconds(Number(event.target.value))}
                    />
                  )}
                </Field>
              ) : null}

              {mode === "equal" ? (
                <>
                  <Field label={`Number of parts - ${parts}`} hint="Divided into that many near-identical chunks.">
                    {({ id, describedBy }) => (
                      <Slider
                        id={id}
                        aria-describedby={describedBy}
                        min={2}
                        max={MAX_PARTS}
                        step={1}
                        value={Math.min(MAX_PARTS, parts)}
                        onChange={(event) => setParts(Number(event.target.value))}
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-1.5">
                    {PART_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        size="sm"
                        variant={parts === preset ? "primary" : "secondary"}
                        onClick={() => setParts(preset)}
                        aria-pressed={parts === preset}
                      >
                        {preset}
                      </Button>
                    ))}
                  </div>
                </>
              ) : null}

              {mode === "silence" ? (
                <>
                  <Field
                    label={`Silence threshold - ${thresholdDb} dBFS`}
                    hint="A 10 ms window below this level counts as silence. For quiet-room speech, -45 to -40 dBFS is a good start."
                  >
                    {({ id, describedBy }) => (
                      <Slider
                        id={id}
                        aria-describedby={describedBy}
                        min={-80}
                        max={-20}
                        step={1}
                        value={thresholdDb}
                        onChange={(event) => setThresholdDb(Number(event.target.value))}
                      />
                    )}
                  </Field>
                  <Field
                    label={`Minimum silence - ${minSilence.toFixed(2)} s`}
                    hint="Runs shorter than this are ignored, which is what stops it chopping between every word."
                  >
                    {({ id, describedBy }) => (
                      <Slider
                        id={id}
                        aria-describedby={describedBy}
                        min={5}
                        max={500}
                        step={5}
                        value={Math.round(minSilence * 100)}
                        onChange={(event) => setMinSilence(Number(event.target.value) / 100)}
                      />
                    )}
                  </Field>
                </>
              ) : null}

              <Checkbox
                label="Crossfade each boundary"
                description="A few milliseconds at the head and tail of every part, so playing them back in order does not click."
                checked={crossfadeMs > 0}
                onChange={(event) => setCrossfadeMs(event.target.checked ? 10 : 0)}
              />

              {crossfadeMs > 0 ? (
                <Field label={`Crossfade length - ${crossfadeMs} ms`}>
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={1}
                      max={100}
                      step={1}
                      value={crossfadeMs}
                      onChange={(event) => setCrossfadeMs(Number(event.target.value))}
                    />
                  )}
                </Field>
              ) : null}

              <Field label="Output format" hint="WAV is uncompressed; MP3 is much smaller and lossy.">
                {() => (
                  <Segmented
                    label="Output format"
                    value={format}
                    onChange={(value) => setFormat(value as OutputFormat)}
                    options={[
                      { value: "wav", label: "WAV" },
                      { value: "mp3", label: "MP3" },
                    ]}
                  />
                )}
              </Field>

              {format === "mp3" ? (
                <Field label="MP3 bitrate" hint="MP3 only supports 44.1 and 48 kHz; anything else is resampled.">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(kbps)}
                      onChange={(event) => setKbps(Number(event.target.value) as Mp3Bitrate)}
                    >
                      {BITRATES.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate} kbps
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <Field label="WAV bit depth" hint="16-bit matches CD; 24-bit leaves headroom for further processing.">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(bitDepth)}
                      onChange={(event) => setBitDepth(Number(event.target.value) as WavBitDepth)}
                    >
                      {WAV_DEPTHS.map((depth) => (
                        <option key={depth} value={depth}>
                          {depth}-bit PCM
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              {single && plan && plan.ranges.length > 0 ? (
                <PlanSummary plan={plan} duration={tracks[0]?.duration ?? 0} />
              ) : null}

              {totalDuration > 0 ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat
                    label={single ? "Parts planned" : "Files"}
                    value={single ? String(plannedParts) : String(tracks.filter((t) => t.ok).length)}
                    tone="brand"
                  />
                  <Stat label="Total length" value={formatDuration(totalDuration)} />
                  <Stat
                    label="Total output size"
                    value={formatBytes(estimate)}
                    hint={format === "mp3" ? `${kbps} kbps` : `${bitDepth}-bit PCM`}
                  />
                </dl>
              ) : null}

              {single && plannedSilence && plannedSilence.removed.length === 0 ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  No silence was found below {thresholdDb} dBFS for at least {minSilence.toFixed(2)} s. Lower the threshold or
                  shorten the minimum to cut this recording into parts.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={files.length === 0 || isRunning || (single && plannedParts === 0)}
              loading={isRunning}
              label="Split audio"
              icon={<SplitIcon className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {results.length > 0 ? (
          <ResultsPanel title={`${results.length} part${results.length === 1 ? "" : "s"} ready`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Parts" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat label="Input size" value={formatBytes(totalBytes)} hint="never modified" />
              <Stat label="Format" value={format.toUpperCase()} />
            </dl>
            <DownloadGroup
              items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
              zipName="audio-parts.zip"
              originalTotalBytes={totalBytes}
            />
            {partUrls.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((item, index) => (
                  <li key={item.filename} className="flex flex-col gap-1.5">
                    {partUrls[index] ? (
                      <audio controls src={partUrls[index] ?? undefined} className="h-9 w-full" />
                    ) : null}
                    <span className="truncate text-[11px] text-[var(--text-muted)]">
                      {item.filename} &middot; {item.note}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          Silence detection is a level gate measured in 10 ms windows, not a voice-activity model. It will happily cut a
          very quiet sustained note, and it will not cut a gap that has hiss above your threshold.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Local bits                                                         */
/* ------------------------------------------------------------------ */

/** Turn a mode and its settings into a concrete list of cut ranges. */
function buildRanges(
  buffer: AudioBuffer,
  mode: Mode,
  settings: { fixedSeconds: number; parts: number; thresholdDb: number; minSilence: number },
): Plan {
  const duration = buffer.duration;
  const ranges: { start: number; end: number }[] = [];

  if (mode === "silence") {
    const silence = planSilenceRemoval(buffer, {
      thresholdDb: settings.thresholdDb,
      minSilence: settings.minSilence,
      padding: 0,
    });
    for (const kept of silence.kept) {
      ranges.push({ start: kept.start, end: kept.end });
    }
    return { ranges: ranges.slice(0, MAX_PARTS), silence };
  }

  if (mode === "equal") {
    const count = Math.max(2, Math.min(MAX_PARTS, Math.round(settings.parts)));
    const step = duration / count;
    for (let index = 0; index < count; index += 1) {
      ranges.push({ start: index * step, end: index === count - 1 ? duration : (index + 1) * step });
    }
    return { ranges };
  }

  const step = Math.max(1, settings.fixedSeconds);
  for (let start = 0; start < duration && ranges.length < MAX_PARTS; start += step) {
    ranges.push({ start, end: Math.min(duration, start + step) });
  }
  return { ranges };
}

function PlanSummary({ plan, duration }: { plan: Plan; duration: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        Cut plan
      </p>
      <ol className="max-h-40 overflow-y-auto text-xs text-[var(--text-muted)]">
        {plan.ranges.map((range, index) => (
          <li key={`${range.start}-${index}`} className="flex items-center justify-between gap-3 py-0.5">
            <span className="font-mono tabular-nums">part {String(index + 1).padStart(3, "0")}</span>
            <span className="font-mono tabular-nums">
              {formatDuration(range.start)} to {formatDuration(range.end)} ({formatDuration(range.end - range.start)})
            </span>
          </li>
        ))}
      </ol>
      {plan.silence && plan.silence.removed.length > 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          {plan.silence.removed.length} silent run{plan.silence.removed.length === 1 ? "" : "s"} became cut points, covering{" "}
          {formatDuration(plan.silence.removedSeconds)} of the {formatDuration(duration)} file. Each cut lands in the middle
          of a silence, so nothing audible is clipped.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Object URLs for a list of blobs, revoked whenever the list changes or the
 * component unmounts. `useObjectUrl` handles one blob; a grid of parts needs
 * one URL each.
 */
function useObjectUrlList(blobs: Blob[]): (string | null)[] {
  const [urls, setUrls] = React.useState<(string | null)[]>([]);
  React.useEffect(() => {
    const created = blobs.map((blob) => URL.createObjectURL(blob));
    setUrls(created);
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [blobs]);
  return urls;
}

/** Ctrl/Command + Enter runs the primary action. */
function useShortcut(enabled: boolean, action: () => void) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey) || !enabled) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, action]);
}
