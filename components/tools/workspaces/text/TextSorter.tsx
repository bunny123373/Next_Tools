"use client";

import * as React from "react";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Select } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { sortText, type SortMode, type SortScope } from "@/lib/tools/engines/text";
import { formatNumber } from "@/lib/utils/format";

const MODES: readonly { value: SortMode; label: string; hint: string }[] = [
  { value: "asc", label: "Ascending (A → Z)", hint: "Character by character, so 10 comes before 9." },
  { value: "desc", label: "Descending (Z → A)", hint: "The reverse of ascending." },
  { value: "natural", label: "Natural / human", hint: "Digit runs count as numbers: 2, 9, 10." },
  { value: "numeric", label: "Numeric", hint: "Compares the numbers it finds, ignoring the rest." },
  { value: "length", label: "By length", hint: "Shortest line first." },
  { value: "reverse", label: "Reverse the order", hint: "No comparison at all — back to front." },
  { value: "shuffle", label: "Shuffle", hint: "A random permutation from the browser's own generator." },
  { value: "dedupe-sort", label: "Dedupe and sort", hint: "Removes repeats, then sorts naturally." },
];

const SCOPES: readonly { value: SortScope; label: string }[] = [
  { value: "lines", label: "Whole lines" },
  { value: "commas", label: "Comma-separated values" },
  { value: "words", label: "Whitespace-separated words" },
  { value: "csv", label: "CSV column" },
];

const SAMPLE = `file10-report.txt
banana
File2-notes.txt
apple
file9-archive.zip
cherry`;

export default function TextSorter() {
  const [value, setValue] = React.useState("");
  const [mode, setMode] = React.useState<SortMode>("natural");
  const [scope, setScope] = React.useState<SortScope>("lines");
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [ignoreArticles, setIgnoreArticles] = React.useState(false);
  const [stripBlankLines, setStripBlankLines] = React.useState(true);
  const [column, setColumn] = React.useState("1");
  /** Bumped by the Shuffle button so each press reseeds the draw. */
  const [draw, setDraw] = React.useState(0);

  const parsedColumn = Number.parseInt(column, 10);
  const safeColumn = Number.isFinite(parsedColumn) && parsedColumn > 0 ? Math.min(parsedColumn, 64) : 1;

  const sorted = React.useMemo(
    () =>
      sortText(value, {
        mode,
        scope,
        caseSensitive,
        ignoreArticles,
        stripBlankLines,
        column: safeColumn,
      }),
    // `draw` deliberately forces a fresh shuffle when the button is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, mode, scope, caseSensitive, ignoreArticles, stripBlankLines, safeColumn, draw],
  );

  const activeMode = MODES.find((item) => item.value === mode) ?? MODES[0]!;

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value
        ? {
            text: sorted.text,
            stats: [
              { label: "Items in", value: formatNumber(sorted.itemsIn) },
              { label: "Items out", value: formatNumber(sorted.count), tone: "brand" },
              {
                label: "Removed",
                value: formatNumber(sorted.removed),
                tone: sorted.removed > 0 ? "success" : "default",
              },
              { label: "Order", value: activeMode.label },
            ],
          }
        : null,
    [value, sorted, activeMode.label],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="sorted-text"
        extension="txt"
        inputLabel="Your list"
        outputLabel="Sorted"
        inputPlaceholder="Paste a list — one entry per line, or comma separated…"
        outputPlaceholder="Choose how to sort and the result appears here."
        sample={SAMPLE}
        rows={14}
        controls={
          <div className="flex flex-col gap-3">
            <Field label="What to sort">
              {() => (
                <Segmented
                  label="What to sort"
                  size="sm"
                  value={scope}
                  onChange={setScope}
                  options={SCOPES.map((item) => ({ value: item.value, label: item.label }))}
                />
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="How to sort it" hint={activeMode.hint}>
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={mode}
                    onChange={(event) => setMode(event.target.value as SortMode)}
                  >
                    {MODES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {scope === "csv" ? (
                <Field label="Column" hint="1-based, quoted commas handled.">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      type="number"
                      min={1}
                      max={64}
                      value={column}
                      onChange={(event) => setColumn(event.target.value)}
                      className="w-24 font-mono"
                    />
                  )}
                </Field>
              ) : null}
            </div>
            <div className="grid gap-2.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5 sm:grid-cols-3">
              <Checkbox
                label="Case sensitive"
                description="“Apple” after “apple”"
                checked={caseSensitive}
                onChange={(event) => setCaseSensitive(event.target.checked)}
              />
              <Checkbox
                label="Ignore leading articles"
                description="the, a, an — comparison only"
                checked={ignoreArticles}
                onChange={(event) => setIgnoreArticles(event.target.checked)}
              />
              <Checkbox
                label="Strip blank lines"
                checked={stripBlankLines}
                onChange={(event) => setStripBlankLines(event.target.checked)}
              />
            </div>
            {mode === "shuffle" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraw((n) => n + 1)}>
                  <Shuffle aria-hidden="true" className="size-3.5" />
                  Shuffle again
                </Button>
                <p className="text-xs text-[var(--text-muted)]">
                  Each press is a new permutation, drawn from{" "}
                  <code className="font-mono">crypto.getRandomValues</code>.
                </p>
              </div>
            ) : null}
          </div>
        }
        actions={
          scope === "csv" && value ? (
            <Notice tone="info" title="CSV mode keeps your rows verbatim.">
              Each line is parsed so a quoted field containing a comma counts as one value, and the
              row is written back exactly as you typed it. Only the order changes.
            </Notice>
          ) : scope === "commas" && value ? (
            <Notice tone="info" title="Comma mode normalises the spacing.">
              Values are split on commas with surrounding whitespace ignored, then rejoined with a
              single comma and space.
            </Notice>
          ) : null
        }
      />
    </ToolShell>
  );
}
