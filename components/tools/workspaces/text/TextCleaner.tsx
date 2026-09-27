"use client";

import * as React from "react";
import { Eraser, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import {
  CLEAN_GROUPS,
  CLEAN_OPERATIONS,
  cleanText,
  type CleanOperationId,
} from "@/lib/tools/engines/text";
import { formatNumber } from "@/lib/utils/format";

/** A sensible starting point: whitespace tidy-up and character scrubbing. */
const DEFAULT_ON: readonly CleanOperationId[] = [
  "crlf-to-lf",
  "trim",
  "trim-trailing",
  "collapse-spaces",
  "remove-tabs",
  "collapse-blanks",
  "strip-zero-width",
  "strip-control",
  "curly-to-straight",
  "nbsp-to-space",
];

/** Invisible characters, built explicitly so the sample is readable as source. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const BELL = String.fromCharCode(0x07);

const SAMPLE = [
  "  Perfectly fine   heading — but with\ttabs,",
  "",
  `Curly “quotes” and an em–dash, plus a zero-width${ZERO_WIDTH_SPACE}space and a bell${BELL} character.`,
  "Visit https://example.com/very/long/path or mail hello@example.com about it.",
  "the the the end.",
].join("\n");

export default function TextCleaner() {
  const [value, setValue] = React.useState("");
  const [enabled, setEnabled] = React.useState<CleanOperationId[]>([...DEFAULT_ON]);

  const toggle = (id: CleanOperationId, on: boolean) => {
    setEnabled((current) =>
      on ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id),
    );
  };

  const outcome = React.useMemo(() => cleanText(value, enabled), [value, enabled]);
  const allIds = React.useMemo(() => CLEAN_OPERATIONS.map((operation) => operation.id), []);

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value
        ? {
            text: outcome.text,
            stats: [
              { label: "Characters in", value: formatNumber(outcome.charactersIn) },
              { label: "Characters out", value: formatNumber(outcome.charactersOut), tone: "brand" },
              {
                label: "Removed",
                value: formatNumber(outcome.removed),
                tone: outcome.removed > 0 ? "success" : "default",
              },
              { label: "Operations on", value: `${enabled.length}/${CLEAN_OPERATIONS.length}` },
            ],
          }
        : null,
    [value, outcome, enabled.length],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="cleaned-text"
        extension="txt"
        inputLabel="Messy text"
        outputLabel="Cleaned text"
        inputPlaceholder="Paste text copied from a PDF, a spreadsheet or a CMS…"
        outputPlaceholder="Tick the cleanups you want and the result appears here."
        sample={SAMPLE}
        rows={14}
        controls={
          <div className="flex flex-col gap-4 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
                <ListChecks aria-hidden="true" className="size-3.5 text-[var(--text-muted)]" />
                Cleanup operations
              </h3>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEnabled([...DEFAULT_ON])}>
                  <Eraser aria-hidden="true" className="size-3.5" />
                  Reset
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEnabled([])}>
                  Clear all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEnabled([...allIds])}>
                  Select all
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CLEAN_GROUPS.map((group) => (
                <fieldset key={group.id} className="flex flex-col gap-2">
                  <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                    {group.label}
                  </legend>
                  {CLEAN_OPERATIONS.filter((operation) => operation.group === group.id).map(
                    (operation) => (
                      <Checkbox
                        key={operation.id}
                        label={operation.label}
                        description={operation.description}
                        checked={enabled.includes(operation.id)}
                        onChange={(event) => toggle(operation.id, event.target.checked)}
                      />
                    ),
                  )}
                </fieldset>
              ))}
            </div>
          </div>
        }
        actions={
          value && outcome.steps.length > 0 ? (
            <section aria-label="What each operation removed" className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-[var(--text-ink)]">
                What each operation removed
                <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                  measured during this run, in the order they are applied
                </span>
              </h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {outcome.steps.map((step) => (
                  <li
                    key={step.id}
                    className="flex items-baseline justify-between gap-3 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-[13px] text-[var(--text-ink)]">
                      {step.label}
                    </span>
                    <span
                      className={
                        step.removed > 0
                          ? "shrink-0 font-mono text-[12px] tabular-nums text-emerald-500"
                          : "shrink-0 font-mono text-[12px] tabular-nums text-[var(--text-muted)]"
                      }
                    >
                      {step.removed > 0 ? `−${formatNumber(step.removed)}` : "no change"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : value ? (
            <p className="text-xs text-[var(--text-muted)]">
              No operation is ticked, so the output is your text unchanged.
            </p>
          ) : null
        }
      />
    </ToolShell>
  );
}
