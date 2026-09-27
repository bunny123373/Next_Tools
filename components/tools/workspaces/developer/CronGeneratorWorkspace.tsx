"use client";

import * as React from "react";
import { CalendarClock, Copy, Eraser, Play, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Stat } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import {
  CRON_FIELDS,
  CRON_FIELDS_WITH_SECONDS,
  CRON_PRESETS,
  cronNextRuns,
  describeCron,
  parseCron,
} from "@/lib/tools/engines/dev";

const SAMPLE = "0 9 * * 1-5";

type Builder = "presets" | "fields" | "paste";

export default function CronGeneratorWorkspace() {
  const [mode, setMode] = React.useState<Builder>("presets");
  const [expression, setExpression] = React.useState(SAMPLE);
  const [hasSeconds, setHasSeconds] = React.useState(false);
  const [fields, setFields] = React.useState<Record<string, string>>({
    minute: "0",
    hour: "9",
    "day of month": "*",
    month: "*",
    "day of week": "1-5",
  });

  const applyFields = (next: Record<string, string>, seconds: boolean): void => {
    setFields(next);
    setHasSeconds(seconds);
    const specs = seconds ? CRON_FIELDS_WITH_SECONDS : CRON_FIELDS;
    const built = specs
      .map((spec) => (spec.label === "second" ? (next.second ?? "0") : next[spec.label] ?? "*"))
      .join(" ");
    setExpression(built);
  };

  const applyPreset = (preset: string): void => {
    setExpression(preset);
    setMode("paste");
    const parsed = parseCron(preset);
    if (parsed.ok) {
      const specs = parsed.cron.hasSeconds ? CRON_FIELDS_WITH_SECONDS : CRON_FIELDS;
      const next: Record<string, string> = {};
      parsed.cron.fields.forEach((field, index) => {
        next[specs[index]!.label] = field;
      });
      setFields(next);
      setHasSeconds(parsed.cron.hasSeconds);
    }
  };

  const parsed = React.useMemo(() => parseCron(expression), [expression]);
  const runs = React.useMemo(
    () => cronNextRuns(expression, 10, new Date()),
    [expression],
  );
  const description = React.useMemo(() => describeCron(expression), [expression]);

  const fieldSpecs = hasSeconds ? CRON_FIELDS_WITH_SECONDS : CRON_FIELDS;

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["presets", "fields", "paste"] as const).map((entry) => (
            <Button
              key={entry}
              size="sm"
              variant={mode === entry ? "primary" : "secondary"}
              onClick={() => setMode(entry)}
            >
              {entry === "presets" ? "Presets" : entry === "fields" ? "Build field by field" : "Paste or edit"}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setExpression("");
              setMode("paste");
            }}
            disabled={expression === ""}
          >
            <Eraser aria-hidden="true" className="size-3.5" />
            Clear
          </Button>
        </div>

        {mode === "presets" ? (
          <section aria-label="Common schedules" className="flex flex-col gap-2">
            <p className="text-[13px] text-[var(--text-muted)]">
              Start from a schedule people actually use, then edit any field below.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {CRON_PRESETS.map((preset) => (
                <li key={preset.expression}>
                  <button
                    type="button"
                    onClick={() => applyPreset(preset.expression)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-[10px] border px-3.5 py-2.5 text-left transition-colors duration-150",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                      expression === preset.expression
                        ? "border-brand-500/40 bg-brand-500/[0.06]"
                        : "border-[var(--surface-line)] bg-[var(--surface-card-2)] hover:border-[var(--surface-line-strong)]",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--text-ink)]">{preset.label}</span>
                      <code className="rounded bg-[var(--surface-card)] px-1.5 py-0.5 font-mono text-[11px] text-brand-500">
                        {preset.expression}
                      </code>
                    </span>
                    <span className="text-[12px] leading-relaxed text-[var(--text-muted)]">{preset.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : mode === "fields" ? (
          <section aria-label="Field builder" className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <label className="flex items-center gap-2.5 text-[13px] text-[var(--text-ink)]">
              <input
                type="checkbox"
                checked={hasSeconds}
                onChange={(event) => applyFields(fields, event.target.checked)}
                className="size-4 accent-[var(--color-brand-500,#FF3B30)]"
              />
              Include a seconds field (6-field syntax)
            </label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fieldSpecs.map((spec) => {
                const value = spec.label === "second" ? (fields.second ?? "0") : (fields[spec.label] ?? "*");
                return (
                  <Field
                    key={spec.label}
                    label={spec.label}
                    hint={`${spec.min}–${spec.max}${spec.names ? ` · ${Object.keys(spec.names).slice(0, 4).join(", ")}…` : ""}`}
                  >
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        value={value}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(event) => applyFields({ ...fields, [spec.label]: event.target.value }, hasSeconds)}
                        className="font-mono"
                      />
                    )}
                  </Field>
                );
              })}
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              Each field accepts <code className="font-mono">*</code>, a number, a range like{" "}
              <code className="font-mono">9-17</code>, a list like <code className="font-mono">1,15</code>,
              or a step like <code className="font-mono">*/15</code>. Anything invalid is reported below
              rather than silently ignored.
            </p>
          </section>
        ) : null}

        <section aria-label="Expression" className="flex flex-col gap-2">
          <Field label="Cron expression" error={parsed.ok ? null : parsed.error}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={expression}
                onChange={(event) => {
                  setExpression(event.target.value);
                  setMode("paste");
                }}
                placeholder="0 9 * * 1-5"
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-[15px]"
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton value={expression || null} what="Expression copied" size="sm" variant="secondary" />
            {parsed.ok ? (
              <span className="flex items-center gap-1.5 text-[12px] text-emerald-500">
                <Play aria-hidden="true" className="size-3.5" />
                {parsed.cron.hasSeconds ? "6 fields" : "5 fields"} · {parsed.cron.fields.length} read
              </span>
            ) : null}
          </div>
        </section>

        {parsed.ok ? (
          <>
            <Notice tone="success" icon={<CalendarClock className="size-4" />} title="In plain English">
              {description}
            </Notice>

            <section aria-label="Next runs" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Next 10 runs</span>
                <div className="flex items-center gap-1.5">
                  <CopyButton
                    value={runs.ok ? runs.runs.map((run) => run.iso).join("\n") : null}
                    what="Next runs copied"
                    size="sm"
                    variant="ghost"
                  />
                  <DownloadButton
                    text={runs.ok ? runs.runs.map((run) => `${run.iso}  ${run.label}`).join("\n") : ""}
                    filename="cron-runs.txt"
                    mime="text/plain;charset=utf-8"
                    label="Download"
                    size="sm"
                    variant="ghost"
                  />
                </div>
              </div>
              {runs.ok ? (
                <>
                  <ol className="grid gap-1.5 sm:grid-cols-2">
                    {runs.runs.map((run, index) => (
                      <li
                        key={run.ms}
                        className="flex items-center gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2"
                      >
                        <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text-ink)]">
                          {run.label}
                        </span>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Copy the ISO time of run ${index + 1}`}
                          onClick={() => void toast.copy(run.iso, "Run time copied")}
                        >
                          <Copy aria-hidden="true" className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                  {runs.truncated ? (
                    <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-500">
                      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      Only {runs.runs.length} run{runs.runs.length === 1 ? "" : "s"} exist within the next
                      forty years for this schedule, so the list is short rather than infinite. That usually
                      means a rare field combination, such as 29 February.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-[13px] text-[var(--text-muted)]">{runs.error}</p>
              )}
            </section>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Fields" value={String(parsed.cron.fields.length)} />
              <Stat label="Has seconds" value={parsed.cron.hasSeconds ? "yes" : "no"} />
              <Stat label="Day-of-month restricted" value={parsed.cron.domRestricted ? "yes" : "no"} />
              <Stat label="Day-of-week restricted" value={parsed.cron.dowRestricted ? "yes" : "no"} />
            </dl>

            <Notice tone="info" title="Day-of-month and day-of-week combine with OR.">
              When both the day-of-month and day-of-week fields are restricted, standard cron fires on days
              that match <em>either</em> of them — not both. So <code className="font-mono">0 0 1 * 1</code>{" "}
              means &quot;the 1st, and every Monday&quot;, not &quot;Mondays that fall on the 1st&quot;.
            </Notice>
          </>
        ) : (
          <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-500" />
            <div>
              <p className="text-[13px] font-medium text-[var(--text-ink)]">That expression is not valid.</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-ink)]">{parsed.error}</p>
            </div>
          </div>
        )}

        {mode === "paste" && expression === "" ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Paste a cron expression."
              description="Five fields, or six with a leading seconds field. You will get a description and the next ten run times."
            />
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
