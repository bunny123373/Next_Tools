"use client";

import * as React from "react";
import { ArrowLeftRight, Columns2, Diff, Eraser, FlaskConical, Rows3, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Checkbox, Segmented, Stat, Textarea } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import {
  diffLines,
  diffWords,
  highlightCode,
  type CodeLang,
  type CodeToken,
  type CodeTokenKind,
  type DiffLine,
  type DiffOp,
  type WordChunk,
} from "@/lib/tools/engines/dev";

const ORIGINAL = `function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum;
}`;

const UPDATED = `function total(items, discount = 0) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum * (1 - discount);
}`;

const LANGS: { value: CodeLang; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "js", label: "JavaScript" },
  { value: "ts", label: "TypeScript" },
  { value: "json", label: "JSON" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "python", label: "Python" },
];

const TOKEN_CLASS: Record<CodeTokenKind, string> = {
  plain: "text-[var(--text-ink)]",
  keyword: "text-brand-500",
  type: "text-amber-500",
  string: "text-emerald-500",
  comment: "text-[var(--text-muted)] italic",
  number: "text-sky-500",
  punct: "text-[var(--text-muted)]",
  tag: "text-brand-500",
  attribute: "text-amber-500",
  selector: "text-emerald-500",
  property: "text-sky-500",
};

type View = "unified" | "split";

/** Pairs each removed line with the inserted line that replaced it, for word diff. */
function pairChanges(lines: DiffLine[]): Map<number, number> {
  const pairs = new Map<number, number>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.op !== "delete") {
      i += 1;
      continue;
    }
    const deletes: number[] = [];
    const inserts: number[] = [];
    while (i < lines.length && lines[i]!.op === "delete") {
      deletes.push(i);
      i += 1;
    }
    while (i < lines.length && lines[i]!.op === "insert") {
      inserts.push(i);
      i += 1;
    }
    const count = Math.min(deletes.length, inserts.length);
    for (let k = 0; k < count; k += 1) pairs.set(deletes[k]!, inserts[k]!);
  }
  return pairs;
}

