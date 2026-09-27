"use client";

import * as React from "react";
import { AlertTriangle, Check, CircleAlert, Info, ShieldCheck } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Field, Segmented, Select, Textarea, Checkbox } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import {
  SCHEMA_SUPPORTED_KEYWORDS,
  lintJson,
  parseJsonDetailed,
  validateJsonSchema,
  type JsonFinding,
  type SchemaViolation,
} from "@/lib/tools/engines/dev";

type Tier = "syntax" | "lint" | "schema";

const SAMPLE = `{
  "id": 7,
  "name": "Ada Lovelace",
  "email": "ada@example.dev",
  "age": 36,
  "roles": ["admin", "editor"],
  "profile": { "city": "London", "zip": "NW1" }
}`;

const SAMPLE_SCHEMA = `{
  "$defs": {
    "Address": {
      "type": "object",
      "required": ["city"],
      "properties": {
        "city": { "type": "string", "minLength": 1 },
        "zip": { "type": "string", "pattern": "^[0-9]{4}$" }
      }
    }
  },
  "type": "object",
  "required": ["id", "name", "email", "age"],
  "properties": {
    "id": { "type": "integer", "minimum": 1 },
    "name": { "type": "string", "minLength": 2 },
    "email": { "type": "string", "pattern": "^[^@\\\\s]+@[^@\\\\s]+\\\\.[a-z]{2,}$" },
    "age": { "type": "integer", "minimum": 0, "maximum": 130 },
    "roles": { "type": "array", "uniqueItems": true, "items": { "type": "string" } },
    "profile": { "$ref": "#/$defs/Address" }
  },
  "additionalProperties": false
}`;

const SEVERITY_STYLE: Record<JsonFinding["severity"], string> = {
  error: "border-brand-500/30 bg-brand-500/[0.05] text-brand-500",
  warning: "border-amber-500/25 bg-amber-500/[0.06] text-amber-500",
  info: "border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]",
};

function FindingRow({ finding }: { finding: JsonFinding }) {
  return (
    <li className={cn("rounded-[10px] border px-3.5 py-2.5", SEVERITY_STYLE[finding.severity])}>
      <p className="text-[13px] font-medium">
        <span className="font-mono text-[11px] uppercase tracking-[0.07em] opacity-80">
          {finding.severity}
        </span>
        <span className="ml-2 font-mono tabular-nums opacity-80">
          line {finding.line}, column {finding.column}
        </span>
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-ink)]">{finding.message}</p>
    </li>
  );
}

