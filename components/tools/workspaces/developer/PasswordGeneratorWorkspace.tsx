"use client";

import * as React from "react";
import { Copy, RefreshCw, ShieldCheck, Trash2, TriangleAlert, Unlock } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Slider, Stat } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import {
  ATTACK_MODELS,
  clampPasswordLength,
  crackTimeSeconds,
  formatCrackTime,
  generatePasswords,
  passwordPools,
  passwordStats,
  passwordStrength,
  passwordsToCsv,
  type PasswordOptions,
  type PasswordSetId,
  type PasswordStrength,
} from "@/lib/tools/engines/dev";

const LENGTH_PRESETS = [8, 12, 16, 20, 32, 64] as const;
const MAX_SLIDER_LENGTH = 128;
const MAX_COUNT = 100;

const SET_LABELS: readonly { id: PasswordSetId; label: string; pool: string }[] = [
  { id: "lowercase", label: "Lowercase", pool: "a–z" },
  { id: "uppercase", label: "Uppercase", pool: "A–Z" },
  { id: "digits", label: "Digits", pool: "0–9" },
  { id: "symbols", label: "Symbols", pool: "!#$%&()*+,-./:;<=>?@[]^_{|}~" },
];

const STRENGTH_ORDER: readonly PasswordStrength[] = [
  "very-weak",
  "weak",
  "fair",
  "strong",
  "very-strong",
];

const STRENGTH_COPY: Record<PasswordStrength, { label: string; tone: string; bar: string }> = {
  "very-weak": {
    label: "Very weak",
    tone: "text-brand-500",
    bar: "bg-brand-500",
  },
  weak: { label: "Weak", tone: "text-amber-500", bar: "bg-amber-500" },
  fair: { label: "Fair", tone: "text-sky-500", bar: "bg-sky-500" },
  strong: { label: "Strong", tone: "text-emerald-500", bar: "bg-emerald-500" },
  "very-strong": { label: "Very strong", tone: "text-emerald-500", bar: "bg-emerald-400" },
};

