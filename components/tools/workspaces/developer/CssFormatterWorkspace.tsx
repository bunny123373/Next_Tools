"use client";

import * as React from "react";
import { Info, ShieldCheck } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { formatCss, type CssFormatOptions, type TextOutcome } from "@/lib/tools/engines/dev";

const SAMPLE = `@media (min-width:600px){.card,.panel{color:#333;background : url("a,b.png")   no-repeat /* keep , me */;padding:8px 12px}}
/* Theme */
:root{--brand:red;--gap:4px}
.btn:hover > .icon + .label{background:rgb(0 0 0/8%)}
@supports (display:grid){.grid{display:grid;gap:var(--gap)}}`;

function toResult(outcome: TextOutcome | null): TextToolResult | null {
  if (!outcome) return null;
  return { text: outcome.text, error: outcome.error, stats: outcome.stats };
}

export default function CssFormatterWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [indent, setIndent] = React.useState(2);
  const [indentWithTab, setIndentWithTab] = React.useState(false);
  const [onePerLine, setOnePerLine] = React.useState(true);
  const [preserveComments, setPreserveComments] = React.useState(true);

  const options = React.useMemo<CssFormatOptions>(
    () => ({ indent, indentWithTab, oneDeclarationPerLine: onePerLine, preserveComments }),
    [indent, indentWithTab, onePerLine, preserveComments],
  );

  const outcome = React.useMemo<TextOutcome | null>(
    () => (value.trim() === "" ? null : formatCss(value, options)),
    [value, options],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={toResult(outcome)}
        outputName="formatted-css"
        extension="css"
        mime="text/css;charset=utf-8"
        inputLabel="CSS"
        outputLabel="Formatted CSS"
        inputPlaceholder=".a { color : red ; }"
        outputPlaceholder="The formatted stylesheet appears here as you type."
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
                label="One declaration per line"
                description="Off puts a rule's declarations on a single line."
                checked={onePerLine}
                onChange={(event) => setOnePerLine(event.target.checked)}
              />
              <Checkbox
                label="Keep comments"
                checked={preserveComments}
                onChange={(event) => setPreserveComments(event.target.checked)}
              />
            </div>
          </div>
        }
        actions={
          <div className="flex flex-col gap-2">
            {outcome?.notes?.map((note) => (
              <p
                key={note}
                className="flex items-start gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-muted)]"
              >
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {note}
              </p>
            ))}
            <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              The tokeniser reads quoted strings and comments as single opaque runs, so no spacing rule can
              reach inside <code className="font-mono">content: &quot;a,  b&quot;</code> or a comment body.
              The line above proves it: the space after the comma inside the string is still there.
            </p>
          </div>
        }
      />
    </ToolShell>
  );
}
