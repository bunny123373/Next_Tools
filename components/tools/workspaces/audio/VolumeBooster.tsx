"use client";

import * as React from "react";
import { Info, TriangleAlert, Volume2 } from "lucide-react";
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
  id: "volume-booster",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];

type Unit = "db" | "percent";
type OutputFormat = "wav" | "mp3";

interface Options {
  unit: Unit;
  gainDb: number;
  gainPercent: number;
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
  /** Linear 0-1 absolute peak, for the projection maths. */
  peak: number;
  peakDb: number;
  rmsDb: number;
  clipped: number;
  ok: boolean;
}

/** The linear gain the current settings imply. */
function resolveGain(options: Options): number {
  if (options.unit === "db") return dbToGain(options.gainDb);
  return Math.max(0, options.gainPercent / 100);
}

function describeGain(options: Options): string {
  return options.unit === "db"
    ? `${options.gainDb >= 0 ? "+" : ""}${options.gainDb.toFixed(1)} dB`
    : `${options.gainPercent.toFixed(0)}%`;
}

export default function VolumeBoosterWorkspace() {
  const { files, add, remove, move, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const queueKey = files.map((file) => file.name + ":" + file.size + ":" + file.lastModified).join("|");
  const [decoded, setDecoded] = React.useState<{ key: string; tracks: TrackInfo[] }>({
    key: "",
    tracks: [],
  });
  const [unit, setUnit] = React.useState<Unit>("db");
  const [gainDb, setGainDb] = React.useState(6);
  const [gainPercent, setGainPercent] = React.useState(200);
  const [limiter, setLimiter] = React.useState(true);
  const [format, setFormat] = React.useState<OutputFormat>("wav");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);

  // Tagged with the queue, so an empty or changed list invalidates the previous
  // decode by comparison rather than by resetting state from an effect.
  const tracks = decoded.key === queueKey ? decoded.tracks : [];

  React.useEffect(() => {
    if (files.length === 0) return;
    let alive = true;
    void Promise.all(
      files.map(async (file): Promise<TrackInfo> => {
        try {
          const analysis: AudioAnalysis = analyseAudio(await decodeAudio(file));
          return {
            name: file.name,
            duration: analysis.duration,
            sampleRate: analysis.sampleRate,
            channels: analysis.channels,
            peak: analysis.peak,
            peakDb: analysis.peakDb,
            rmsDb: analysis.rmsDb,
            clipped: analysis.clipped,
            ok: analysis.duration > 0,
          };
        } catch {
          return {
            name: file.name,
            duration: 0,
            sampleRate: 0,
            channels: 0,
            peak: 0,
            peakDb: -Infinity,
            rmsDb: -Infinity,
            clipped: 0,
            ok: false,
          };
        }
      }),
    ).then((value) => {
      if (alive) setDecoded({ key: queueKey, tracks: value });
    });
    return () => {
      alive = false;
    };
  }, [files, queueKey]);

  const options = React.useMemo<Options>(
    () => ({ unit, gainDb, gainPercent, limiter, format, bitDepth, kbps }),
    [unit, gainDb, gainPercent, limiter, format, bitDepth, kbps],
  );

  const linear = resolveGain(options);
  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

  // Projected peak and clip count, straight from the measured peaks. Exact for
  // a gain with no limiter; with the limiter on, nothing can reach +/-1.
  const projections = tracks
    .filter((track) => track.ok && Number.isFinite(track.peakDb))
    .map((track) => {
      const rawPeakDb = track.peakDb + toDb(linear);
      const projectedPeak = Math.min(1, track.peak * linear);
      return {
        name: track.name,
        rawPeakDb,
        projectedPeakDb: toDb(projectedPeak),
        willClip: track.peak * linear >= 1,
      };
    });
  const anyClips = projections.some((item) => item.willClip) && !limiter;
  const worstProjected = projections.reduce((worst, item) => Math.max(worst, item.rawPeakDb), -Infinity);

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
      const gain = resolveGain(current);
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

        report({
          percent: share(0.4),
          done: index,
          total: batch.length,
          caption: `Applying ${describeGain(current)} to ${file.name}`,
        });

        const before = analyseAudio(buffer);
        applyGain(buffer, gain);
        // The limiter runs after the gain, which is the only order that can
        // actually prevent the clipping the gain just created.
        if (current.limiter) softClip(buffer, 0.98);
        const after = analyseAudio(buffer);

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

        results.push({
          blob,
          filename: withExtension(`${baseName(file.name)}-boost`, current.format),
          source: file,
          note: `peak ${Number.isFinite(before.peakDb) ? before.peakDb.toFixed(1) : "-inf"} to ${
            Number.isFinite(after.peakDb) ? after.peakDb.toFixed(1) : "-inf"
          } dBFS · ${after.clipped.toLocaleString()} clipped sample${after.clipped === 1 ? "" : "s"}${
            current.limiter ? " · limiter on" : " · no limiter"
          }`,
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
      outputName: results.length === 1 ? results[0]?.filename : `${results.length} boosted files`,
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
          emptyTitle="Drop quiet audio to boost it."
          emptyDescription="Raise the level and see exactly what happens to the peak, measured from the real samples."
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
            return `${formatDuration(track.duration)} · peak ${Number.isFinite(track.peakDb) ? `${track.peakDb.toFixed(1)} dBFS` : "-inf dBFS"}`;
          }}
          controls={
            <div className="flex flex-col gap-4">
              {tracks.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Files" value={String(tracks.filter((track) => track.ok).length)} />
                  <Stat label="Total length" value={formatDuration(totalDuration)} />
                  <Stat
                    label="Highest input peak"
                    value={Number.isFinite(worstProjected) ? `${worstProjected.toFixed(1)} dBFS` : "-inf dBFS"}
                    hint="after the boost, before any limiter"
                  />
                  <Stat
                    label="Output size"
                    value={formatBytes(estimate)}
                    hint={format === "mp3" ? `${kbps} kbps` : `${bitDepth}-bit PCM`}
                  />
                </dl>
              ) : null}

              <Field label="Gain unit" hint="dB is what mixing engineers use; a percentage is the same thing in linear terms.">
                {() => (
                  <Segmented
                    label="Gain unit"
                    size="sm"
                    value={unit}
                    onChange={(value) => setUnit(value as Unit)}
                    options={[
                      { value: "db", label: "dB" },
                      { value: "percent", label: "%" },
                    ]}
                  />
                )}
              </Field>

              {unit === "db" ? (
                <Field
                  label={`Gain - ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB`}
                  hint="0 dBFS is the maximum the format can represent. A mastered track usually peaks around -8 to -10."
                >
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={-24}
                      max={24}
                      step={0.5}
                      value={gainDb}
                      onChange={(event) => setGainDb(Number(event.target.value))}
                    />
                  )}
                </Field>
              ) : (
                <Field
                  label={`Gain - ${gainPercent.toFixed(0)}%`}
                  hint="100% leaves the audio untouched. 200% is +6 dB; 400% is +12 dB."
                >
                  {({ id, describedBy }) => (
                    <Slider
                      id={id}
                      aria-describedby={describedBy}
                      min={10}
                      max={400}
                      step={5}
                      value={gainPercent}
                      onChange={(event) => setGainPercent(Number(event.target.value))}
                    />
                  )}
                </Field>
              )}

              {projections.length > 0 ? (
                <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                    Projected peak, per file
                  </p>
                  {projections.slice(0, 6).map((item) => (
                    <p
                      key={item.name}
                      className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]"
                    >
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {Number.isFinite(item.rawPeakDb) ? `${item.rawPeakDb.toFixed(1)} dBFS` : "-inf dBFS"}
                        {item.willClip ? (
                          <span className="ml-2 text-brand-500">clip{limiter ? "ped by limiter" : ""}</span>
                        ) : null}
                      </span>
                    </p>
                  ))}
                  {projections.length > 6 ? (
                    <p className="text-xs text-[var(--text-muted)]">and {projections.length - 6} more</p>
                  ) : null}
                </div>
              ) : null}

              {anyClips ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="This will clip.">
                  At {describeGain(options)} the samples push past full scale. Turn the soft limiter on, or back the gain off
                  until the projected peak stays below 0 dBFS.
                </Notice>
              ) : limiter ? (
                <Notice tone="info" icon={<Info className="size-4" />}>
                  The soft limiter is on: samples below the knee are untouched, and anything above it is compressed into a
                  tanh shoulder. No sample can come out beyond +/-1.
                </Notice>
              ) : null}

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

              <Field label="Output format" hint="WAV keeps the boosted result bit-exact; MP3 is smaller and lossy.">
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
                <Field label="WAV bit depth" hint="24-bit avoids running out of headroom on a big boost.">
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
              label="Boost volume"
              icon={<Volume2 className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {results.length > 0 ? (
          <ResultsPanel title={results.length === 1 ? "Boosted audio ready" : `${results.length} files boosted`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Files" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat label="Input size" value={formatBytes(totalBytes)} hint="never modified" />
              <Stat
                label="Limiter"
                value={limiter ? "on" : "off"}
                hint={limiter ? "tanh shoulder at -0.2 dB" : "hard clipping possible"}
                tone={limiter ? "success" : "default"}
              />
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
                zipName="boosted-audio.zip"
                originalTotalBytes={totalBytes}
              />
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          This applies a linear gain to the samples, which is what a preamp does. It cannot extract loudness that was never
          recorded: quiet material stays quiet relative to its own noise floor, and boosting raises the hiss with it.
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
