"use client";

import * as React from "react";
import { Flag } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { splitSentences } from "@/lib/tools/engines/text";
import { formatNumber } from "@/lib/utils/format";

/** Beyond this a sentence usually needs splitting for comfort. */
const LONG_SENTENCE_WORDS = 25;

const SAMPLE = `Good writing is rewriting. The first draft exists so the second one has something to improve on, which is why every serious writer treats a blank page as a starting point rather than a verdict.

That habit shows up in small ways. A long sentence carrying three separate ideas will lose one of them, usually the last. A short one carrying a single idea will survive any edit.`;

export default function SentenceCounter() {
  const [value, setValue] = React.useState("");

  const analysis = React.useMemo(() => {
    const sentences = splitSentences(value);
    const total = sentences.length;
    const words = sentences.reduce((sum, sentence) => sum + sentence.words, 0);
    const average = total > 0 ? words / total : 0;
    let longest = sentences[0];
    let shortest = sentences[0];
    for (const sentence of sentences) {
      if (!longest || sentence.words > longest.words) longest = sentence;
      if (!shortest || sentence.words < shortest.words) shortest = sentence;
    }
    const longSentences = sentences.filter((sentence) => sentence.long);
    return { sentences, total, average, longest, shortest, longSentences };
  }, [value]);

  const listing = React.useMemo(() => {
    const width = String(analysis.total).length;
    return analysis.sentences
      .map((sentence) => {
        const flag = sentence.long ? `  ← ${sentence.words} words` : "";
        return `${String(sentence.index).padStart(width, " ")}. ${sentence.text}${flag}`;
      })
      .join("\n");
  }, [analysis]);

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value.trim()
        ? {
            text: listing,
            stats: [
              { label: "Sentences", value: formatNumber(analysis.total), tone: "brand" },
              { label: "Avg words", value: analysis.average.toFixed(1) },
              { label: "Longest", value: `${formatNumber(analysis.longest?.words ?? 0)} w` },
              { label: "Shortest", value: `${formatNumber(analysis.shortest?.words ?? 0)} w` },
              { label: "Total words", value: formatNumber(
                analysis.sentences.reduce((sum, sentence) => sum + sentence.words, 0),
              ) },
              {
                label: `Over ${LONG_SENTENCE_WORDS} w`,
                value: formatNumber(analysis.longSentences.length),
                tone: analysis.longSentences.length > 0 ? "brand" : "success",
              },
            ],
          }
        : null,
    [value, listing, analysis],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="sentences"
        extension="txt"
        inputLabel="Your text"
        outputLabel="Sentences"
        inputPlaceholder="Paste a paragraph or a whole page…"
        outputPlaceholder="Every sentence will be numbered here, with long ones flagged."
        sample={SAMPLE}
        rows={16}
        actions={
          analysis.longSentences.length > 0 ? (
            <Notice tone="info" icon={<Flag aria-hidden="true" className="size-4" />}>
              <span className="font-medium">
                {formatNumber(analysis.longSentences.length)} sentence
                {analysis.longSentences.length === 1 ? "" : "s"} run
                {analysis.longSentences.length === 1 ? "s" : ""} over {LONG_SENTENCE_WORDS} words
                {analysis.longSentences.length === 1 ? "" : "s"}:
              </span>{" "}
              {analysis.longSentences.map((sentence) => `#${sentence.index}`).join(", ")}. That is a
              guideline, not a rule — a long sentence is fine when the rhythm is deliberate.
            </Notice>
          ) : analysis.total > 0 ? (
            <Notice tone="success" icon={<Flag aria-hidden="true" className="size-4" />}>
              Every sentence is {LONG_SENTENCE_WORDS} words or fewer, with an average of{" "}
              {analysis.average.toFixed(1)}.
            </Notice>
          ) : null
        }
      />
    </ToolShell>
  );
}
