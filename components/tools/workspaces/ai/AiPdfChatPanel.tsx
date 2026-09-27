"use client";

/**
 * The shared PDF-chat workspace.
 *
 * The flow, and why it is this shape:
 *
 *  1. Drop in a PDF. Its text layer is extracted **in the browser** with pdf.js,
 *     so the file itself never leaves the device.
 *  2. The workspace shows the exact character count it will send, and warns
 *     before the first question when the document is bigger than the limit.
 *  3. Each question sends the text plus the previous turns. Truncation is never
 *     silent: the panel says how many characters went out, how many the document
 *     held, and that the rest was cut.
 *
 * If in-browser extraction fails, the page says why and offers to send the file
 * to the server instead. That is an explicit, labelled choice — the tool never
 * quietly uploads a document you assumed it had read locally.
 */

import * as React from "react";
import { FileQuestion, Info, MessageSquareText, Send, TriangleAlert } from "lucide-react";
import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { FileDropzone } from "@/components/tools/FileDropzone";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState, ToolError } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { SITE } from "@/lib/site";
import { toast } from "@/lib/utils/toast";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import { baseName, sanitizeFilename } from "@/lib/utils/files";
import {
  AI_MAX_PDF_BYTES,
  AI_MAX_QUESTION_CHARS,
  AI_PDF_CONTEXT_CHARS,
  AI_PDF_HISTORY_TURNS,
  type PdfContext,
} from "@/lib/ai/schemas";
import type { Tool } from "@/lib/tools/types";
import { AiRequestError, runPdf } from "./ai-client";
import { AiCheckingState, AiSetupState, useAiStatus } from "./useAiStatus";
import { PdfExtractError, extractPdfTextInBrowser } from "./pdf-text";

/** The tighter of the site-wide PDF ceiling and what the route accepts. */
const MAX_PDF_BYTES = Math.min(SITE.limits.pdf, AI_MAX_PDF_BYTES);

interface Turn {
  question: string;
  answer: string;
  model: string;
}

