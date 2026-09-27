"use client";

/**
 * The shared workspace for the five text tools.
 *
 * One component, five configurations. Each tool file under this directory
 * renders this with its own `task`, controls, sample and copy, so the behaviour
 * — the status gate, the indeterminate progress bar, the error mapping, the
 * honest third-party note — cannot drift between them.
 *
 * Two deliberate choices:
 *
 *  - **`percent={null}` on the progress bar.** A model call has no
 *    reportable completion ratio. The bar is indeterminate because the
 *    alternative is animating a number we made up.
 *  - **Output is rendered as text.** `TextWorkbench` puts the model's answer in
 *    a `whitespace-pre-wrap` div. There is no `dangerouslySetInnerHTML`
 *    anywhere in this file, so a model that returns `<script>` produces visible
 *    text, not a running script.
 */

import * as React from "react";
import { Info, WandSparkles } from "lucide-react";
import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { Notice } from "@/components/tools/states";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import { systemPromptForTask } from "@/lib/ai/prompt";
import { AI_MAX_PROMPT_CHARS, type AiOptions, type AiTextTask } from "@/lib/ai/schemas";
import type { Tool } from "@/lib/tools/types";
import { AiRequestError, runChat } from "./ai-client";
import { AiControls, defaultControlValues, type AiControl, type AiControlValues } from "./controls";
import { AiCheckingState, AiSetupState, useAiStatus } from "./useAiStatus";

export interface AiTextWorkspaceProps {
  tool: Tool;
  task: AiTextTask;
  placeholder: string;
  sample: string;
  /** The tool's declared controls. */
  options: readonly AiControl[];
  /** Optional extra instructions field shown under the main input. */
  extraInstructions?: { label: string; placeholder: string; hint?: string };
  /** Download format. Markdown only where markdown is the point. */
  extension?: "md" | "txt";
  inputLabel?: string;
  /**
   * Display-only override for the "what the model is told" disclosure. The
   * request itself never carries a system prompt: the route resolves it from
   * `task`, so the text shown here is exactly what was sent.
   */
  systemPrompt?: string;
}

export default function AiTextWorkspace({
  tool,
  task,
  placeholder,
  sample,
  options: controls,
  extraInstructions,
  extension = "txt",
  inputLabel,
  systemPrompt,
}: AiTextWorkspaceProps) {
  const status = useAiStatus();

  const [input, setInput] = React.useState("");
  const [extra, setExtra] = React.useState("");
  const [values, setValues] = React.useState<AiControlValues>(() => defaultControlValues(controls));
  const [output, setOutput] = React.useState("");
  const [model, setModel] = React.useState<string | null>(null);
  const [tokens, setTokens] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const disabled = busy || status.state !== "ready";
  const overLimit = input.length > AI_MAX_PROMPT_CHARS;
  const ready = status.state === "ready";

  const stats = React.useMemo(() => {
    if (!output) return undefined;
    return [
      { label: "Characters", value: formatNumber(output.length) },
      { label: "Words", value: formatNumber(countWords(output)) },
      ...(model ? [{ label: "Model", value: model }] : []),
      ...(tokens !== null ? [{ label: "Tokens used", value: formatNumber(tokens) }] : []),
    ];
  }, [output, model, tokens]);

  const run = async () => {
    if (!ready || busy) return;

    const trimmed = input.trim();
    if (!trimmed) {
      toast.warning("Nothing to work on", "Type or paste something first.");
      return;
    }
    if (overLimit) {
      toast.warning("That input is too long", `The limit is ${formatNumber(AI_MAX_PROMPT_CHARS)} characters.`);
      return;
    }

    setBusy(true);
    setError(null);
    setOutput("");
    setTokens(null);

    try {
      const response = await runChat({
        task,
        prompt: trimmed,
        options: values as AiOptions,
        ...(extra.trim() ? { extraInstructions: extra.trim() } : {}),
      });
      setOutput(response.output);
      setModel(response.model);
      setTokens(response.usage?.totalTokens ?? null);
      toast.processingComplete("Done", `Written by ${response.model}.`);
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

  const benchResult: TextToolResult = React.useMemo(
    () => ({
      text: output,
      ...(error ? { error } : {}),
      ...(stats ? { stats } : {}),
    }),
    [error, output, stats],
  );

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
            <TextWorkbench
              value={input}
              onChange={setInput}
              result={benchResult}
              inputLabel={inputLabel ?? "Your input"}
              outputLabel="Result"
              inputPlaceholder={placeholder}
              outputPlaceholder="The result will appear here."
              sample={sample}
              outputName={`${tool.slug}-ai`}
              extension={extension}
              mime={extension === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8"}
              rows={12}
              controls={
                <div className="flex flex-col gap-4">
                  <AiControls controls={controls} values={values} onChange={setValues} disabled={disabled} />

                  {extraInstructions ? (
                    <Field
                      label={extraInstructions.label}
                      {...(extraInstructions.hint ? { hint: extraInstructions.hint } : {})}
                    >
                      {({ id, describedBy }) => (
                        <Textarea
                          id={id}
                          aria-describedby={describedBy}
                          rows={2}
                          disabled={disabled}
                          maxLength={2_000}
                          placeholder={extraInstructions.placeholder}
                          value={extra}
                          onChange={(event) => setExtra(event.target.value)}
                          className="resize-y"
                        />
                      )}
                    </Field>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => void run()}
                      loading={busy}
                      disabled={disabled || !input.trim() || overLimit}
                    >
                      <WandSparkles className="size-4" aria-hidden="true" />
                      {tool.actionLabel ?? "Generate"}
                    </Button>
                    {output ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setOutput("");
                          setTokens(null);
                          setError(null);
                        }}
                      >
                        Clear result
                      </Button>
                    ) : null}
                    <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {formatNumber(input.length)} / {formatNumber(AI_MAX_PROMPT_CHARS)} characters
                    </span>
                    {overLimit ? (
                      <span role="alert" className="text-xs text-brand-500">
                        Too long by {formatNumber(input.length - AI_MAX_PROMPT_CHARS)} characters.
                      </span>
                    ) : null}
                  </div>

                  {busy ? (
                    <ProgressBar
                      stage="processing"
                      percent={null}
                      caption="Waiting for the model. This can take anywhere from a second to a minute, and we cannot know how far along it is."
                    />
                  ) : null}
                </div>
              }
              actions={
                <div className="flex flex-col gap-3">
                  <Notice
                    tone="info"
                    icon={<Info className="size-4" />}
                    title={model ? `Written by ${model}.` : "Written by a third-party model."}
                  >
                    {model
                      ? "A language model produced this text. It is fluent, confident and sometimes simply wrong, so check anything that matters — names, numbers, citations, and any legal, medical or financial claim."
                      : "A language model will produce this text. It can be wrong, so check anything that matters before you use it."}
                  </Notice>
                  <details className="text-xs text-[var(--text-muted)]">
                    <summary className="cursor-pointer select-none hover:text-[var(--text-ink)]">
                      What the model is told
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[11px] leading-relaxed">
                      {systemPrompt ?? systemPromptForTask(task)}
                    </pre>
                    <p className="mt-2">
                      Your input and the settings above are appended to this. The prompt is resolved on
                      the server from the tool you are on, so it cannot be swapped out from the browser.
                    </p>
                  </details>
                </div>
              }
            />
          </>
        )}
      </div>
    </ToolShell>
  );
}

/** Word count, matching how the output panel labels its stats. */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