export default function PasswordGeneratorWorkspace() {
  const [length, setLength] = React.useState(20);
  const [count, setCount] = React.useState(5);
  const [sets, setSets] = React.useState({
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
  });
  const [avoidAmbiguous, setAvoidAmbiguous] = React.useState(false);
  const [requireEverySet, setRequireEverySet] = React.useState(true);
  const [exclude, setExclude] = React.useState("");
  /** Bumped by the Generate button to draw a fresh batch without an effect. */
  const [seed, setSeed] = React.useState(0);

  const options: PasswordOptions = React.useMemo(
    () => ({ length, sets, avoidAmbiguous, requireEverySet, exclude }),
    [length, sets, avoidAmbiguous, requireEverySet, exclude],
  );

  const pools = React.useMemo(() => passwordPools(options), [options]);
  const stats = React.useMemo(() => passwordStats(options), [options]);

  /**
   * `seed` is not read here, but it is in the dependency list on purpose: it is
   * what makes Generate produce a *different* batch rather than re-deriving the
   * same one from the same settings.
   */
  const passwords = React.useMemo(
    () => generatePasswords(count, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, options, seed],
  );

  const effectiveLength = clampPasswordLength(length, pools.length, requireEverySet);
  const strength = passwordStrength(stats.bits);
  const strengthIndex = STRENGTH_ORDER.indexOf(strength);
  const strengthCopy = STRENGTH_COPY[strength];

  /** The distinct blocklist characters as typed, for the hint under the field. */
  const typedExclusions = React.useMemo(
    () => [...new Set(exclude)].filter((char) => char.trim().length > 0),
    [exclude],
  );

  const regenerate = React.useCallback(() => {
    setSeed((current) => current + 1);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      regenerate();
    }
  };

  const toggleSet = (id: PasswordSetId): void => {
    setSets((current) => ({ ...current, [id]: !current[id] }));
  };

  const text = passwords.join("\n");

  return (
    <ToolShell>
      <div className="flex flex-col gap-4" onKeyDown={onKeyDown} role="group" aria-label="Password generator">
        <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2">
          <Field
            label="Length"
            hint={`${formatNumber(effectiveLength)} characters${
              effectiveLength > length ? " — raised to fit one of every selected set" : ""
            }.`}
            action={
              <div className="flex gap-1">
                {LENGTH_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    variant={effectiveLength === preset ? "secondary" : "ghost"}
                    aria-pressed={effectiveLength === preset}
                    onClick={() => setLength(preset)}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            }
          >
            {({ id, describedBy }) => (
              <div className="flex items-center gap-3">
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={4}
                  max={MAX_SLIDER_LENGTH}
                  value={length}
                  onChange={(event) => setLength(Number(event.target.value))}
                  className="flex-1"
                />
                <output
                  htmlFor={id}
                  className="w-12 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-[var(--text-ink)]"
                >
                  {effectiveLength}
                </output>
              </div>
            )}
          </Field>

          <Field
            label="How many"
            hint={`Between 1 and ${MAX_COUNT} per run.`}
          >
            {({ id, describedBy }) => (
              <div className="flex items-center gap-3">
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={1}
                  max={MAX_COUNT}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  className="flex-1"
                />
                <output
                  htmlFor={id}
                  className="w-12 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-[var(--text-ink)]"
                >
                  {count}
                </output>
              </div>
            )}
          </Field>
        </div>

        <fieldset className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <legend className="px-1 text-[13px] font-medium text-[var(--text-ink)]">Character classes</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SET_LABELS.map((set) => {
              const pool = pools.find((entry) => entry.id === set.id);
              const empty = sets[set.id] && !pool;
              return (
                <div
                  key={set.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                    sets[set.id]
                      ? "border-brand-500/30 bg-brand-500/[0.05]"
                      : "border-[var(--surface-line)]",
                  )}
                >
                  <Checkbox
                    label={set.label}
                    description={
                      empty
                        ? "Everything here was excluded by your filters, so it contributes nothing."
                        : pool
                          ? `${formatNumber(pool.chars.length)} characters available`
                          : set.pool
                    }
                    checked={sets[set.id]}
                    onChange={() => toggleSet(set.id)}
                    className="flex-1"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-[var(--surface-line)] pt-3">
            <Checkbox
              label="Require at least one of each"
              description={
                requireEverySet && pools.length > 0
                  ? `Guarantees ${pools.length} of ${formatNumber(pools.length)} class${
                      pools.length === 1 ? "" : "es"
                    } appears. This costs a little entropy, and the count below shows by how much.`
                  : "Guarantees every selected class appears at least once."
              }
              checked={requireEverySet}
              onChange={(event) => setRequireEverySet(event.target.checked)}
            />
            <Checkbox
              label="Avoid characters that get misread"
              description="Drops I l 1 O 0 o | and the quote family — the characters that turn into a typo when a password is read aloud."
              checked={avoidAmbiguous}
              onChange={(event) => setAvoidAmbiguous(event.target.checked)}
            />
            <Field
              label="Characters to exclude"
              hint={
                typedExclusions.length === 0
                  ? "Useful for quoting rules: drop ' or \" to get a password safe to paste into YAML."
                  : `${formatNumber(typedExclusions.length)} excluded: ${typedExclusions.join(" ")}`
              }
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={exclude}
                  maxLength={32}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={'e.g. \'"'}
                  onChange={(event) => setExclude(event.target.value)}
                  className="font-mono"
                />
              )}
            </Field>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={regenerate} disabled={pools.length === 0}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Generate {count > 1 ? formatNumber(count) : ""}
          </Button>
          <span className="text-[11px] text-[var(--text-muted)]">
            or press{" "}
            <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">
              Ctrl + Enter
            </kbd>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <CopyButton
              value={text || null}
              what={`${passwords.length} password${passwords.length === 1 ? "" : "s"} copied`}
              size="sm"
              variant="secondary"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSeed(0)}
              disabled={seed === 0 && passwords.length === 0}
              aria-label="Discard the current passwords"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>

        {pools.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Nothing left to pick from."
              description="Every character class you selected is switched off, or your exclusion list removes all of them. Turn one back on to generate a password."
              icon={<TriangleAlert className="size-5" />}
            />
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Length" value={formatNumber(effectiveLength)} hint="characters" />
              <Stat
                label="Entropy"
                value={`${formatNumber(Math.round(stats.bits))} bits`}
                hint={stats.pinned > 0 ? `${stats.pinned} character${stats.pinned === 1 ? "" : "s"} pinned to a class` : "uniform over the alphabet"}
                tone="brand"
              />
              <Stat
                label="Alphabet"
                value={formatNumber(stats.alphabet)}
                hint={`${formatNumber(Math.round(stats.perChar * 100) / 100)} bits per character`}
              />
              <div className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
                <dt className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                  Strength
                </dt>
                <dd className={cn("mt-1 font-mono text-[15px] font-semibold tabular-nums", strengthCopy.tone)}>
                  {strengthCopy.label}
                </dd>
                {/* The label above carries the meaning; the bar is decoration only. */}
                <div aria-hidden="true" className="mt-1.5 flex gap-1">
                  {STRENGTH_ORDER.map((band, index) => (
                    <span
                      key={band}
                      className={cn(
                        "h-1 flex-1 rounded-full bg-[var(--surface-line)]",
                        index <= strengthIndex && strengthCopy.bar,
                      )}
                    />
                  ))}
                </div>
              </div>
            </dl>

            <ul className="flex flex-col gap-2" aria-label={`${passwords.length} generated passwords`}>
              {passwords.map((password, index) => (
                <li
                  key={`${password}-${index}`}
                  className="flex items-center gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2.5 py-2"
                >
                  <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                    {index + 1}
                  </span>
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[13px] text-[var(--text-ink)]">
                    {password}
                  </code>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Copy password ${index + 1}`}
                    onClick={() => void toast.copy(password, "Password copied")}
                  >
                    <Copy aria-hidden="true" className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              <DownloadButton
                text={text}
                filename="passwords.txt"
                mime="text/plain;charset=utf-8"
                label="Download .txt"
                size="sm"
                variant="secondary"
              />
              <DownloadButton
                text={passwordsToCsv(passwords, options)}
                filename="passwords.csv"
                mime="text/csv;charset=utf-8"
                label="Download .csv"
                size="sm"
                variant="secondary"
              />
            </div>

            <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
              <h3 className="text-[13px] font-medium text-[var(--text-ink)]">
                Time to crack, if the attacker is patient
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                Average time to find one password of this strength. Every figure is an average over the keyspace —
                one particular password can fall much earlier.
              </p>
              <dl className="mt-2.5 flex flex-col gap-1.5">
                {ATTACK_MODELS.map((model) => (
                  <div
                    key={model.id}
                    className="flex flex-col gap-0.5 rounded-lg border border-[var(--surface-line)] px-2.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                  >
                    <dt className="text-[12px] text-[var(--text-ink)]">
                      {model.label}
                      <span className="block text-[11px] text-[var(--text-muted)]">{model.note}</span>
                    </dt>
                    <dd className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-brand-500">
                      {formatCrackTime(crackTimeSeconds(stats.bits, model.rate))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <Notice tone="success" icon={<ShieldCheck className="size-4" />} title="Where these characters come from.">
              Every character is drawn with <code className="font-mono">crypto.getRandomValues</code>, the same
              CSPRNG your browser uses for TLS keys — not <code className="font-mono">Math.random</code>, which
              is predictable. Indices use rejection sampling rather than <code className="font-mono">byte % n</code>,
              which would quietly make the first four characters of a 94-character alphabet more likely than the rest.
              Nothing leaves this tab.
            </Notice>

            <Notice tone="info" icon={<Unlock aria-hidden="true" className="size-4" />}>
              A generated password is only as safe as where you put it. Copy it straight into a password manager —
              not into a chat message, a spreadsheet, or a note on your desk.
            </Notice>
          </>
        )}
      </div>
    </ToolShell>
  );
}