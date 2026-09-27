"use client";

import * as React from "react";
import { Download, Mic, TriangleAlert } from "lucide-react";
import { ToolShell, PrivacyNote, SetupRequired } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformProgress,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { Notice } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Select, Stat } from "@/components/ui/form";
import { useFiles, useObjectUrl } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { baseName, downloadBlob } from "@/lib/utils/files";
import { toast } from "@/lib/utils/toast";
import { recordJob } from "@/components/user/recordJob";
import type { Tool } from "@/lib/tools/types";
import { AUDIO_TOOLS } from "@/lib/tools/definitions/audio";
import { analyseAudio, decodeAudio, type AudioAnalysis } from "@/lib/tools/engines/media";

const TOOL: Pick<Tool, "id" | "category" | "processing"> = {
  id: "audio-to-text",
  category: "audio",
  processing: "server",
};

/**
 * The real tool definition, straight from the category module — `SetupRequired`
 * reads `setupNote` from it, so there is one source of truth for the wording and
 * no reason to restate it here. The lookup can only fail if the definition is
 * removed, which is a build-time concern handled by the registry validator.
 */
const TOOL_DEFINITION = AUDIO_TOOLS.find((tool) => tool.id === TOOL.id) as Tool;

/** Languages the route is expected to accept, in the usual provider codes. */
const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "auto", label: "Detect automatically" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
];

const MODELS: ReadonlyArray<{ code: string; label: string; note: string }> = [
  { code: "standard", label: "Standard", note: "Fastest and cheapest. Best for clear, single-speaker audio." },
  { code: "enhanced", label: "Enhanced", note: "Slower, more expensive, noticeably better on accents and noise." },
];

