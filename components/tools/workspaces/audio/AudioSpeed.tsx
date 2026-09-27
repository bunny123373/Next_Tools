"use client";

import * as React from "react";
import { Info, Timer, TriangleAlert } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Field, Segmented, Select, Slider, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  analyseAudio,
  applyFades,
  changeSpeedResample,
  decodeAudio,
  encodeMp3,
  encodeWav,
  estimateMp3Bytes,
  pickAudioMime,
  runPitchPreservingRecorder,
  type AudioAnalysis,
  type Mp3Bitrate,
  type PickedAudioMime,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "audio-speed",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];
const RATE_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

type Mode = "resample" | "preserve";
type OutputFormat = "wav" | "mp3";

interface Options {
  mode: Mode;
  rate: number;
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

export default function AudioSpeedWorkspace() {
  const { files, add, remove, move, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const [tracks, setTracks] = React.useState<TrackInfo[]>([]);
  const [mode, setMode] = React.useState<Mode>("resample");
  const [rate, setRate] = React.useState(1.5);
  const [seamFade, setSeamFade] = React.useState(10);
  const [format, setFormat] = React.useState<OutputFormat>("wav");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);

  const [audioMime, setAudioMime] = React.useState<PickedAudioMime | null>(null);
  const [preservePitchSupported, setPreservePitchSupported] = React.useState<boolean | null>(null);
  const [liveTick, setLiveTick] = React.useState<{ elapsed: number; remaining: number | null; percent: number | null } | null>(
    null,
  );
  const [cancelled, setCancelled] = React.useState(false);
  const recorderRef = React.useRef<{ cancel: (reason?: string) => void } | null>(null);

  React.useEffect(() => {
    let alive = true;
    void detectPreservesPitch().then((supports) => alive && setPreservePitchSupported(supports));
    setAudioMime(pickAudioMime());
    return () => {
      alive = false;
    };
  }, []);

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
  }, [files]);

  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const outDuration = totalDuration / rate;
  const wallTime = mode === "resample" ? outDuration : totalDuration;

  const options = React.useMemo<Options>(
    () => ({ mode, rate, seamFade: seamFade / 1000, format, bitDepth, kbps }),
    [mode, rate, seamFade, format, bitDepth, kbps],
  );

  const estimate =
    format === "mp3"
      ? estimateMp3Bytes(kbps, outDuration)
      : Math.round(
          outDuration *
            (tracks[0]?.sampleRate ?? 44100) *
            (rate >= 1 ? 1 / rate : 1) *
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

      if (current.mode === "preserve") {
        const mime = pickAudioMime();
        if (!mime.supported) {
          throw new Error("This browser cannot record audio from a media element, so pitch preservation is unavailable.");
        }

        for (let index = 0; index < batch.length; index += 1) {
          const file = batch[index]!;
          const run = runPitchPreservingRecorder({
            file,
            rate: current.rate,
            mime: mime.mime,
            preservePitch: true,
            onTick: (tick) => {
              setLiveTick({ elapsed: tick.elapsed, remaining: tick.remaining, percent: tick.percent });
              report({
                percent: tick.percent,
                done: index,
                total: batch.length,
                caption: `Pitch-preserving ${file.name}: ${formatDuration(tick.elapsed)}${
                  tick.remaining !== null ? `, ${formatDuration(tick.remaining)} left` : ""
                }`,
              });
            },
          });
          recorderRef.current = run;
          try {
            const outcome = await run.result;
            results.push({
              blob: outcome.blob,
              filename: withExtension(
                `${baseName(file.name)}-${String(current.rate).replace(".", "p")}x-pitch`,
                mime.mime.includes("mp4") ? "m4a" : "webm",
              ),
              source: file,
              note: `${formatDuration(outcome.duration)} · ${mime.label} · pitch preserved`,
            });
          } catch (error) {
            if (error instanceof Error && error.name === "CancelledError") throw error;
            throw new Error(
              `${file.name}: pitch-preserving speed change failed. ${error instanceof Error ? error.message : ""}`.trim(),
            );
          } finally {
            recorderRef.current = null;
            setLiveTick(null);
          }
        }
        return results;
      }

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
          percent: share(0.5),
          done: index,
          total: batch.length,
          caption: `Resampling ${file.name} to ${current.rate}x`,
        });

        // Reinterpreting the same samples at a new sample rate: instant,
        // artefact-free, and it shifts pitch by the same factor.
        const sped = changeSpeedResample(buffer, current.rate);
        if (current.seamFade > 0) applyFades(sped, current.seamFade, current.seamFade);
        const analysis = analyseAudio(sped);

        const blob =
          current.format === "mp3"
            ? await encodeMp3(sped, current.kbps, (percent) => {
                report({
                  percent: share(0.7 + (percent / 100) * 0.3),
                  done: index,
                  total: batch.length,
                  caption: `Encoding ${file.name} - ${Math.round(percent)}%`,
                });
              })
            : encodeWav(sped, current.bitDepth, {});

        results.push({
          blob,
          filename: withExtension(`${baseName(file.name)}-${String(current.rate).replace(".", "p")}x`, current.format),
          source: file,
          note: `${formatDuration(analysis.duration)} · ${sped.sampleRate} Hz · ${
            current.rate > 1 ? `pitch up ~${semitones(current.rate)} semitones` : `pitch down ~${semitones(1 / current.rate)} semitones`
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
    setCancelled(false);
    setLiveTick(null);
    void run(files);
  }, [files, run, isRunning]);

  useShortcut(files.length > 0 && !isRunning && rate !== 1, start);

  React.useEffect(() => {
    if (stage !== "complete" || results.length === 0) return;
    recordJob(TOOL, {
      status: "success",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: results.length,
      inputBytes: totalBytes,
      outputBytes,
      outputName: results.length === 1 ? results[0]?.filename : `${results.length} speed-changed files`,
    });
  }, [stage, results, files.length, files, totalBytes, outputBytes]);

  React.useEffect(() => {
    if (stage !== "idle" || !error) return;
    if (error === "Cancelled.") return;
    recordJob(TOOL, {
      status: "error",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: files.length,
      errorMessage: error,
    });
  }, [stage, error, files]);

  const handleReset = () => {
    recorderRef.current?.cancel("Reset.");
    recorderRef.current = null;
    setLiveTick(null);
    setCancelled(false);
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
          emptyTitle="Drop audio to change its speed."
          emptyDescription="Resample instantly, or let the browser time-stretch it in real time with the pitch intact."
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
            return `${formatDuration(track.duration)} · ${track.sampleRate} Hz · ${track.channels === 1 ? "mono" : `${track.channels}ch`}`;
          }}
          controls={
            <div className="flex flex-col gap-4">
              {tracks.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Original length" value={formatDuration(totalDuration)} />
                  <Stat
                    label="New length"
                    value={formatDuration(outDuration)}
                    hint={`${rate.toFixed(2)}x`}
                    tone="brand"
                  />
                  <Stat
                    label="Processing time"
                    value={formatDuration(wallTime)}
                    hint={mode === "preserve" ? "records in real time" : "instant"}
                  />
                  <Stat
                    label="Output size"
                    value={formatBytes(estimate)}
                    hint={format === "mp3" ? `${kbps} kbps` : `${bitDepth}-bit PCM`}
                  />
                </dl>
              ) : null}

              <Field
                label="Method"
                hint="Two genuinely different trade-offs, labelled as they are rather than pretending they are equivalent."
              >
                {() => (
                  <Segmented
                    label="Method"
                    value={mode}
                    onChange={(value) => setMode(value as Mode)}
                    options={[
                      { value: "resample", label: "Resample (instant)" },
                      { value: "preserve", label: "Preserve pitch" },
                    ]}
                  />
                )}
              </Field>

              {mode === "resample" ? (
                <Notice tone="info" icon={InfoIcon}>
                  The same samples are reinterpreted at a new sample rate. This is instant and free of interpolation
                  artefacts, and the pitch moves by the speed factor: {rate >= 1 ? `up about ${semitones(rate).toFixed(1)} semitones` : `down about ${semitones(1 / rate).toFixed(1)} semitones`}.
                </Notice>
              ) : preservePitchSupported === false ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  This browser has no pitch-preserving speed control. Safari, for example, does not implement
                  HTMLMediaElement.preservesPitch, so the option cannot work here. Use Resample instead, and expect the pitch
                  to shift.
                </Notice>
              ) : (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  Pitch preservation runs in real time: the file is played at the new speed and recorded, so a 30-minute
                  recording takes 15 minutes at 2x. There is no instant Web Audio primitive for a pitch-preserving stretch.
                  Output container: {audioMime?.label ?? "checking..."}.
                </Notice>
              )}

              <Field label="Speed" hint="0.5x to 2x. Above 1x the output is shorter; below 1x it is longer.">
                {() => (
                  <Segmented
                    label="Speed"
                    size="sm"
                    value={String(rate)}
                    onChange={(value) => setRate(Number(value))}
                    options={RATE_PRESETS.map((value) => ({ value: String(value), label: `${value}x` }))}
                  />
                )}
              </Field>

              <Field label={`Custom rate - ${rate.toFixed(2)}x`}>
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={50}
                    max={200}
                    step={5}
                    value={Math.round(rate * 100)}
                    onChange={(event) => setRate(Number(event.target.value) / 100)}
                  />
                )}
              </Field>

              {mode === "resample" ? (
                <Field
                  label={`Edge fade - ${seamFade} ms`}
                  hint="A resampled waveform can start or end mid-cycle, and a step from nothing to something is a click. A few milliseconds at each end removes it."
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
              ) : null}

              {mode === "resample" ? (
                <Field label="Output format" hint="WAV is uncompressed; MP3 is smaller and lossy.">
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
              ) : null}

              {mode === "resample" && format === "mp3" ? (
                <Field label="MP3 bitrate" hint="MP3 only supports 44.1 and 48 kHz; anything else is resampled.">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(kbps)}
                      onChange={(event) => setKbps(Number(event.target.value) as Mp3Bitrate)}
                    >
                      {BITRATES.map((rateOption) => (
                        <option key={rateOption} value={rateOption}>
                          {rateOption} kbps
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}

              {mode === "resample" && format === "wav" ? (
                <Field label="WAV bit depth" hint="16-bit is enough unless you will keep processing the result.">
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
              ) : null}

            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={files.length === 0 || isRunning || rate === 1 || (mode === "preserve" && preservePitchSupported === false)}
              loading={isRunning}
              label="Change speed"
              icon={<Timer className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {isRunning && liveTick ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] px-3.5 py-3"
          >
            <span aria-hidden="true" className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-brand-500" />
              <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
            </span>
            <p className="text-[13px] font-medium text-[var(--text-ink)]">
              Recording... {formatDuration(liveTick.elapsed)}
              {liveTick.remaining !== null ? (
                <span className="text-[var(--text-muted)]"> &middot; {formatDuration(liveTick.remaining)} left</span>
              ) : null}
            </p>
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setCancelled(true);
                recorderRef.current?.cancel("Recording cancelled.");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        {cancelled && !isRunning ? (
          <Notice tone="info" icon={<Info className="size-4" />}>
            Recording cancelled, so nothing was exported.
          </Notice>
        ) : null}

        {results.length > 0 ? (
          <ResultsPanel title={results.length === 1 ? "Speed-changed audio ready" : `${results.length} files changed`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Files" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat label="Input size" value={formatBytes(totalBytes)} hint="never modified" />
              <Stat
                label="Method"
                value={mode === "resample" ? "Resample" : "Pitch preserved"}
                hint={mode === "resample" ? "pitch changed" : "real-time recording"}
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
                zipName="speed-changed-audio.zip"
                originalTotalBytes={totalBytes}
              />
            ) : null}
          </ResultsPanel>
        ) : null}

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Local bits                                                         */
/* ------------------------------------------------------------------ */

/** 12 * log2(ratio) — how far the pitch moves for a given speed factor. */
function semitones(ratio: number): number {
  return 12 * Math.log2(Math.max(0.01, ratio));
}

const InfoIcon = <Info className="size-4" aria-hidden="true" />;

/**
 * Does the browser have `HTMLMediaElement.preservesPitch`? Read from a real
 * element rather than guessed from the user agent.
 */
async function detectPreservesPitch(): Promise<boolean> {
  if (typeof HTMLVideoElement === "undefined") return false;
  const probe = document.createElement("video");
  if ("preservesPitch" in probe) return true;
  if ("webkitPreservesPitch" in probe) return true;
  return false;
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
