"use client";

import * as React from "react";
import { ListX } from "lucide-react";
import { Checkbox, Segmented } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { dedupeLines } from "@/lib/tools/engines/text";
import { formatNumber } from "@/lib/utils/format";

type SortMode = "none" | "asc" | "desc";

const SAMPLE = `banana
apple
Banana
apple
cherry
  apple
banana`;

export default function RemoveDuplicateLines() {
  const [value, setValue] = React.useState("");
  const [sort, setSort] = React.useState<SortMode>("none");
  const [ignoreCase, setIgnoreCase] = React.useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(false);
  const [collapseBlankLines, setCollapseBlankLines] = React.useState(false);

  const outcome = React.useMemo(
    () => dedupeLines(value, { sort, ignoreCase, ignoreWhitespace, collapseBlankLines }),
    [value, sort, ignoreCase, ignoreWhitespace, collapseBlankLines],
  );

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value
        ? {
            text: outcome.text,
            stats: [
              { label: "Lines in", value: formatNumber(outcome.linesIn) },
              { label: "Lines out", value: formatNumber(outcome.linesOut), tone: "brand" },
              { label: "Removed", value: formatNumber(outcome.removed), tone: outcome.removed > 0 ? "success" : "default" },
              { label: "Blank lines", value: formatNumber(outcome.blankLinesRemoved) },
            ],
          }
        : null,
    [value, outcome],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="deduplicated-lines"
        extension="txt"
        mime="text/plain;charset=utf-8"
        inputLabel="Your list"
        outputLabel="Deduplicated"
        inputPlaceholder="Paste a list with repeats, one entry per line…"
        outputPlaceholder="Paste a list on the left — the first occurrence of each line is kept."
        sample={SAMPLE}
        rows={14}
        controls={
          <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
            <Segmented
              label="Output order"
              size="sm"
              value={sort}
              onChange={setSort}
              options={[
                { value: "none", label: "Keep original order" },
                { value: "asc", label: "A → Z" },
                { value: "desc", label: "Z → A" },
              ]}
            />
            <div className="grid gap-2.5 sm:grid-cols-3">
              <Checkbox
                label="Ignore case"
                description="“Apple” and “apple” match"
                checked={ignoreCase}
                onChange={(event) => setIgnoreCase(event.target.checked)}
              />
              <Checkbox
                label="Ignore surrounding spaces"
                description="Indentation does not create a new line"
                checked={ignoreWhitespace}
                onChange={(event) => setIgnoreWhitespace(event.target.checked)}
              />
              <Checkbox
                label="Treat blank lines as one"
                description="Runs collapse to a single blank; ends are dropped"
                checked={collapseBlankLines}
                onChange={(event) => setCollapseBlankLines(event.target.checked)}
              />
            </div>
            {sort !== "none" ? (
              <p className="text-xs text-[var(--text-muted)]">
                Sorting drops blank lines, because a blank line has no place in a sorted list. The
                removed count includes them.
              </p>
            ) : null}
          </div>
        }
        actions={
          value ? (
            <section aria-label="Removed lines" className="flex flex-col gap-2">
              <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
                <ListX aria-hidden="true" className="size-3.5 text-[var(--text-muted)]" />
                {formatNumber(outcome.duplicates.length)} line
                {outcome.duplicates.length === 1 ? "" : "s"} removed
              </h3>
              {outcome.duplicates.length === 0 ? (
                <Notice tone="success">Nothing was duplicated under the current rules.</Notice>
              ) : (
                <ul className="flex max-h-64 flex-col gap-1 overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-2">
                  {outcome.duplicates.map((line, index) => (
                    <li
                      key={`${line}-${index}`}
                      className="truncate px-2 py-1 font-mono text-[12px] text-[var(--text-muted)]"
                    >
                      {line.trim() === "" ? "(blank line)" : line}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null
        }
      />
    </ToolShell>
  );
}
