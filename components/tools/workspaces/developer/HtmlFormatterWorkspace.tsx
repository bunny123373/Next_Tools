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
import { formatHtml, type HtmlFormatOptions, type TextOutcome } from "@/lib/tools/engines/dev";

const SAMPLE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Order 4821</title>
<style>.card{border:1px solid #ddd;padding:12px}</style></head>
<body>
<main class="card">
<h1>Order &amp; receipt</h1>
<p>Thanks for your order. It will ship <strong>tomorrow</strong> &mdash; no need to do anything.</p>
<!-- The tracker link is added by the client app -->
<ul class="items"><li data-sku="A-1">Widget <em>x2</em></li><li data-sku="B-7">Gadget</li></ul>
<pre>
  keep    this
     exactly
</pre>
<script>console.log("not reflowed");</script>
</main>
</body>
</html>`;

function toResult(outcome: TextOutcome | null): TextToolResult | null {
  if (!outcome) return null;
  return { text: outcome.text, error: outcome.error, stats: outcome.stats };
}

export default function HtmlFormatterWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [indent, setIndent] = React.useState(2);
  const [indentWithTab, setIndentWithTab] = React.useState(false);
  const [wrapAttributes, setWrapAttributes] = React.useState(true);
  const [collapseEmpty, setCollapseEmpty] = React.useState(true);
  const [sortAttributes, setSortAttributes] = React.useState(false);

  const options = React.useMemo<HtmlFormatOptions>(
    () => ({ indent, indentWithTab, wrapAttributes, collapseEmpty, sortAttributes }),
    [indent, indentWithTab, wrapAttributes, collapseEmpty, sortAttributes],
  );

  const outcome = React.useMemo<TextOutcome | null>(
    () => (value.trim() === "" ? null : formatHtml(value, options)),
    [value, options],
  );

  return (
    <ToolShell>
      <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="A formatter, not a validator.">
        The browser&apos;s HTML parser repairs broken markup before this tool sees it, so an unclosed tag
        comes back tidy rather than rejected. It will never tell you the HTML was invalid — for that, run
        it through a real HTML validator.
      </Notice>

      <div className="mt-4">
        <TextWorkbench
          value={value}
          onChange={setValue}
          result={toResult(outcome)}
          outputName="formatted-html"
          extension="html"
          mime="text/html;charset=utf-8"
          inputLabel="HTML"
          outputLabel="Formatted HTML"
          inputPlaceholder="<main><h1>Title</h1><p>Body</p></main>"
          outputPlaceholder="The formatted document appears here as you type."
          sample={SAMPLE}
          controls={
            <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2">
              <Field label="Indent width" hint="Spaces per nesting level.">
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={String(indent)}
                    onChange={(event) => setIndent(Number(event.target.value))}
                  >
                    <option value="1">1 space</option>
                    <option value="2">2 spaces</option>
                    <option value="3">3 spaces</option>
                    <option value="4">4 spaces</option>
                  </Select>
                )}
              </Field>
              <div className="flex flex-col justify-center gap-2">
                <Checkbox
                  label="Indent with tabs"
                  checked={indentWithTab}
                  onChange={(event) => setIndentWithTab(event.target.checked)}
                />
                <Checkbox
                  label="Wrap long attribute lists"
                  checked={wrapAttributes}
                  onChange={(event) => setWrapAttributes(event.target.checked)}
                />
              </div>
              <div className="flex flex-col justify-center gap-2 sm:col-span-2">
                <Checkbox
                  label="Collapse empty elements onto one line"
                  description="Removes the stray whitespace-only text node an indented blank line creates."
                  checked={collapseEmpty}
                  onChange={(event) => setCollapseEmpty(event.target.checked)}
                />
                <Checkbox
                  label="Sort attributes"
                  description="Puts them in a stable alphabetical order."
                  checked={sortAttributes}
                  onChange={(event) => setSortAttributes(event.target.checked)}
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
      </div>
    </ToolShell>
  );
}
