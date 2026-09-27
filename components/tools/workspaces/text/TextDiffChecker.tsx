"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Columns2, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Segmented, Textarea } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { diffLines, toUnifiedDiff, type DiffRow, type DiffWordPart } from "@/lib/tools/engines/text";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { toast } from "@/lib/utils/toast";

type View = "split" | "unified";

const SAMPLE_ORIGINAL = `Balu Tools is a toolbox that runs in your browser.
Nothing is uploaded, so there is no upload limit.
Every tool recomputes on the same keystroke that produced the input.

Text tools:
- word counter
- case converter
- text cleaner`;

const SAMPLE_UPDATED = `Balu Tools is a toolbox that runs entirely in your browser.
Nothing is uploaded, so there is no upload limit and no wait.
Every tool recomputes on the same keystroke that produced the input.
Results can be copied or downloaded.

Text tools:
- word counter
- character counter
- case converter
- text cleaner
- markdown editor`;

/** Rows rendered before the view gives up, so a huge diff cannot flood the DOM. */
const MAX_ROWS = 1500;

export default function TextDiffChecker() {
  const [original, setOriginal] = React.useState("");
  const [updated, setUpdated] = React.useState("");
  const [ignoreCase, setIgnoreCase] = React.useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(false);
  const [view, setView] = React.useState<View>("split");
  const [cursor, setCursor] = React.useState(0);
  const rowRefs = React.useRef<HTMLElement[]>([]);

  const outcome = React.useMemo(
    () => diffLines(original, updated, { ignoreCase, ignoreWhitespace }),
    [original, updated, ignoreCase, ignoreWhitespace],
  );

  const diff = outcome.ok ? outcome.result : null;
  const changeIndexes = React.useMemo(
    () => (diff ? diff.rows.flatMap((row, index) => (row.type === "equal" ? [] : [index])) : []),
    [diff],
  );

  // Clamp the cursor whenever the diff changes shape under it.
  const activeChange = changeIndexes[cursor];
  React.useEffect(() => {
    if (cursor > changeIndexes.length - 1) setCursor(Math.max(0, changeIndexes.length - 1));
  }, [changeIndexes.length, cursor]);

  const goTo = React.useCallback(
    (next: number) => {
      if (changeIndexes.length === 0) return;
      const clamped = (next + changeIndexes.length) % changeIndexes.length;
      setCursor(clamped);
      const row = rowRefs.current[changeIndexes[clamped] ?? -1];
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [changeIndexes],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "n" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      goTo(cursor + 1);
    }
    if (event.key === "p" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      goTo(cursor - 1);
    }
  };

  const unified = React.useMemo(
    () => (diff ? toUnifiedDiff(diff, "original", "updated") : ""),
    [diff],
  );

  const result = React.useMemo<TextToolResult | null>(() => {
    if (!original && !updated) return null;
    if (!outcome.ok) return { text: "", error: outcome.error };
    const d = outcome.result;
    const changedRows = d.added + d.removed + d.changed;
    return {
      text: unified,
      stats: [
        { label: "Added", value: formatNumber(d.added), tone: "success" },
        { label: "Removed", value: formatNumber(d.removed), tone: "brand" },
        { label: "Changed", value: formatNumber(d.changed) },
        { label: "Unchanged", value: formatNumber(d.rows.length - changedRows) },
        { label: "Lines", value: `${formatNumber(d.linesA)} → ${formatNumber(d.linesB)}` },
        { label: "Changes", value: formatNumber(changeIndexes.length) },
      ],
    };
  }, [original, updated, outcome, unified, changeIndexes.length]);

  const rows = diff ? diff.rows.slice(0, MAX_ROWS) : [];
  const truncatedRows = diff ? Math.max(0, diff.rows.length - rows.length) : 0;

  return (
    <ToolShell>
      <TextWorkbench
        value={original}
        onChange={setOriginal}
        result={result}
        outputName="changes"
        extension="diff"
        mime="text/plain;charset=utf-8"
        outputLabel="Unified diff"
        outputPlaceholder="Paste text into both boxes — a copy-and-paste diff appears here."
        hideInput
        sample={SAMPLE_ORIGINAL}
        controls={
          <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
            <div className="grid gap-3 lg:grid-cols-2">
              <TextPane
                id="diff-original"
                label="Original"
                value={original}
                onChange={setOriginal}
                placeholder="The text before the change…"
              />
              <TextPane
                id="diff-updated"
                label="Updated"
                value={updated}
                onChange={setUpdated}
                placeholder="The text after the change…"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Checkbox
                  label="Ignore case"
                  description="“Word” and “word” are the same line"
                  checked={ignoreCase}
                  onChange={(event) => setIgnoreCase(event.target.checked)}
                />
                <Checkbox
                  label="Ignore whitespace"
                  description="Spaces and tabs are collapsed before comparing"
                  checked={ignoreWhitespace}
                  onChange={(event) => setIgnoreWhitespace(event.target.checked)}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setOriginal(SAMPLE_ORIGINAL);
                    setUpdated(SAMPLE_UPDATED);
                    toast.info("Comparison loaded");
                  }}
                >
                  Load example
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!original && !updated}
                  onClick={() => {
                    setOriginal("");
                    setUpdated("");
                    setCursor(0);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
        }
        actions={
          diff && diff.rows.length > 0 ? (
            <section aria-label="Visual diff" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-medium text-[var(--text-ink)]">Changes</h3>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                    {changeIndexes.length === 0
                      ? "identical"
                      : `${cursor + 1} of ${changeIndexes.length}`}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Previous change (Ctrl+P)"
                      disabled={changeIndexes.length === 0}
                      onClick={() => goTo(cursor - 1)}
                    >
                      <ChevronUp aria-hidden="true" className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Next change (Ctrl+N)"
                      disabled={changeIndexes.length === 0}
                      onClick={() => goTo(cursor + 1)}
                    >
                      <ChevronDown aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <Segmented
                  label="Diff layout"
                  size="sm"
                  className="w-auto"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "split", label: "Split", icon: <Columns2 aria-hidden="true" className="size-3.5" /> },
                    { value: "unified", label: "Unified", icon: <Rows3 aria-hidden="true" className="size-3.5" /> },
                  ]}
                />
              </div>

              {changeIndexes.length === 0 ? (
                <p className="rounded-[10px] border border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-3 text-[13px] text-emerald-500">
                  The two texts are identical under the current options.
                </p>
              ) : view === "split" ? (
                <SplitRows
                  rows={rows}
                  activeRow={activeChange}
                  registerRow={rowRefs}
                />
              ) : (
                <UnifiedRows rows={rows} activeRow={activeChange} registerRow={rowRefs} />
              )}

              {truncatedRows > 0 ? (
                <p className="text-xs text-amber-500">
                  Showing the first {formatNumber(MAX_ROWS)} rows. The unified diff above still
                  covers every line.
                </p>
              ) : null}
              {diff.approximate ? (
                <p className="text-xs text-amber-500">
                  These two texts differ too much to trace precisely, so the middle is shown as one
                  block. The line counts and the unified diff are still exact.
                </p>
              ) : null}
              <p className="text-[11px] text-[var(--text-muted)]">
                Navigate with the buttons or Ctrl+N / Ctrl+P while the workspace has focus. Changed
                lines are highlighted word by word.
              </p>
            </section>
          ) : null
        }
      />
    </ToolShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Pieces                                                            */
