"use client";

import * as React from "react";
import { Gauge } from "lucide-react";
import { Field, Input, Segmented } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import {
  TextWorkbench,
  countWords,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { characterBreakdown, graphemeCount, utf8ByteLength } from "@/lib/tools/engines/text";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatNumber } from "@/lib/utils/format";

interface LimitPreset {
  value: string;
  label: string;
  limit: number;
  /** Where the number comes from, so the readout is not a bare claim. */
  note: string;
}

const PRESETS: readonly LimitPreset[] = [
  { value: "post", label: "Post", limit: 280, note: "Short-form post limit used by most platforms." },
  { value: "meta", label: "Meta", limit: 155, note: "Search-result description before Google truncates." },
  { value: "sms", label: "SMS", limit: 160, note: "One GSM-7 SMS segment." },
  { value: "title", label: "Title", limit: 60, note: "HTML title tag, pixels not characters." },
  { value: "subject", label: "Subject", limit: 78, note: "Email subject line most clients show in full." },
  { value: "custom", label: "Custom", limit: 500, note: "Type any limit you are working to." },
];

const SAMPLE = "Crème brûlée, kühlschrank & kaffeebohnen — a 90-character description of something nobody needs to buy.";

export default function CharacterCounter() {
  const [value, setValue] = React.useState("");
  const [preset, setPreset] = React.useState("post");
  const [customLimit, setCustomLimit] = React.useState("500");

  const active = PRESETS.find((item) => item.value === preset) ?? PRESETS[0]!;
  const parsedCustom = Number.parseInt(customLimit, 10);
  const limit =
    active.value === "custom" && Number.isFinite(parsedCustom) && parsedCustom > 0
      ? Math.min(parsedCustom, 1_000_000)
      : active.limit;

  const counts = React.useMemo(() => {
    const characters = [...value].length;
    const graphemes = graphemeCount(value);
    const bytes = utf8ByteLength(value);
    const breakdown = characterBreakdown(value);
    const remaining = limit - characters;
    return { characters, graphemes, bytes, breakdown, remaining };
  }, [value, limit]);

  const ratio = limit > 0 ? counts.characters / limit : 0;
  const tone = ratio > 1 ? "over" : ratio > 0.9 ? "near" : "ok";

  const report = React.useMemo(() => {
    if (value === "") return "";
    const b = counts.breakdown;
    const lines = [
      `Limit            ${formatNumber(limit)} characters`,
      `Used             ${formatNumber(counts.characters)}  (${(ratio * 100).toFixed(1)}%)`,
      `Remaining        ${counts.remaining < 0 ? `${formatNumber(-counts.remaining)} over` : formatNumber(counts.remaining)}`,
      "",
      `Graphemes        ${formatNumber(counts.graphemes)}`,
      `UTF-8 bytes      ${formatNumber(counts.bytes)}  (${formatBytes(counts.bytes)})`,
      `Words            ${formatNumber(countWords(value))}`,
      "",
      "Composition",
      `  Letters        ${formatNumber(b.letters)}`,
      `  Digits         ${formatNumber(b.digits)}`,
      `  Punctuation    ${formatNumber(b.punctuation)}`,
      `  Whitespace     ${formatNumber(b.spaces)}`,
      `  Line breaks    ${formatNumber(b.newlines)}`,
      `  Non-ASCII      ${formatNumber(b.nonAscii)}`,
      "",
      `Longest word     ${b.longestWord || "—"} (${formatNumber(b.longestWordLength)} characters)`,
      `Average word     ${b.averageWordLength.toFixed(1)} characters`,
    ];
    return lines.join("\n");
  }, [value, counts, limit, ratio]);

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value
        ? {
            text: report,
            stats: [
              {
                label: "Characters",
                value: formatNumber(counts.characters),
                tone: tone === "over" ? "brand" : "default",
              },
              { label: "Remaining", value: formatNumber(counts.remaining), tone: tone === "ok" ? "success" : "default" },
              { label: "Graphemes", value: formatNumber(counts.graphemes) },
              { label: "UTF-8 size", value: formatBytes(counts.bytes) },
              { label: "Words", value: formatNumber(countWords(value)) },
              { label: "Lines", value: formatNumber(value === "" ? 0 : value.split(/\r\n|\r|\n/).length) },
            ],
          }
        : null,
    [value, report, counts, tone],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="character-report"
        extension="txt"
        inputLabel="Your text"
        outputLabel="Character breakdown"
        inputPlaceholder="Paste the meta description, post or SMS here…"
        outputPlaceholder="Type something on the left to see exactly where your characters go."
        sample={SAMPLE}
        rows={14}
        controls={
          <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
            <Segmented
              label="Character limit"
              size="sm"
              value={preset}
              onChange={setPreset}
              options={PRESETS.map((item) => ({ value: item.value, label: `${item.label} ${item.limit}` }))}
            />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              {active.value === "custom" ? (
                <Field label="Your limit" hint="Whole characters, up to 1,000,000.">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      type="number"
                      min={1}
                      max={1_000_000}
                      value={customLimit}
                      onChange={(event) => setCustomLimit(event.target.value)}
                      className="font-mono"
                    />
                  )}
                </Field>
              ) : (
                <p className="pb-2 text-xs leading-relaxed text-[var(--text-muted)]">{active.note}</p>
              )}
              <div className="pb-2 text-right">
                <p
                  className={cn(
                    "font-mono text-2xl font-semibold tabular-nums",
                    tone === "over" && "text-brand-500",
                    tone === "near" && "text-amber-500",
                    tone === "ok" && "text-emerald-500",
                  )}
                >
                  {counts.remaining < 0 ? `+${formatNumber(-counts.remaining)}` : formatNumber(counts.remaining)}
                </p>
                <p className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
                  {counts.remaining < 0 ? "over the limit" : "characters left"}
                </p>
              </div>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(counts.characters, limit)}
              aria-valuetext={`${formatNumber(counts.characters)} of ${formatNumber(limit)} characters`}
              aria-label="Characters used against the limit"
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-line)]"
            >
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-150",
                  tone === "over" && "bg-brand-500",
                  tone === "near" && "bg-amber-500",
                  tone === "ok" && "bg-emerald-500",
                )}
                style={{ width: `${Math.min(100, ratio * 100)}%` }}
              />
            </div>
            {tone === "over" ? (
              <Notice tone="warning" icon={<Gauge aria-hidden="true" className="size-4" />}>
                You are {formatNumber(-counts.remaining)} characters over the {formatNumber(limit)}-character
                limit. Trim from the end — the tail is what gets cut.
              </Notice>
            ) : null}
          </div>
        }
      />
    </ToolShell>
  );
}
