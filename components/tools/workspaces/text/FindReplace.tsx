"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Replace, ReplaceAll, Rows3, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import {
  applyReplacement,
  compileFinder,
  countCaptureGroups,
  findMatches,
  type FindOptions,
  type MatchRange,
} from "@/lib/tools/engines/text";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { toast } from "@/lib/utils/toast";

type Mode = "source" | "result" | "matches";

const SAMPLE = `The quick brown fox jumps over the lazy dog.
The quick brown cat sleeps on the quick mat.
Replace "quick" with a slower adjective, but keep "quick" in quick facts.`;

/** Matches turned into DOM in the preview. The count above stays authoritative. */
const PREVIEW_LIMIT = 2000;

export default function FindReplace() {
  const [value, setValue] = React.useState("");
  const [find, setFind] = React.useState("");
  const [replace, setReplace] = React.useState("");
  const [matchCase, setMatchCase] = React.useState(false);
  const [wholeWord, setWholeWord] = React.useState(false);
  const [regex, setRegex] = React.useState(false);
  const [multiline, setMultiline] = React.useState(false);
  const [backreferences, setBackreferences] = React.useState(true);
  const [resultText, setResultText] = React.useState<string | null>(null);
  const [replacedCount, setReplacedCount] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>("source");
  const [active, setActive] = React.useState(0);

  const options = React.useMemo<FindOptions>(
    () => ({ matchCase, wholeWord, regex, multiline, backreferences }),
    [matchCase, wholeWord, regex, multiline, backreferences],
  );

  const compiled = React.useMemo(() => compileFinder(find, options), [find, options]);

  const matches = React.useMemo(
    () =>
      compiled.ok
        ? findMatches(value, compiled.regex)
        : { matches: [] as MatchRange[], truncated: false },
    [value, compiled],
  );

  // A pattern we refused to run never reaches the matcher; yield a tick so the
  // inline error paints before anything else competes for the main thread.
  React.useEffect(() => {
    if (!compiled.ok && compiled.pathological) {
      setTimeout(() => {}, 0);
    }
  }, [compiled]);

  // Editing either the text or the pattern invalidates a previous result.
  React.useEffect(() => {
    setActive(0);
    setMode("source");
  }, [value, find, matchCase, wholeWord, regex, multiline]);

  const groups = React.useMemo(
    () => (regex ? countCaptureGroups(find, options) : 0),
    [find, regex, options],
  );

  const outputText = mode === "result" && resultText !== null ? resultText : value;
  const outputLabel =
    mode === "result"
      ? "Result"
      : mode === "matches"
        ? "Extracted matches"
        : "Your text (unchanged)";

  const run = (all: boolean) => {
    if (!compiled.ok) return;
    const applied = applyReplacement(value, compiled.regex, replace, {
      all,
      backreferences: options.backreferences,
    });
    setResultText(applied.text);
    setReplacedCount(applied.count);
    setMode("result");
    toast.success(
      all ? "Replaced every match" : "Replaced the first match",
      `${formatNumber(applied.count)} replacement${applied.count === 1 ? "" : "s"}`,
    );
  };

  const extract = () => {
    setResultText(matches.matches.map((match) => match.text).join("\n"));
    setReplacedCount(0);
    setMode("matches");
    toast.info(
      "Matches extracted",
      `${formatNumber(matches.matches.length)} line${matches.matches.length === 1 ? "" : "s"}`,
    );
  };

  const reset = () => {
    setResultText(null);
    setReplacedCount(0);
    setMode("source");
    setActive(0);
  };

  const jumpTo = (index: number) => {
    setActive(index);
    document.getElementById(`match-${index}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const preview = React.useMemo(() => {
    if (matches.matches.length === 0) return null;
    const shown = matches.matches.slice(0, PREVIEW_LIMIT);
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    shown.forEach((match, index) => {
      if (match.start > cursor) nodes.push(value.slice(cursor, match.start));
      nodes.push(
        <mark
          key={index}
          id={`match-${index}`}
          className={cn(
            "cursor-pointer rounded-[3px] px-0.5 text-[var(--text-ink)]",
            index === active ? "bg-brand-500 text-white" : "bg-brand-500/30",
          )}
        >
          {match.text}
        </mark>,
      );
      cursor = match.end;
    });
    if (cursor < value.length) nodes.push(value.slice(cursor));
    return nodes;
  }, [matches, value, active]);

  const result = React.useMemo<TextToolResult | null>(() => {
    if (find === "") return null;
    if (compiled.ok) {
      if (!value) return null;
      return {
        text: outputText,
        stats: [
          { label: "Matches", value: formatNumber(matches.matches.length), tone: "brand" },
          { label: "Replaced", value: formatNumber(replacedCount) },
          { label: "Characters", value: formatNumber(value.length) },
          { label: "Result length", value: formatNumber(outputText.length) },
        ],
      };
    }
    // Surface the message through the workbench's own error surface; nothing
    // throws and nothing reaches the console.
    return { text: "", error: compiled.error };
  }, [find, compiled, value, matches, replacedCount, outputText]);

  const fieldError = find === "" || compiled.ok ? null : compiled.error;

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="find-replace-result"
        extension="txt"
        mime="text/plain;charset=utf-8"
        inputLabel="Text to search"
        outputLabel={outputLabel}
        inputPlaceholder="Paste the text you want to change…"
        outputPlaceholder="Type what to find — matches are highlighted below as you go."
        sample={SAMPLE}
        rows={14}
        controls={
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Find" error={fieldError}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                    placeholder={regex ? "\\bquick\\b" : "quick"}
                    className="font-mono"
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field
                label="Replace with"
                hint={
                  backreferences && regex
                    ? groups > 0
                      ? `Capture groups: $1 to $${groups}`
                      : "$1 and $2 need a capturing group in the pattern"
                    : "Literals only — the $ backreference option is off"
                }
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={replace}
                    onChange={(event) => setReplace(event.target.value)}
                    placeholder="slow"
                    className="font-mono"
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>

            <div className="grid gap-2.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5 sm:grid-cols-2 lg:grid-cols-3">
              <Checkbox
                label="Match case"
                checked={matchCase}
                onChange={(event) => setMatchCase(event.target.checked)}
              />
              <Checkbox
                label="Whole word only"
                checked={wholeWord}
                onChange={(event) => setWholeWord(event.target.checked)}
              />
              <Checkbox
                label="Regular expression"
                description="Turns the find field into a pattern"
                checked={regex}
                onChange={(event) => setRegex(event.target.checked)}
              />
              <Checkbox
                label="Multiline"
                description="^ and $ match at line boundaries"
                checked={multiline}
                onChange={(event) => setMultiline(event.target.checked)}
              />
              <Checkbox
                label="Use $1, $2 backreferences"
                description="Only meaningful in regex mode"
                checked={backreferences}
                onChange={(event) => setBackreferences(event.target.checked)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="secondary" disabled={!compiled.ok} onClick={() => run(false)}>
                <Replace aria-hidden="true" className="size-3.5" />
                Replace first
              </Button>
              <Button size="sm" variant="primary" disabled={!compiled.ok} onClick={() => run(true)}>
                <ReplaceAll aria-hidden="true" className="size-3.5" />
                Replace all
              </Button>
              <Button size="sm" variant="secondary" disabled={matches.matches.length === 0} onClick={extract}>
                <Rows3 aria-hidden="true" className="size-3.5" />
                Extract matches
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={resultText === null}
                onClick={reset}
              >
                <Undo2 aria-hidden="true" className="size-3.5" />
                Reset result
              </Button>
              {resultText !== null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setValue(resultText);
                    reset();
                    toast.info("Result moved into the editor");
                  }}
                >
                  Use result as the source
                </Button>
              ) : null}
            </div>

            {matches.truncated ? (
              <Notice tone="warning">
                There are more matches than can be listed one by one, so only the first{" "}
                {formatNumber(PREVIEW_LIMIT)} are highlighted in the preview. The count above is the
                real one, and replacement still covers every match.
              </Notice>
            ) : null}
          </div>
        }
        actions={
          value && find && compiled.ok ? (
            <section aria-label="Match preview" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-medium text-[var(--text-ink)]">
                  {formatNumber(matches.matches.length)} match
                  {matches.matches.length === 1 ? "" : "es"}
                  <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                    click a highlight to jump to it
                  </span>
                </h3>
                {matches.matches.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Previous match"
                      disabled={matches.matches.length < 2}
                      onClick={() => jumpTo((active - 1 + matches.matches.length) % matches.matches.length)}
                    >
                      <ChevronUp aria-hidden="true" className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Next match"
                      disabled={matches.matches.length < 2}
                      onClick={() => jumpTo((active + 1) % matches.matches.length)}
                    >
                      <ChevronDown aria-hidden="true" className="size-3.5" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Clear the search" onClick={() => setFind("")}>
                      <X aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
              <p
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[13px] leading-relaxed text-[var(--text-ink)]"
                onClick={(event) => {
                  const target = (event.target as HTMLElement).closest("mark[id]");
                  if (target?.id) setActive(Number(target.id.replace("match-", "")));
                }}
              >
                {preview ?? "No matches in this text."}
              </p>
            </section>
          ) : null
        }
      />
    </ToolShell>
  );
}
