"use client";

import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Checkbox, Segmented } from "@/components/ui/form";
import { formatJson, type JsonFormatOptions, type TextOutcome } from "@/lib/tools/engines/dev";

const SAMPLE = `{"id":7,"name":"Ada Lovelace","active":true,"roles":["admin","editor"],"profile":{"city":"London","timezone":"Europe/London","scores":[91,88,74]},"createdAt":"2026-01-05T09:30:00Z"}`;

function toResult(outcome: TextOutcome | null): TextToolResult | null {
  if (!outcome) return null;
  return { text: outcome.text, error: outcome.error, stats: outcome.stats };
}

export default function JsonFormatterWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [indent, setIndent] = React.useState<JsonFormatOptions["indent"]>("2");
  const [sortKeys, setSortKeys] = React.useState(false);
  const [trailingNewline, setTrailingNewline] = React.useState(true);

  const outcome = React.useMemo<TextOutcome | null>(
    () => (value.trim() === "" ? null : formatJson(value, { indent, sortKeys, trailingNewline })),
    [value, indent, sortKeys, trailingNewline],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={toResult(outcome)}
        outputName="formatted-json"
        extension="json"
        mime="application/json;charset=utf-8"
        inputLabel="JSON"
        outputLabel="Formatted JSON"
        inputPlaceholder='Paste JSON here — e.g. {"name":"Ada","tags":["a","b"]}'
        outputPlaceholder="The formatted document appears here as you type."
        sample={SAMPLE}
        controls={
          <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="min-w-[13rem] flex-1">
              <span className="mb-1.5 block text-[13px] font-medium text-[var(--text-ink)]">Indentation</span>
              <Segmented
                label="Indentation"
                size="sm"
                value={indent}
                onChange={setIndent}
                options={[
                  { value: "2", label: "2 spaces" },
                  { value: "4", label: "4 spaces" },
                  { value: "tab", label: "Tab" },
                  { value: "min", label: "Minified" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-2 sm:pb-0.5">
              <Checkbox
                label="Sort object keys"
                description="Arrays keep their original order."
                checked={sortKeys}
                onChange={(event) => setSortKeys(event.target.checked)}
              />
              <Checkbox
                label="Add a trailing newline"
                description="Posix-friendly for files in a repo."
                checked={trailingNewline}
                onChange={(event) => setTrailingNewline(event.target.checked)}
              />
            </div>
          </div>
        }
        actions={
          <div className="flex flex-col gap-2">
            {outcome?.errorDetail ? (
              <figure className="overflow-x-auto rounded-[10px] border border-brand-500/30 bg-brand-500/[0.05] p-3">
                <figcaption className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-brand-500">
                  <AlertTriangle aria-hidden="true" className="size-3.5" />
                  Around the error
                </figcaption>
                <pre className="font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                  {outcome.errorDetail}
                </pre>
              </figure>
            ) : null}
            {outcome?.notes?.map((note) => (
              <p
                key={note}
                className="flex items-start gap-2 rounded-[10px] border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-500"
              >
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {note}
              </p>
            ))}
          </div>
        }
      />
    </ToolShell>
  );
}
