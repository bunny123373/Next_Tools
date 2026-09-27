"use client";

import * as React from "react";
import { AlertTriangle, ClipboardPaste, Eraser, FlaskConical, Link } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Stat, Textarea } from "@/components/ui/form";
import { CopyButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import {
  analyzeUrl,
  decodeUrl,
  type UrlAnalysis,
  type UrlEncodeMode,
} from "@/lib/tools/engines/dev";

const SAMPLE = "https://user:pw@api.example.dev:8443/v1/items%20list?q=blue+shoes&page=2&tag=a%2Fb#results";
const ENCODED_SAMPLE = "https%3A%2F%2Fexample.dev%2Fsearch%3Fq%3Dblue%20shoes%20%26%20size%3D10%20%23results";

type Mode = "text" | "url";

export default function UrlDecoderWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [mode, setMode] = React.useState<Mode>("url");
  const [plusAsSpace, setPlusAsSpace] = React.useState<UrlEncodeMode>("query");

  const decoded = React.useMemo(
    () => (value.trim() === "" ? null : decodeUrl(plusAsSpace === "query" ? value : value.replace(/\+/g, "%20"))),
    [value, plusAsSpace],
  );
  const analysis: UrlAnalysis | null = React.useMemo(
    () => (mode === "url" && value.trim() === "" ? null : analyzeUrl(value)),
    [value, mode],
  );

  const decodedText = decoded?.ok === true ? decoded.text : "";
  const urlParts = analysis?.ok === true ? analysis.parts : [];

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {value ? (
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {formatNumber(value.length)} chars
            </span>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue(mode === "url" ? SAMPLE : ENCODED_SAMPLE);
                toast.info("Sample loaded");
              }}
            >
              <FlaskConical aria-hidden="true" className="size-3.5" />
              Sample
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text) {
                    toast.warning("Clipboard is empty");
                    return;
                  }
                  setValue(text);
                  toast.copied("Pasted from clipboard");
                } catch {
                  toast.error("Couldn't read the clipboard", "Your browser blocked clipboard access.");
                }
              }}
            >
              <ClipboardPaste aria-hidden="true" className="size-3.5" />
              Paste
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!value}
              onClick={() => {
                setValue("");
              }}
            >
              <Eraser aria-hidden="true" className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="min-w-[14rem] flex-1">
            <Field label="Mode">
              {() => (
                <Segmented
                  label="Mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "url", label: "Break down a URL", title: "Splits into scheme, host, path, query and fragment" },
                    { value: "text", label: "Plain text", title: "Just percent-decode the whole string" },
                  ]}
                />
              )}
            </Field>
          </div>
          {mode === "text" ? (
            <div className="min-w-[15rem] flex-1">
              <Field label="Plus sign" hint="In a query string + means a space. In a path it is a literal plus.">
                {() => (
                  <Segmented
                    label="Plus sign"
                    size="sm"
                    value={plusAsSpace}
                    onChange={setPlusAsSpace}
                    options={[
                      { value: "query", label: "+ is a space" },
                      { value: "component", label: "+ is literal" },
                    ]}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="url-decoder-input" className="text-[13px] font-medium text-[var(--text-ink)]">
            {mode === "url" ? "URL to inspect" : "Percent-encoded text"}
          </label>
          <Textarea
            id="url-decoder-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste a URL or an encoded string."
            rows={6}
            spellCheck={false}
            className="resize-y font-mono text-[13px] leading-relaxed"
          />
        </div>

        {value.trim() === "" ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Paste something to decode."
              description="A URL is broken into its parts with each one shown raw and percent-decoded."
            />
          </div>
        ) : mode === "text" ? (
          <div className="flex flex-col gap-3">
            {decoded && !decoded.ok ? (
              <div role="alert" className="flex flex-col gap-2 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5">
                <p className="flex items-start gap-2 text-[13px] font-medium text-[var(--text-ink)]">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-500" />
                  This is not valid percent-encoding.
                </p>
                <p className="text-[13px] leading-relaxed text-[var(--text-ink)]">{decoded.error}</p>
                {decoded.preview ? (
                  <pre className="overflow-x-auto rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-2.5 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                    {decoded.preview}
                  </pre>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">Decoded</span>
                  <CopyButton value={decodedText || null} what="Decoded text copied" size="sm" variant="ghost" />
                </div>
                <div className="min-h-[10rem] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[13px] leading-relaxed text-[var(--text-ink)]">
                  {decodedText}
                </div>
              </div>
            )}
          </div>
        ) : !analysis ? null : analysis.ok ? (
          <div className="flex flex-col gap-4">
            {analysis.assumedProtocol ? (
              <Notice tone="warning" icon={<Link aria-hidden="true" className="size-4" />} title="No scheme in the input.">
                There was no protocol, so <code className="font-mono">https://</code> was assumed to parse it.
                Everything below is correct for that reading, not for the text as written.
              </Notice>
            ) : null}

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Origin" value={analysis.origin} />
              <Stat label="Host" value={analysis.hostname} />
              <Stat label="Port" value={analysis.port || "default"} />
              <Stat label="Query params" value={String(analysis.query.length)} tone="brand" />
            </dl>

            <div className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)]">
              <table className="w-full min-w-[34rem] border-collapse text-left">
                <caption className="sr-only">Each part of the URL, raw and percent-decoded</caption>
                <thead>
                  <tr className="border-b border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                    <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                      Part
                    </th>
                    <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                      As written
                    </th>
                    <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                      Decoded
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {urlParts.map((part) => (
                    <tr key={part.label} className="border-b border-[var(--surface-line)] last:border-0">
                      <th scope="row" className="whitespace-nowrap px-3 py-2 align-top text-[13px] font-medium text-[var(--text-ink)]">
                        {part.label}
                        {part.note ? (
                          <span className="mt-0.5 block text-[11px] font-normal text-[var(--text-muted)]">{part.note}</span>
                        ) : null}
                      </th>
                      <td className="px-3 py-2 align-top font-mono text-[12px] break-all text-[var(--text-ink)]">
                        {part.raw === "" ? <span className="text-[var(--text-muted)]">—</span> : part.raw}
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-[12px] break-all text-emerald-500">
                        {part.decoded === "" ? <span className="text-[var(--text-muted)]">—</span> : part.decoded}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {analysis.query.length > 0 ? (
              <div className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)]">
                <table className="w-full min-w-[30rem] border-collapse text-left">
                  <caption className="sr-only">Query parameters, decoded</caption>
                  <thead>
                    <tr className="border-b border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                      <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                        Parameter
                      </th>
                      <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.query.map((param, index) => (
                      <tr key={`${param.name}-${index}`} className="border-b border-[var(--surface-line)] last:border-0">
                        <th scope="row" className="px-3 py-2 align-top font-mono text-[12px] font-medium break-all text-[var(--text-ink)]">
                          {param.decodedName}
                        </th>
                        <td className="px-3 py-2 align-top font-mono text-[12px] break-all text-emerald-500">
                          {param.decodedValue === "" ? <span className="text-[var(--text-muted)]">(empty)</span> : param.decodedValue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <Notice tone="warning" icon={<AlertTriangle aria-hidden="true" className="size-4" />} title="Not a URL.">
            {analysis.error}
          </Notice>
        )}
      </div>
    </ToolShell>
  );
}
