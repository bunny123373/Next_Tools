"use client";

import * as React from "react";
import { CalendarClock, Eraser, FlaskConical, Timer, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Stat } from "@/components/ui/form";
import { CopyButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import {
  COMMON_TIMEZONES,
  formatTimestampRows,
  parseTimestampInput,
  type TimestampRow,
} from "@/lib/tools/engines/dev";

const SAMPLE = "2026-02-16T09:30:00Z";

type Unit = "auto" | "seconds" | "milliseconds";

export default function TimestampConverterWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [unit, setUnit] = React.useState<Unit>("auto");
  const [timeZone, setTimeZone] = React.useState("Europe/London");
  const [now, setNow] = React.useState(0);

  // Gate every clock-dependent value behind mount, so the server HTML and the
  // first client render agree and React never reports a hydration mismatch.
  React.useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const parsed = React.useMemo(() => (value.trim() === "" ? null : parseTimestampInput(value, unit)), [value, unit]);
  const ms = parsed?.ok === true ? parsed.ms : null;
  const rows = React.useMemo<TimestampRow[]>(
    () => (ms === null ? [] : formatTimestampRows(ms, timeZone, now)),
    [ms, timeZone, now],
  );
  const live = React.useMemo(() => (now === 0 ? [] : formatTimestampRows(now, timeZone, now)), [now, timeZone]);

  const localZone = React.useMemo(() => {
    if (now === 0) return "";
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  }, [now]);

  const report = rows.map((row) => `${row.label}: ${row.value}`).join("\n");

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <section aria-label="Current time" className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
              <Timer aria-hidden="true" className="size-3.5" />
              Right now on this device
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (now === 0) return;
                setValue(String(Math.floor(now / 1000)));
                toast.info("Current Unix timestamp inserted — switch the unit to seconds if it is not detected");
              }}
            >
              Use this timestamp
            </Button>
          </div>
          {now === 0 ? (
            <p className="mt-1.5 font-mono text-[13px] text-[var(--text-muted)]">Starting the clock…</p>
          ) : (
            <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
              <div className="flex items-baseline gap-2">
                <dt className="w-24 shrink-0 text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">ISO 8601</dt>
                <dd className="font-mono text-[13px] text-[var(--text-ink)]">{new Date(now).toISOString()}</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="w-24 shrink-0 text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Local</dt>
                <dd className="font-mono text-[13px] text-[var(--text-ink)]">
                  {new Date(now).toLocaleString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="w-24 shrink-0 text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Seconds</dt>
                <dd className="font-mono text-[13px] text-[var(--text-ink)]">{Math.floor(now / 1000)}</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="w-24 shrink-0 text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Zone</dt>
                <dd className="font-mono text-[13px] text-[var(--text-ink)]">
                  {localZone || "UTC"} · {timeZone}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2">
          <Field
            label="A Unix timestamp or a date"
            hint="A number is read as seconds or milliseconds; anything else as a date string."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="1771134600 or 2026-02-16T09:30:00Z"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Number unit">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as Unit)}
                >
                  <option value="auto">Detect from digit count</option>
                  <option value="seconds">Seconds</option>
                  <option value="milliseconds">Milliseconds</option>
                </Select>
              )}
            </Field>
            <Field label="Show in">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={timeZone}
                  onChange={(event) => setTimeZone(event.target.value)}
                >
                  {COMMON_TIMEZONES.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.label} — {zone.id}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue(SAMPLE);
              toast.info("Sample loaded");
            }}
          >
            <FlaskConical aria-hidden="true" className="size-3.5" />
            Sample
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!value}
            onClick={() => {
              setValue("");
              toast.info("Cleared");
            }}
          >
            <Eraser aria-hidden="true" className="size-3.5" />
            Clear
          </Button>
          {ms !== null ? (
            <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {parsed?.ok ? parsed.detected : ""} · {formatNumber(new Date(ms).getTime())} ms
            </span>
          ) : null}
        </div>

        {value.trim() === "" ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Paste a timestamp or a date."
              description="Every format below is derived from the one moment in time you give it."
              icon={<CalendarClock className="size-5" />}
            />
          </div>
        ) : parsed && !parsed.ok ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-500" />
            <div>
              <p className="text-[13px] font-medium text-[var(--text-ink)]">That is not a moment in time.</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-ink)]">{parsed.error}</p>
            </div>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Unix seconds" value={String(Math.floor(ms! / 1000))} tone="brand" />
              <Stat label="Unix ms" value={String(ms!)} />
              <Stat
                label="Readable"
                value={new Date(ms!).toLocaleDateString(undefined, { dateStyle: "medium" })}
              />
              <Stat
                label="Day of year"
                value={String(Math.floor((ms! - Date.UTC(new Date(ms!).getUTCFullYear(), 0, 0)) / 86_400_000))}
              />
            </dl>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">
                  {formatNumber(rows.length)} representations
                </span>
                <CopyButton value={report} what="Every format copied" size="sm" variant="secondary" />
              </div>
              <div className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)]">
                <table className="w-full min-w-[34rem] border-collapse text-left">
                  <caption className="sr-only">The same instant in every common format</caption>
                  <thead>
                    <tr className="border-b border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                      <th
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]"
                      >
                        Format
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]"
                      >
                        Value
                      </th>
                      <th
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]"
                      >
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label} className="border-b border-[var(--surface-line)] last:border-0">
                        <th scope="row" className="whitespace-nowrap px-3 py-2 align-top text-[13px] font-medium text-[var(--text-ink)]">
                          {row.label}
                        </th>
                        <td className="px-3 py-2 align-top">
                          <span className="block font-mono text-[12px] break-all text-emerald-500">{row.value}</span>
                        </td>
                        <td className="px-3 py-2 align-top text-[11px] text-[var(--text-muted)]">
                          {row.note ?? ""}
                          <span className="sr-only"> </span>
                          <CopyButton value={row.value} what={`${row.label} copied`} size="sm" variant="ghost" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Notice tone="info">
              Detection uses the digit count: ten digits or fewer is read as <strong>seconds</strong>, because
              milliseconds for any plausible modern date run to thirteen. A 1970-era millisecond value
              (three digits) is therefore read as seconds — use the unit selector if that is what you have.
            </Notice>
          </>
        )}

        {live.length > 0 ? (
          <details className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <summary className="cursor-pointer text-[13px] font-medium text-[var(--text-ink)]">
              The current time in every format
            </summary>
            <dl className="mt-2.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {live.map((row) => (
                <div key={row.label} className="flex items-baseline gap-2">
                  <dt className="w-40 shrink-0 truncate text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
                    {row.label}
                  </dt>
                  <dd
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-[12px]",
                      row.label === "Relative" ? "text-[var(--text-muted)]" : "text-[var(--text-ink)]",
                    )}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </ToolShell>
  );
}
