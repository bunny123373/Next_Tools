"use client";

import * as React from "react";
import { Info, Database } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { SQL_DIALECTS, formatSql, type SqlDialect, type SqlFormatOptions, type TextOutcome } from "@/lib/tools/engines/dev";

const SAMPLE = `-- Orders that need chasing, per customer
select u.id, u.name, count(*) as order_count, max(o.placed_at) as last_order
from users u
left join orders o on o.user_id = u.id
where u.active = 1 and o.total > 100 -- big spender
group by u.id, u.name having count(*) > 2 order by order_count desc limit 20`;

const DIALECT_LABEL: Record<SqlDialect, string> = {
  standard: "ANSI / Standard SQL",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

function toResult(outcome: TextOutcome | null): TextToolResult | null {
  if (!outcome) return null;
  return { text: outcome.text, error: outcome.error, stats: outcome.stats };
}

export default function SqlFormatterWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [dialect, setDialect] = React.useState<SqlDialect>("postgres");
  const [indent, setIndent] = React.useState(2);
  const [indentWithTab, setIndentWithTab] = React.useState(false);
  const [keywordCase, setKeywordCase] = React.useState<SqlFormatOptions["keywordCase"]>("upper");
  const [oneColumnPerLine, setOneColumnPerLine] = React.useState(false);

  const options = React.useMemo<SqlFormatOptions>(
    () => ({ dialect, indent, indentWithTab, keywordCase, oneColumnPerLine }),
    [dialect, indent, indentWithTab, keywordCase, oneColumnPerLine],
  );

  const outcome = React.useMemo<TextOutcome | null>(
    () => (value.trim() === "" ? null : formatSql(value, options)),
    [value, options],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={toResult(outcome)}
        outputName="formatted-sql"
        extension="sql"
        mime="text/plain;charset=utf-8"
        inputLabel="SQL"
        outputLabel="Formatted SQL"
        inputPlaceholder="select a, b from t where a = 1"
        outputPlaceholder="The formatted query appears here as you type."
        sample={SAMPLE}
        controls={
          <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Dialect" hint="Decides which words are keywords, and so which get re-cased.">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={dialect}
                  onChange={(event) => setDialect(event.target.value as SqlDialect)}
                >
                  {SQL_DIALECTS.map((entry) => (
                    <option key={entry} value={entry}>
                      {DIALECT_LABEL[entry]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Keyword case">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={keywordCase}
                  onChange={(event) => setKeywordCase(event.target.value as SqlFormatOptions["keywordCase"])}
                >
                  <option value="upper">UPPERCASE</option>
                  <option value="lower">lowercase</option>
                  <option value="preserve">Leave as written</option>
                </Select>
              )}
            </Field>
            <Field label="Indent width">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={String(indent)}
                  onChange={(event) => setIndent(Number(event.target.value))}
                >
                  <option value="2">2 spaces</option>
                  <option value="4">4 spaces</option>
                </Select>
              )}
            </Field>
            <div className="flex flex-col justify-center gap-2 sm:col-span-2 lg:col-span-3">
              <Checkbox
                label="One selected column per line"
                description="Breaks a select or values list across lines, the way most style guides ask for."
                checked={oneColumnPerLine}
                onChange={(event) => setOneColumnPerLine(event.target.checked)}
              />
              <Checkbox
                label="Indent with tabs"
                checked={indentWithTab}
                onChange={(event) => setIndentWithTab(event.target.checked)}
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
              <Database aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              The sample above contains a <code className="font-mono">--</code> line comment and a doubled
              single quote. Both survive untouched: the tokeniser reads them as single units before any
              spacing rule sees the query.
            </p>
          </div>
        }
      />
    </ToolShell>
  );
}
