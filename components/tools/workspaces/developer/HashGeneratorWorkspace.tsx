"use client";

import * as React from "react";
import { Copy, FileCode, Hash, ShieldAlert, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Segmented, Stat, Textarea } from "@/components/ui/form";
import { FileDropzone } from "@/components/tools/FileDropzone";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { SITE } from "@/lib/site";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import {
  HASH_ALGORITHMS,
  computeHashes,
  formatPreciseMs,
  utf8Encode,
  type HashId,
  type HashResult,
} from "@/lib/tools/engines/dev";

const ALL = HASH_ALGORITHMS.map((entry) => entry.id);
const SAMPLE = "The quick brown fox jumps over the lazy dog";

type Source = "text" | "file";

export default function HashGeneratorWorkspace() {
  const [source, setSource] = React.useState<Source>("text");
  const [text, setText] = React.useState(SAMPLE);
  const [file, setFile] = React.useState<File | null>(null);
  const [bytes, setBytes] = React.useState<Uint8Array | null>(null);
  const [selected, setSelected] = React.useState<HashId[]>(ALL);
  const [results, setResults] = React.useState<HashResult[]>([]);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const activeBytes = source === "text" ? utf8Encode(text) : bytes;
  const activeSize = activeBytes?.length ?? 0;

  const run = React.useCallback(
    async (input: Uint8Array | null, ids: readonly HashId[]) => {
      if (!input || input.length === 0) {
        setResults([]);
        setError(null);
        return;
      }
      setRunning(true);
      setError(null);
      try {
        setResults(await computeHashes(ids, input));
      } catch (caught) {
        setResults([]);
        setError(
          caught instanceof Error
            ? `This browser could not run the hash functions: ${caught.message}`
            : "This browser could not run the hash functions.",
        );
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    void run(source === "text" ? utf8Encode(text) : bytes, selected);
  }, [text, bytes, source, selected, run]);

  const onFiles = React.useCallback((incoming: File[]) => {
    const candidate = incoming[0];
    if (!candidate) return;
    if (candidate.size === 0) {
      toast.rejected(`"${candidate.name}" is empty (0 bytes).`);
      return;
    }
    if (candidate.size > SITE.limits.image) {
      toast.rejected(`"${candidate.name}" is larger than the ${Math.round(SITE.limits.image / 1024 / 1024)} MB limit.`);
      return;
    }
    setSource("file");
    setFile(candidate);
    setError(null);
    void (async () => {
      try {
        setBytes(new Uint8Array(await candidate.arrayBuffer()));
      } catch {
        setBytes(null);
        setError("The browser could not read that file.");
      }
    })();
  }, []);

  const clearFile = (): void => {
    setFile(null);
    setBytes(null);
    setError(null);
  };

  const toggle = (id: HashId): void => {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  };

  const report = results.map((result) => `${result.label}\nhex    ${result.hex}\nbase64 ${result.base64}`).join("\n\n");

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2">
          <Field label="Hash what">
            {({ id }) => (
              <Segmented
                label="Hash what"
                value={source}
                onChange={setSource}
                options={[
                  { value: "text", label: "Text", title: "UTF-8 encoded, exactly as typed" },
                  { value: "file", label: "File bytes", title: "The raw bytes, with no encoding step" },
                ]}
              />
            )}
          </Field>
          <Field label="Algorithms" hint={`${selected.length} of ${HASH_ALGORITHMS.length} selected.`}>
            {() => (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSelected(ALL)}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  Clear
                </Button>
                <span className="ml-auto font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                  {formatBytes(activeSize)}
                </span>
              </div>
            )}
          </Field>
        </div>

        {source === "text" ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="hash-input" className="text-[13px] font-medium text-[var(--text-ink)]">
              Text to hash
            </label>
            <Textarea
              id="hash-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              spellCheck={false}
              className="resize-y font-mono text-[13px] leading-relaxed"
            />
            <p className="text-xs text-[var(--text-muted)]">
              Encoded as UTF-8, so the digest is of the bytes a server would receive.{" "}
              {formatNumber(utf8Encode(text).length)} bytes.
            </p>
          </div>
        ) : (
          <FileDropzone
            category="any"
            maxBytes={SITE.limits.image}
            onAdd={onFiles}
            files={file ? [file] : []}
            onRemove={clearFile}
            onClear={clearFile}
            label="Drop a file here, or choose one"
            hint={`Up to ${formatBytes(SITE.limits.image)}. Read in this tab; the bytes are never uploaded.`}
          />
        )}

        <fieldset className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <legend className="px-1 text-[13px] font-medium text-[var(--text-ink)]">Algorithms</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {HASH_ALGORITHMS.map((algorithm) => (
              <div
                key={algorithm.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                  selected.includes(algorithm.id)
                    ? "border-brand-500/30 bg-brand-500/[0.05]"
                    : "border-[var(--surface-line)]",
                )}
              >
                <input
                  id={`hash-${algorithm.id}`}
                  type="checkbox"
                  checked={selected.includes(algorithm.id)}
                  onChange={() => toggle(algorithm.id)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-[var(--surface-line-strong)] bg-[var(--surface-card)] text-white opacity-0 transition-opacity peer-checked:border-brand-500 peer-checked:bg-brand-500 peer-checked:opacity-100 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--surface-canvas)]"
                >
                  <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M2.5 6.2 4.8 8.5 9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <label htmlFor={`hash-${algorithm.id}`} className="min-w-0 cursor-pointer select-none">
                  <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
                    {algorithm.label}
                    {algorithm.checksum ? (
                      <span className="rounded border border-sky-500/25 bg-sky-500/10 px-1 text-[10px] font-medium uppercase tracking-wide text-sky-500">
                        checksum
                      </span>
                    ) : algorithm.legacy ? (
                      <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-500">
                        broken
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                    {algorithm.bits} bits · via {algorithm.source}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        {error ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="Hashing failed.">
            {error}
          </Notice>
        ) : null}

        {activeSize === 0 ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title={source === "text" ? "Type something to hash." : "Choose a file to hash."}
              description="Every digest is computed in this tab, from the bytes you supplied."
              icon={<Hash className="size-5" />}
            />
          </div>
        ) : results.length === 0 ? (
          <Notice tone="info">No algorithms selected, so there is nothing to compute.</Notice>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Input" value={formatBytes(activeSize)} />
              <Stat label="Algorithms" value={String(results.length)} />
              <Stat
                label="Total time"
                value={formatPreciseMs(results.reduce((sum, result) => sum + result.ms, 0))}
                tone="brand"
              />
              <Stat
                label="Fastest"
                value={results.reduce((best, r) => (r.ms < best.ms ? r : best), results[0]!).label}
              />
            </dl>

            <ul className="flex flex-col gap-2">
              {results.map((result) => {
                const algorithm = HASH_ALGORITHMS.find((entry) => entry.id === result.id)!;
                return (
                  <li
                    key={result.id}
                    className="flex flex-col gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-ink)]">
                        {result.label}
                        {result.error ? (
                          <span className="rounded border border-brand-500/30 bg-brand-500/10 px-1.5 text-[11px] font-medium text-brand-500">
                            unavailable
                          </span>
                        ) : null}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                        {formatPreciseMs(result.ms)}
                      </span>
                    </div>
                    {result.error ? (
                      <p className="text-[13px] leading-relaxed text-brand-500">{result.error}</p>
                    ) : (
                      <>
                        <div className="flex items-start gap-2">
                          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                            {result.hex}
                          </code>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Copy the ${result.label} hex digest`}
                            onClick={() => void toast.copy(result.hex, `${result.label} copied`)}
                          >
                            <Copy aria-hidden="true" className="size-3.5" />
                          </Button>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="w-14 shrink-0 pt-0.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                            base64
                          </span>
                          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-emerald-500">
                            {result.base64}
                          </code>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Copy the ${result.label} base64 digest`}
                            onClick={() => void toast.copy(result.base64, `${result.label} base64 copied`)}
                          >
                            <Copy aria-hidden="true" className="size-3.5" />
                          </Button>
                        </div>
                        {algorithm.legacy ? (
                          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-500">
                            <ShieldAlert aria-hidden="true" className="mt-px size-3 shrink-0" />
                            {result.label} is broken for anything adversarial. Use it to detect accidental
                            corruption, never to prove integrity.
                          </p>
                        ) : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <CopyButton value={report} what="Every digest copied" size="sm" variant="secondary" />
              <DownloadButton
                text={report}
                filename="hashes.txt"
                mime="text/plain;charset=utf-8"
                label="Download all"
                size="sm"
                variant="secondary"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (source === "text") setText("");
                  else clearFile();
                  setResults([]);
                }}
                aria-label="Clear the input and every digest"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                Clear
              </Button>
            </div>

            {running ? (
              <p className="flex items-center justify-end gap-1.5 text-[11px] text-[var(--text-muted)]">
                <FileCode aria-hidden="true" className="size-3" />
                Recomputing…
              </p>
            ) : null}

            <Notice tone="success" icon={<ShieldCheck className="size-4" />} title="Where each digest comes from.">
              SHA-256, SHA-384 and SHA-512 go through{" "}
              <code className="font-mono">crypto.subtle.digest</code>, the platform&apos;s own
              implementation. MD5, SHA-1, SHA-512/256, SHA3, BLAKE2 and CRC-32 are pure JavaScript from{" "}
              <code className="font-mono">@noble/hashes</code>, loaded on first use so nothing lands in
              the page bundle for visitors who never hash. The timings are real{" "}
              <code className="font-mono">performance.now()</code> readings around each digest; a sub-100&nbsp;µs
              figure can legitimately read as zero in a browser that clamps its timer.
            </Notice>
          </>
        )}
      </div>
    </ToolShell>
  );
}
