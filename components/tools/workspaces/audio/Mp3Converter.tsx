"use client";

import * as React from "react";
import { Info, Music, TriangleAlert } from "lucide-react";
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
import { Checkbox, Field, Segmented, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration, percentSaved } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  MP3_BITRATES,
  analyseAudio,
  decodeAudio,
  encodeMp3,
  estimateMp3Bytes,
  type Mp3Bitrate,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "mp3-converter",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;

interface Options {
  kbps: Mp3Bitrate;
  mono: boolean;
}

/** Per-file facts, measured from the decoded audio, for the plan panel. */
interface TrackInfo {
  name: string;
  size: number;
  duration: number;
  channels: number;
  sampleRate: number;
  ok: boolean;
  error?: string;
}

export default function Mp3ConverterWorkspace() {
  const { files, add, remove, move, clear, totalBytes } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });

  const [tracks, setTracks] = React.useState<TrackInfo[]>([]);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);
  const [mono, setMono] = React.useState(false);

  // Decode every selected file up front so the estimates are real numbers.
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
          const analysis = analyseAudio(buffer);
          return {
            name: file.name,
            size: file.size,
            duration: analysis.duration,
            channels: analysis.channels,
            sampleRate: analysis.sampleRate,
            ok: analysis.duration > 0,
          };
        } catch (error) {
          return {
            name: file.name,
            size: file.size,
            duration: 0,
            channels: 0,
            sampleRate: 0,
            ok: false,
            error: error instanceof Error ? error.message : "This file could not be decoded.",
          };
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
  const estimate = totalDuration > 0 ? estimateMp3Bytes(kbps, totalDuration) : 0;
  const ready = tracks.filter((track) => track.ok);
  const unreadable = tracks.filter((track) => !track.ok);

  const options = React.useMemo<Options>(() => ({ kbps, mono }), [kbps, mono]);

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const results: TransformResult[] = [];
      for (let index = 0; index < batch.length; index += 1) {
        const file = batch[index]!;
        report({
          percent: (index / batch.length) * 100,
          done: index,
          total: batch.length,
          caption: `Decoding ${file.name}`,
        });

        const buffer = await decodeAudio(file);
        if (buffer.length === 0) {
          throw new Error(`${file.name} has no decodable audio.`);
        }
        const analysis = analyseAudio(buffer);

        report({
          percent: (index / batch.length) * 100,
          done: index,
          total: batch.length,
          caption: `Encoding ${file.name} to MP3 at ${current.kbps} kbps`,
        });

        const blob = await encodeMp3(buffer, current.kbps, (percent) => {
          report({
            percent: (index + percent / 100) / batch.length * 100,
            done: index,
            total: batch.length,
            caption: `Encoding ${file.name} - ${Math.round(percent)}%`,
          });
        });

        results.push({
          blob,
          filename: withExtension(baseName(file.name), "mp3"),
          source: file,
          note: `${formatDuration(analysis.duration)} · ${current.kbps} kbps · peak ${Number.isFinite(analysis.peakDb) ? `${analysis.peakDb.toFixed(1)} dBFS` : "-inf dBFS"}`,
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

  useShortcut(files.length > 0 && ready.length > 0 && !isRunning, start);

  React.useEffect(() => {
    if (stage !== "complete" || results.length === 0) return;
    recordJob(TOOL, {
      status: "success",
      fileName: files.length === 1 ? files[0]?.name : undefined,
      fileCount: results.length,
      inputBytes: totalBytes,
      outputBytes,
      outputName: results.length === 1 ? results[0]?.filename : `${results.length} MP3 files`,
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
          emptyTitle="Drop audio files to convert to MP3."
          emptyDescription="MP3, WAV, M4A, OGG, FLAC, WebM - anything your browser can decode. Up to 20 files at once."
          dropzoneHint={`Up to ${MAX_FILES} files, ${Math.round(SITE.limits.audio / 1024 / 1024)} MB each. Reorder to change the output order.`}
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
                    label="Output estimate"
                    value={formatBytes(estimate)}
                    hint={`${kbps} kbps x ${formatDuration(totalDuration)}`}
                    tone="brand"
                  />
                </dl>
              ) : null}

              <Field
                label="MP3 bitrate"
                hint="128 kbps suits speech; 192 kbps suits most music; 320 kbps only helps sources that were already lossy at a high rate."
              >
                {({ id, describedBy }) => (
                  <div className="flex flex-col gap-2">
                    <Segmented
                      label="MP3 bitrate"
                      value={String(kbps)}
                      onChange={(value) => setKbps(Number(value) as Mp3Bitrate)}
                      options={MP3_BITRATES.map((rate) => ({ value: String(rate), label: `${rate}` }))}
                    />
                    <p className="text-xs text-[var(--text-muted)]" id={describedBy}>
                      {kbps} kbps, {kbps <= 128 ? "speech-optimised" : kbps <= 192 ? "a good general default" : "high quality, diminishing returns"}
                    </p>
                  </div>
                )}
              </Field>

              <Checkbox
                label="Force mono"
                description="Halves the bitrate a mono stream needs. Most stereo music gains nothing and loses its spatial image."
                checked={mono}
                onChange={(event) => setMono(event.target.checked)}
              />

              {unreadable.length > 0 ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  {unreadable.length} of your files could not be decoded by this browser and will fail the job. MP3, AAC,
                  Opus, Vorbis and PCM decode everywhere; rarer codecs do not.
                </Notice>
              ) : null}

              {estimate > totalBytes && totalBytes > 0 ? (
                <Notice tone="info" icon={<TriangleAlert className="size-4" />}>
                  At {kbps} kbps the output will be larger than the input ({formatBytes(estimate)} against{" "}
                  {formatBytes(totalBytes)}). Opus and Vorbis files are usually the reason; re-encoding them to MP3 costs
                  bytes without adding quality.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={files.length === 0 || ready.length === 0 || isRunning}
              loading={isRunning}
              label="Convert to MP3"
              icon={<Music className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {results.length > 0 ? (
          <ResultsPanel title={results.length === 1 ? "MP3 ready" : `${results.length} MP3 files ready`}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Files" value={String(results.length)} tone="brand" />
              <Stat label="Output size" value={formatBytes(outputBytes)} />
              <Stat
                label={outputBytes < totalBytes ? "Saved" : "Increase"}
                value={`${percentSaved(totalBytes, outputBytes).toFixed(1)}%`}
                hint={outputBytes < totalBytes ? "of the input size" : "larger than the input"}
                tone={outputBytes < totalBytes ? "success" : "default"}
              />
              <Stat label="Bitrate" value={`${kbps} kbps`} hint="target" />
            </dl>

            {results.length === 1 && primary && primaryUrl ? (
              <div className="flex flex-col gap-2">
                <AudioPreview file={primary.blob} src={primaryUrl} />
                <div className="flex flex-wrap items-center gap-2">
                  <DownloadButton blob={primary.blob} filename={primary.filename} label="Download MP3" />
                  <OpenButton blob={primary.blob} filename={primary.filename} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">{primary.note}</p>
              </div>
            ) : results.length > 1 ? (
              <DownloadGroup
                items={results.map((item) => ({ name: item.filename, blob: item.blob }))}
                zipName="mp3-converted.zip"
                originalTotalBytes={totalBytes}
              />
            ) : null}

          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          MP3 is mono or stereo at 44.1 or 48 kHz. Anything else is resampled and downmixed first, which is a required
          format constraint rather than a choice - and it is why a 5.1 source does not stay 5.1.
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