export default function DiffCheckerWorkspace() {
  const [original, setOriginal] = React.useState(ORIGINAL);
  const [updated, setUpdated] = React.useState(UPDATED);
  const [view, setView] = React.useState<View>("unified");
  const [lang, setLang] = React.useState<CodeLang>("js");
  const [highlight, setHighlight] = React.useState(true);
  const [wordDiff, setWordDiff] = React.useState(true);
  const [wrap, setWrap] = React.useState(false);

  const result = React.useMemo(() => diffLines(original, updated), [original, updated]);
  const pairs = React.useMemo(() => (wordDiff ? pairChanges(result.lines) : new Map<number, number>()), [result.lines, wordDiff]);

  const words = React.useMemo(() => {
    if (!wordDiff) return new Map<number, { chunks: WordChunk[]; side: "left" | "right" }>();
    const out = new Map<number, { chunks: WordChunk[]; side: "left" | "right" }>();
    for (const [leftIndex, rightIndex] of pairs) {
      const left = result.lines[leftIndex]!.text;
      const right = result.lines[rightIndex]!.text;
      const result2 = diffWords(left, right);
      out.set(leftIndex, { chunks: result2.left, side: "left" });
      out.set(rightIndex, { chunks: result2.right, side: "right" });
    }
    return out;
  }, [pairs, result.lines, wordDiff]);

  const unified = React.useMemo(() => renderUnified(result.lines, lang, highlight, words, wrap), [result.lines, lang, highlight, words, wrap]);
  const split = React.useMemo(() => renderSplit(result.lines, lang, highlight, words, wrap), [result.lines, lang, highlight, words, wrap]);
  const patch = React.useMemo(() => renderUnifiedText(result.lines), [result.lines]);

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOriginal(ORIGINAL);
              setUpdated(UPDATED);
              toast.info("Sample loaded");
            }}
          >
            <FlaskConical aria-hidden="true" className="size-3.5" />
            Sample
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOriginal("");
              setUpdated("");
            }}
            disabled={!original && !updated}
          >
            <Eraser aria-hidden="true" className="size-3.5" />
            Clear
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOriginal(updated);
              setUpdated(updated);
            }}
            disabled={!updated}
            title="Copy the updated text into the original pane. The diff clears and you can keep editing from there."
          >
            <ArrowLeftRight aria-hidden="true" className="size-3.5" />
            Accept updated
          </Button>
          <div className="ml-auto">
            <Segmented
              label="View"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "unified", label: "Unified", icon: <Rows3 className="size-3.5" /> },
                { value: "split", label: "Side by side", icon: <Columns2 className="size-3.5" /> },
              ]}
            />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Pane label="Original" value={original} onChange={setOriginal} placeholder="The code before the change." />
          <Pane label="Updated" value={updated} onChange={setUpdated} placeholder="The code after the change." />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <div className="min-w-[10rem]">
            <label htmlFor="diff-lang" className="mb-1.5 block text-[13px] font-medium text-[var(--text-ink)]">
              Language
            </label>
            <select
              id="diff-lang"
              value={lang}
              onChange={(event) => setLang(event.target.value as CodeLang)}
              className="h-10 w-full cursor-pointer appearance-none rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
            >
              {LANGS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-center gap-2">
            <Checkbox label="Syntax highlighting" checked={highlight} onChange={(event) => setHighlight(event.target.checked)} />
            <Checkbox
              label="Word-level changes inside changed lines"
              checked={wordDiff}
              onChange={(event) => setWordDiff(event.target.checked)}
            />
            <Checkbox label="Wrap long lines" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Added" value={`+${formatNumber(result.added)}`} tone="success" />
          <Stat label="Removed" value={`-${formatNumber(result.removed)}`} tone="brand" />
          <Stat label="Unchanged" value={formatNumber(result.unchanged)} />
          <Stat
            label="Change"
            value={`${result.added + result.removed} lines`}
            hint={result.unchanged === 0 ? "everything differs" : undefined}
          />
        </dl>

        {result.approximate ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="Very large inputs.">
            These two documents have too many line pairs for an exact longest-common-subsequence diff, so the
            changed region is reported as a single delete-then-insert block instead of the precise line
            alignment. Shrink either side, or diff them in chunks, for an exact result.
          </Notice>
        ) : null}

        {original === "" && updated === "" ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Paste the two versions to compare."
              description="Nothing is uploaded — the diff is computed in this tab with a longest-common-subsequence walk."
              icon={<Diff className="size-5" />}
            />
          </div>
        ) : result.added === 0 && result.removed === 0 ? (
          <Notice tone="success" title="The two texts are identical.">
            Every line matched, so there is nothing to show.
          </Notice>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">
                {view === "unified" ? "Unified diff" : "Side by side"}
              </span>
              <div className="flex items-center gap-1.5">
                <CopyButton value={patch} what="Unified diff copied" size="sm" variant="ghost" />
                <DownloadButton
                  text={patch}
                  filename="diff.patch"
                  mime="text/x-diff;charset=utf-8"
                  label="Download .patch"
                  size="sm"
                  variant="secondary"
                />
              </div>
            </div>
            <div className="max-h-[34rem] overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] font-mono text-[12px] leading-relaxed">
              {view === "unified" ? unified : split}
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              The downloaded file is a standard unified diff, so <code className="font-mono">git apply</code>{" "}
              and <code className="font-mono">patch</code> can consume it. The highlighting, word-level
              shading and side-by-side layout are presentation only and are not in the patch.
            </p>
          </div>
        )}
      </div>
    </ToolShell>
  );
}

function Pane({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const id = `diff-${label.toLowerCase()}`;
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
        spellCheck={false}
        className="resize-y font-mono text-[12px] leading-relaxed"
      />
      <p className="font-mono text-[11px] text-[var(--text-muted)]">
        {formatNumber(value.split("\n").length)} lines
      </p>
    </div>
  );
}