export default function JsonValidatorWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [tier, setTier] = React.useState<Tier>("lint");
  const [schema, setSchema] = React.useState(SAMPLE_SCHEMA);
  const [useSchema, setUseSchema] = React.useState(false);

  const parsed = React.useMemo(() => (value.trim() === "" ? null : parseJsonDetailed(value)), [value]);
  const findings = React.useMemo(
    () => (tier === "lint" && value.trim() !== "" ? lintJson(value) : []),
    [tier, value],
  );

  const schemaReport = React.useMemo<{ violations: SchemaViolation[]; error: string | null }>(() => {
    if (tier !== "schema" || !useSchema) return { violations: [], error: null };
    let schemaValue: unknown;
    try {
      schemaValue = JSON.parse(schema);
    } catch (error) {
      return { violations: [], error: `The schema is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}.` };
    }
    if (!parsed?.ok) return { violations: [], error: null };
    return { violations: validateJsonSchema(parsed.scan.value, schemaValue), error: null };
  }, [tier, useSchema, schema, parsed]);

  const schemaUnused = React.useMemo(() => {
    if (tier !== "schema" || !useSchema || schemaReport.error) return [];
    const text = schema;
    return Array.from(
      new Set(
        [...text.matchAll(/"(\$?[A-Za-z_][\w]*)"\s*:/g)]
          .map((match) => match[1]!)
          .filter((key) => !key.startsWith("$") && key !== "properties" && key !== "defs"),
      ),
    ).filter((keyword) => !(SCHEMA_SUPPORTED_KEYWORDS as readonly string[]).includes(keyword));
  }, [tier, useSchema, schema, schemaReport.error]);

  const syntaxOk = parsed?.ok === true;
  const errors = findings.filter((finding) => finding.severity === "error");

  const reportText = React.useMemo(() => {
    if (tier === "syntax") {
      return syntaxOk
        ? `valid JSON · ${formatNumber(parsed!.scan.keys)} keys · max depth ${parsed!.scan.depth}`
        : `invalid · line ${parsed!.error.line}, column ${parsed!.error.column}\n${parsed!.error.message}`;
    }
    if (tier === "lint") {
      const count = (level: JsonFinding["severity"]): number =>
        findings.filter((finding) => finding.severity === level).length;
      return [
        `${count("error")} error(s), ${count("warning")} warning(s), ${count("info")} note(s)`,
        ...findings.map((finding) => `line ${finding.line}, column ${finding.column} [${finding.severity}] ${finding.message}`),
      ].join("\n");
    }
    return [
      `${schemaReport.violations.length} violation(s)`,
      ...schemaReport.violations.map((v) => `${v.pointer || "/"} [${v.keyword}] ${v.message}`),
    ].join("\n");
  }, [tier, syntaxOk, parsed, findings, schemaReport]);

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <Field label="Validation depth">
          {() => (
            <Segmented
              label="Validation depth"
              value={tier}
              onChange={setTier}
              options={[
                { value: "syntax", label: "Well-formed", title: "Only asks whether the text is valid JSON" },
                { value: "lint", label: "Well-formed + issues", title: "Adds duplicate keys, NaN, comments and similar" },
                { value: "schema", label: "JSON Schema", title: "Validates against a schema you supply" },
              ]}
            />
          )}
        </Field>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="json-validator-input" className="text-[13px] font-medium text-[var(--text-ink)]">
              JSON to check
            </label>
            <Textarea
              id="json-validator-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Paste JSON here."
              spellCheck={false}
              rows={16}
              className="min-h-[20rem] resize-y font-mono text-[13px] leading-relaxed"
            />
            <p className="text-xs text-[var(--text-muted)]">
              {value.length === 0
                ? "Nothing to check yet."
                : `${formatNumber(value.length)} characters · ${formatNumber(value.split("\n").length)} lines`}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Report</span>
              <CopyButton value={reportText} what="Report copied" size="sm" variant="ghost" />
            </div>

            {tier === "schema" ? (
              <div className="flex flex-col gap-2">
                <Checkbox
                  label="Validate against a schema"
                  description="Turn this on to run the schema validator."
                  checked={useSchema}
                  onChange={(event) => setUseSchema(event.target.checked)}
                />
                {useSchema ? (
                  <Field
                    label="Schema"
                    hint={`Supported keywords: ${SCHEMA_SUPPORTED_KEYWORDS.join(", ")}.`}
                  >
                    {({ id, describedBy }) => (
                      <Textarea
                        id={id}
                        aria-describedby={describedBy}
                        value={schema}
                        onChange={(event) => setSchema(event.target.value)}
                        spellCheck={false}
                        rows={9}
                        className="resize-y font-mono text-[12px] leading-relaxed"
                      />
                    )}
                  </Field>
                ) : null}
              </div>
            ) : null}

            {value.trim() === "" ? (
              <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                <ToolEmptyState
                  title="Paste some JSON to check it."
                  description="Nothing is sent anywhere — the checks run in this tab."
                />
              </div>
            ) : tier === "syntax" ? (
              parsed?.ok ? (
                <Notice tone="success" icon={<Check className="size-4" />} title="Valid JSON.">
                  {formatNumber(parsed.scan.keys)} keys, {formatNumber(parsed.scan.arrays)} arrays, maximum nesting depth{" "}
                  {parsed.scan.depth}.
                  {parsed.scan.duplicateKeys.length > 0
                    ? ` ${parsed.scan.duplicateKeys.length} duplicate key(s) exist, which JSON.parse silently allows.`
                    : ""}
                </Notice>
              ) : (
                <Notice tone="warning" icon={<AlertTriangle className="size-4" />} title="Not valid JSON.">
                  {parsed?.error.message}
                </Notice>
              )
            ) : null}

            {!parsed?.ok && parsed ? (
              <pre className="overflow-x-auto rounded-[10px] border border-brand-500/30 bg-brand-500/[0.05] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                {parsed.error.preview}
              </pre>
            ) : null}

            {tier === "lint" && value.trim() !== "" ? (
              findings.length === 0 ? (
                <Notice tone="success" icon={<ShieldCheck className="size-4" />} title="Nothing to report.">
                  No duplicate keys, no comments, no trailing commas, no NaN — just clean JSON.
                </Notice>
              ) : (
                <ul className="flex flex-col gap-2">
                  {findings.map((finding, index) => (
                    <FindingRow key={`${finding.offset}-${index}`} finding={finding} />
                  ))}
                </ul>
              )
            ) : null}

            {tier === "schema" && value.trim() !== "" ? (
              schemaReport.error ? (
                <Notice tone="warning" icon={<AlertTriangle className="size-4" />} title="Schema problem.">
                  {schemaReport.error}
                </Notice>
              ) : !parsed?.ok ? (
                <Notice tone="warning" icon={<CircleAlert className="size-4" />} title="Fix the JSON first.">
                  The schema validator can only run on JSON that parses.
                </Notice>
              ) : schemaReport.violations.length === 0 ? (
                <Notice tone="success" icon={<Check className="size-4" />} title="Schema satisfied.">
                  Every rule the schema states is met.
                </Notice>
              ) : (
                <ul className="flex flex-col gap-2">
                  {schemaReport.violations.map((violation, index) => (
                    <li
                      key={`${violation.pointer}-${violation.keyword}-${index}`}
                      className="rounded-[10px] border border-brand-500/25 bg-brand-500/[0.05] px-3.5 py-2.5"
                    >
                      <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.07em] text-brand-500">
                        <span className="font-mono normal-case tracking-normal">{violation.pointer || "/"}</span>
                        <span>· {violation.keyword}</span>
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-ink)]">
                        {violation.message}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {schemaUnused.length > 0 ? (
              <Notice tone="warning" icon={<Info className="size-4" />} title="Ignored keywords.">
                This validator is a subset, and it skipped{" "}
                {schemaUnused.map((keyword) => (
                  <code key={keyword} className="mx-0.5 rounded bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[11px]">
                    {keyword}
                  </code>
                ))}
                . Unknown keywords are ignored rather than reported as passing, so a rule written in one of
                them is not being checked here.
              </Notice>
            ) : null}

            <div className="flex justify-end">
              <DownloadButton
                text={reportText}
                filename="json-validation-report.txt"
                label="Download report"
                size="sm"
                variant="secondary"
              />
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
