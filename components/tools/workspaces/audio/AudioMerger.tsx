"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Combine, Info, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Field, Segmented, Slider, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, withExtension } from "@/lib/utils/files";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import {
  analyseAudio,
  decodeAudio,
  encodeMp3,
  encodeWav,
  estimateMp3Bytes,
  mergeBuffers,
  resampleBuffer,
  type Mp3Bitrate,
  type WavBitDepth,
} from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "audio-merger",
  category: "audio",
  processing: "local",
};

const MAX_FILES = 20;
const WAV_DEPTHS: readonly WavBitDepth[] = [16, 24, 32];
const BITRATES: readonly Mp3Bitrate[] = [96, 128, 160, 192, 256, 320];

type OutputFormat = "wav" | "mp3";

interface TrackSettings {
  gainDb: number;
  fadeMs: number;
}

interface Options {
  gap: number;
  settings: Record<string, TrackSettings>;
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

export default function AudioMergerWorkspace() {
  const {
    files: added,
    add,
    remove: removeAdded,
    clear: clearAdded,
  } = useFiles({
    category: "audio",
    maxBytes: SITE.limits.audio,
    multiple: true,
    maxFiles: MAX_FILES,
  });
  // `useFiles` validates and owns the queue but exposes no wholesale replace,
  // which arrow-button reordering needs. So the export order is local state,
  // seeded from the hook; a new selection replaces it, a reorder does not.
  const [order, setOrder] = React.useState<File[]>([]);
  const orderMatchesQueue = order.length === added.length && order.every((file, i) => file === added[i]);
  const files = orderMatchesQueue ? order : added;

  const remove = React.useCallback(
    (index: number) => {
      setOrder((current) => current.filter((_, i) => i !== index));
      removeAdded(index);
    },
    [removeAdded],
  );

  const clear = React.useCallback(() => {
    setOrder([]);
    clearAdded();
  }, [clearAdded]);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const [decoded, setDecoded] = React.useState<{ key: string; tracks: TrackInfo[] }>({ key: "", tracks: [] });
  const [gap, setGap] = React.useState(0.5);
  const [settings, setSettings] = React.useState<Record<string, TrackSettings>>({});
  const [format, setFormat] = React.useState<OutputFormat>("wav");
  const [bitDepth, setBitDepth] = React.useState<WavBitDepth>(16);
  const [kbps, setKbps] = React.useState<Mp3Bitrate>(192);

  // Decoded facts are keyed by the ordered queue, so a reorder re-measures in
  // exactly the order the export will use.
  const orderKey = files.map((file) => file.name + ":" + file.size + ":" + file.lastModified).join("|");
  const tracks = decoded.key === orderKey ? decoded.tracks : [];

  // Keyed by index because two files can share a name.
  const settingsFor = (index: number): TrackSettings => settings[index] ?? { gainDb: 0, fadeMs: 20 };
  const updateSetting = (index: number, patch: Partial<TrackSettings>) => {
    setSettings((current) => ({ ...current, [index]: { ...settingsFor(index), ...patch } }));
  };

  React.useEffect(() => {
    if (files.length === 0) return;
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
      if (alive) setDecoded({ key: orderKey, tracks: value });
    });
    return () => {
      alive = false;
    };
  }, [files, orderKey]);

  const move = React.useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= files.length) return;
      const next = [...files];
      const [item] = next.splice(from, 1);
      if (!item) return;
      next.splice(to, 0, item);
      setOrder(next);
    },
    [files],
  );

  const ready = tracks.filter((track) => track.ok);
  const audioTotal = ready.reduce((sum, track) => sum + track.duration, 0);
  const totalDuration = audioTotal + Math.max(0, gap) * Math.max(0, ready.length - 1);
  const outputChannels = Math.max(2, ...ready.map((track) => track.channels));
  const outputRate = ready[0]?.sampleRate || 48000;

  const estimate =
    format === "mp3"
      ? estimateMp3Bytes(kbps, totalDuration)
      : Math.round(totalDuration * outputRate * outputChannels * (bitDepth / 8)) + 44;

  const options = React.useMemo<Options>(
    () => ({ gap, settings, format, bitDepth, kbps }),
    [gap, settings, format, bitDepth, kbps],
  );

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      if (batch.length === 0) throw new Error("Add at least one audio file.");

      const decoded = [];
      for (let index = 0; index < batch.length; index += 1) {
        const file = batch[index]!;
        report({
          percent: (index / batch.length) * 60,
          done: index,
          total: batch.length,
          caption: `Decoding ${file.name}`,
        });
        const buffer = await decodeAudio(file);
        if (buffer.length === 0) {
          throw new Error(`${file.name} has no decodable audio.`);
        }
        decoded.push({ file, buffer });
      }

      // One common rate, chosen from the source material so nothing is
      // needlessly degraded. Concatenating mismatched rates would play the
      // later tracks at the wrong speed.
      const rate = Math.max(...decoded.map((item) => item.buffer.sampleRate));
      const prepared = [];
      for (const item of decoded) {
        prepared.push({
          file: item.file,
          buffer: await resampleBuffer(item.buffer, rate),
        });
      }

      report({ percent: 70, done: batch.length, total: batch.length, caption: "Rendering the merged timeline..." });

      const merged = await mergeBuffers(
        prepared.map((item, index) => ({
          buffer: item.buffer,
          gainDb: current.settings[index]?.gainDb ?? 0,
          fade: (current.settings[index]?.fadeMs ?? 20) / 1000,
        })),
        current.gap,
        rate,
      );

      const blob =
        current.format === "mp3"
          ? await encodeMp3(merged, current.kbps, (percent) => {
              report({
                percent: 75 + percent * 0.25,
                done: batch.length,
                total: batch.length,
                caption: `Encoding merged MP3 - ${Math.round(percent)}%`,
              });
            })
          : encodeWav(merged, current.bitDepth, { channels: merged.numberOfChannels === 1 ? 1 : 2 });

      const stem = baseName(batch[0]?.name ?? "merged");
      const analysis = analyseAudio(merged);
      return [
        {
          blob,
          filename: withExtension(`${stem}-merged-${batch.length}tracks`, current.format),
          source: batch[0],
          note: `${formatDuration(merged.duration)} · ${batch.length} tracks · ${merged.sampleRate} Hz · ${
            merged.numberOfChannels === 1 ? "mono" : "stereo"
          } · peak ${Number.isFinite(analysis.peakDb) ? `${analysis.peakDb.toFixed(1)} dBFS` : "-inf dBFS"}`,
        },
      ];
    },
    [],
  );

  const { results, stage, percent, error, run, reset, isRunning } = useTransform({ transform, options });

  const result = results[0] ?? null;
  const resultUrl = useObjectUrl(result?.blob ?? null);

  const start = React.useCallback(() => {
    if (files.length < 1 || isRunning) return;
    void run(files);
  }, [files, run, isRunning]);

  useShortcut(files.length > 0 && ready.length > 0 && !isRunning, start);

  React.useEffect(() => {
    if (stage !== "complete" || !result) return;
    recordJob(TOOL, {
      status: "success",
      fileName: files.length === 1 ? files[0]?.name : `${files.length} tracks`,
      fileCount: files.length,
      inputBytes: totalBytes,
      outputBytes: result.blob.size,
      outputName: result.filename,
    });
  }, [stage, result, files, totalBytes]);

  React.useEffect(() => {
    if (stage !== "idle" || !error) return;
    recordJob(TOOL, { status: "error", fileName: `${files.length} tracks`, fileCount: files.length, errorMessage: error });
  }, [stage, error, files.length]);

  const handleReset = () => {
    setSettings({});
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
          emptyTitle="Drop two or more files to join them."
          emptyDescription="Reorder with the arrows, set a gap, and give each track its own level and fade."
          dropzoneHint={`Up to ${MAX_FILES} files, ${Math.round(SITE.limits.audio / 1024 / 1024)} MB each.`}
          error={error}
          stage={stage}
          percent={percent}
          onRetry={start}
          renderMeta={(file, index) => {
            const track = tracks[index];
            if (!track) return null;
            if (!track.ok) return <span className="text-brand-500">cannot decode</span>;
            return `${formatDuration(track.duration)} · ${track.sampleRate} Hz · ${track.channels === 1 ? "mono" : `${track.channels}ch`}`;
          }}
          controls={
            <div className="flex flex-col gap-4">
              {files.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Tracks" value={String(ready.length)} hint={`${files.length - ready.length} cannot decode`} />
                  <Stat label="Audio total" value={formatDuration(audioTotal)} />
                  <Stat label="With gaps" value={formatDuration(totalDuration)} tone="brand" />
                  <Stat
                    label="Output size"
                    value={formatBytes(estimate)}
                    hint={`${outputRate} Hz · ${outputChannels === 1 ? "mono" : "stereo"}`}
                  />
                </dl>
              ) : null}

              {files.length > 1 ? (
                <ol className="flex flex-col gap-2">
                  {files.map((file, index) => {
                    const track = tracks[index];
                    const setting = settingsFor(index);
                    return (
                      <li
                        key={`${file.name}-${index}`}
                        className="flex flex-col gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--surface-card)] font-mono text-[11px] text-[var(--text-muted)]"
                          >
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-ink)]">
                            {file.name}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                            {track?.ok ? formatDuration(track.duration) : "—"}
                          </span>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Move ${file.name} earlier`}
                            disabled={isRunning || index === 0}
                            onClick={() => move(index, index - 1)}
                          >
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Move ${file.name} later`}
                            disabled={isRunning || index === files.length - 1}
                            onClick={() => move(index, index + 1)}
                          >
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove ${file.name}`}
                            disabled={isRunning}
                            onClick={() => remove(index)}
                          >
                            <X className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label={`Track gain - ${setting.gainDb.toFixed(1)} dB`}>
                            {({ id, describedBy }) => (
                              <Slider
                                id={id}
                                aria-describedby={describedBy}
                                min={-24}
                                max={12}
                                step={0.5}
                                value={setting.gainDb}
                                disabled={isRunning}
                                onChange={(event) =>
                                  updateSetting(index, { gainDb: Number(event.target.value) })
                                }
                              />
                            )}
                          </Field>
                          <Field label={`Fade in/out - ${setting.fadeMs} ms`}>
                            {({ id, describedBy }) => (
                              <Slider
                                id={id}
                                aria-describedby={describedBy}
                                min={0}
                                max={2000}
                                step={10}
                                value={setting.fadeMs}
                                disabled={isRunning}
                                onChange={(event) =>
                                  updateSetting(index, { fadeMs: Number(event.target.value) })
                                }
                              />
                            )}
                          </Field>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              <Field
                label={`Gap between tracks - ${gap.toFixed(2)} s`}
                hint={`Applies between each pair, so ${files.length} tracks produce ${Math.max(0, files.length - 1)} gaps.`}
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    min={0}
                    max={5000}
                    step={50}
                    value={Math.round(gap * 1000)}
                    disabled={isRunning}
                    onChange={(event) => setGap(Number(event.target.value) / 1000)}
                  />
                )}
              </Field>

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
                  {() => (
                    <Segmented
                      label="MP3 bitrate"
                      size="sm"
                      value={String(kbps)}
                      onChange={(value) => setKbps(Number(value) as Mp3Bitrate)}
                      options={BITRATES.map((rate) => ({ value: String(rate), label: `${rate}` }))}
                    />
                  )}
                </Field>
              ) : (
                <Field label="WAV bit depth" hint="16-bit matches CD; 24-bit leaves headroom for further processing.">
                  {() => (
                    <Segmented
                      label="WAV bit depth"
                      size="sm"
                      value={String(bitDepth)}
                      onChange={(value) => setBitDepth(Number(value) as WavBitDepth)}
                      options={WAV_DEPTHS.map((depth) => ({ value: String(depth), label: `${depth}-bit` }))}
                    />
                  )}
                </Field>
              )}

              {ready.length > 0 && ready.length !== files.length ? (
                <Notice tone="warning" icon={<Info className="size-4" />}>
                  {files.length - ready.length} file(s) could not be decoded by this browser and will fail the merge.
                </Notice>
              ) : null}
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={ready.length === 0 || isRunning}
              loading={isRunning}
              label="Merge tracks"
              icon={<Combine className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {result ? (
          <ResultsPanel title="Merged audio">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Length" value={formatDuration(totalDuration)} tone="brand" />
              <Stat label="Tracks joined" value={String(ready.length)} />
              <Stat label="Output size" value={formatBytes(result.blob.size)} />
              <Stat label="Input total" value={formatBytes(totalBytes)} hint="never modified" />
            </dl>
            {resultUrl ? (
              <div className="flex flex-col gap-2">
                <AudioPreview file={result.blob} src={resultUrl} />
                <div className="flex flex-wrap items-center gap-2">
                  <DownloadButton blob={result.blob} filename={result.filename} label="Download merged audio" />
                  <OpenButton blob={result.blob} filename={result.filename} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">{result.note}</p>
              </div>
            ) : null}
          </ResultsPanel>
        ) : null}

        <Notice tone="info" icon={<Info className="size-4" />}>
          Files with different sample rates are resampled to a common rate chosen from the source material. Without that step,
          concatenating a 44.1 kHz file with a 48 kHz one would play the second at the wrong speed.
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
