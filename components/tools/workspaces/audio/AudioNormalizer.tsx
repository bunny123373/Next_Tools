"use client";

import * as React from "react";
import { Gauge, Info, TriangleAlert } from "lucide-react";
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
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  analyseAudio,
  applyGain,
  dbToGain,
  decodeAudio,
  encodeMp3,
  encodeWav,
  estimateMp3Bytes,
  softClip,
  toDb,
  type AudioAnalysis,
  type Mp3Bitrate,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "audio-normalizer",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];

type Mode = "peak" | "loudness";
type OutputFormat = "wav" | "mp3";

interface Options {
  mode: Mode;
  targetDb: number;
  guardDb: number;
  useGuard: boolean;
  limiter: boolean;
  format: OutputFormat;
  bitDepth: WavBitDepth;
  kbps: Mp3Bitrate;
}

interface TrackInfo {
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  peakDb: number;
  rmsDb: number;
  ok: boolean;
  skip: boolean;
}

export default function AudioNormalizerWorkspace() {
  const { files, add, remove, move, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const [tracks, setTracks] = React.useState<TrackInfo[]>([]);
  const [mode, setMode] = React.useState<Mode>("peak");
  const [targetDb, setTargetDb] = React.useState(-1);
  const [guardDb, setGuardDb] = React.useState(-60);
  const [useGuard, setUseGuard] = React.useState(true);
  const [limiter, setLimiter] = React.useState(true);
  const [format, setFormat] = React.useState<OutputFormat>("wav");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);

  React.useEffect(() => {
    let alive = true;
    if (files.length === 0) {
      setTracks([]);
      return;
    }
    void Promise.all(
      files.map(async (file): Promise<TrackInfo> => {
        try {
          const analysis: AudioAnalysis = analyseAudio(await decodeAudio(file));
          return {
            name: file.name,
            duration: analysis.duration,
            sampleRate: analysis.sampleRate,
            channels: analysis.channels,
            peakDb: analysis.peakDb,
            rmsDb: analysis.rmsDb,
            ok: analysis.duration > 0,
            // A silent file normalised to full scale is just amplified hiss.
            skip: useGuard && analysis.peakDb < guardDb,
          };
        } catch {
          return {
            name: file.name,
            duration: 0,
            sampleRate: 0,
            channels: 0,
            peakDb: -Infinity,
            rmsDb: -Infinity,
            ok: false,
            skip: true,
          };
        }
      }),
    ).then((value) => {
      if (alive) setTracks(value);
    });
    return () => {
      alive = false;
    };
  }, [files, useGuard, guardDb]);

  const options = React.useMemo<Options>(
    () => ({ mode, targetDb, guardDb, useGuard, limiter, format, bitDepth, kbps }),
    [mode, targetDb, guardDb, useGuard, limiter, format, bitDepth, kbps],
  );

  /** Gain the tool will apply, from the file's own measured level. */
  const plannedGain = (track: TrackInfo): number | null => {
    if (!track.ok || track.skip) return null;
    const current = mode === "peak" ? track.peakDb : track.rmsDb;
    if (!Number.isFinite(current) || current <= -99) return null;
    return targetDb - current;
  };

  const eligible = tracks.filter((track) => plannedGain(track) !== null);
  const skipped = tracks.filter((track) => track.ok && track.skip);
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
          percent: share(0.45),
          done: index,
          total: batch.length,
          caption: `Measuring ${file.name}`,
        });

        const guarded = current.useGuard && before.peakDb < current.guardDb;
        const reference = current.mode === "peak" ? before.peakDb : before.rmsDb;
        const measurable = Number.isFinite(reference) && reference > -99;
        const gainDb = guarded || !measurable ? 0 : current.targetDb - reference;

        applyGain(buffer, dbToGain(gainDb));
        const peakBeforeLimiter = analyseAudio(buffer).peakDb;
        if (current.limiter) softClip(buffer, 0.98);
        const after = analyseAudio(buffer);
        // How much the limiter had to pull back, in dB. Negative means the
        // peaks were compressed rather than clipped.
        const limiterDb = Number.isFinite(peakBeforeLimiter) ? peakBeforeLimiter - after.peakDb : 0;

        const blob =
          current.format === "mp3"
            ? await encodeMp3(buffer, current.kbps, (percent) => {
                report({
                  percent: share(0.7 + (percent / 100) * 0.3),
                  done: index,
                  total: batch.length,
                  caption: `Encoding ${file.name} - ${Math.round(percent)}%`,
                });
              })
            : encodeWav(buffer, current.bitDepth, {});

        const action = guarded
          ? "left alone by the silence guard"
          : !measurable
            ? "left alone: the file is digital silence"
            : `gain ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB`;

        results.push({
          blob,
          filename: withExtension(`${baseName(file.name)}-normalised`, current.format),
          source: file,
          note: `${action} · peak ${Number.isFinite(before.peakDb) ? before.peakDb.toFixed(1) : "-inf"} to ${
            Number.isFinite(after.peakDb) ? after.peakDb.toFixed(1) : "-inf"
          } dBFS · limiter ${limiterDb > 0.05 ? `${limiterDb.toFixed(1)} dB` : "idle"} · ${
            after.clipped
          } clipped samples`,
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
      outputName: results.length === 1 ? results[0]?.filename : `${results.length} normalised files`,
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
          emptyTitle="Drop audio to normalise it."
          emptyDescription="Match a target peak or an approximate loudness, with a real limiter so it never clips."
          dropzoneHint={`Up to ${MAX_FILES} files, ${Math.round(SITE.limits.audio / 1024 / 1024)} MB each.`}
          error={error}
          stage={stage}
          percent={percent}
          done={done}
          total={total}
          onRetry={start}
          renderMeta={(file) => {
            const track = tracks.find((item) => item.name === file.name);
            if (!track) return null;
            if (!track.ok) return <span className="text-brand-500">cannot decode</span>;
            const gain = plannedGain(track);
            return `${formatDuration(track.duration)} · peak ${Number.isFinite(track.peakDb) ? `${track.peakDb.toFixed(1)}` : "-inf"} dBFS${
              gain === null ? " · skipped" : ` · gain ${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB`
            }`;
          }}
          controls={
            <div className="flex flex-col gap-4">
              <Field
                label="Target"
                hint="Peak matches absolute level. Loudness is an RMS approximation, not LUFS — see the note below."
              >
                {() => (
                  <Segmented
                    label="Normalisation target"
                    value={mode}
                    onChange={(value) => setMode(value as Mode)}
                    options={[
                      { value: "peak", label: "Target peak" },
                      { value: "loudness", label: "Loudness (approx.)" },
                    ]}
                  />
                )}
              </Field>

              <Field
                label={
                  mode === "peak"
                    ? `Target peak - ${targetDb.toFixed(1)} dBFS`
                    : `Target loudness - ${targetDb.toFixed(1)} dB RMS`
                }
                hint={
                  mode === "peak"
                    ? "-1 dBFS is the usual choice. At 0 dBFS a single loud transient can clip the format."
                    : "Measured RMS across the whole file. A typical mastered track sits around -12 to -16 dB RMS."
                }
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={-30}
                    max={0}
                    step={0.5}
                    value={targetDb}
                    onChange={(event) => setTargetDb(Number(event.target.value))}
                  />
                )}
              </Field>

              <Field
                label="Silence guard"
                hint={`Files quieter than ${guardDb} dBFS are left alone, so a silent recording is not boosted into noise.`}
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={-90}
                    max={-20}
                    step={1}
                    value={guardDb}
                    disabled={!useGuard}
                    onChange={(event) => setGuardDb(Number(event.target.value))}
                  />
                )}
              </Field>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-[var(--text-ink)]">Apply the silence guard</span>
                <Segmented
                  label="Apply the silence guard"
                  size="sm"
                  value={useGuard ? "on" : "off"}
                  onChange={(value) => setUseGuard(value === "on")}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-[var(--text-ink)]">Soft limiter</span>
                <Segmented
                  label="Soft limiter"
                  size="sm"
                  value={limiter ? "on" : "off"}
                  onChange={(value) => setLimiter(value === "on")}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                />
              </div>

              {tracks.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Files" value={String(eligible.length)} hint={`${skipped.length} skipped by the guard`} />
                  <Stat label="Total length" value={formatDuration(totalDuration)} />
                  <Stat
                    label="Measured reference"
                    value={mode === "peak" ? "peak" : "RMS"}
                    hint={mode === "peak" ? "absolute level" : "approximate loudness"}
                  />
                  <Stat
                    label="Output size"
                    value={formatBytes(estimate)}
                    hint={format === "mp3" ? `${kbps} kbps` : `${bitDepth}-bit PCM`}
                  />
                </dl>
              ) : null}

              {skipped.length > 0 ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  {skipped.length} file{skipped.length === 1 ? "" : "s"} sit below {guardDb} dBFS and will pass through
                  unchanged. Normalising a near-silent recording only amplifies its noise floor.
                </Notice>
              ) : null}

              <Field label="Output format" hint="WAV keeps the normalised result bit-exact; MP3 is smaller and lossy.">
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
                <Field label="WAV bit depth" hint="16-bit is fine for normalisation; 24-bit if you will keep processing.">
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
              label="Normalise"
              icon={<Gauge className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {results.length > 0 ? (
          <ResultsPanel title={results.length === 1 ? "Normalised audio ready" : `${results.length} files normalised`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Files" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat label="Input size" value={formatBytes(totalBytes)} hint="never modified" />
              <Stat label="Mode" value={mode === "peak" ? "Peak" : "Loudness (approx.)"} />
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
                zipName="normalised-audio.zip"
                originalTotalBytes={totalBytes}
              />
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          This is not LUFS normalisation. A real implementation needs the K-weighting filters and gated block measurement of
          EBU R128. What you get here is a genuine peak normalisation, plus an RMS-based loudness approximation labelled as
          exactly that. Use peak when clips have to line up with other material.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
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
