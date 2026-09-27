"use client";

import * as React from "react";
import { Binary, Eraser, FlaskConical, Link } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Stat, Textarea } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import { URL_ENCODE_MODES, encodeUrl, type UrlEncodeMode } from "@/lib/tools/engines/dev";

const SAMPLE = "https://example.dev/search?q=blue shoes & size=10 #results";

export default function UrlEncoderWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [mode, setMode] = React.useState<UrlEncodeMode>("component");
  const [output, setOutput] = React.useState("");

  const encode = React.useCallback((text: string, next: UrlEncodeMode): string => encodeUrl(text, next), []);

  const run = React.useCallback(
    (text: string, next: UrlEncodeMode) => {
      if (text === "") {
        setOutput("");
        return;
      }
      try {
        setOutput(encode(text, next));
      } catch (error) {
        // encodeURI and encodeURIComponent both throw on a lone surrogate, which
        // is a real defect in the input and the visitor deserves to hear about it.
        setOutput("");
        toast.error(
          "Couldn't encode that",
          error instanceof Error
            ? `${error.message} A lone surrogate is a code point with no character, which cannot be encoded.`
            : "One of the characters is not a valid Unicode code point.",
        );
      }
    },
    [encode],
  );

  React.useEffect(() => {
    run(value, mode);
  }, [value, mode, run]);

  const inputBytes = React.useMemo(() => new Blob([value]).size, [value]);
  const outputBytes = React.useMemo(() => new Blob([output]).size, [output]);
  const escaped = React.useMemo(() => (output.match(/%[0-9A-F]{2}/gi) ?? []).length, [output]);
  const activeHint = URL_ENCODE_MODES.find((entry) => entry.value === mode)?.hint ?? "";

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {value ? (
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {formatNumber(value.length)} chars · {formatNumber(inputBytes)} bytes
            </span>
          ) : (
            <span />
          )}
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
              Paste
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!value}
              onClick={() => {
                setValue("");
                setOutput("");
              }}
            >
              <Eraser aria-hidden="true" className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>

        <Field label="Encoding mode" hint={activeHint}>
          {() => (
            <Segmented
              label="Encoding mode"
              value={mode}
              onChange={setMode}
              options={URL_ENCODE_MODES.map((entry) => ({
                value: entry.value,
                label: entry.label,
                title: entry.hint,
              }))}
            />
          )}
        </Field>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="url-encoder-input" className="text-[13px] font-medium text-[var(--text-ink)]">
              Text or URL to encode
            </label>
            <Textarea
              id="url-encoder-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Anything at all, including spaces, &, #, ? and non-ASCII."
              rows={14}
              spellCheck={false}
              className="min-h-[18rem] resize-y font-mono text-[13px] leading-relaxed"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="url-encoder-output" className="text-[13px] font-medium text-[var(--text-ink)]">
                Percent-encoded
              </label>
              <div className="flex items-center gap-1.5">
                <CopyButton
                  value={output || null}
                  what="Encoded text copied"
                  size="sm"
                  variant="ghost"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!output}
                  onClick={() =>
                    void import("@/lib/utils/files").then(({ downloadText }) => {
                      downloadText(output, "url-encoded.txt", "text/plain;charset=utf-8");
                      toast.downloadReady("url-encoded.txt");
                    })
                  }
                >
                  Download
                </Button>
              </div>
            </div>
            {output ? (
              <div
                role="region"
                aria-label="Percent-encoded output"
                aria-live="polite"
                className="min-h-[18rem] max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[13px] leading-relaxed text-[var(--text-ink)]"
              >
                {output}
              </div>
            ) : (
              <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                <ToolEmptyState
                  title="Nothing to encode yet."
                  description="Type on the left and the encoded form appears here immediately."
                />
              </div>
            )}
          </div>
        </div>

        {value ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Input bytes" value={formatNumber(inputBytes)} />
              <Stat label="Output bytes" value={formatNumber(outputBytes)} />
              <Stat label="Escapes" value={formatNumber(escaped)} tone="brand" />
              <Stat
                label="Growth"
                value={inputBytes === 0 ? "—" : `${(((outputBytes - inputBytes) / inputBytes) * 100).toFixed(1)}%`}
              />
            </dl>

            <Notice tone="info" icon={<Link aria-hidden="true" className="size-4" />} title="Which mode do I want?">
              <ul className="mt-1 grid gap-1">
                <li>
                  • <strong>Component</strong> — one value, e.g. a path segment or a query parameter. Escapes
                  everything that could be misread, including <code className="font-mono">/</code> and{" "}
                  <code className="font-mono">?</code>.
                </li>
                <li>
                  • <strong>Full URI</strong> — a whole URL. Leaves the structural characters alone so the
                  result is still a URL, and only escapes the unsafe parts of the text inside it.
                </li>
                <li>
                  • <strong>Query string</strong> — a query parameter value as an HTML form writes it: spaces
                  become <code className="font-mono">+</code> rather than <code className="font-mono">%20</code>.
                </li>
              </ul>
            </Notice>
          </>
        ) : null}

        {output ? (
          <div className="flex justify-end">
            <DownloadButton
              text={output}
              filename="url-encoded.txt"
              label="Download encoded text"
              size="sm"
              variant="secondary"
            />
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
