"use client";

/**
 * The shared workspace for the six image tools.
 *
 * `kind` decides the shape of the input, not the output contract:
 *
 *  - `generate` — a prompt box. Nothing is uploaded.
 *  - `edit`     — a dropzone plus a prompt. The result is a new image; the file
 *                 on disk is only read.
 *  - `analyze`  — a dropzone plus an optional question. The result is text, so
 *                 this mode renders the model's readout rather than a picture.
 *
 * `kind` and `task` are typed as a union, so a workspace cannot pair the
 * analyzer's `task` with the editor's route and find out at runtime.
 *
 * The result image is delivered as base64 and shown through a `data:` URL. It is
 * never written anywhere and never put in the address bar, so a generated image
 * cannot leak through a shared link.
 */

import * as React from "react";
import { Info, Sparkles, Upload } from "lucide-react";
import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
// The indeterminate ProgressBar that used to sit here was replaced by
// `GeneratingPanel`, which reports the provider's real stages instead of a bar
// that cannot know its own percentage.
import { FileDropzone } from "@/components/tools/FileDropzone";
import { ImagePreview } from "@/components/tools/FilePreview";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState, ToolError } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { SITE } from "@/lib/site";
import { toast } from "@/lib/utils/toast";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import { baseName, sanitizeFilename } from "@/lib/utils/files";
import {
  AI_ALLOWED_IMAGE_MIME,
  AI_MAX_IMAGE_BYTES,
  AI_MAX_IMAGE_PROMPT_CHARS,
  extensionForMime,
  type AiImageTask,
  type AiOptions,
  type AiVisionTask,
} from "@/lib/ai/schemas";
import type { Tool } from "@/lib/tools/types";
import {
  AiRequestError,
  runImageStreaming,
  runVision,
  type ImageStage,
} from "./ai-client";
import { AiControls, defaultControlValues, type AiControl, type AiControlValues } from "./controls";
import { AiCheckingState, AiSetupState, useAiStatus } from "./useAiStatus";

/** Uploads are capped by the stricter of the site limit and the route's own. */
const MAX_UPLOAD_BYTES = Math.min(SITE.limits.image, AI_MAX_IMAGE_BYTES);

interface AiImageWorkspaceBase {
  tool: Tool;
  /** The tool's declared controls. */
  options: readonly AiControl[];
  promptLabel?: string;
  promptPlaceholder?: string;
  /** Shown under the dropzone. */
  uploadHint?: React.ReactNode;
  dropzoneLabel?: React.ReactNode;
}

export type AiImageWorkspaceProps =
  | (AiImageWorkspaceBase & { kind: "generate"; task: AiImageTask })
  | (AiImageWorkspaceBase & { kind: "edit"; task: AiImageTask })
  | (AiImageWorkspaceBase & { kind: "analyze"; task: AiVisionTask });

interface ReadoutField {
  label: string;
  value: string;
}

/**
 * Splits a `key-value` readout into a labelled list. Deliberately conservative:
 * only lines that are exactly `Label: value` become fields, and the raw text is
 * always rendered underneath, so parsing can never hide what the model said.
 */
