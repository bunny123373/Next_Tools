"use client";

import * as React from "react";
import { AlertTriangle, Binary, Eraser, ImageIcon } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Segmented, Stat, Textarea } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import { toast } from "@/lib/utils/toast";
import { useObjectUrl } from "@/lib/hooks";
import {
  bytesToBase64,
  decodeBase64,
  hexDump,
  type Base64DecodeError,
  type Base64DecodeOk,
} from "@/lib/tools/engines/dev";

const SAMPLE = "SGVsbG8sIHdvcmxkIQo=";

type View = "text" | "hex" | "image";

export default function Base64DecoderWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [view, setView] = React.useState<View>("text");

  const decoded = React.useMemo(() => (value.trim() === "" ? null : decodeBase64(value)), [value]);
  const ok = decoded?.ok === true ? (decoded as Base64DecodeOk) : null;
  const error = decoded && !decoded.ok ? (decoded as Base64DecodeError) : null;

  const dataUri = React.useMemo(
    () => (ok && ok.mime && ok.mime !== "text/plain;charset=utf-8" ? `data:${ok.mime};base64,${bytesToBase64(ok.bytes)}` : null),
    [ok],
  );

  const loadSample = (): void => {
    setValue(SAMPLE);
    toast.info("Sample loaded");
  };

  const clear = (): void => {
    setValue("");
    setView("text");
  };

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {value ? (
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                {formatNumber(value.length)} chars
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={loadSample}>
              <Binary aria-hidden="true" className="size-3.5" />
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
            <Button size="sm" variant="ghost" onClick={clear} disabled={!value}>
              <Eraser aria-hidden="true" className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="base64-decoder-input" className="text-[13px] font-medium text-[var(--text-ink)]">
              Base64 input
            </label>
            <Textarea
              id="base64-decoder-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Paste Base64 here. Line breaks and missing padding are fine."
              rows={14}
              spellCheck={false}
              className="min-h-[18rem] resize-y font-mono text-[13px] leading-relaxed"
            />
            <p className="text-xs text-[var(--text-muted)]">
              Both alphabets are accepted — the standard <code className="font-mono">+/</code> and the
              URL-safe <code className="font-mono">-_</code> — with or without <code className="font-mono">=</code> padding.
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Decoded</span>
              {ok ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Segmented
                    label="Result view"
                    size="sm"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: "text", label: "Text" },
                      { value: "hex", label: "Hex" },
                      ...(ok.mime ? ([{ value: "image", label: "Preview" }] as const) : []),
                    ]}
                  />
                  <CopyButton value={ok.text || bytesToBase64(ok.bytes)} what="Decoded content copied" size="sm" variant="ghost" />
                </div>
              ) : null}
            </div>

            {value.trim() === "" ? (
              <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                <ToolEmptyState
                  title="Paste some Base64 to decode it."
                  description="The result updates as you type. Nothing is sent anywhere."
                />
              </div>
            ) : error ? (
              <div
                role="alert"
                className="flex flex-col gap-3 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5"
              >
                <p className="flex items-start gap-2 text-[13px] font-medium text-[var(--text-ink)]">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-500" />
                  This is not valid Base64.
                </p>
                <p className="text-[13px] leading-relaxed text-[var(--text-ink)]">{error.error}</p>
                {error.preview ? (
                  <pre className="overflow-x-auto rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-2.5 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                    {error.preview}
                  </pre>
                ) : null}
                <p className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  {error.offset !== null ? `Character offset ${error.offset}, line ${error.line}, column ${error.column}` : "No offset available"}
                </p>
              </div>
            ) : ok ? (
              <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Bytes" value={formatNumber(ok.bytes.length)} />
                  <Stat label="Size" value={formatBytes(ok.bytes.length)} />
                  <Stat
                    label="Kind"
                    value={ok.binary ? "Binary" : "Text"}
                    tone={ok.binary ? "brand" : "success"}
                  />
                  <Stat
                    label="Detected"
                    value={ok.mime ?? "unknown"}
                    hint={ok.binary ? "From the file's magic bytes" : undefined}
                  />
                </dl>

                {ok.strippedWhitespace > 0 || ok.paddingAdded > 0 || ok.usedUrlAlphabet ? (
                  <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                    Repaired on the way in: {ok.strippedWhitespace} whitespace character
                    {ok.strippedWhitespace === 1 ? "" : "s"} ignored
                    {ok.paddingAdded > 0 ? `, ${ok.paddingAdded} padding character${ok.paddingAdded === 1 ? "" : "s"} added` : ""}
                    {ok.usedUrlAlphabet ? ", URL-safe alphabet translated to standard" : ""}.
                  </p>
                ) : null}

                {view === "text" ? (
                  ok.binary ? (
                    <Notice tone="warning">
                      The bytes are not valid UTF-8 text, so printing them would only produce mojibake. Use
                      the hex view to inspect them, or the preview if this is an image.
                    </Notice>
                  ) : (
                    <div
                      role="region"
                      aria-label="Decoded text"
                      className="min-h-[10rem] max-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[13px] leading-relaxed text-[var(--text-ink)]"
                    >
                      {ok.text}
                    </div>
                  )
                ) : null}

                {view === "hex" ? (
                  <>
                    {ok.bytes.length > 512 ? (
                      <p className="text-xs text-[var(--text-muted)]">
                        Showing the first 512 of {formatNumber(ok.bytes.length)} bytes.
                      </p>
                    ) : null}
                    <pre className="max-h-[24rem] overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                      {hexDump(ok.bytes, 512)}
                    </pre>
                  </>
                ) : null}

                {view === "image" && dataUri ? <DataUriPreview dataUri={dataUri} mime={ok.mime!} /> : null}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <DownloadButton
                    text={ok.binary ? bytesToBase64(ok.bytes) : ok.text}
                    filename={ok.binary ? "decoded.bin" : "decoded.txt"}
                    mime={ok.mime ?? "application/octet-stream"}
                    label="Download"
                    size="sm"
                    variant="secondary"
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

function DataUriPreview({ dataUri, mime }: { dataUri: string; mime: string }) {
  const blob = React.useMemo(() => {
    const comma = dataUri.indexOf(",");
    return comma === -1 ? null : new Blob([atob(dataUri.slice(comma + 1))], { type: mime });
  }, [dataUri, mime]);
  const url = useObjectUrl(blob);

  if (!url) {
    return (
      <div className={cn("grid place-items-center rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] py-10")}>
        <span className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
          <ImageIcon aria-hidden="true" className="size-4" />
          Preparing the preview…
        </span>
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
      {/* Decoded user data, not remote content. eslint-disable-next-line @next/next/no-img-element -- a blob: URL of bytes already in the page; next/image would add nothing and cannot take a data: source here. */}
      <img
        src={url}
        alt="The image these Base64 bytes decoded to"
        className="max-h-80 w-full rounded-lg bg-[var(--surface-canvas)] object-contain"
      />
      <figcaption className="text-xs text-[var(--text-muted)]">
        Decoded as <code className="font-mono">{mime}</code>. Nothing was fetched — these bytes were already
        in the page.
      </figcaption>
    </figure>
  );
}