function LineBody({
  text,
  lang,
  highlight,
  chunks,
  side,
  empty,
}: {
  text: string;
  lang: CodeLang;
  highlight: boolean;
  chunks?: WordChunk[];
  side?: "left" | "right";
  empty?: boolean;
}) {
  if (empty) return <span className="text-[var(--text-muted)]"> </span>;

  if (chunks) {
    return (
      <>
        {chunks.map((chunk, index) => (
          <span
            key={index}
            className={cn(
              chunk.op === "equal" ? undefined : "rounded-[3px] px-px",
              side === "left" && chunk.op === "delete" && "bg-brand-500/25",
              side === "right" && chunk.op === "insert" && "bg-emerald-500/25",
            )}
          >
            {chunk.text}
          </span>
        ))}
      </>
    );
  }

  if (!highlight) return <>{text}</>;
  return <>{renderTokens(highlightCode(text, lang))}</>;
}

function renderTokens(tokens: CodeToken[]): React.ReactNode {
  return tokens.map((token, index) => (
    <span key={index} className={TOKEN_CLASS[token.kind]}>
      {token.text}
    </span>
  ));
}

const ROW_STYLE: Record<string, string> = {
  equal: "",
  insert: "bg-emerald-500/[0.07]",
  delete: "bg-brand-500/[0.07]",
};

const MARKER: Record<string, string> = {
  equal: " ",
  insert: "+",
  delete: "-",
};

