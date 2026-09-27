"use client";

import * as React from "react";
import { AlertTriangle, Info, TrendingDown } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Checkbox } from "@/components/ui/form";
import { minifyJson, type JsonMinifyOptions, type TextOutcome } from "@/lib/tools/engines/dev";

const SAMPLE = `{
  "id": 7,
  "name": "Ada Lovelace",
  "active": true,
  "roles": ["admin", "editor"],
  "profile": { "city": "London", "timezone": "Europe/London" },
  "createdAt": "2026-01-05T09:30:00Z"
}`;

function toResult(outcome: TextOutcome | null): TextToolResult | null {
  if (!outcome) return null;
  return { text: outcome.text, error: outcome.error, stats: outcome.stats };
}

export default function JsonMinifierWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [sortKeys, setSortKeys] = React.useState(false);
  const [stripControlChars, setStripControlChars] = React.useState(true);

  const outcome = React.useMemo<TextOutcome | null>(
    () => (value.trim() === "" ? null : minifyJson(value, { sortKeys, stripControlChars } satisfies JsonMinifyOptions)),
    [value, sortKeys, stripControlChars],
  );

  const saved = outcome?.stats?.find((stat) => stat.label === "Saved")?.value ?? "—";

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={toResult(outcome)}
        outputName="minified-json"
        extension="json"
        mime="application/json;charset=utf-8"
        inputLabel="JSON"
        outputLabel="Minified JSON"
        inputPlaceholder="Paste the JSON you want to shrink."
        outputPlaceholder="The minified document appears here as you type."
        sample={SAMPLE}
        controls={
          <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
            <div className="flex flex-col gap-2">
              <Checkbox
                label="Sort object keys"
                description="Makes the output stable across rebuilds. Arrays are untouched."
                checked={sortKeys}
                onChange={(event) => setSortKeys(event.target.checked)}
              />
              <Checkbox
                label="Strip control characters"
                description="Removes anything below U+0020 other than tab, newline and carriage return. U+007F is also removed."
                checked={stripControlChars}
                onChange={(event) => setStripControlChars(event.target.checked)}
              />
            </div>
            <p className="flex items-center gap-1.5 font-mono text-[13px] font-semibold tabular-nums text-emerald-500">
              <TrendingDown aria-hidden="true" className="size-4" />
              {saved} smaller
            </p>
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
              Minification is lossless for JSON: no key, value or string is altered. It removes only the
              whitespace the format never needed.
            </p>
          </div>
        }
      />
    </ToolShell>
  );
}