function parseReadout(text: string): { fields: ReadoutField[]; parseable: boolean } {
  const nonEmpty = text.split("\n").filter((line) => line.trim().length > 0);
  const fields: ReadoutField[] = [];
  for (const line of nonEmpty) {
    const match = /^(?:\*\*)?([A-Za-z][A-Za-z0-9 /&'-]{0,40}?)(?:\*\*)?\s*:\s*(.+?)\s*$/.exec(line.trim());
    if (match && match[1] && match[2]) fields.push({ label: match[1], value: match[2] });
  }
  // Only show the labelled grid when it actually covers most of the answer;
  // a long paragraph with one stray colon is not a structured readout.
  return { fields, parseable: fields.length >= 2 && fields.length >= nonEmpty.length / 2 };
}

export default function AiImageWorkspace(props: AiImageWorkspaceProps) {
  const { tool, options: controls, kind } = props;
  const status = useAiStatus();

  const [file, setFile] = React.useState<File | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [values, setValues] = React.useState<AiControlValues>(() => defaultControlValues(controls));
  const [image, setImage] = React.useState<{ mime: string; base64: string } | null>(null);
  const [revisedPrompt, setRevisedPrompt] = React.useState<string | null>(null);
  const [readout, setReadout] = React.useState<string | null>(null);
  const [model, setModel] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  /**
   * The provider's real position in a queued job. Null before the first frame.
   * Deliberately no percentage: nobody knows how far through an image a model
   * is, so the panel reports measured elapsed time instead of inventing a ratio.
   */
  const [stage, setStage] = React.useState<ImageStage | null>(null);
  const [sourceUrl, setSourceUrl] = React.useState<string | null>(null);

  const ready = status.state === "ready";
  const disabled = busy || !ready;
  const needsFile = kind !== "generate";
  /** The analyzer can run with no question; the generators need one. */
  const needsPrompt = kind !== "analyze";
  const overLimit = prompt.length > AI_MAX_IMAGE_PROMPT_CHARS;
  const canRun =
    ready &&
    !busy &&
    !overLimit &&
    (needsPrompt ? prompt.trim().length > 0 : true) &&
    (needsFile ? file !== null : true);

  // The uploaded image is previewed through an object URL, so a 4 MB file is not
  // re-encoded as base64 just to be looked at.
  React.useEffect(() => {
    if (!file) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setImage(null);
    setReadout(null);
    setRevisedPrompt(null);
    setModel(null);
    setError(null);
  };

  const acceptFile = (incoming: File[]) => {
    const next = incoming[0];
    if (!next) {
      setFile(null);
      return;
    }
    if (!(AI_ALLOWED_IMAGE_MIME as readonly string[]).includes(next.type)) {
      // The dropzone's own image set is wider than what the provider route will
      // accept, so the narrower list is enforced here, visibly.
      toast.rejected(
        `${next.name} is a ${next.type || "unknown"} file. Use ${AI_ALLOWED_IMAGE_MIME.join(", ")}.`,
      );
      setFile(null);
      return;
    }
    setFile(next);
    reset();
  };

  const run = async () => {
    if (!canRun) return;

    setBusy(true);
    setStage(null);
    reset();

    try {
      if (props.kind === "analyze") {
        const response = await runVision({
          task: props.task,
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
          options: values as AiOptions,
          file: file as File,
        });
        setReadout(response.output);
        setModel(response.model);
        toast.processingComplete("Readout ready", `Written by ${response.model}.`);
        return;
      }

      const response = await runImageStreaming(
        {
          task: props.task,
          prompt: prompt.trim(),
          options: values as AiOptions,
          ...(file ? { file } : {}),
        },
        setStage,
      );
      setImage(response.image);
      setRevisedPrompt(response.revisedPrompt ?? null);
      setModel(response.model);
      toast.processingComplete("Image ready", `Generated by ${response.model}.`);
    } catch (caught) {
      const message =
        caught instanceof AiRequestError
          ? caught.message
          : "Something went wrong on the way to the model. Try again in a moment.";
      setError(message);
      toast.error("The model could not be reached", message);
    } finally {
      setBusy(false);
    }
  };

  const dataUrl = image ? `data:${image.mime};base64,${image.base64}` : null;
  const downloadName = `${sanitizeFilename(baseName(tool.name)).toLowerCase().replace(/\s+/g, "-")}.${extensionForMime(image?.mime ?? "image/png")}`;
  const readoutData = readout ? parseReadout(readout) : null;

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        <PrivacyNote mode="ai" detailed />

        {status.state === "checking" ? (
          <AiCheckingState />
        ) : status.state === "unavailable" ? (
          <AiSetupState tool={tool} reason={status.reason} />
        ) : (
          <>
            {needsFile ? (
              <FileDropzone
                category="image"
                maxBytes={MAX_UPLOAD_BYTES}
                files={file ? [file] : []}
                onAdd={acceptFile}
                {...(file ? { onRemove: () => setFile(null), onClear: () => setFile(null) } : {})}
                label={props.dropzoneLabel ?? "Drop an image here"}
                hint={
                  props.uploadHint ?? (
                    <>
                      {AI_ALLOWED_IMAGE_MIME.map((mime) => mime.replace("image/", "").toUpperCase()).join(", ")}
                      {" · "}
                      up to {formatBytes(MAX_UPLOAD_BYTES)}. The file is read here and sent straight to
                      the provider; we do not store it.
                    </>
                  )
                }
                disabled={busy}
              />
            ) : null}

            <div className="flex flex-col gap-4">
              <Field
                label={
                  props.promptLabel ??
                  (kind === "generate" ? "Describe the image" : "What should change?")
                }
                {...(kind === "generate"
                  ? {
                      hint: "Concrete detail beats concept: subject, framing, light, colour, material.",
                    }
                  : {})}
              >
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    rows={4}
                    disabled={disabled}
                    maxLength={AI_MAX_IMAGE_PROMPT_CHARS}
                    placeholder={
                      props.promptPlaceholder ??
                      (kind === "generate"
                        ? "A worn leather notebook on an oak desk beside a window, soft morning light, shallow depth of field…"
                        : kind === "analyze"
                          ? "Optional: what do you want to know about it? Leave blank for a general description."
                          : "Sharpen the edges of the label and calm the noise in the shadow areas.")
                    }
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    className="resize-y"
                  />
                )}
              </Field>

              <AiControls controls={controls} values={values} onChange={setValues} disabled={disabled} />

              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void run()}
                  loading={busy}
                  disabled={!canRun}
                >
                  {needsFile ? (
                    <Upload className="size-4" aria-hidden="true" />
                  ) : (
                    <Sparkles className="size-4" aria-hidden="true" />
                  )}
                  {tool.actionLabel ?? "Run"}
                </Button>
                {image || readout ? (
                  <Button variant="ghost" onClick={reset}>
                    Clear result
                  </Button>
                ) : null}
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  {formatNumber(prompt.length)} / {formatNumber(AI_MAX_IMAGE_PROMPT_CHARS)} characters
                </span>
              </div>

              {busy ? <GeneratingPanel stage={stage} size={values.size} style={values.style} /> : null}
            </div>

            {error ? (
              <ToolError
                title="That did not work."
                detail={error}
                {...(needsPrompt && !prompt.trim() ? {} : { onRetry: () => void run() })}
              />
            ) : null}

            {readout ? (
              <section className="flex flex-col gap-3" aria-label="Readout">
                {readoutData?.parseable ? (
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {readoutData.fields.map((field) => (
                      <div
                        key={field.label}
                        className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3"
                      >
                        <dt className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                          {field.label}
                        </dt>
                        <dd className="mt-1 break-words text-[13px] leading-relaxed text-[var(--text-ink)]">
                          {field.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <div
                  role="region"
                  aria-label="Model readout, raw text"
                  className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 text-[13px] leading-relaxed text-[var(--text-ink)]"
                >
                  {readout}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton value={readout} label="Copy readout" what="Readout copied to clipboard" />
                  <DownloadButton
                    size="sm"
                    variant="secondary"
                    text={readout}
                    filename={`${tool.slug}-readout.txt`}
                    label="Download readout"
                  />
                </div>
              </section>
            ) : null}

            {image && dataUrl ? (
              <section className="flex flex-col gap-3" aria-label="Result">
                <div className={kind === "edit" && sourceUrl ? "grid gap-3 lg:grid-cols-2" : "grid gap-3"}>
                  {kind === "edit" && sourceUrl ? (
                    <ImagePreview
                      src={sourceUrl}
                      alt="The image you uploaded"
                      caption="Original — unchanged on your device"
                    />
                  ) : null}
                  <ImagePreview
                    src={dataUrl}
                    alt={`Result generated by ${model ?? "the configured model"}`}
                    caption="Result — rendered in the page and never uploaded anywhere"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <DownloadButton dataUrl={dataUrl} filename={downloadName} label="Download image" />
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                    {image.mime} · generated by {model}
                  </span>
                </div>
                {revisedPrompt ? (
                  <details className="text-xs text-[var(--text-muted)]">
                    <summary className="cursor-pointer select-none hover:text-[var(--text-ink)]">
                      The model rewrote your description
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[11px] leading-relaxed">
                      {revisedPrompt}
                    </pre>
                    <p className="mt-2">
                      Some providers expand your prompt before generating. This is what was actually
                      rendered, which is usually the fastest way to see why the result looks the way it
                      does.
                    </p>
                  </details>
                ) : null}
              </section>
            ) : null}

            {needsFile && !file && !readout && !image && !error && !busy ? (
              <div className="rounded-[10px] border border-[var(--surface-line)]">
                <ToolEmptyState
                  title="Add an image to get started."
                  description="Everything below comes into use as soon as you drop a file."
                  className="py-10"
                />
              </div>
            ) : null}

            <Notice tone="info" icon={<Info className="size-4" />}>
              {kind === "analyze"
                ? "A vision model will look at your image and write about it. It is told to report only what it can see and to admit when it cannot — and it still gets things wrong. It will not identify people."
                : "A generative model will produce this image. It is inventing pixels rather than editing a photograph the way a photo editor would, so faces, lettering and fine detail can come out wrong."}
            </Notice>
          </>
        )}
      </div>
    </ToolShell>
  );
}

/** The three steps, in the order the provider actually reports them. */
const STEPS = [
  { phase: "submitting", label: "Sending your prompt" },
  { phase: "generating", label: "The model is drawing" },
  { phase: "fetching", label: "Fetching the finished image" },
] as const;

function stageIndex(phase: ImageStage["phase"]): number {
  return STEPS.findIndex((step) => step.phase === phase);
}

/**
 * What the user sees while an image is being made.
 *
 * Two honest choices. The box is drawn at the aspect ratio actually requested,
 * so the page does not jump when the image lands. And the steps come from the
 * provider's own report of where a queued job is, with a real elapsed-seconds
 * counter — never a percentage, because no one knows how far through an image
 * a model is. A bar filling at a made-up rate is worse than no bar.
 */
function GeneratingPanel({
  stage,
  size,
  style,
}: {
  stage: ImageStage | null;
  size: unknown;
  style: unknown;
}) {
  const active = stage ? stageIndex(stage.phase) : 0;
  const elapsed = stage && "elapsedMs" in stage ? Math.round(stage.elapsedMs / 1000) : null;
  const polls = stage && "polls" in stage ? stage.polls : null;

  // The requested canvas, so the placeholder matches the result's shape.
  const [w, h] = typeof size === "string" ? size.split("x").map(Number) : [1, 1];
  const ratio = Number.isFinite(w) && Number.isFinite(h) && h > 0 ? w / h : 1;
  const boxWidth = ratio >= 1 ? "max-w-[300px]" : "max-w-[210px]";

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="flex flex-col items-center gap-3.5">
        <div
          className={`relative w-full ${boxWidth} overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)]`}
          style={{ aspectRatio: String(ratio) }}
        >
          {/* A shimmer, not a fill: it says "waiting", not "62% done". */}
          <div
            aria-hidden="true"
            className="absolute inset-0 animate-pulse bg-gradient-to-br from-[var(--surface-line)]/40 via-transparent to-[var(--surface-line)]/40"
          />
          <div className="absolute inset-0 grid place-items-center px-4 text-center">
            <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
              {stage?.phase === "fetching"
                ? "Almost there — downloading the finished image."
                : "The model is working. This usually takes a few seconds."}
            </p>
          </div>
        </div>

        <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
          {STEPS.map((step, index) => {
            const done = index < active;
            const current = index === active;
            return (
              <li key={step.phase} className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 text-[12px] ${
                    current
                      ? "font-medium text-[var(--text-ink)]"
                      : done
                        ? "text-emerald-500"
                        : "text-[var(--text-muted)]"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-4 place-items-center rounded-full border text-[9px] ${
                      current
                        ? "border-brand-500 bg-brand-500/20"
                        : done
                          ? "border-emerald-500 bg-emerald-500/20"
                          : "border-[var(--surface-line)]"
                    }`}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  {step.label}
                </span>
                {index < STEPS.length - 1 ? (
                  <span aria-hidden="true" className="text-[var(--text-muted)]">
                    ·
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      <p className="text-center text-[12px] leading-relaxed text-[var(--text-muted)]">
        {elapsed !== null ? (
          <>
            {elapsed}s elapsed
            {polls !== null ? ` · ${polls} status ${polls === 1 ? "check" : "checks"}` : ""}. We
            cannot show a percentage, because the model does not report one.
          </>
        ) : (
          <>
            {typeof style === "string" && style ? `Style: ${style}. ` : ""}
            We cannot show a percentage, because the model does not report one.
          </>
        )}
      </p>
    </div>
  );
}