const ENDPOINT = "/api/tools/audio/transcribe";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface Options {
  language: string;
  model: string;
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

export default function AudioToTextWorkspace() {
  const { files, add, remove, clear } = useFiles({ category: "audio", maxBytes: SITE.limits.audio });
  const source = files[0] ?? null;
  const sourceUrl = useObjectUrl(source);

  const [analysis, setAnalysis] = React.useState<AudioAnalysis | null>(null);
  const [language, setLanguage] = React.useState("auto");
  const [model, setModel] = React.useState("standard");
  const [setupMissing, setSetupMissing] = React.useState(false);
  const [segments, setSegments] = React.useState<Segment[]>([]);

  // Measure the real audio so the size and duration in the panel are facts.
  React.useEffect(() => {
    let alive = true;
    setAnalysis(null);
    if (!source) return;
    void decodeAudio(source)
      .then((buffer) => alive && setAnalysis(analyseAudio(buffer)))
      .catch(() => {
        if (alive) setAnalysis(null);
      });
    return () => {
      alive = false;
    };
  }, [source]);

  const tooLarge = Boolean(source && source.size > MAX_UPLOAD_BYTES);

  const options = React.useMemo<Options>(() => ({ language, model }), [language, model]);

  const transform = React.useCallback(
    async (
      batch: File[],
      current: Options,
      report: (progress: TransformProgress) => void,
    ): Promise<TransformResult[]> => {
      const file = batch[0];
      if (!file) throw new Error("Choose an audio file first.");
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `This file is ${formatBytes(file.size)}. Transcription providers cap uploads at 25 MB, so split it first.`,
        );
      }

      report({ percent: 20, done: 0, total: 1, caption: "Uploading..." });

      const body = new FormData();
      body.append("file", file, file.name);
      body.append("language", current.language);
      body.append("model", current.model);

      let response: Response;
      try {
        response = await fetch(ENDPOINT, { method: "POST", body });
      } catch {
        throw new Error(
          "The request could not be sent. If this deployment has no transcription route configured, that is expected - see the setup note below.",
        );
      }

      // A missing route is not a failure we should paper over: it means the
      // operator has not configured a provider, and the tool must say so.
      if (response.status === 501 || response.status === 404) {
        setSetupMissing(true);
        throw new Error("No transcription provider is configured on this deployment.");
      }
      if (response.status === 413) {
        throw new Error("That file is too large for the provider. Split it and try again.");
      }
      if (response.status === 429) {
        throw new Error("The transcription endpoint is rate limited. Wait a moment and try again.");
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Transcription failed with HTTP ${response.status}.${detail ? ` ${detail.slice(0, 200)}` : ""}`,
        );
      }

      report({ percent: 90, done: 0, total: 1, caption: "Reading the transcript..." });

      const payload: unknown = await response.json().catch(() => null);
      const parsed = parseTranscript(payload);
      if (!parsed) {
        throw new Error("The provider's response did not contain a transcript. Nothing was invented in its place.");
      }

      setSegments(parsed.segments);
      report({ percent: 100, done: 1, total: 1, caption: "Transcript ready" });

      return [
        {
          blob: new Blob([parsed.text], { type: "text/plain;charset=utf-8" }),
          filename: `${baseName(file.name)}.txt`,
          source: file,
          note: `${parsed.segments.length > 0 ? `${parsed.segments.length} segments · ` : ""}${
            parsed.language ? `${parsed.language} · ` : ""
          }${formatBytes(parsed.text.length)} of text`,
        },
      ];
    },
    [],
  );

  const { results, stage, percent, error, run, reset, isRunning } = useTransform({ transform, options });

  const result = results[0] ?? null;
  const text = useObjectUrlText(result?.blob ?? null);
  const transcript = text ?? "";

  const start = React.useCallback(() => {
    if (!source || isRunning) return;
    setSetupMissing(false);
    void run([source]);
  }, [source, run, isRunning]);

  useShortcut(Boolean(source) && !isRunning && !tooLarge, start);

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
    setSegments([]);
    setSetupMissing(false);
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
          maxBytes={SITE.limits.audio}
          emptyTitle="Drop an audio or video file to transcribe."
          emptyDescription="The upload, language and model controls are complete. Transcription needs a server-side provider."
          dropzoneHint={`One file at a time. Transcription providers cap uploads at 25 MB; the panel shows the real size.`}
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
              {source ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="File size" value={formatBytes(source.size)} />
                  <Stat
                    label="Length"
                    value={analysis ? formatDuration(analysis.duration) : "—"}
                    hint={analysis ? undefined : "not decodable locally"}
                  />
                  <Stat
                    label="Provider limit"
                    value="25 MB"
                    hint={tooLarge ? "this file is over it" : "within limit"}
                    tone={tooLarge ? "default" : "success"}
                  />
                  <Stat
                    label="Endpoint"
                    value={ENDPOINT}
                    hint={setupMissing ? "not implemented" : "POST, multipart"}
                    tone={setupMissing ? "default" : "brand"}
                  />
                </dl>
              ) : null}

              {tooLarge ? (
                <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                  This file is {formatBytes(source?.size ?? 0)}, over the 25 MB cap most transcription providers impose. Split
                  it with the Audio Splitter first.
                </Notice>
              ) : null}

              <Field label="Language" hint="Passed straight through to the provider as the language hint.">
                {({ id }) => (
                  <Select id={id} value={language} onChange={(event) => setLanguage(event.target.value)}>
                    {LANGUAGES.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Model" hint={MODELS.find((item) => item.code === model)?.note}>
                {({ id }) => (
                  <Select id={id} value={model} onChange={(event) => setModel(event.target.value)}>
                    {MODELS.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          }
          action={
            <ProcessButton
              onClick={start}
              disabled={!source || isRunning || tooLarge}
              loading={isRunning}
              label="Transcribe"
              icon={<Mic className="size-4" aria-hidden="true" />}
            />
          }
          secondary={<ResetButton onClick={handleReset} />}
        />

        {sourceUrl ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-ink)]">Source</h3>
            <audio controls src={sourceUrl} className="w-full" />
            <p className="truncate text-xs text-[var(--text-muted)]">{source.name}</p>
          </div>
        ) : null}

        {setupMissing ? <SetupRequired tool={TOOL_DEFINITION} /> : null}

        {result && transcript ? (
          <ResultsPanel title="Transcript">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  downloadBlob(result.blob, result.filename);
                  toast.downloadReady(result.filename, result.blob.size);
                }}
              >
                <Download className="size-4" aria-hidden="true" />
                Download .txt
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void toast.copy(transcript, "Transcript copied");
                }}
              >
                Copy transcript
              </Button>
            </div>

            <p className="text-xs text-[var(--text-muted)]">{result.note}</p>

            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4 text-[13px] leading-relaxed text-[var(--text-ink)]">
              {transcript}
            </pre>

            {segments.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                  Timings returned by the provider
                </p>
                <ol className="max-h-56 overflow-y-auto text-xs text-[var(--text-muted)]">
                  {segments.map((segment, index) => (
                    <li key={`${segment.start}-${index}`} className="flex gap-3 py-0.5">
                      <span className="w-24 shrink-0 font-mono tabular-nums">
                        {formatDuration(segment.start)} - {formatDuration(segment.end)}
                      </span>
                      <span className="min-w-0 flex-1">{segment.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </ResultsPanel>
        ) : null}

        <PrivacyNote mode="server" detailed />
      </div>
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Local bits                                                         */
/* ------------------------------------------------------------------ */

interface ParsedTranscript {
  text: string;
  language: string;
  segments: Segment[];
}

/**
 * Read the provider's response without inventing anything. Anything that is not
 * a recognisable transcript shape is rejected, so we can report that instead of
 * rendering an empty or invented result.
 */
function parseTranscript(payload: unknown): ParsedTranscript | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  const rawText = record["text"] ?? record["transcript"] ?? record["transcription"];
  if (typeof rawText !== "string" || rawText.trim().length === 0) return null;

  const segments: Segment[] = [];
  const rawSegments = record["segments"] ?? record["utterances"] ?? record["chunks"];
  if (Array.isArray(rawSegments)) {
    for (const entry of rawSegments) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const value = item["text"] ?? item["transcript"];
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const start = Number(item["start"] ?? item["start_time"] ?? 0);
      const end = Number(item["end"] ?? item["end_time"] ?? start);
      segments.push({
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : 0,
        text: value,
      });
    }
  }

  const language = typeof record["language"] === "string" ? record["language"] : "";
  return { text: rawText, language, segments };
}

/** Read a text Blob into state, revoking the object URL on change/unmount. */
function useObjectUrlText(blob: Blob | null): string | null {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!blob) {
      setText(null);
      return;
    }
    let alive = true;
    const url = URL.createObjectURL(blob);
    void fetch(url)
      .then((response) => response.text())
      .then((value) => {
        if (alive) setText(value);
      })
      .catch(() => {
        if (alive) setText(null);
      });
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return text;
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
