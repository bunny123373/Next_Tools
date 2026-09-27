"use client";

import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { formatXml, type TextOutcome, type XmlFormatOptions } from "@/lib/tools/engines/dev";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog version="2.1" updated="2026-01-12">
  <!-- Featured items, in no particular order -->
  <book id="b1" lang="en"><title>The Analytical Engine</title><author>Ada Lovelace</author><price currency="GBP">42.50</price><note><![CDATA[Keep <this> exactly as written.]]></note></book>
  <book id="b2" lang="en"><title>Notes on the Engine</title><author>Ada Lovelace</author><price currency="GBP">18.00</price></book>
  <meta>
    <count>2</count>
    <generated>2026-01-12T09:00:00Z</generated>
  </meta>
</catalog>`;

function toResult(outcome: TextOutcome | null): TextToolResult | null {
  if (!outcome) return null;
  return { text: outcome.text, error: outcome.error, stats: outcome.stats };
}

export default function XmlFormatterWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [indent, setIndent] = React.useState(2);
  const [indentWithTab, setIndentWithTab] = React.useState(false);
  const [wrapAttributes, setWrapAttributes] = React.useState(true);
  const [selfCloseEmpty, setSelfCloseEmpty] = React.useState(true);
  const [preserveCdata, setPreserveCdata] = React.useState(true);
  const [sortAttributes, setSortAttributes] = React.useState(false);
  const [declaration, setDeclaration] = React.useState<XmlFormatOptions["declaration"]>("keep");

  const options = React.useMemo<XmlFormatOptions>(
    () => ({ indent, indentWithTab, wrapAttributes, selfCloseEmpty, preserveCdata, sortAttributes, declaration }),
    [indent, indentWithTab, wrapAttributes, selfCloseEmpty, preserveCdata, sortAttributes, declaration],
  );

  const outcome = React.useMemo<TextOutcome | null>(
    () => (value.trim() === "" ? null : formatXml(value, options)),
    [value, options],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={toResult(outcome)}
        outputName="formatted-xml"
        extension="xml"
        mime="application/xml;charset=utf-8"
        inputLabel="XML"
        outputLabel="Formatted XML"
        inputPlaceholder="<root><child attr=&quot;1&quot;>text</child></root>"
        outputPlaceholder="The formatted document appears here as you type."
        sample={SAMPLE}
        controls={
          <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <Field label="XML declaration" hint="The <?xml …?> prolog.">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={declaration}
                  onChange={(event) => setDeclaration(event.target.value as XmlFormatOptions["declaration"])}
                >
                  <option value="keep">Keep it if present</option>
                  <option value="drop">Remove it</option>
                  <option value="ensure">Always add one</option>
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
            <div className="flex flex-col justify-center gap-2">
              <Checkbox
                label="Self-close empty elements"
                description="&lt;meta/&gt; instead of &lt;meta&gt;&lt;/meta&gt;."
                checked={selfCloseEmpty}
                onChange={(event) => setSelfCloseEmpty(event.target.checked)}
              />
              <Checkbox
                label="Preserve CDATA verbatim"
                checked={preserveCdata}
                onChange={(event) => setPreserveCdata(event.target.checked)}
              />
            </div>
            <div className="flex flex-col justify-center gap-2">
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
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              Parsed with the browser&apos;s own XML parser, which follows the XML 1.0 specification
              strictly. Unlike HTML, XML has no error recovery: an unclosed tag, a stray character or a
              second root element is rejected with a line and column rather than guessed at.
            </p>
          </div>
        }
      />
    </ToolShell>
  );
}