/* ------------------------------------------------------------------ */

function TextPane({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[var(--text-ink)]">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={10}
        className="min-h-[13rem] resize-y font-mono text-[13px] leading-relaxed"
      />
    </div>
  );
}

const ROW_TONE: Record<DiffRow["type"], string> = {
  equal: "",
  insert: "bg-emerald-500/[0.10]",
  delete: "bg-brand-500/[0.10]",
  replace: "bg-amber-500/[0.10]",
};

const GUTTER_TONE: Record<DiffRow["type"], string> = {
  equal: "text-[var(--text-muted)]",
  insert: "text-emerald-500",
  delete: "text-brand-500",
  replace: "text-amber-500",
};

const SIGN: Record<DiffRow["type"], string> = {
  equal: " ",
  insert: "+",
  delete: "−",
  replace: "~",
};

function Parts({ parts, fallback }: { parts?: DiffWordPart[]; fallback: string }) {
  if (!parts || parts.length === 0) return <>{fallback}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.changed ? (
          <mark
            key={index}
            className="rounded-[3px] bg-brand-500/25 px-[1px] text-[var(--text-ink)]"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function SplitRows({
  rows,
  activeRow,
  registerRow,
}: {
  rows: DiffRow[];
  activeRow: number | undefined;
  registerRow: React.RefObject<HTMLElement[]>;
}) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)]">
      <table className="w-full min-w-[36rem] border-collapse font-mono text-[12px]">
        <caption className="sr-only">Line-by-line comparison, original on the left and updated on the right</caption>
        <thead>
          <tr className="border-b border-[var(--surface-line)] text-left text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
            <th scope="col" className="w-8 px-1 py-1.5 font-medium">#</th>
            <th scope="col" className="w-8 px-1 py-1.5 font-medium"> </th>
            <th scope="col" className="px-2 py-1.5 font-medium">Original</th>
            <th scope="col" className="w-8 px-1 py-1.5 font-medium">#</th>
            <th scope="col" className="w-8 px-1 py-1.5 font-medium"> </th>
            <th scope="col" className="px-2 py-1.5 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              ref={(node) => {
                if (node) registerRow.current[index] = node;
              }}
              className={cn(
                "align-top",
                ROW_TONE[row.type],
                activeRow === index && "outline-2 -outline-offset-2 outline-brand-500",
              )}
            >
              <td className="w-8 select-none px-1 py-0.5 text-right tabular-nums text-[var(--text-muted)]">
                {row.leftNo ?? ""}
              </td>
              <td className={cn("w-8 select-none px-1 py-0.5 text-center font-semibold", GUTTER_TONE[row.type])}>
                {SIGN[row.type]}
              </td>
              <td className="whitespace-pre-wrap break-words px-2 py-0.5 text-[var(--text-ink)]">
                <Parts parts={row.leftParts} fallback={row.left ?? ""} />
              </td>
              <td className="w-8 select-none px-1 py-0.5 text-right tabular-nums text-[var(--text-muted)]">
                {row.rightNo ?? ""}
              </td>
              <td className={cn("w-8 select-none px-1 py-0.5 text-center font-semibold", GUTTER_TONE[row.type])}>
                {SIGN[row.type]}
              </td>
              <td className="whitespace-pre-wrap break-words px-2 py-0.5 text-[var(--text-ink)]">
                <Parts parts={row.rightParts} fallback={row.right ?? ""} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnifiedRows({
  rows,
  activeRow,
  registerRow,
}: {
  rows: DiffRow[];
  activeRow: number | undefined;
  registerRow: React.RefObject<HTMLElement[]>;
}) {
  return (
    <div className="flex flex-col gap-0 overflow-x-auto rounded-[10px] border border-[var(--surface-line)] font-mono text-[12px]">
      {rows.map((row, index) => (
        <div
          key={index}
          ref={(node) => {
            if (node) registerRow.current[index] = node;
          }}
          className={cn(
            "flex items-start gap-2 px-2 py-0.5",
            ROW_TONE[row.type],
            activeRow === index && "outline-2 -outline-offset-2 outline-brand-500",
          )}
        >
          <span className="w-10 shrink-0 select-none text-right tabular-nums text-[var(--text-muted)]">
            {row.leftNo ?? ""}
          </span>
          <span className="w-10 shrink-0 select-none text-right tabular-nums text-[var(--text-muted)]">
            {row.rightNo ?? ""}
          </span>
          <span className={cn("w-3 shrink-0 select-none text-center font-semibold", GUTTER_TONE[row.type])}>
            {SIGN[row.type]}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[var(--text-ink)]">
            <Parts parts={row.leftParts ?? row.rightParts} fallback={row.left ?? row.right ?? ""} />
          </span>
        </div>
      ))}
    </div>
  );
}
