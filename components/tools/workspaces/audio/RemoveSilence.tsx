"use client";

import * as React from "react";
import { AudioWaveform, Info, TriangleAlert } from "lucide-react";
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
import { AudioPreview } from "@/components/tools/FilePreview";
import { DownloadButton, DownloadGroup, OpenButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { Field, Segmented, Select, Slider, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration, percentSaved } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  analyseAudio,
  applyFades,
  concatenateRanges,
  decodeAudio,
  encodeMp3,
  encodeWav,
  estimateMp3Bytes,
  planSilenceRemoval,
  type AudioAnalysis,
  type Mp3Bitrate,
  type SilencePlan,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "remove-silence",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];

type OutputFormat = "wav" | "mp3";

interface Options {
  thresholdDb: number;
  minSilence: number;
  padding: number;
  seamFade: number;
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

export default function RemoveSilenceWorkspace() {
  const { files, add, remove, move, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const [tracks, setTracks] = React.useState<TrackInfo[]>([]);
  const [plan, setPlan] = React.useState<SilencePlan | null>(null);

  const [thresholdDb, setThresholdDb] = React.useState(-45);
  const [minSilence, setMinSilence] = React.useState(0.5);
  const [padding, setPadding] = React.useState(0.05);
  const [seamFade, setSeamFade] = React.useState(10);
  const [format, setFormat] = React.useState<OutputFormat>("wav");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);

  const single = files.length === 1;
  const source = files[0] ?? null;

  // Analyse every file: the durations are needed for the batch case, and the
  // first file's silence plan drives the list.
  React.useEffect(() => {
    let alive = true;
    if (files.length === 0) {
      setTracks([]);
      setPlan(null);
      return;
    }
    void Promise.all(
      files.map(async (file, index): Promise<TrackInfo> => {
        try {
          const analysis: AudioAnalysis = analyseAudio(await decodeAudio(file));
          if (index === 0 && alive) {
            setPlan(
              planSilenceRemoval(await decodeAudio(file), {
                thresholdDb,
                minSilence,
                padding,
              }),
            );
          }
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
  }, [files, thresholdDb, minSilence, padding]);

  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const keptDuration = plan?.keptSeconds ?? totalDuration;
  const savedSeconds = Math.max(0, totalDuration - keptDuration);
  const savedPercent = totalDuration > 0 ? (savedSeconds / totalDuration) * 100 : 0;

  const options = React.useMemo<Options>(
    () => ({
      thresholdDb,
      minSilence,
      padding,
      seamFade: seamFade / 1000,
      format,
      bitDepth,
      kbps,
    }),
    [thresholdDb, minSilence, padding, seamFade, format, bitDepth, kbps],
  );

  const estimate =
    format === "mp3"
      ? estimateMp3Bytes(kbps, keptDuration)
      : Math.round(
          keptDuration *
            (tracks[0]?.sampleRate ?? 44100) *
            (tracks[0]?.channels === 1 ? 1 : 2) *
            (bitDepth / 8),
        ) + 44;

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const results: TransformResult[] = [];
      for (let index = 0; index < batch.length; index += 1) {
        const file = batch[index]!;
        const share = (fraction: number) => ((index + fraction) / batch.length) * 100;
        report({
          percent: share(0),
          done: index,
          total: batch.length,
          caption: `Decoding ${file.name}`,
        });

        const buffer = await decodeAudio(file);
        if (buffer.length === 0) {
          throw new Error(`${file.name} has no decodable audio.`);
        }
        const before = analyseAudio(buffer);

        report({
          percent: share(0.5),
          done: index,
          total: batch.length,
          caption: `Analysing ${file.name} for silence`,
        });

        const silence = planSilenceRemoval(buffer, {
          thresholdDb: current.thresholdDb,
          minSilence: current.minSilence,
          padding: current.padding,
        });
        const trimmed = concatenateRanges(buffer, silence.removed.length > 0 ? silence.kept : [silence.kept[0]!]);

        // A seam fade removes the click that two unrelated waveforms make when
        // they are butted up against each other.
        if (current.seamFade > 0) applyFades(trimmed, current.seamFade, current.seamFade);
        const after = analyseAudio(trimmed);

        const blob =
          current.format === "mp3"
            ? await encodeMp3(trimmed, current.kbps, (percent) => {
                report({
                  percent: share(0.7 + (percent / 100) * 0.3),
                  done: index,
                  total: batch.length,
                  caption: `Encoding ${file.name} - ${Math.round(percent)}%`,
                });
              })
            : encodeWav(trimmed, current.bitDepth, {});

        results.push({
          blob,
          filename: withExtension(`${baseName(file.name)}-nosilence`, current.format),
          source: file,
          note: `${formatDuration(before.duration)} to ${formatDuration(after.duration)} · ${
            silence.removed.length
          } silence range(s) removed · ${after.clipped} clipped samples`,
        });
      }
      return results;
    },
    [],
  );

  const { results, stage, percent, done, total, error, run, reset, isRunning } = useTransform({
    transform,
    options,
  });

  const primary = results[0] ?? null;
  const primaryUrl = useObjectUrl(primary?.blob ?? null);
  const outputBytes = results.reduce((sum, item) => sum + item.blob.size, 0);

  const start = React.useCallback(() => {
    if (files.length === 0 || isRunning) return;
    void run(files);
  }, [files, run, isRunning]);

  useShortcut(files.length > 0 && !isRunning, start);

  React.useEffect(() => {
    if (stage !== "complete" || results.length === 0) return;
    recordJob(TOOL, {
      status: "success",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: results.length,
      inputBytes: totalBytes,
      outputBytes,
      outputName: results.length === 1 ? results[0]?.filename : `${results.length} trimmed files`,
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
          onReorder={move}
          category="audio"
          multiple
          maxFiles={MAX_FILES}
          maxBytes={SITE.limits.audio}
          reorderable
          emptyTitle="Drop audio to tighten it."
          emptyDescription="Set a threshold and the silent stretches come out, with a list of exactly what was removed."
          dropzoneHint={`Up to ${MAX_FILES} files, ${Math.round(SITE.limits.audio / 1024 / 1024)} MB each.`}
          error={error}
          stage={stage}
          percent={percent}
          done={done}
          total={total}
          onRetry={start}
          renderMeta={(file, index) => {
            const track = tracks[index];
            if (!track) return null;
            if (!track.ok) return <span className="text-brand-500">cannot decode</span>;
            return `${formatDuration(track.duration)} · ${track.sampleRate} Hz · ${track.channels === 1 ? "mono" : `${track.channels}ch`}`;
          }}
          controls={
            <div className="flex flex-col gap-4">
              {tracks.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Original length" value={formatDuration(totalDuration)} />
                  <Stat
                    label="After removal"
                    value={formatDuration(keptDuration)}
                    hint={totalDuration > 0 ? `${savedPercent.toFixed(1)}% shorter` : undefined}
                    tone="brand"
                  />
                  <Stat label="Time saved" value={formatDuration(savedSeconds)} />
                  <Stat
                    label="Output size"
                    value={formatBytes(estimate)}
                    hint={format === "mp3" ? `${kbps} kbps` : `${bitDepth}-bit PCM`}
                  />
                </dl>
              ) : null}

              <Field
                label={`Silence threshold - ${thresholdDb} dBFS`}
                hint="A 10 ms window quieter than this counts as silence. For quiet-room speech, -45 to -40 dBFS is a good start; for a noisy recording, raise it to around -35."
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
                hint="Runs shorter than this are left alone. This is what stops it chopping between every word."
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

              <Field
                label={`Padding - ${Math.round(padding * 1000)} ms`}
                hint="Keeps this much silence at each side of a cut, so a breath or the tail of a word is not clipped with it."
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={0}
                    max={500}
                    step={5}
                    value={Math.round(padding * 1000)}
                    onChange={(event) => setPadding(Number(event.target.value) / 1000)}
                  />
                )}
              </Field>

              <Field
                label={`Seam fade - ${seamFade} ms`}
                hint="A short ramp at the head and tail of the result, so the joined edges do not click."
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={0}
                    max={200}
                    step={1}
                    value={seamFade}
                    onChange={(event) => setSeamFade(Number(event.target.value))}
                  />
                )}
              </Field>

              {plan ? <SilenceList plan={plan} /> : null}

              {plan && plan.removed.length === 0 ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  Nothing was removed: no silent run below {thresholdDb} dBFS lasted at least {minSilence.toFixed(2)} s with{" "}
                  {Math.round(padding * 1000)} ms of padding either side. Lower the threshold, shorten the minimum, or accept
                  that this recording has no gaps.
                </Notice>
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
                <Field label="WAV bit depth" hint="16-bit is plenty for a voice recording.">
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
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={files.length === 0 || isRunning}
              loading={isRunning}
              label="Remove silence"
              icon={<AudioWaveform className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {results.length > 0 ? (
          <ResultsPanel title={results.length === 1 ? "Tightened audio ready" : `${results.length} files tightened`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Files" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat
                label={outputBytes < totalBytes ? "Saved" : "Increase"}
                value={`${percentSaved(totalBytes, outputBytes).toFixed(1)}%`}
                hint={outputBytes < totalBytes ? "of the input size" : "larger than the input"}
                tone={outputBytes < totalBytes ? "success" : "default"}
              />
              <Stat label="Input size" value={formatBytes(totalBytes)} hint="never modified" />
            </dl>

            {results.length === 1 && primary && primaryUrl ? (
              <div className="flex flex-col gap-2">
                <AudioPreview file={primary.blob} src={primaryUrl} />
                <div className="flex flex-wrap items-center gap-2">
                  <DownloadButton blob={primary.blob} filename={primary.filename} label="Download" />
                  <OpenButton blob={primary.blob} filename={primary.filename} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">{primary.note}</p>
              </div>
            ) : results.length > 1 ? (
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName="silence-removed.zip"
                originalTotalBytes={totalBytes}
              />
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="Why this is beta.">
          This is a level gate, not a voice-activity detector. It will happily remove a very quiet sustained note, and it
          will not cut a gap that has hiss above your threshold. Real VAD needs a model or at least spectral analysis,
          neither of which runs locally in a browser tab.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Local bits                                                         */
/* ------------------------------------------------------------------ */

function SilenceList({ plan }: { plan: SilencePlan }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        Silences removed
      </p>
      {plan.removed.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">None at these settings.</p>
      ) : (
        <>
          <ol className="max-h-48 overflow-y-auto text-xs text-[var(--text-muted)]">
            {plan.removed.map((range, index) => (
              <li
                key={`${range.start}-${index}`}
                className="flex items-center justify-between gap-3 py-0.5"
              >
                <span className="font-mono tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                <span className="font-mono tabular-nums">
                  {formatDuration(range.start)} to {formatDuration(range.end)}
                </span>
                <span className="font-mono tabular-nums text-[var(--text-ink)]">
                  {formatDuration(range.duration)}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-[var(--text-muted)]">
            {plan.removed.length} range{plan.removed.length === 1 ? "" : "s"} totalling{" "}
            {formatDuration(plan.removedSeconds)}, from {plan.detected.length} candidate run
            {plan.detected.length === 1 ? "" : "s"} found above the minimum length.
          </p>
        </>
      )}
    </div>
  );
}

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
