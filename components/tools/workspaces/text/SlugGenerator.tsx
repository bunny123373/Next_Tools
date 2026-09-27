"use client";

import * as React from "react";
import { Link2 } from "lucide-react";
import { Checkbox, Field, Input, Segmented, Textarea } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { CopyButton } from "@/components/tools/DownloadButton";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { generateSlug } from "@/lib/tools/engines/text";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

/** 75 characters is where Google starts truncating a result URL. */
const GOOD_LENGTH = 75;

const SAMPLE = "Crème Brûlée & the Sibling's Diner — a 20-year-old recipe, revisited";

const DEFAULT_MAP = ["& = and", "@ = at", "+ = plus", "% = percent"].join("\n");

/** Parse a `from=to` map, one pair per line. Blank lines and # comments ignored. */
function parseMap(source: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split <= 0) continue;
    out.push([trimmed.slice(0, split).trim(), trimmed.slice(split + 1).trim()]);
  }
  return out;
}

export default function SlugGenerator() {
  const [value, setValue] = React.useState("");
  const [separator, setSeparator] = React.useState<"-" | "_" | ".">("-");
  const [lowercase, setLowercase] = React.useState(true);
  const [strip, setStrip] = React.useState(true);
  const [maxLength, setMaxLength] = React.useState("80");
  const [replacementMap, setReplacementMap] = React.useState(DEFAULT_MAP);

  const parsedMax = Number.parseInt(maxLength, 10);
  const cap = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.min(parsedMax, 200) : 0;
  const replacements = React.useMemo(() => parseMap(replacementMap), [replacementMap]);

  const slug = React.useMemo(
    () =>
      generateSlug(value, {
        separator,
        lowercase,
        maxLength: cap,
        stripDiacritics: strip,
        replacements,
      }),
    [value, separator, lowercase, cap, strip, replacements],
  );

  const preview = `https://example.com/blog/${slug.slug}`;

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value.trim()
        ? {
            text: slug.slug,
            stats: [
              { label: "Slug length", value: formatNumber(slug.slug.length), tone: "brand" },
              { label: "Words", value: formatNumber(slug.words) },
              { label: "Cap", value: cap > 0 ? formatNumber(cap) : "none" },
              { label: "Title length", value: formatNumber([...value.trim()].length) },
            ],
          }
        : null,
    [value, slug, cap],
  );

  const tooLong = slug.slug.length > GOOD_LENGTH;
  const encodedDiffers = slug.encoded !== slug.slug;

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="slug"
        extension="txt"
        mime="text/plain;charset=utf-8"
        inputLabel="Page title"
        outputLabel="Slug"
        inputPlaceholder="Paste a headline or page title…"
        outputPlaceholder="Your slug appears here as you type."
        sample={SAMPLE}
        rows={6}
        controls={
          <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5 lg:grid-cols-2">
            <Field label="Separator">
              {/* A Segmented control carries its own accessible name, so the
                  Field's generated ids are not needed here. */}
              {() => (
                <Segmented
                  label="Separator"
                  size="sm"
                  value={separator}
                  onChange={setSeparator}
                  options={[
                    { value: "-", label: "hyphen -" },
                    { value: "_", label: "underscore _" },
                    { value: ".", label: "dot ." },
                  ]}
                />
              )}
            </Field>
            <Field
              label="Maximum length"
              hint={`0 removes the cap. Most search engines truncate past ${GOOD_LENGTH}.`}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="number"
                  min={0}
                  max={200}
                  value={maxLength}
                  onChange={(event) => setMaxLength(event.target.value)}
                  className="font-mono"
                />
              )}
            </Field>
            <div className="flex flex-col gap-2.5">
              <Checkbox
                label="Lowercase"
                description="Most sites serve one canonical case"
                checked={lowercase}
                onChange={(event) => setLowercase(event.target.checked)}
              />
              <Checkbox
                label="Strip accents"
                description="Crème → creme, via Unicode normalisation"
                checked={strip}
                onChange={(event) => setStrip(event.target.checked)}
              />
            </div>
            <Field
              label="Character replacements"
              hint="One from=to pair per line. # starts a comment."
            >
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  value={replacementMap}
                  onChange={(event) => setReplacementMap(event.target.value)}
                  rows={4}
                  className="font-mono text-[13px]"
                />
              )}
            </Field>
          </div>
        }
        actions={
          value.trim() ? (
            <section aria-label="URL preview" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                  <Link2 aria-hidden="true" className="size-3" />
                  URL preview
                </p>
                <p className="break-all font-mono text-[13px] text-[var(--text-ink)]">{preview}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton value={preview} what="URL copied" label="Copy URL" />
                  <span
                    className={cn(
                      "font-mono text-[11px] tabular-nums",
                      tooLong ? "text-amber-500" : "text-emerald-500",
                    )}
                  >
                    {slug.slug.length} / {GOOD_LENGTH} characters
                  </span>
                  {slug.truncated ? (
                    <span className="text-[11px] text-[var(--text-muted)]">
                      cut on a word boundary to fit {cap}
                    </span>
                  ) : null}
                </div>
              </div>
              {encodedDiffers ? (
                <div className="flex flex-col gap-1.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                    Percent-encoded
                  </p>
                  <p className="break-all font-mono text-[13px] text-[var(--text-ink)]">
                    https://example.com/blog/{slug.encoded}
                  </p>
                  <div className="flex items-center gap-2">
                    <CopyButton
                      value={`https://example.com/blog/${slug.encoded}`}
                      what="Encoded URL copied"
                      label="Copy encoded"
                    />
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Non-Latin characters have to be encoded in a real URL.
                    </span>
                  </div>
                </div>
              ) : null}
              {replacements.length > 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  {replacements.length} replacement
                  {replacements.length === 1 ? "" : "s"} active:{" "}
                  {replacements.map(([from, to]) => `${from}→${to || "(nothing)"}`).join(", ")}.
                  They are applied before accents are stripped, longest key first.
                </p>
              ) : null}
            </section>
          ) : null
        }
      />
    </ToolShell>
  );
}
