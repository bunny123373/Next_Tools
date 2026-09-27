"use client";

import * as React from "react";
import { AlertTriangle, Info, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { Notice } from "@/components/tools/states";
import { formatJs, type JsFormatOptions, type TextOutcome } from "@/lib/tools/engines/dev";

const SAMPLE = `const config={retries:3,timeout:2500,headers:{'content-type':'application/json'}}
function fetchWithRetry(url,options={}){
  // One comment the formatter must not move
  const pattern=/^https?:\\/\\/[a-z.]+\\//i
  return fetch(url,options).then(function(res){
    if(!res.ok)throw new Error('HTTP '+res.status)
    return res.json()
  }).catch(err=>{console.error('failed',err);throw err})
}
class Store{
  items=[]
  add(item){this.items.push(item)}
}`;

function toResult(outcome: TextOutcome | null): TextToolResult | null {
  if (!outcome) return null;
  return { text: outcome.text, error: outcome.error, stats: outcome.stats };
}

export default function JavascriptFormatterWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [indent, setIndent] = React.useState(2);
  const [indentWithTab, setIndentWithTab] = React.useState(false);
  const [semicolons, setSemicolons] = React.useState<JsFormatOptions["semicolons"]>("ensure");
  const [quoteStyle, setQuoteStyle] = React.useState<JsFormatOptions["quoteStyle"]>("preserve");

  const options = React.useMemo<JsFormatOptions>(
    () => ({ indent, indentWithTab, semicolons, quoteStyle }),
    [indent, indentWithTab, semicolons, quoteStyle],
  );

  const outcome = React.useMemo<TextOutcome | null>(
    () => (value.trim() === "" ? null : formatJs(value, options)),
    [value, options],
  );

  return (
    <ToolShell>
      <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="Lightweight, and deliberately not a parser.">
        This is a <strong>token-based</strong> formatter. It normalises indentation and horizontal spacing
        while keeping your line breaks exactly where you put them. It does not build a syntax tree, so it
        will not join a wrapped statement, re-wrap a long one, or reorder anything. For production-grade
        formatting use a real tool such as Prettier or Biome — this is here to tidy a pasted snippet
        without round-tripping it through something that might rewrite it.
      </Notice>

      <div className="mt-4">
        <TextWorkbench
          value={value}
          onChange={setValue}
          result={toResult(outcome)}
          outputName="formatted-js"
          extension="js"
          mime="text/javascript;charset=utf-8"
          inputLabel="JavaScript"
          outputLabel="Formatted JavaScript"
          inputPlaceholder="const a=1;function f(x){return x*2}"
          outputPlaceholder="The formatted code appears here as you type."
          sample={SAMPLE}
          controls={
            <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Field label="Indent width">
                  {({ id }) => (
                    <Select id={id} value={String(indent)} onChange={(event) => setIndent(Number(event.target.value))}>
                      <option value="2">2 spaces</option>
                      <option value="4">4 spaces</option>
                      <option value="8">8 spaces</option>
                    </Select>
                  )}
                </Field>
                <Checkbox
                  label="Indent with tabs"
                  checked={indentWithTab}
                  onChange={(event) => setIndentWithTab(event.target.checked)}
                />
              </div>
              <div className="flex flex-col gap-3">
                <Field label="Semicolons" hint="Never removes one; only adds what looks missing.">
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={semicolons}
                      onChange={(event) => setSemicolons(event.target.value as JsFormatOptions["semicolons"])}
                    >
                      <option value="keep">Leave exactly as written</option>
                      <option value="ensure">Add where they look missing</option>
                    </Select>
                  )}
                </Field>
                <Field label="Quote style" hint="Only applied to strings with no escape sequences.">
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={quoteStyle}
                      onChange={(event) => setQuoteStyle(event.target.value as JsFormatOptions["quoteStyle"])}
                    >
                      <option value="preserve">Preserve what you wrote</option>
                      <option value="double">Prefer double quotes</option>
                      <option value="single">Prefer single quotes</option>
                    </Select>
                  )}
                </Field>
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
              <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
                <p className="text-[13px] font-medium text-[var(--text-ink)]">Known limits, stated plainly</p>
                <ul className="mt-2 grid gap-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
                  <li>
                    • Telling <code className="font-mono">/</code> (division) from{" "}
                    <code className="font-mono">/regex/</code> uses the previous token plus a brace/paren
                    stack. It is right for normal code, but it is a heuristic and an exotic file could
                    fool it.
                  </li>
                  <li>
                    • JSX and TypeScript-only syntax (<code className="font-mono">type X =</code>, generics,{" "}
                    <code className="font-mono">&lt;Component /&gt;</code>) is treated as ordinary operators.
                    The output is still spaced consistently, but it is not idiomatic for those languages.
                  </li>
                  <li>
                    • Semicolon insertion only fires at the end of a line, inside a real block, and never
                    after{" "}
                    <code className="font-mono">else</code>, <code className="font-mono">catch</code> or an
                    operator.
                  </li>
                </ul>
              </div>
            </div>
          }
        />
      </div>
    </ToolShell>
  );
}
