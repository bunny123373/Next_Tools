"use client";

import * as React from "react";
import { FileAudio, Info } from "lucide-react";
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
import { Field, Segmented, Select, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  analyseAudio,
  decodeAudio,
  encodeWav,
  resampleBuffer,
  type AudioAnalysis,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "wav-converter",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000] as const;
const DEPTHS: readonly WavBitDepth[] = [16, 24, 32];

const RATE_NOTES: Record<number, string> = {
  8000: "Telephone quality. Speech only.",
  16000: "Wideband speech. Usable for voice, thin for music.",
  22050: "Half of 44.1 kHz. Common in older game and voice assets.",
  32000: "Broadcast and video-bench standard.",
  44100: "CD standard. What most music was mastered at.",
  48000: "Video standard. What your browser most likely decoded this file at.",
};

interface Options {
  bitDepth: WavBitDepth;
  sampleRate: number;
  mono: boolean;
}

interface TrackInfo {
  name: string;
  duration: number;
  channels: number;
  sampleRate: number;
  ok: boolean;
}

export default function WavConverterWorkspace() {
  const { files, add, remove, move, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const [tracks, setTracks] = React.useState<TrackInfo[]>([]);
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [sampleRate, setSampleRate] = React.useState(44100);
  const [mono, setMono] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    if (files.length === 0) {
      setTracks([]);
      return;
    }
    void Promise.all(
      files.map(async (file): Promise<TrackInfo> => {
        try {
          const buffer = await decodeAudio(file);
          const analysis: AudioAnalysis = analyseAudio(buffer);
          return {
            name: file.name,
            duration: analysis.duration,
            channels: analysis.channels,
            sampleRate: analysis.sampleRate,
            ok: analysis.duration > 0,
          };
        } catch {
          return { name: file.name, duration: 0, channels: 0, sampleRate: 0, ok: false };
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
  const ready = tracks.filter((track) => track.ok);
  const unreadable = tracks.filter((track) => !track.ok);

  // Exact arithmetic, not a guess: frames x block align + 44-byte header.
  const estimate = React.useMemo(() => {
    if (totalDuration <= 0) return 0;
    const channels = mono ? 1 : 2;
    return Math.round(totalDuration * sampleRate * channels * (bitDepth / 8)) + 44 * ready.length;
  }, [totalDuration, sampleRate, bitDepth, mono, ready.length]);

  const options = React.useMemo<Options>(
    () => ({ bitDepth, sampleRate, mono }),
    [bitDepth, sampleRate, mono],
  );

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
        report({
          percent: share(0.6),
          done: index,
          total: batch.length,
          caption:
            buffer.sampleRate === current.sampleRate
              ? `Writing ${file.name}`
              : `Resampling ${file.name} to ${current.sampleRate} Hz`,
        });

        const prepared = await resampleBuffer(buffer, current.sampleRate);
        const blob = encodeWav(prepared, current.bitDepth, {
          channels: current.mono ? 1 : 2,
        });

        results.push({
          blob,
          filename: withExtension(baseName(file.name), "wav"),
          source: file,
          note: `${formatDuration(prepared.duration)} · ${current.bitDepth}-bit · ${prepared.sampleRate} Hz · ${
            current.mono ? "mono" : "stereo"
          }`,
        });
        report({ percent: share(1), done: index + 1, total: batch.length, caption: `Wrote ${file.name}` });
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

  useShortcut(files.length > 0 && ready.length > 0 && !isRunning, start);

  React.useEffect(() => {
    if (stage !== "complete" || results.length === 0) return;
    recordJob(TOOL, {
      status: "success",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: results.length,
      inputBytes: totalBytes,
      outputBytes,
      outputName: results.length === 1 ? results[0]?.filename : `${results.length} WAV files`,
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
          emptyTitle="Drop audio files to convert to WAV."
          emptyDescription="Uncompressed PCM with a correct RIFF header. Up to 20 files at once."
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
                  <Stat label="Files" value={String(ready.length)} hint={`${unreadable.length} cannot be decoded`} />
                  <Stat label="Total length" value={formatDuration(totalDuration)} />
                  <Stat label="Input size" value={formatBytes(totalBytes)} />
                  <Stat
                    label="Exact output size"
                    value={formatBytes(estimate)}
                    hint="frames x block align + header"
                    tone="brand"
                  />
                </dl>
              ) : null}

              <Field label="Bit depth" hint="24-bit is the working standard in audio editors; 32-bit is archival.">
                {({ id }) => (
                  <Select id={id} value={String(bitDepth)} onChange={(event) => setBitDepth(Number(event.target.value) as WavBitDepth)}>
                    {DEPTHS.map((depth) => (
                      <option key={depth} value={depth}>
                        {depth}-bit PCM
                        {depth === 16 ? " (CD standard)" : depth === 24 ? " (editing standard)" : " (archival)"}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Sample rate" hint={RATE_NOTES[sampleRate]} error={null}>
                {({ id }) => (
                  <Select id={id} value={String(sampleRate)} onChange={(event) => setSampleRate(Number(event.target.value))}>
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

              {unreadable.length > 0 ? (
                <Notice tone="warning" icon={<Info className="size-4" />}>
                  {unreadable.length} of your files could not be decoded by this browser and will fail the job.
                </Notice>
              ) : null}

              {estimate > totalBytes && totalBytes > 0 ? (
                <Notice tone="info" icon={<Info className="size-4" />}>
                  WAV is uncompressed, so the output is {formatBytes(estimate)} against {formatBytes(totalBytes)} of input.
                  That is the honest arithmetic, not a bug.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={files.length === 0 || ready.length === 0 || isRunning}
              loading={isRunning}
              label="Convert to WAV"
              icon={<FileAudio className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {results.length > 0 ? (
          <ResultsPanel title={results.length === 1 ? "WAV ready" : `${results.length} WAV files ready`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Files" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat label="Bit depth" value={`${bitDepth}-bit`} />
              <Stat label="Sample rate" value={`${sampleRate.toLocaleString()} Hz`} hint="resampled where needed" />
            </dl>

            {results.length === 1 && primary && primaryUrl ? (
              <div className="flex flex-col gap-2">
                <AudioPreview file={primary.blob} src={primaryUrl} />
                <div className="flex flex-wrap items-center gap-2">
                  <DownloadButton blob={primary.blob} filename={primary.filename} label="Download WAV" />
                  <OpenButton blob={primary.blob} filename={primary.filename} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">{primary.note}</p>
              </div>
            ) : results.length > 1 ? (
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName="wav-converted.zip"
                originalTotalBytes={totalBytes}
              />
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          24- and 32-bit output include a fact chunk declaring the sample-frame count, which is what makes them formally
          valid RIFF/WAVE. 16-bit is plain PCM and needs nothing extra. No float extensions are written.
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