function renderUnified(
  lines: DiffLine[],
  lang: CodeLang,
  highlight: boolean,
  words: Map<number, { chunks: WordChunk[]; side: "left" | "right" }>,
  wrap: boolean,
): React.ReactNode {
  let oldNumber = 0;
  let newNumber = 0;
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Line-by-line differences</caption>
      <tbody>
        {lines.map((line, index) => {
          const oldNo = line.op === "insert" ? "" : ++oldNumber;
          const newNo = line.op === "delete" ? "" : ++newNumber;
          const entry = words.get(index);
          return (
            <tr key={index} className={ROW_STYLE[line.op]}>
              <td className="w-10 select-none border-r border-[var(--surface-line)] px-1 text-right text-[var(--text-muted)]">
                {oldNo}
              </td>
              <td className="w-10 select-none border-r border-[var(--surface-line)] px-1 text-right text-[var(--text-muted)]">
                {newNo}
              </td>
              <td className="w-6 select-none text-center text-[var(--text-muted)]">{MARKER[line.op]}</td>
              <td className={cn("px-2", wrap ? "break-all" : "whitespace-pre")}>
                <LineBody
                  text={line.text}
                  lang={lang}
                  highlight={highlight && !entry}
                  chunks={entry?.chunks}
                  side={entry?.side}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function renderSplit(
  lines: DiffLine[],
  lang: CodeLang,
  highlight: boolean,
  words: Map<number, { chunks: WordChunk[]; side: "left" | "right" }>,
  wrap: boolean,
): React.ReactNode {
  const rows: { left: DiffLine | null; right: DiffLine | null; leftIndex: number; rightIndex: number }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.op === "equal") {
      rows.push({ left: line, right: line, leftIndex: i, rightIndex: i });
      i += 1;
      continue;
    }
    if (line.op === "delete") {
      const deletes: DiffLine[] = [];
      const inserts: DiffLine[] = [];
      const start = i;
      while (i < lines.length && lines[i]!.op === "delete") {
        deletes.push(lines[i]!);
        i += 1;
      }
      const insertStart = i;
      while (i < lines.length && lines[i]!.op === "insert") {
        inserts.push(lines[i]!);
        i += 1;
      }
      const count = Math.max(deletes.length, inserts.length);
      for (let k = 0; k < count; k += 1) {
        const leftIndex = start + k < insertStart ? start + k : -1;
        const rightIndex = insertStart + k < i ? insertStart + k : -1;
        rows.push({
          left: deletes[k] ?? null,
          right: inserts[k] ?? null,
          leftIndex: leftIndex >= 0 && deletes[k] ? leftIndex : -1,
          rightIndex: rightIndex >= 0 && inserts[k] ? rightIndex : -1,
        });
      }
      continue;
    }
    rows.push({ left: null, right: line, leftIndex: -1, rightIndex: i });
    i += 1;
  }

  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Differences, side by side</caption>
      <thead>
        <tr className="border-b border-[var(--surface-line)]">
          <th
            scope="col"
            colSpan={2}
            className="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]"
          >
            Original
          </th>
          <th
            scope="col"
            colSpan={2}
            className="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]"
          >
            Updated
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const leftEntry = row.leftIndex >= 0 ? words.get(row.leftIndex) : undefined;
          const rightEntry = row.rightIndex >= 0 ? words.get(row.rightIndex) : undefined;
          return (
            <tr key={index}>
              <td className="w-10 select-none border-r border-[var(--surface-line)] px-1 text-right text-[var(--text-muted)]">
                {row.left?.oldIndex !== null && row.left ? row.left.oldIndex + 1 : ""}
              </td>
              <td className={cn("w-1/2 border-r border-[var(--surface-line)] px-2", row.left ? ROW_STYLE.delete : ROW_STYLE.insert, wrap ? "break-all" : "whitespace-pre")}>
                <LineBody
                  text={row.left?.text ?? ""}
                  lang={lang}
                  highlight={highlight && !leftEntry}
                  chunks={leftEntry?.chunks}
                  side="left"
                  empty={!row.left}
                />
              </td>
              <td className="w-10 select-none border-r border-[var(--surface-line)] px-1 text-right text-[var(--text-muted)]">
                {row.right?.newIndex !== null && row.right ? row.right.newIndex + 1 : ""}
              </td>
              <td className={cn("w-1/2 px-2", row.right ? ROW_STYLE.insert : ROW_STYLE.delete, wrap ? "break-all" : "whitespace-pre")}>
                <LineBody
                  text={row.right?.text ?? ""}
                  lang={lang}
                  highlight={highlight && !rightEntry}
                  chunks={rightEntry?.chunks}
                  side="right"
                  empty={!row.right}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * A real unified diff, with @@ hunks and three lines of context, so `git apply`
 * and `patch` can consume it. Windows around each change are merged so nearby
 * edits share one hunk instead of producing overlapping ones.
 */
function renderUnifiedText(lines: DiffLine[], context = 3): string {
  const out: string[] = ["--- a/previous", "+++ b/current"];
  const numbered: { op: DiffOp; text: string; old: number; new: number }[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  for (const line of lines) {
    if (line.op === "insert") {
      newNumber += 1;
      numbered.push({ op: "insert", text: line.text, old: 0, new: newNumber });
    } else if (line.op === "delete") {
      oldNumber += 1;
      numbered.push({ op: "delete", text: line.text, old: oldNumber, new: 0 });
    } else {
      oldNumber += 1;
      newNumber += 1;
      numbered.push({ op: "equal", text: line.text, old: oldNumber, new: newNumber });
    }
  }

  const changed = numbered.map((line, index) => (line.op === "equal" ? -1 : index)).filter((index) => index >= 0);
  const windows: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(numbered.length - 1, index + context);
    const last = windows[windows.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }

  for (const [start, end] of windows) {
    const slice = numbered.slice(start, end + 1);
    const oldStart = slice.find((line) => line.old > 0)?.old ?? 0;
    const newStart = slice.find((line) => line.new > 0)?.new ?? 0;
    const oldCount = slice.filter((line) => line.op !== "insert").length;
    const newCount = slice.filter((line) => line.op !== "delete").length;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const line of slice) out.push(`${MARKER[line.op]}${line.text}`);
  }
  return out.join("\n");
}
