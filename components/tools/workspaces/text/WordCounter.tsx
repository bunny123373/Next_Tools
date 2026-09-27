"use client";

import * as React from "react";
import { Hash } from "lucide-react";
import { Checkbox } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { CopyButton } from "@/components/tools/DownloadButton";
import {
  TextWorkbench,
  countCharacters,
  countParagraphs,
  countWords,
  readingStats,
  splitSentences,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { paragraphBreakdown, wordFrequency } from "@/lib/tools/engines/text";
import { formatNumber } from "@/lib/utils/format";

const SAMPLE = `Balu Tools is a toolbox that runs in your browser.

Every tool here is a pure string transform. Nothing is uploaded, nothing is stored, and every number you see is recomputed from the text in front of you on the same keystroke that produced it.

That sounds like a small thing, but it changes how the tools feel. A counter that waits for a round trip is a counter you stop trusting.`;

const TOP_WORDS = 25;
const MAX_BARS = 40;

export default function WordCounter() {
  const [value, setValue] = React.useState("");
  const [ignoreStopWords, setIgnoreStopWords] = React.useState(true);

  const stats = React.useMemo(() => {
    const reading = readingStats(value);
    return {
      ...reading,
      charactersNoSpaces: countCharacters(value, false),
      // `readingStats` uses the shared counter, which stops at the last full
      // sentence; splitting directly also counts a trailing fragment.
      sentences: splitSentences(value).length,
      paragraphs: countParagraphs(value),
      words: countWords(value),
    };
  }, [value]);

  const paragraphs = React.useMemo(() => paragraphBreakdown(value), [value]);
  const frequency = React.useMemo(
    () => wordFrequency(value, { limit: TOP_WORDS, ignoreStopWords, minCount: 1 }),
    [value, ignoreStopWords],
  );

  const report = React.useMemo(() => {
    if (frequency.length === 0) return "";
    const widest = Math.max(...frequency.map((entry) => entry.word.length));
    return frequency
      .map((entry) => {
        const share = `${(entry.share * 100).toFixed(1)}%`;
        return `${entry.word.padEnd(widest, " ")}  ${String(entry.count).padStart(4, " ")}  ${share.padStart(6, " ")}`;
      })
      .join("\n");
  }, [frequency]);

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value.trim()
        ? {
            text: report,
            stats: [
              { label: "Words", value: formatNumber(stats.words), tone: "brand" },
              { label: "Characters", value: formatNumber(stats.characters) },
              { label: "No spaces", value: formatNumber(stats.charactersNoSpaces) },
              { label: "Sentences", value: formatNumber(stats.sentences) },
              { label: "Paragraphs", value: formatNumber(stats.paragraphs) },
              { label: "Reading", value: stats.readingTimeLabel },
              { label: "Speaking", value: stats.speakingTimeLabel },
            ],
          }
        : null,
    [value, report, stats],
  );

  const maxWords = Math.max(1, ...paragraphs.map((item) => item.words));
  const bars = paragraphs.slice(0, MAX_BARS);

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="word-frequency-report"
        extension="txt"
        inputLabel="Your text"
        outputLabel="Most used words"
        inputPlaceholder="Type or paste an essay, article or chapter…"
        outputPlaceholder="Type something on the left to see which words you lean on."
        hideDownload
        sample={SAMPLE}
        rows={16}
        controls={
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
            <Checkbox
              label="Skip common words"
              description="Hides words like “the”, “and” and “of” so the report shows content words."
              checked={ignoreStopWords}
              onChange={(event) => setIgnoreStopWords(event.target.checked)}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Reading time assumes 200 words per minute, speaking time 130.
            </p>
          </div>
        }
        actions={
          paragraphs.length > 0 ? (
            <section aria-label="Words per paragraph" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
                  <Hash aria-hidden="true" className="size-3.5 text-[var(--text-muted)]" />
                  Words per paragraph
                </h3>
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  longest {formatNumber(Math.max(...paragraphs.map((item) => item.words)))} words
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {bars.map((item, index) => (
                  <li key={index} className="flex items-center gap-3">
                    <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {index + 1}
                    </span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-card-2)] ring-1 ring-inset ring-[var(--surface-line)]">
                      <span
                        className="block h-full rounded-full bg-brand-500/80"
                        style={{ width: `${Math.max(2, (item.words / maxWords) * 100)}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--text-ink)]">
                      {formatNumber(item.words)} words
                    </span>
                  </li>
                ))}
              </ul>
              {paragraphs.length > MAX_BARS ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Showing the first {MAX_BARS} of {formatNumber(paragraphs.length)} paragraphs.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton
                  value={report || null}
                  label="Copy report"
                  what="Word report copied"
                />
                <span className="text-xs text-[var(--text-muted)]">
                  Paragraphs are split on a blank line, and soft line breaks inside a
                  paragraph do not start a new one.
                </span>
              </div>
            </section>
          ) : null
        }
      />
    </ToolShell>
  );
}
