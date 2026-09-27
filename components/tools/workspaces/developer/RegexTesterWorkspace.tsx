"use client";

import * as React from "react";
import { Eraser, FlaskConical, Plus, Regex, Replace, TriangleAlert, Zap } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Stat, Textarea } from "@/components/ui/form";
import { CopyButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import {
  REGEX_SNIPPETS,
  explainRegex,
  formatPreciseMs,
  nowMs,
  regexBacktrackWarning,
  regexSummary,
} from "@/lib/tools/engines/dev";

/** Hard ceiling on the test string, so a pathological pattern cannot hang the tab. */
const MAX_INPUT = 100_000;
const SLOW_THRESHOLD_MS = 250;

const SAMPLE_PATTERN = "\\b(?<user>[\\w.+-]+)@(?<domain>[\\w-]+)\\.(?<tld>[a-z]{2,})\\b";
const SAMPLE_TEXT = "Contact ada@example.dev or grace.hopper@bl.uk. Broken: not-an-email@, @example.dev.";

const FLAGS: { value: string; label: string; title: string }[] = [
  { value: "g", label: "g", title: "global — find every match, not just the first" },
  { value: "i", label: "i", title: "ignore case" },
  { value: "m", label: "m", title: "multiline — ^ and $ match at line breaks too" },
  { value: "s", label: "s", title: "dotAll — . also matches newlines" },
  { value: "u", label: "u", title: "unicode — enable \\u{...} escapes" },
  { value: "y", label: "y", title: "sticky — match only at lastIndex" },
];

type Segment = { text: string; kind: "plain" | "match" };
type Line = { segments: Segment[]; number: number; matches: number };

interface RunResult {
  explanation: { atoms: ReturnType<typeof explainRegex>["atoms"]; error: string | null };
  warning: string | null;
  error: string | null;
  matches: RegExpExecArray[];
  ms: number;
}

export default function RegexTesterWorkspace() {
  const [pattern, setPattern] = React.useState(SAMPLE_PATTERN);
  const [flags, setFlags] = React.useState<Record<string, boolean>>({ g: true, i: false, m: false, s: false, u: false, y: false });
  const [text, setText] = React.useState(SAMPLE_TEXT);
  const [replace, setReplace] = React.useState("");
  const [replaceOpen, setReplaceOpen] = React.useState(false);
  const [visible, setVisible] = React.useState(120);

  const flagString = React.useMemo(
    () => FLAGS.filter((flag) => flags[flag.value]).map((flag) => flag.value).join(""),
    [flags],
  );

  const truncated = text.length > MAX_INPUT;
  const testText = truncated ? text.slice(0, MAX_INPUT) : text;

  const run = React.useMemo<RunResult>(() => {
    const explanation = explainRegex(pattern);
    const warning = regexBacktrackWarning(pattern);
    if (pattern === "") {
      return { explanation, warning, error: null, matches: [], ms: 0 };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flagString);
    } catch (error) {
      return {
        explanation,
        warning,
        error: error instanceof Error ? error.message : "The browser rejected this pattern.",
        matches: [],
        ms: 0,
      };
    }
    const started = nowMs();
    const matches: RegExpExecArray[] = [];
    // Only g and y can loop forever on a zero-length match, so only they need a guard.
    if (flagString.includes("g") || flagString.includes("y")) {
      regex.lastIndex = 0;
      let match = regex.exec(testText);
      while (match !== null && matches.length < 20_000) {
        matches.push(match);
        if (match[0] === "") regex.lastIndex += 1;
        if (regex.lastIndex > testText.length) break;
        match = regex.exec(testText);
      }
    } else {
      const single = regex.exec(testText);
      if (single) matches.push(single);
    }
    return { explanation, warning, error: null, matches, ms: nowMs() - started };
  }, [pattern, flagString, testText]);

  /** Named group names in source order, so each capture can be labelled properly. */
  const groupNames = React.useMemo(() => {
    const names: string[] = [];
    const scanner = /\(\?<([A-Za-z_$][\w$]*)>/g;
    for (let match = scanner.exec(pattern); match; match = scanner.exec(pattern)) names.push(match[1]!);
    return names;
  }, [pattern]);

  const lines = React.useMemo<Line[]>(() => {
    if (run.error || pattern === "") return [];
    const textLines = testText.split("\n");
    const lineStarts: number[] = [];
    let offset = 0;
    for (const entry of textLines) {
      lineStarts.push(offset);
      offset += entry.length + 1;
    }
    const rangesByLine = new Map<number, { from: number; to: number }[]>();

    for (const match of run.matches) {
      if (match.index === undefined || match[0].length === 0) continue;
      const from = match.index;
      const to = match.index + match[0].length;
      const firstLine = lineIndexOf(testText, lineStarts, from);
      const lastLine = lineIndexOf(testText, lineStarts, to - 1);
      for (let line = firstLine; line <= lastLine; line += 1) {
        const start = lineStarts[line] ?? 0;
        const length = textLines[line]?.length ?? 0;
        const entry = rangesByLine.get(line) ?? [];
        entry.push({
          from: Math.max(from, start) - start,
          to: Math.min(to, start + length) - start,
        });
        rangesByLine.set(line, entry);
      }
    }

    return [...rangesByLine.keys()]
      .sort((a, b) => a - b)
      .map((lineIndex) => {
        const source = textLines[lineIndex] ?? "";
        const ranges = mergeRanges(rangesByLine.get(lineIndex) ?? []);
        const segments: Segment[] = [];
        let at = 0;
        for (const range of ranges) {
          if (range.from > at) segments.push({ text: source.slice(at, range.from), kind: "plain" });
          if (range.to > range.from) segments.push({ text: source.slice(range.from, range.to), kind: "match" });
          at = Math.max(at, range.to);
        }
        if (at < source.length) segments.push({ text: source.slice(at), kind: "plain" });
        return { segments, number: lineIndex + 1, matches: ranges.length };
      });
  }, [run.matches, run.error, pattern, testText]);

  const replacePreview = React.useMemo(() => {
    if (!pattern || run.error || replace === "") return null;
    try {
      const regex = new RegExp(pattern, flagString.includes("g") ? flagString : `${flagString}g`);
      return testText.replace(regex, replace);
    } catch {
      return null;
    }
  }, [pattern, flagString, replace, testText, run.error]);

  const toggleFlag = (flag: string): void => {
    setFlags((current) => ({ ...current, [flag]: !current[flag] }));
  };

  const slow = run.ms > SLOW_THRESHOLD_MS;
  const shown = lines.slice(0, visible);

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <Field label="Pattern" error={run.error ?? null}>
            {({ id, describedBy, invalid }) => (
              <div className="flex flex-col gap-2">
                <div className="flex items-stretch gap-2">
                  <span aria-hidden="true" className="grid w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card)] font-mono text-sm text-[var(--text-muted)]">
                    /
                  </span>
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    value={pattern}
                    onChange={(event) => setPattern(event.target.value)}
                    placeholder="^\\s*(\\w+)@(\\w+)"
                    spellCheck={false}
                    autoComplete="off"
                    className="h-10 min-w-0 flex-1 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 font-mono text-sm text-[var(--text-ink)] transition-colors duration-150 placeholder:text-[var(--text-muted)] hover:border-[var(--surface-line-strong)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 aria-[invalid=true]:border-brand-500"
                  />
                  <span aria-hidden="true" className="grid w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card)] font-mono text-sm text-[var(--text-muted)]">
                    /
                  </span>
                  <div className="flex shrink-0 gap-1" role="group" aria-label="Regular expression flags">
                    {FLAGS.map((flag) => (
                      <button
                        key={flag.value}
                        type="button"
                        title={flag.title}
                        aria-pressed={flags[flag.value]}
                        onClick={() => toggleFlag(flag.value)}
                        className={cn(
                          "grid size-10 place-items-center rounded-[10px] border font-mono text-sm transition-colors duration-150",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                          flags[flag.value]
                            ? "border-brand-500 bg-brand-500 text-white"
                            : "border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)] hover:border-[var(--surface-line-strong)] hover:text-[var(--text-ink)]",
                        )}
                      >
                        {flag.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Flags in use:{" "}
                  <code className="font-mono text-[var(--text-ink)]">{flagString === "" ? "(none)" : flagString}</code>
                </p>
              </div>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Insert</span>
            {REGEX_SNIPPETS.map((snippet) => (
              <Button
                key={snippet.label}
                size="sm"
                variant="secondary"
                title={`${snippet.pattern} — ${snippet.note}`}
                onClick={() => setPattern((current) => (current ? `${current}|${snippet.pattern}` : snippet.pattern))}
              >
                <Plus aria-hidden="true" className="size-3" />
                {snippet.label}
              </Button>
            ))}
          </div>
        </div>

        {run.error ? (
          <div role="alert" className="rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5">
            <p className="text-[13px] font-medium text-[var(--text-ink)]">The browser rejected this pattern.</p>
            <p className="mt-1 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">{run.error}</p>
          </div>
        ) : null}

        {run.warning ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="Possible catastrophic backtracking.">
            {run.warning}
          </Notice>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="regex-test-text" className="text-[13px] font-medium text-[var(--text-ink)]">
                Test text
              </label>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setText(SAMPLE_TEXT)}>
                  <FlaskConical aria-hidden="true" className="size-3.5" />
                  Sample
                </Button>
                <Button size="sm" variant="ghost" disabled={!text} onClick={() => setText("")}>
                  <Eraser aria-hidden="true" className="size-3.5" />
                  Clear
                </Button>
              </div>
            </div>
            <Textarea
              id="regex-test-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={10}
              spellCheck={false}
              placeholder="Paste the text you want to match against."
              className="resize-y font-mono text-[13px] leading-relaxed"
            />
            <p className="text-xs text-[var(--text-muted)]">
              {formatNumber(text.length)} characters
              {truncated ? ` · only the first ${MAX_INPUT.toLocaleString("en")} are tested` : ""}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            {text === "" ? (
              <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                <ToolEmptyState
                  title="Paste some test text."
                  description="Matches are highlighted in place and listed below with every capture group."
                  icon={<Regex className="size-5" />}
                />
              </div>
            ) : run.error ? null : (
              <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Matches" value={formatNumber(run.matches.length)} tone="brand" />
                  <Stat
                    label="Groups"
                    value={String(pattern.replace(/\\./g, "").includes("(") ? (run.matches[0]?.length ?? 1) - 1 : 0)}
                  />
                  <Stat label="Match time" value={formatPreciseMs(run.ms)} tone={slow ? "brand" : "default"} />
                  <Stat label="Tested" value={`${formatNumber(testText.length)} chars`} />
                </dl>

                {slow ? (
                  <Notice tone="warning" icon={<Zap className="size-4" />} title="That was slow.">
                    The match took {formatPreciseMs(run.ms)} on {formatNumber(testText.length)} characters.
                    A pattern that scales badly here will get much worse on real input.
                  </Notice>
                ) : null}

                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">Highlighted</span>
                  {lines.length === 0 ? (
                    <p className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3 text-[13px] text-[var(--text-muted)]">
                      No match. The pattern ran against all {formatNumber(testText.length)} characters.
                    </p>
                  ) : (
                    <div
                      className="max-h-72 overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-2 font-mono text-[12px] leading-relaxed"
                      aria-label="Test text with matches highlighted"
                    >
                      {shown.map((line) => (
                        <div key={line.number} className="flex gap-2 px-1 py-px">
                          <span className="w-8 shrink-0 select-none text-right text-[var(--text-muted)]">
                            {line.number}
                          </span>
                          <span className="min-w-0 whitespace-pre-wrap break-all text-[var(--text-ink)]">
                            {line.segments.map((segment, index) =>
                              segment.kind === "match" ? (
                                <mark
                                  key={index}
                                  className="rounded-[3px] bg-brand-500/25 px-px text-[var(--text-ink)] ring-1 ring-inset ring-brand-500/40"
                                >
                                  {segment.text}
                                </mark>
                              ) : (
                                <React.Fragment key={index}>{segment.text}</React.Fragment>
                              ),
                            )}
                          </span>
                        </div>
                      ))}
                      {lines.length > shown.length ? (
                        <p className="mt-2 px-1 text-[11px] text-[var(--text-muted)]">
                          {formatNumber(lines.length - shown.length)} more matching lines not shown.
                        </p>
                      ) : null}
                    </div>
                  )}
                  {lines.length > shown.length ? (
                    <Button size="sm" variant="secondary" onClick={() => setVisible((current) => current + 240)}>
                      Show more lines
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>

        {!run.error && run.matches.length > 0 ? (
          <section aria-label="Match list" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">
                Matches ({formatNumber(run.matches.length)})
              </span>
              <CopyButton
                value={run.matches
                  .map((match, index) => `${index + 1}. @${match.index} — ${JSON.stringify(match[0])}`)
                  .join("\n")}
                what="Match list copied"
                size="sm"
                variant="ghost"
              />
            </div>
            <ul className="flex max-h-80 flex-col gap-2 overflow-auto">
              {run.matches.slice(0, 200).map((match, index) => (
                <li
                  key={`${match.index}-${index}`}
                  className="flex flex-col gap-1.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px] tabular-nums text-[var(--text-muted)]">
                    <span className="font-mono">#{index + 1}</span>
                    <span>
                      index{" "}
                      <span className="font-mono text-[var(--text-ink)]">{match.index}</span>
                    </span>
                    <span>
                      length{" "}
                      <span className="font-mono text-[var(--text-ink)]">{match[0].length}</span>
                    </span>
                  </div>
                  <code className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] text-emerald-500">
                    {JSON.stringify(match[0])}
                  </code>
                  {match.length > 1 ? (
                    <dl className="grid gap-1">
                      {Array.from(match).slice(1).map((group, groupIndex) => (
                        <div key={groupIndex} className="flex gap-2 text-[12px]">
                          <dt className="w-28 shrink-0 truncate font-mono text-[var(--text-muted)]">
                            {groupNameFor(groupNames, groupIndex)}
                          </dt>
                          <dd className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[var(--text-ink)]">
                            {group === undefined ? (
                              <span className="text-[var(--text-muted)]">(did not participate)</span>
                            ) : (
                              JSON.stringify(group)
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
            {run.matches.length > 200 ? (
              <p className="text-xs text-[var(--text-muted)]">
                Showing the first 200 of {formatNumber(run.matches.length)} matches.
              </p>
            ) : null}
          </section>
        ) : null}

        <section aria-label="Replace" className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <Checkbox
            label="Preview a replacement"
            description="Adds the g flag for the preview, so every match is replaced."
            checked={replaceOpen}
            onChange={(event) => setReplaceOpen(event.target.checked)}
          />
          {replaceOpen ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Replace with" hint="Supports $1, $2, $<name> and $& as JavaScript defines them.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={replace}
                    onChange={(event) => setReplace(event.target.value)}
                    placeholder="$1 at $&lt;$2&gt;"
                    className="font-mono"
                  />
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
                  <Replace aria-hidden="true" className="size-3.5" />
                  Result
                </span>
                <div className="min-h-[4.5rem] max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-2.5 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                  {replacePreview ?? (
                    <span className="text-[var(--text-muted)]">
                      {replace === "" ? "Type a replacement to see the result." : "The pattern cannot be used for replacement."}
                    </span>
                  )}
                </div>
                {replacePreview !== null ? (
                  <div className="flex justify-end">
                    <CopyButton value={replacePreview} what="Replacement copied" size="sm" variant="secondary" />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {run.explanation.atoms.length > 0 ? (
          <section aria-label="Pattern explanation" className="flex flex-col gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">What this pattern says</span>
              <CopyButton
                value={regexSummary(run.explanation.atoms)}
                what="Explanation copied"
                size="sm"
                variant="ghost"
              />
            </div>
            <p className="text-[13px] leading-relaxed text-[var(--text-ink)]">
              {regexSummary(run.explanation.atoms)}
              {flagString ? ` Flags: ${flagString}.` : ""}
            </p>
            {run.explanation.error ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                {run.explanation.error}
              </Notice>
            ) : null}
            <ul className="grid gap-1">
              {run.explanation.atoms.map((atom, index) => (
                <li
                  key={`${atom.text}-${index}`}
                  className="flex flex-col gap-0.5 border-b border-[var(--surface-line)] py-1.5 last:border-0 sm:flex-row sm:gap-3"
                >
                  <code className="w-32 shrink-0 overflow-x-auto font-mono text-[12px] text-brand-500">
                    {atom.text}
                  </code>
                  <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
                    <span className="mr-1.5 rounded bg-[var(--surface-card)] px-1 py-0.5 text-[10px] uppercase tracking-wide">
                      {atom.kind}
                    </span>
                    {atom.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </ToolShell>
  );
}

/** Which line a character offset falls on, using the precomputed line starts. */
function lineIndexOf(_text: string, lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function mergeRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: { from: number; to: number }[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
      continue;
    }
    out.push({ ...range });
  }
  return out;
}

/**
 * Label a capture group. Named groups are numbered in the order their `(` appears,
 * so pairing the names from the pattern with the group index labels the common
 * cases correctly. Unnamed groups fall back to their number.
 */
function groupNameFor(groupNames: readonly string[], groupIndex: number): string {
  const name = groupNames[groupIndex];
  return name === undefined ? `$${groupIndex + 1}` : `$${groupIndex + 1} «${name}»`;
}
