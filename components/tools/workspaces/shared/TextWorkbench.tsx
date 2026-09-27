"use client";

import * as React from "react";
import { ClipboardPaste, Eraser, FlaskConical, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { CopyButton } from "@/components/tools/DownloadButton";
import { ToolEmptyState } from "@/components/tools/states";

/* ------------------------------------------------------------------ */
/*  Result shape                                                       */
/* ------------------------------------------------------------------ */

export interface TextToolResult {
  /** Transformed output. Empty string means "nothing to show yet". */
  text: string;
  /** A user-facing problem. Shown inline; never a stack trace. */
  error?: string;
  /** Optional readouts rendered as a stat strip. */
  stats?: { label: string; value: string; tone?: "default" | "brand" | "success" }[];
  /** Optional tabs when the tool has several useful outputs at once. */
  tabs?: { label: string; text: string }[];
}

export interface TextWorkbenchProps {
  value: string;
  onChange: (value: string) => void;
  result: TextToolResult | null;
  /** Filename stem for the download, e.g. "formatted-json". */
  outputName?: string;
  /** Output extension, e.g. "json". */
  extension?: string;
  mime?: string;
  inputLabel?: string;
  outputLabel?: string;
  inputPlaceholder?: string;
  outputPlaceholder?: string;
  /** Controls strip rendered between the toolbar and the panes. */
  controls?: React.ReactNode;
  /** Extra controls rendered in the input toolbar. */
  header?: React.ReactNode;
  /** Buttons under the panes (e.g. "Copy as JSON"). */
  actions?: React.ReactNode;
  /** Hide the input pane — for generators with no input. */
  hideInput?: boolean;
  /** Hide the download button — for inspection-only tools. */
  hideDownload?: boolean;
  /** Seed value for the "Sample" button. */
  sample?: string;
  className?: string;
  /** Monospace both panes. */
  mono?: boolean;
  /** Live character count in the input toolbar. Defaults to true when input is shown. */
  showCounts?: boolean;
  /** Keep the output pane scrolled to the top when it changes. */
  rows?: number;
}

/**
 * The shared text-in / text-out workbench. Handles pane state, copy, download,
 * paste-from-clipboard, sample data, and the empty state. Tools only compute
 * `result`.
 */
export function TextWorkbench({
  value,
  onChange,
  result,
  outputName = "result",
  extension = "txt",
  mime = "text/plain;charset=utf-8",
  inputLabel = "Input",
  outputLabel = "Output",
  inputPlaceholder = "Type or paste your text here…",
  outputPlaceholder = "Your result will appear here.",
  controls,
  header,
  actions,
  hideInput = false,
  hideDownload = false,
  sample,
  className,
  mono = true,
  showCounts = true,
  rows = 14,
}: TextWorkbenchProps) {
  const outputText = result?.tabs?.length ? result.text : (result?.text ?? "");
  const [copied, setCopied] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);

  // Reset the "copied" affordance whenever the result changes.
  React.useEffect(() => {
    setCopied(false);
    if (outputRef.current) outputRef.current.scrollTop = 0;
  }, [outputText]);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.warning("Clipboard is empty");
        return;
      }
      onChange(text);
      toast.copied("Pasted from clipboard");
    } catch {
      toast.error("Couldn't read the clipboard", "Your browser blocked clipboard access.");
    }
  };

  const loadSample = () => {
    if (sample === undefined) return;
    onChange(sample);
    toast.info("Sample loaded");
  };

  const hasOutput = Boolean(outputText);
  const fontClass = mono ? "font-mono text-[13px] leading-relaxed" : "text-sm leading-relaxed";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {header}
          {showCounts && !hideInput && value ? (
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {formatNumber(value.length)} chars
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {sample !== undefined ? (
            <Button size="sm" variant="ghost" onClick={loadSample}>
              <FlaskConical className="size-3.5" aria-hidden="true" />
              Sample
            </Button>
          ) : null}
          {!hideInput ? (
            <Button size="sm" variant="ghost" onClick={pasteFromClipboard}>
              <ClipboardPaste className="size-3.5" aria-hidden="true" />
              Paste
            </Button>
          ) : null}
          {!hideInput ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange("");
                textareaRef.current?.focus();
              }}
              disabled={!value}
            >
              <Eraser className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {controls}

      {/* Stat strip */}
      {result?.stats && result.stats.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {result.stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2"
            >
              <dt className="truncate text-[10px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                {stat.label}
              </dt>
              <dd
                className={cn(
                  "mt-0.5 font-mono text-sm font-semibold tabular-nums",
                  stat.tone === "brand" && "text-brand-500",
                  stat.tone === "success" && "text-emerald-500",
                  stat.tone === "default" && "text-[var(--text-ink)]",
                )}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Panes */}
      <div
        className={cn(
          "grid gap-3",
          !hideInput && "lg:grid-cols-2",
        )}
      >
        {!hideInput ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="text-workbench-input"
              className="text-[13px] font-medium text-[var(--text-ink)]"
            >
              {inputLabel}
            </label>
            <Textarea
              id="text-workbench-input"
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={inputPlaceholder}
              rows={rows}
              className={cn("min-h-[16rem] flex-1 resize-y", fontClass)}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-[var(--text-ink)]">{outputLabel}</span>
            <div className="flex items-center gap-1.5">
              <CopyButton
                value={hasOutput ? outputText : null}
                size="sm"
                variant="ghost"
                what="Result copied to clipboard"
              />
              {!hideDownload ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!hasOutput}
                  onClick={() => {
                    void import("@/lib/utils/files").then(({ downloadText }) => {
                      downloadText(outputText, `${outputName}.${extension}`, mime);
                      toast.downloadReady(`${outputName}.${extension}`);
                    });
                  }}
                >
                  Download
                </Button>
              ) : null}
            </div>
          </div>

          {result?.error ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-3.5 py-3"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-brand-500"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-ink)]">
                  We couldn't process this input.
                </p>
                <p className="mt-0.5 break-words text-xs leading-relaxed text-[var(--text-muted)]">
                  {result.error}
                </p>
              </div>
            </div>
          ) : hasOutput ? (
            <div
              ref={outputRef}
              role="region"
              aria-label={outputLabel}
              aria-live="polite"
              className={cn(
                "min-h-[16rem] max-h-[32rem] overflow-auto whitespace-pre-wrap break-words",
                "rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3",
                "text-[var(--text-ink)]",
                fontClass,
              )}
            >
              {outputText}
            </div>
          ) : (
            <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
              <ToolEmptyState
                title={hideInput ? "Click generate to get started." : "Your result will appear here."}
                description={
                  hideInput
                    ? undefined
                    : "Type or paste something on the left and the result updates instantly."
                }
                className="py-12"
              />
            </div>
          )}

          {result?.tabs && result.tabs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {result.tabs.map((tab) => (
                <Button
                  key={tab.label}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void import("@/lib/utils/files").then(({ downloadText }) => {
                      downloadText(tab.text, `${outputName}-${tab.label.toLowerCase().replace(/\s+/g, "-")}.${extension}`, mime);
                      toast.downloadReady(tab.label);
                    });
                  }}
                >
                  Download {tab.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {actions}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers shared by text tools                                       */
/* ------------------------------------------------------------------ */

/** Word count that handles most punctuation conventions consistently. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function countSentences(text: string): number {
  return splitSentences(text).length;
}

/**
 * Splits text into sentences.
 *
 * Handles abbreviations ("Dr.", "e.g.", "U.S.A."), decimal numbers ("3.14"),
 * ellipses and terminal punctuation. This is a heuristic, not a NLP model —
 * it is right often enough to be useful for a counter, and the tool page says
 * so rather than claiming perfect accuracy.
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const ABBREVIATIONS = new Set([
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
    "fig", "no", "vol", "pp", "approx", "dept", "est", "min", "max", "inc", "ltd",
    "co", "corp", "a.m", "p.m", "u.s", "u.k",
  ]);

  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") continue;

    // Consume a run of terminators plus any closing quotes/brackets.
    let end = i;
    while (
      end + 1 < trimmed.length &&
      /[.!?…]/.test(trimmed[end + 1] ?? "")
    ) {
      end += 1;
    }
    while (end + 1 < trimmed.length && /["')\]]/.test(trimmed[end + 1] ?? "")) {
      end += 1;
    }

    // A terminator inside a number is not a sentence end.
    if (ch === "." && /\d/.test(trimmed[i - 1] ?? "") && /\d/.test(trimmed[end + 1] ?? "")) {
      continue;
    }

    // Look back at the token before the period for a known abbreviation.
    if (ch === ".") {
      const before = trimmed.slice(Math.max(0, i - 12), i);
      const token = (before.match(/([A-Za-z.]+)$/)?.[1] ?? "").toLowerCase().replace(/\./g, "");
      if (token && ABBREVIATIONS.has(token)) continue;
      // Single initial, e.g. "J. R. R. Tolkien".
      if (/^[A-Za-z]$/.test(token)) continue;
    }

    // Require whitespace or end-of-text after the terminator.
    const next = trimmed[end + 1];
    if (next !== undefined && !/\s/.test(next)) continue;

    const sentence = trimmed.slice(start, end + 1).trim();
    if (sentence) out.push(sentence);
    start = end + 1;
  }

  const tail = trimmed.slice(start).trim();
  if (tail) out.push(tail);

  return out;
}

export function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
}

export function countCharacters(text: string, includeSpaces: boolean): number {
  return includeSpaces ? [...text].length : [...text.replace(/\s/g, "")].length;
}

export function readingStats(text: string) {
  const words = countWords(text);
  const characters = [...text].length;
  const charactersNoSpaces = countCharacters(text, false);
  const sentences = countSentences(text);
  const paragraphs = countParagraphs(text);
  const lines = text ? text.split("\n").length : 0;
  // 200 wpm is the commonly cited adult silent-reading average.
  const readingMinutes = words / 200;
  return {
    words,
    characters,
    charactersNoSpaces,
    sentences,
    paragraphs,
    lines,
    readingMinutes,
    readingTimeLabel: readingLabel(readingMinutes),
    speakingTimeLabel: speakingLabel(words / 130),
  };
}

export function readingLabel(minutes: number): string {
  if (minutes <= 0) return "0 min";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function speakingLabel(minutes: number): string {
  if (minutes <= 0) return "0 min";
  if (minutes < 1) return "< 1 min";
  return `${Math.round(minutes)} min`;
}
