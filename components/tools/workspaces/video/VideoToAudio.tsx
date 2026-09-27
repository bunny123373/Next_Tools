"use client";

import * as React from "react";
import { Download, Music, TriangleAlert } from "lucide-react";
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
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { SizeComparisonStats } from "@/components/tools/BeforeAfter";
import { Field, Segmented, Select, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, downloadBlob, withExtension } from "@/lib/utils/files";
import { toast } from "@/lib/utils/toast";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  MP3_BITRATES,
  analyseAudio,
  decodeAudio,
  encodeMp3,
  encodeWav,
  estimateMp3Bytes,
  type AudioAnalysis,
  type Mp3Bitrate,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "video-to-audio",
  category: "video",
  processing: "local",
};

const SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000] as const;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const MAX_ESTIMATE_BYTES = 12 * 1024 * 1024 * 1024;

type OutputFormat = "wav" | "mp3";

interface Options {
  format: OutputFormat;
  bitDepth: WavBitDepth;
  sampleRate: number;
  kbps: Mp3Bitrate;
  mono: boolean;
}

export default function VideoToAudioWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "video", maxBytes: SITE.limits.video });
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  const [decoded, setDecoded] = React.useState<{
    key: string;
    analysis: AudioAnalysis | null;
    error: string | null;
  }>({ key: "", analysis: null, error: null });
  const sourceKey = source ? `${source.name}:${source.size}:${source.lastModified}` : "";
  const isDecoded = decoded.key === sourceKey;
  const analysis = isDecoded ? decoded.analysis : null;
  const probeError = isDecoded ? decoded.error : null;
  const probing = Boolean(source) && !isDecoded;

  const [format, setFormat] = React.useState<OutputFormat>("mp3");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [sampleRate, setSampleRate] = React.useState(44100);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);
  const [mono, setMono] = React.useState(false);

  // Decode once, up front, so the real numbers are on screen before encoding.
  // The result is tagged with the file, so a new file invalidates it by
  // comparison rather than by resetting state from an effect.
  React.useEffect(() => {
    if (!source) return;
    let alive = true;
    void decodeAudio(source)
      .then((buffer) => {
        if (!alive) return;
        setDecoded({ key: sourceKey, analysis: analyseAudio(buffer), error: null });
        setSampleRate(buffer.sampleRate === 44100 || buffer.sampleRate === 48000 ? buffer.sampleRate : 44100);
        setMono(buffer.numberOfChannels === 1);
      })
      .catch((error: unknown) => {
        if (alive) {
          setDecoded({
            key: sourceKey,
            analysis: null,
            error: error instanceof Error ? error.message : "This file has no decodable audio.",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [source, sourceKey]);

  const estimate = React.useMemo(() => {
    if (!analysis) return 0;
    if (format === "mp3") return estimateMp3Bytes(kbps, analysis.duration);
    const channels = mono ? 1 : Math.min(2, analysis.channels);
    const resample = analysis.sampleRate === sampleRate ? 1 : sampleRate / analysis.sampleRate;
    const bytes = Math.round(
      analysis.duration * resample * channels * (bitDepth / 8) + 44,
    );
    return bytes;
  }, [analysis, format, kbps, mono, bitDepth, sampleRate]);

  const willGrow = Boolean(source && estimate > 0 && estimate >= source.size);

  const options = React.useMemo<Options>(
    () => ({ format, bitDepth, sampleRate, kbps, mono }),
    [format, bitDepth, sampleRate, kbps, mono],
  );

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const file = batch[0];
      if (!file) throw new Error("Choose a video first.");
      report({ percent: 5, done: 0, total: 1, caption: "Decoding the audio track..." });

      const buffer = await decodeAudio(file);
      if (buffer.length === 0) {
        throw new Error("This file contains no decodable audio track.");
      }

      if (current.format === "mp3") {
        const blob = await encodeMp3(buffer, current.kbps, (percent) => {
          report({
            percent: 10 + percent * 0.9,
            done: 0,
            total: 1,
            caption: `Encoding MP3 at ${current.kbps} kbps - ${Math.round(percent)}%`,
          });
        });
        return [
          {
            blob,
            filename: withExtension(baseName(file.name), "mp3"),
            source: file,
            note: `${formatDuration(buffer.duration)} · ${current.kbps} kbps MP3`,
          },
        ];
      }

      // WAV: resample through OfflineAudioContext when the rate differs.
      const targetRate = current.sampleRate;
      const prepared =
        buffer.sampleRate === targetRate
          ? buffer
          : await resampleForWav(buffer, targetRate);
      const blob = encodeWav(prepared, current.bitDepth, {
        channels: current.mono ? 1 : 2,
      });
      return [
        {
          blob,
          filename: withExtension(baseName(file.name), "wav"),
          source: file,
          note: `${formatDuration(prepared.duration)} · ${current.bitDepth}-bit · ${prepared.sampleRate} Hz · ${
            current.mono ? "mono" : "stereo"
          }`,
        },
      ];
    },
    [],
  );

  const { results, stage, percent, error, run, reset, isRunning } = useTransform({ transform, options });

  const result = results[0] ?? null;
  const resultUrl = useObjectUrl(result?.blob ?? null);

  const start = React.useCallback(() => {
    if (!source || isRunning) return;
    void run([source]);
  }, [source, run, isRunning]);

  useShortcut(Boolean(source) && !isRunning, start);

  React.useEffect(() => {
    if (stage !== "complete" || !result || !source) return;
    recordJob(TOOL, {
      status: "success",
      fileName: source.name,
      fileCount: 1,
      inputBytes: source.size,
      outputBytes: result.blob.size,
      outputName: result.filename,
    });
  }, [stage, result, source]);

  React.useEffect(() => {
    if (stage !== "idle" || !error || !source) return;
    recordJob(TOOL, { status: "error", fileName: source.name, errorMessage: error });
  }, [stage, error, source]);

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
          category="video"
          maxBytes={SITE.limits.video}
          emptyTitle="Drop a video to extract its audio."
          emptyDescription="The video is never re-encoded: only the audio track is decoded and written out."
          dropzoneHint="One file at a time, up to 500 MB. MP4, WebM and MOV with a decodable audio codec."
          error={error}
          stage={stage}
          percent={percent}
          onRetry={start}
          renderMeta={() =>
            analysis
              ? `${formatDuration(analysis.duration)} · ${analysis.sampleRate} Hz · ${analysis.channels === 1 ? "mono" : `${analysis.channels}ch`}`
              : null
          }
          controls={
            <div className="flex flex-col gap-4">
              {analysis ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Audio length" value={formatDuration(analysis.duration)} />
                  <Stat
                    label="Sample rate"
                    value={`${analysis.sampleRate} Hz`}
                    hint="the browser resamples to its own rate on decode"
                  />
                  <Stat
                    label="Channels"
                    value={analysis.channels === 1 ? "Mono" : `${analysis.channels}`}
                    hint={analysis.channels > 2 ? "will be downmixed" : undefined}
                  />
                  <Stat
                    label="Peak level"
                    value={Number.isFinite(analysis.peakDb) ? `${analysis.peakDb.toFixed(1)} dBFS` : "-inf dBFS"}
                    hint={`RMS ${Number.isFinite(analysis.rmsDb) ? analysis.rmsDb.toFixed(1) : "-inf"} dBFS`}
                    tone={analysis.clipped > 0 ? "default" : "success"}
                  />
                </dl>
              ) : null}

              {analysis && analysis.clipped > 0 ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  {analysis.clipped.toLocaleString()} sample{analysis.clipped === 1 ? "" : "s"} in this file are already at
                  or beyond full scale. That clipping was in the source and cannot be undone.
                </Notice>
              ) : null}

              <Field label="Output format" hint="WAV is uncompressed and exact; MP3 is much smaller and lossy.">
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
                <Field
                  label="MP3 bitrate"
                  hint="MP3 only understands 44.1 and 48 kHz; anything else is resampled to 44.1 kHz first."
                >
                  {({ id }) => (
                    <Select id={id} value={String(kbps)} onChange={(event) => setKbps(Number(event.target.value) as Mp3Bitrate)}>
                      {MP3_BITRATES.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate} kbps
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <>
                  <Field label="Bit depth" hint="24-bit is the working standard in audio editors; 32-bit is archival.">
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
                  <Field label="Sample rate" hint="Resampled with an OfflineAudioContext, not a nearest-neighbour drop.">
                    {({ id }) => (
                      <Select
                        id={id}
                        value={String(sampleRate)}
                        onChange={(event) => setSampleRate(Number(event.target.value))}
                      >
                        {SAMPLE_RATES.map((rate) => (
                          <option key={rate} value={rate}>
                            {rate.toLocaleString()} Hz
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Channels" hint="Surround is averaged down to stereo; mono sums the pair.">
                    {() => (
                      <Segmented
                        label="Channels"
                        value={mono ? "mono" : "stereo"}
                        onChange={(value) => setMono(value === "mono")}
                        options={[
                          { value: "stereo", label: "Stereo" },
                          { value: "mono", label: "Mono" },
                        ]}
                      />
                    )}
                  </Field>
                </>
              )}

              {estimate > 0 ? (
                <div className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                    Expected output
                  </p>
                  <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-[var(--text-ink)]">
                    {formatBytes(Math.min(estimate, MAX_ESTIMATE_BYTES))}
                    {estimate > MAX_ESTIMATE_BYTES ? "+" : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    {format === "mp3"
                      ? `Bitrate x duration, plus a small frame header allowance.`
                      : `frames x block align + 44-byte header, from the real duration and sample rate.`}
                  </p>
                </div>
              ) : null}

              {willGrow ? (
                <Notice tone="info" icon={<TriangleAlert className="size-4" />}>
                  The audio will be larger than the whole video file. That is expected: extracting a lossless track removes
                  the video, and re-encoding it to MP3 still costs more bytes per second than a compressed video frame.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={!source || isRunning || !analysis}
              loading={isRunning}
              label="Extract audio"
              icon={<Music className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {probing && source ? (
          <p className="text-xs text-[var(--text-muted)]" role="status">
            Decoding the audio track to measure its real level and length...
          </p>
        ) : null}

        {probeError ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
            {probeError}
          </Notice>
        ) : null}

        {result && source ? (
          <ResultsPanel title="Extracted audio">
            <SizeComparisonStats beforeBytes={source.size} afterBytes={result.blob.size} />
            <div className="flex flex-wrap items-center gap-2">
              <DownloadButton blob={result.blob} filename={result.filename} label="Download audio" />
              {resultUrl ? <OpenButton blob={result.blob} filename={result.filename} /> : null}
            </div>
            {resultUrl ? (
              <div className="flex flex-col gap-2">
                <AudioPreview file={result.blob} src={resultUrl} />
                <button
                  type="button"
                  onClick={() => {
                    downloadBlob(result.blob, result.filename);
                    toast.downloadReady(result.filename, result.blob.size);
                  }}
                  className="self-start text-xs text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-ink)]"
                >
                  <Download className="mr-1 inline size-3" aria-hidden="true" />
                  Save as {result.filename}
                </button>
                <p className="text-xs text-[var(--text-muted)]">{result.note}</p>
              </div>
            ) : null}
          </ResultsPanel>
        ) : null}

        {sourceUrl && !result ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-ink)]">Source</h3>
            <video
              src={sourceUrl}
              controls
              playsInline
              preload="metadata"
              className="max-h-[22rem] w-full rounded-xl border border-[var(--surface-line)] bg-black object-contain"
            />
            <p className="truncate text-xs text-[var(--text-muted)]">{source.name}</p>
          </div>
        ) : null}

        <Notice tone="info" icon={<TriangleAlert className="size-4" />}>
          The browser decoder decides what is readable. AAC and MP3 in MP4, and Opus and Vorbis in WebM, work everywhere.
          AC-3, DTS, TrueHD and ALAC usually do not, and you will get a clear message rather than an empty file.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Local bits                                                         */
/* ------------------------------------------------------------------ */

/** Resample for the WAV writer. Split out so the transform body stays readable. */
async function resampleForWav(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;
  const frames = Math.max(1, Math.round(buffer.duration * targetRate));
  const offline = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
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
