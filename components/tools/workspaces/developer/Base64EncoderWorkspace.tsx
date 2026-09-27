"use client";

import * as React from "react";
import { FileCode, ShieldCheck, Trash2 } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { Field, Segmented, Select, Stat } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/tools/FileDropzone";
import { Notice } from "@/components/tools/states";
import { toast } from "@/lib/utils/toast";
import { SITE } from "@/lib/site";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import { bytesToBase64, encodeBase64, type Base64Variant, type TextOutcome } from "@/lib/tools/engines/dev";

const SAMPLE = `Grüße aus München — emoji stays intact: 🎉

Base64 encodes bytes, not characters. Encoding the string "ü" the naive way
produces 6w== instead of w7w=, which is why /dev/console always looks wrong.`;

const VARIANT_HINT: Record<Base64Variant, string> = {
  standard: "Uses + and / with = padding. Right for email, data URIs and most APIs.",
  url: "Uses - and _ with no padding. Right for JWTs, filenames and anything in a URL path.",
};

export default function Base64EncoderWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [variant, setVariant] = React.useState<Base64Variant>("standard");
  const [lineWidth, setLineWidth] = React.useState(0);
  const [dataUri, setDataUri] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileResult, setFileResult] = React.useState<{ base64: string; mime: string } | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);

  const outcome = React.useMemo<TextOutcome | null>(() => {
    if (value.trim() === "") return null;
    const encoded = encodeBase64(value, { variant, lineWidth });
    return {
      text: dataUri ? `data:text/plain;charset=utf-8;base64,${encoded.replace(/\n/g, "")}` : encoded,
      stats: [
        { label: "Input", value: `${formatNumber(new Blob([value]).size)} B` },
        { label: "Output", value: `${formatNumber(new Blob([encoded]).size)} B` },
        {
          label: "Overhead",
          value: `${formatPercentOverhead(value, encoded)}%`,
          tone: "brand",
        },
        { label: "Lines", value: formatNumber(encoded.split("\n").length) },
      ],
    };
  }, [value, variant, lineWidth, dataUri]);

  const onFiles = React.useCallback(
    (incoming: File[]) => {
      const candidate = incoming[0];
      if (!candidate) return;
      if (candidate.size > SITE.limits.image) {
        toast.rejected(`"${candidate.name}" is larger than the ${Math.round(SITE.limits.image / 1024 / 1024)} MB limit.`);
        return;
      }
      setFile(candidate);
      setFileError(null);
      setFileResult(null);
      void (async () => {
        try {
          const buffer = new Uint8Array(await candidate.arrayBuffer());
          const mime = candidate.type || "application/octet-stream";
          setFileResult({ base64: bytesToBase64(buffer), mime });
        } catch {
          setFileError("The browser could not read that file.");
        }
      })();
    },
    [],
  );

  const clearFile = (): void => {
    setFile(null);
    setFileResult(null);
    setFileError(null);
  };

  const result: TextToolResult | null = outcome
    ? { text: outcome.text, stats: outcome.stats }
    : null;

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Alphabet" hint={VARIANT_HINT[variant]}>
              {() => (
                <Segmented
                  label="Alphabet"
                  value={variant}
                  onChange={(next) => {
                    setVariant(next);
                    setDataUri(false);
                  }}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "url", label: "URL-safe" },
                  ]}
                />
              )}
            </Field>
            <Field label="Line width" hint="0 means one unbroken line.">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={String(lineWidth)}
                  onChange={(event) => setLineWidth(Number(event.target.value))}
                >
                  <option value="0">No wrapping</option>
                  <option value="64">64 characters</option>
                  <option value="76">76 characters</option>
                </Select>
              )}
            </Field>
            <Field label="Output" hint="A data URI is a single line and always uses the standard alphabet.">
              {() => (
                <Segmented
                  label="Output"
                  value={dataUri ? "uri" : "raw"}
                  onChange={(next) => {
                    setDataUri(next === "uri");
                    if (next === "uri") setVariant("standard");
                  }}
                  options={[
                    { value: "raw", label: "Plain text" },
                    { value: "uri", label: "Data URI" },
                  ]}
                />
              )}
            </Field>
          </div>
        </div>

        <TextWorkbench
          value={value}
          onChange={setValue}
          result={result}
          outputName="base64"
          extension="txt"
          mime="text/plain;charset=utf-8"
          inputLabel="Text to encode"
          outputLabel="Base64"
          inputPlaceholder="Type or paste anything. Emoji and accents are fine."
          outputPlaceholder="The Base64 appears here as you type."
          sample={SAMPLE}
        />

        <section aria-label="Encode a file" className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-[var(--text-ink)]">Encode a file instead</h3>
          <FileDropzone
            category="any"
            maxBytes={SITE.limits.image}
            onAdd={onFiles}
            files={file ? [file] : []}
            onRemove={clearFile}
            onClear={clearFile}
            label="Drop any file here, or choose one"
            hint={`Up to ${formatBytes(SITE.limits.image)}. The file is read in this tab and never uploaded.`}
          />
          {fileError ? <Notice tone="warning">{fileError}</Notice> : null}
          {file && fileResult ? (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="File" value={file.name} hint={formatBytes(file.size)} />
                <Stat label="Type" value={fileResult.mime} />
                <Stat label="Base64 size" value={formatBytes(new Blob([fileResult.base64]).size)} />
                <Stat
                  label="Overhead"
                  value={`${(((new Blob([fileResult.base64]).size - file.size) / Math.max(1, file.size)) * 100).toFixed(1)}%`}
                  tone="brand"
                />
              </dl>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="base64-file-output" className="text-[13px] font-medium text-[var(--text-ink)]">
                  Base64 of {file.name}
                </label>
                <textarea
                  id="base64-file-output"
                  readOnly
                  value={fileResult.base64}
                  rows={6}
                  spellCheck={false}
                  className="w-full resize-y rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void toast.copy(fileResult.base64, "File Base64 copied")}
                  >
                    <FileCode aria-hidden="true" className="size-3.5" />
                    Copy Base64
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void toast.copy(
                        `data:${fileResult.mime};base64,${fileResult.base64}`,
                        "Data URI copied",
                      )
                    }
                  >
                    Copy data URI
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void import("@/lib/utils/files").then(({ downloadText }) => {
                        const name = `${file.name}.base64.txt`;
                        downloadText(fileResult.base64, name, "text/plain;charset=utf-8");
                        toast.downloadReady(name);
                      });
                    }}
                  >
                    Download
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearFile}>
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </section>

        <Notice tone="success" icon={<ShieldCheck className="size-4" />} title="Why non-ASCII survives.">
          The text is encoded to UTF-8 bytes first, then those bytes are Base64 encoded. Skipping that step
          and encoding string code units is the classic bug: it mangles every accent, and any emoji above
          U+FFFF. The size readout confirms the byte length actually encoded.
        </Notice>
      </div>
    </ToolShell>
  );
}

/** Base64 always costs 33% more than 3 bytes per 4 characters; show the real number. */
function formatPercentOverhead(input: string, encoded: string): string {
  const inBytes = new Blob([input]).size;
  const outBytes = new Blob([encoded]).size;
  if (inBytes === 0) return "0.0";
  return (((outBytes - inBytes) / inBytes) * 100).toFixed(1);
}