export default function AiPdfChatPanel({ tool }: { tool: Tool }) {
  const status = useAiStatus();

  const [file, setFile] = React.useState<File | null>(null);
  const [documentText, setDocumentText] = React.useState<string | null>(null);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [extracting, setExtracting] = React.useState(false);
  const [extractError, setExtractError] = React.useState<string | null>(null);
  const [serverMode, setServerMode] = React.useState(false);

  const [question, setQuestion] = React.useState("");
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [context, setContext] = React.useState<PdfContext | null>(null);
  const [model, setModel] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const ready = status.state === "ready";
  const disabled = busy || !ready || extracting;

  // Local extraction is the default. This flag is set only when the browser
  // could not read the document and the visitor explicitly chose the server.
  const useServerExtraction = serverMode;

  React.useEffect(() => {
    if (!file || useServerExtraction) return;
    let active = true;

    setExtracting(true);
    setExtractError(null);
    setDocumentText(null);
    setPageCount(null);
    setContext(null);

    void extractPdfTextInBrowser(file)
      .then((result) => {
        if (!active) return;
        setDocumentText(result.text);
        setPageCount(result.pageCount);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setExtractError(
          caught instanceof PdfExtractError
            ? caught.message
            : "That PDF could not be read in the browser.",
        );
      })
      .finally(() => {
        if (active) setExtracting(false);
      });

    return () => {
      active = false;
    };
  }, [file, useServerExtraction]);

  const documentReady = useServerExtraction ? file !== null : documentText !== null;
  const totalCharacters = documentText?.length ?? 0;
  const tooLarge = !useServerExtraction && totalCharacters > AI_PDF_CONTEXT_CHARS;
  const history = turns.slice(-AI_PDF_HISTORY_TURNS).flatMap((turn) => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.answer },
  ]);

  const ask = async () => {
    const trimmed = question.trim();
    if (!ready || busy || !documentReady || !trimmed) return;

    setBusy(true);
    setError(null);

    try {
      const response = await runPdf({
        ...(file ? { fileName: file.name } : {}),
        ...(useServerExtraction && file ? { file } : {}),
        ...(documentText ? { text: documentText } : {}),
        question: trimmed,
        history,
      });
      setTurns((current) => [
        ...current,
        { question: trimmed, answer: response.output, model: response.model },
      ]);
      setContext(response.context);
      setModel(response.model);
      setQuestion("");
      toast.processingComplete("Answered", `Written by ${response.model}.`);
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

  const transcript = turns
    .map(
      (turn) =>
        `## ${turn.question}\n\n${turn.answer}\n\n<!-- answered by ${turn.model} -->`,
    )
    .join("\n\n");

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
            <FileDropzone
              category="pdf"
              maxBytes={MAX_PDF_BYTES}
              files={file ? [file] : []}
              onAdd={(files) => {
                setFile(files[0] ?? null);
                setTurns([]);
                setContext(null);
                setError(null);
                setExtractError(null);
                setServerMode(false);
              }}
              {...(file
                ? {
                    onRemove: () => {
                      setFile(null);
                      setDocumentText(null);
                      setPageCount(null);
                      setContext(null);
                      setTurns([]);
                    },
                    onClear: () => {
                      setFile(null);
                      setDocumentText(null);
                      setPageCount(null);
                      setContext(null);
                      setTurns([]);
                    },
                    renderMeta: () =>
                      pageCount !== null
                        ? `${formatNumber(pageCount)} pages · ${formatNumber(totalCharacters)} characters extracted`
                        : extracting
                          ? "Reading the text layer…"
                          : serverMode
                            ? `${formatBytes(file?.size ?? 0)} · will be read on the server`
                            : null,
                  }
                : {})}
              label="Drop a PDF here"
              hint={`Text-based PDF, up to ${formatBytes(MAX_PDF_BYTES)}. The text is read in your browser, so the file itself is not uploaded.`}
              disabled={busy}
            />

            {extracting ? (
              <ProgressBar
                stage="processing"
                percent={null}
                caption="Reading the document's text layer in your browser."
              />
            ) : null}

            {extractError ? (
              <ToolError
                title="The text could not be read in your browser."
                detail={extractError}
              >
                {!serverMode ? (
                  <div className="flex flex-col items-center gap-2">
                    <p className="max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
                      You can send the PDF to our server instead, which extracts the text there. The
                      file is processed for this request and not stored.
                    </p>
                    <Button variant="secondary" onClick={() => setServerMode(true)}>
                      Send the file to the server instead
                    </Button>
                  </div>
                ) : null}
              </ToolError>
            ) : null}

            {useServerExtraction && file ? (
              <Notice
                tone="warning"
                icon={<TriangleAlert className="size-4" />}
                title="This PDF will be uploaded."
              >
                Server-side extraction is on, so the file itself is sent to our server and read there
                for this request only. The extracted text is what reaches the AI provider either way.
                {" "}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 align-baseline"
                  onClick={() => setServerMode(false)}
                >
                  Go back to reading it here
                </Button>
              </Notice>
            ) : null}

            {documentReady && !useServerExtraction ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <Readout
                  label="Context to send"
                  value={`${formatNumber(Math.min(totalCharacters, AI_PDF_CONTEXT_CHARS))} chars`}
                />
                <Readout
                  label="Document size"
                  value={`${formatNumber(totalCharacters)} chars`}
                  tone={tooLarge ? "warning" : "default"}
                />
                <Readout label="Pages read" value={pageCount === null ? "—" : formatNumber(pageCount)} />
              </div>
            ) : null}

            {tooLarge ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="This document is long.">
                Only the first {formatNumber(AI_PDF_CONTEXT_CHARS)} characters will be sent, which is
                about {formatNumber(AI_PDF_CONTEXT_CHARS)} characters of the{" "}
                {formatNumber(totalCharacters)} available. Answers about the rest of the document may
                be wrong, and the model is told to say so. This is a deliberate limit, not a failure.
              </Notice>
            ) : null}

            {documentReady ? (
              <div className="flex flex-col gap-4">
                <Field
                  label="Ask a question"
                  hint="Answered from this document's text only. Ask about a specific section when you can."
                >
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={3}
                      disabled={disabled}
                      maxLength={AI_MAX_QUESTION_CHARS}
                      placeholder="What are the termination conditions in clause 7?"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          void ask();
                        }
                      }}
                      className="resize-y"
                    />
                  )}
                </Field>

                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => void ask()}
                    loading={busy}
                    disabled={disabled || !question.trim()}
                  >
                    <Send className="size-4" aria-hidden="true" />
                    {tool.actionLabel ?? "Ask question"}
                  </Button>
                  {turns.length > 0 ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setTurns([]);
                        setContext(null);
                        setError(null);
                      }}
                    >
                      Clear conversation
                    </Button>
                  ) : null}
                  <span className="text-xs text-[var(--text-muted)]">
                    ⌘/Ctrl + Enter to ask
                  </span>
                </div>

                {busy ? (
                  <ProgressBar
                    stage="processing"
                    percent={null}
                    caption="Reading the document and answering. This can take a while, and we cannot know how far along it is."
                  />
                ) : null}
              </div>
            ) : null}

            {error ? <ToolError title="That question could not be answered." detail={error} /> : null}

            {turns.length > 0 ? (
              <section className="flex flex-col gap-3" aria-label="Conversation">
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton
                    value={transcript}
                    label="Copy conversation"
                    what="Conversation copied to clipboard"
                  />
                  <DownloadButton
                    size="sm"
                    variant="secondary"
                    text={transcript}
                    filename={`${sanitizeFilename(baseName(file?.name ?? "document"))}-chat.md`}
                    mime="text/markdown;charset=utf-8"
                    label="Download conversation"
                  />
                </div>

                <ol className="flex flex-col gap-3">
                  {turns.map((turn, index) => (
                    <li
                      key={`${turn.question}-${index}`}
                      className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5"
                    >
                      <p className="flex items-start gap-2 text-[13px] font-medium text-[var(--text-ink)]">
                        <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                        {turn.question}
                      </p>
                      <div
                        role="region"
                        aria-label="Answer"
                        className="mt-2.5 whitespace-pre-wrap break-words pl-6 text-[13px] leading-relaxed text-[var(--text-ink)]"
                      >
                        {turn.answer}
                      </div>
                      <p className="mt-2.5 pl-6 font-mono text-[11px] text-[var(--text-muted)]">
                        answered by {turn.model}
                      </p>
                    </li>
                  ))}
                </ol>

                {context ? (
                  <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Readout label="Characters sent" value={formatNumber(context.characters)} />
                    <Readout
                      label="Document had"
                      value={formatNumber(context.totalCharacters)}
                      tone={context.truncated ? "warning" : "default"}
                    />
                    <Readout
                      label="Truncated"
                      value={context.truncated ? "Yes — visibly" : "No"}
                      tone={context.truncated ? "warning" : "success"}
                    />
                    <Readout
                      label="Text read by"
                      value={context.source === "server-extracted" ? "our server" : "your browser"}
                    />
                  </dl>
                ) : null}
              </section>
            ) : null}

            {!documentReady && !extracting && !extractError ? (
              <div className="rounded-[10px] border border-[var(--surface-line)]">
                <ToolEmptyState
                  title="Drop a PDF to get started."
                  icon={<FileQuestion className="size-5" />}
                  description="It needs a text layer, so a scan of a page will not work. If the document has no extractable text the page will tell you rather than answering from nothing."
                />
              </div>
            ) : null}

            <Notice
              tone="info"
              icon={<Info className="size-4" />}
              title={model ? `Answers come from ${model}.` : "Answers come from a third-party model."}
            >
              The model reads the extracted text, not the page images, so it cannot see diagrams,
              tables that were flattened oddly, or anything that only exists as pixels. It is
              instructed to say when the answer is not in the document — but it is still a model, and
              it can still be wrong.
            </Notice>
          </>
        )}
      </div>
    </ToolShell>
  );
}

function Readout({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-[15px] font-semibold tabular-nums ${
          tone === "success"
            ? "text-emerald-500"
            : tone === "warning"
              ? "text-amber-500"
              : "text-[var(--text-ink)]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
