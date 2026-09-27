"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Textarea } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { generateLorem, type LoremCorpus, type LoremFormat, type LoremMode } from "@/lib/tools/engines/text";
import { formatNumber } from "@/lib/utils/format";

const CORPUS_OPTIONS: readonly { value: LoremCorpus; label: string; title: string }[] = [
  { value: "lorem", label: "Lorem ipsum", title: "The classic public-domain Cicero passage" },
  { value: "bacon", label: "Bacon ipsum", title: "Original mock-elegiac prose about bacon" },
  { value: "custom", label: "My word list", title: "Sentences built from words you supply" },
];

export default function LoremIpsumGenerator() {
  const [corpus, setCorpus] = React.useState<LoremCorpus>("lorem");
  const [mode, setMode] = React.useState<LoremMode>("per-paragraph");
  const [paragraphs, setParagraphs] = React.useState("3");
  const [wordsPerParagraph, setWordsPerParagraph] = React.useState("60");
  const [totalWords, setTotalWords] = React.useState("300");
  const [startWithLorem, setStartWithLorem] = React.useState(true);
  const [noRepeat, setNoRepeat] = React.useState(true);
  const [format, setFormat] = React.useState<LoremFormat>("text");
  const [customWords, setCustomWords] = React.useState("");
  /** Bumped by the Generate button to force a fresh draw. */
  const [draw, setDraw] = React.useState(0);

  const paragraphCount = clampNumber(paragraphs, 1, 50, 3);
  const perParagraph = clampNumber(wordsPerParagraph, 1, 500, 60);
  const total = clampNumber(totalWords, 1, 20_000, 300);
  const wordList = React.useMemo(() => customWords.split("\n"), [customWords]);

  const generated = React.useMemo(
    () =>
      generateLorem({
        corpus,
        mode,
        paragraphs: paragraphCount,
        wordsPerParagraph: perParagraph,
        totalWords: total,
        startWithLorem,
        noRepeat,
        format,
        customWords: wordList,
      }),
    // `draw` is a deliberate dependency: pressing Generate changes nothing else
    // but the seed, which is exactly what should produce new text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [corpus, mode, paragraphCount, perParagraph, total, startWithLorem, noRepeat, format, wordList, draw],
  );

  const result = React.useMemo<TextToolResult | null>(
    () =>
      generated.text
        ? {
            text: generated.text,
            stats: [
              { label: "Words", value: formatNumber(generated.words), tone: "brand" },
              { label: "Paragraphs", value: formatNumber(generated.paragraphs) },
              { label: "Sentences", value: formatNumber(generated.sentences) },
              { label: "Characters", value: formatNumber(generated.text.length) },
            ],
          }
        : null,
    [generated],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value=""
        onChange={() => undefined}
        result={result}
        outputName="lorem-ipsum"
        extension={format === "html" ? "html" : "txt"}
        mime={format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8"}
        outputLabel={format === "html" ? "HTML paragraphs" : "Plain text"}
        outputPlaceholder="Press Generate to write placeholder copy."
        hideInput
        header={
          <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
            Generator — no input needed
          </span>
        }
        controls={
          <div className="flex flex-col gap-3.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
            <div className="grid gap-3 lg:grid-cols-2">
              {/* Segmented controls carry their own accessible name, so the
                  Field's generated ids are not wired to them here. */}
              <Field label="Corpus">
                {() => (
                  <Segmented
                    label="Corpus"
                    size="sm"
                    value={corpus}
                    onChange={setCorpus}
                    options={CORPUS_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                      title: option.title,
                    }))}
                  />
                )}
              </Field>
              <Field label="Output format">
                {() => (
                  <Segmented
                    label="Output format"
                    size="sm"
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: "text", label: "Plain text" },
                      { value: "html", label: "<p> HTML" },
                    ]}
                  />
                )}
              </Field>
            </div>

            <Field label="Length">
              {() => (
                <Segmented
                  label="Length basis"
                  size="sm"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "per-paragraph", label: "Words per paragraph" },
                    { value: "total", label: "Exact total words" },
                  ]}
                />
              )}
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paragraphs" hint="1 to 50. Used when length is set per paragraph.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min={1}
                    max={50}
                    value={paragraphs}
                    onChange={(event) => setParagraphs(event.target.value)}
                    disabled={mode === "total"}
                    className="font-mono"
                  />
                )}
              </Field>
              {mode === "per-paragraph" ? (
                <Field label="Words per paragraph" hint="1 to 500. A paragraph can overshoot by one sentence.">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      type="number"
                      min={1}
                      max={500}
                      value={wordsPerParagraph}
                      onChange={(event) => setWordsPerParagraph(event.target.value)}
                      className="font-mono"
                    />
                  )}
                </Field>
              ) : (
                <Field
                  label="Total words"
                  hint="1 to 20,000. The last sentence is cut to land exactly on this number."
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      type="number"
                      min={1}
                      max={20_000}
                      value={totalWords}
                      onChange={(event) => setTotalWords(event.target.value)}
                      className="font-mono"
                    />
                  )}
                </Field>
              )}
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <Checkbox
                label="Start with “Lorem ipsum dolor sit amet”"
                description="Always opens the first paragraph"
                checked={startWithLorem}
                onChange={(event) => setStartWithLorem(event.target.checked)}
              />
              <Checkbox
                label="No repeats"
                description="Drain the whole corpus before any sentence is reused"
                checked={noRepeat}
                onChange={(event) => setNoRepeat(event.target.checked)}
              />
            </div>

            {corpus === "custom" ? (
              <Field
                label="Your words"
                hint="One or more words per line, separated by spaces or commas. Sentences are built from them."
                error={wordList.length === 0 ? "Add at least one word." : null}
              >
                {({ id, describedBy, invalid }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    value={customWords}
                    onChange={(event) => setCustomWords(event.target.value)}
                    rows={4}
                    placeholder="brisket, gravy, crust, skillet, tavern"
                    className="font-mono text-[13px]"
                  />
                )}
              </Field>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => setDraw((value) => value + 1)}>
                <RefreshCw aria-hidden="true" className="size-3.5" />
                Generate
              </Button>
              <p className="text-xs text-[var(--text-muted)]">
                The controls also regenerate as you change them. Shuffling uses your browser&apos;s
                random source, so two draws are never the same.
              </p>
            </div>
          </div>
        }
        actions={
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            The lorem corpus is the standard public-domain passage derived from Cicero. The bacon
            corpus is original mock-elegiac prose written for this tool — it is not a quotation from
            any playwright.
          </p>
        }
      />
    </ToolShell>
  );
}

function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
