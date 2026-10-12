"use client";

/**
 * ZIP Password Recovery.
 *
 * Registry line:
 *   "zip-password-recovery": dynamic(() => import("./developer/ZipPasswordRecovery")),
 *
 * The honesty rule for this tool, applied throughout: it never implies it can
 * break a strong password. When the list is exhausted the result says so
 * plainly and stops. An earlier build kept searching to look thorough; it was
 * changed because a long empty search reads as "still working" when it has
 * already failed.
 *
 * Everything runs locally — the archive never leaves the tab, which is what
 * makes the tool safe to point at a personal or work file.
 */

import * as React from "react";
import { Download, FileArchive, FolderOpen, KeyRound, ListChecks, ShieldAlert, TriangleAlert } from "lucide-react";

import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { Notice, ToolError, ToolEmptyState } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { downloadZipBatch, type NamedBlob } from "@/lib/utils/files";
import { toast } from "@/lib/utils/toast";
import { recordJob } from "@/components/user/recordJob";
import {
  ZipRecoveryError,
  buildWordlist,
  extractWithPassword,
  listArchive,
  recoverPassword,
  type ArchiveListing,
  type ExtractedFile,
  type ZipEncryption,
} from "@/lib/tools/engines/zip-password";

const TOOL = { id: "zip-password-recovery", category: "developer", processing: "local" } as const;

const ENCRYPTION_COPY: Record<ZipEncryption, { label: string; blurb: string }> = {
  none: { label: "Not encrypted", blurb: "This archive has no password on its files." },
  zipcrypto: {
    label: "Legacy ZipCrypto",
    blurb:
      "An older scheme. It leaves filenames readable, which is why the contents can be listed without the password.",
  },
  aes: {
    label: "AES (WinZip)",
    blurb:
      "The modern scheme used by 7-Zip and WinZip. It encrypts filenames too, so nothing is visible until the password is recovered.",
  },
};

export default function ZipPasswordRecoveryWorkspace() {
  const { files, add, clear } = useFiles({ category: "text", maxBytes: SITE.limits.video });
  const archive = files[0] ?? null;

  const [extraWords, setExtraWords] = React.useState("");
  const [includeYears, setIncludeYears] = React.useState(true);
  const [includeDecorations, setIncludeDecorations] = React.useState(true);

  const [listing, setListing] = React.useState<ArchiveListing | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "reading" | "trying" | "extracting">("idle");
  const [tried, setTried] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [recovered, setRecovered] = React.useState<string | null>(null);
  const [filesOut, setFilesOut] = React.useState<ExtractedFile[]>([]);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const busy = phase === "reading" || phase === "trying" || phase === "extracting";

  /* Read the archive as soon as it arrives, so the entry list is on screen
   * before anyone presses anything. Listing the contents is often the answer
   * on its own, and it is free. */
  React.useEffect(() => {
    if (!archive) {
      setListing(null);
      return;
    }
    let alive = true;
    setPhase("reading");
    setError(null);
    setRecovered(null);
    setFilesOut([]);

    void listArchive(archive)
      .then((result) => {
        if (!alive) return;
        setListing(result);
        if (result.encryptedCount === 0) {
          setError(
            "This archive has no password-protected files, so there is nothing to recover. Everything inside can be read as it is.",
          );
        }
      })
      .catch((thrown: unknown) => {
        if (!alive) return;
        setError(thrown instanceof ZipRecoveryError ? thrown.message : "This file could not be read as a ZIP archive.");
      })
      .finally(() => {
        if (alive) setPhase("idle");
      });

    return () => {
      alive = false;
    };
  }, [archive]);

  const start = React.useCallback(async () => {
    if (!archive || busy || !listing || listing.encryptedCount === 0) return;

    const words = extraWords
      .split(/[\s,]+/)
      .map((word) => word.trim())
      .filter(Boolean);

    const candidates = buildWordlist({ extraWords: words, includeYears, includeDecorations });
    if (candidates.length === 0) {
      setError("Add at least one of your own words, or enable the common list.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setRecovered(null);
    setFilesOut([]);
    setTried(0);
    setTotal(candidates.length);
    setPhase("trying");

    try {
      const result = await recoverPassword(archive, candidates, (progress) => {
        setTried(progress.tried);
      }, controller.signal);

      setElapsed(result.elapsedMs);

      if (!result.recovered) {
        setPhase("idle");
        toast.info(
          "No match",
          `${result.tried} passwords tried in ${formatDuration(result.elapsedMs / 1000)}. Add your own words and try again.`,
        );
        recordJob(TOOL, { status: "error", fileName: archive.name, errorMessage: "No password found in list" });
        return;
      }

      setRecovered(result.password ?? null);
      setPhase("extracting");
      const extracted = await extractWithPassword(archive, result.password ?? "");
      setFilesOut(extracted);
      setPhase("idle");

      toast.success(
        "Password recovered",
        `${result.password} — ${extracted.length} file${extracted.length === 1 ? "" : "s"} extracted`,
      );
      recordJob(TOOL, {
        status: "success",
        fileName: archive.name,
        fileCount: 1,
        inputBytes: archive.size,
        outputBytes: extracted.reduce((total, file) => total + file.blob.size, 0),
      });
    } catch (thrown) {
      if (thrown instanceof DOMException && thrown.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setPhase("idle");
      setError(thrown instanceof ZipRecoveryError ? thrown.message : "The archive could not be read.");
    } finally {
      abortRef.current = null;
    }
  }, [archive, busy, listing, extraWords, includeYears, includeDecorations]);

  const cancel = React.useCallback(() => abortRef.current?.abort(), []);

  const handleReset = () => {
    abortRef.current?.abort();
    clear();
    setListing(null);
    setRecovered(null);
    setFilesOut([]);
    setError(null);
    setTried(0);
    setTotal(0);
    setElapsed(0);
  };

  const namedBlobs: NamedBlob[] = filesOut.map((file) => ({ blob: file.blob, name: file.name }));

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        {!archive ? (
          <ToolEmptyState
            icon={<FileArchive className="size-5" />}
            title="Drop a ZIP you cannot open."
            description="It is read and decrypted in this tab. Nothing is uploaded, and no copy of your file is stored anywhere."
          />
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={undefined}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void add([file]);
                event.target.value = "";
              }}
              id="zip-input"
            />
            <Button variant="secondary" onClick={() => document.getElementById("zip-input")?.click()} disabled={busy}>
              <FolderOpen className="mr-1.5 inline size-4" aria-hidden="true" />
              {archive ? "Choose another ZIP" : "Choose a ZIP"}
            </Button>
            {archive ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-muted)]">
                  {archive.name} · {formatBytes(archive.size)}
                </span>
                <Button size="sm" variant="ghost" onClick={handleReset} disabled={busy}>
                  Clear
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {listing ? (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-medium text-[var(--text-ink)]">
                <ListChecks className="mr-1.5 inline size-3.5" aria-hidden="true" />
                {listing.entries.length} entr{listing.entries.length === 1 ? "y" : "ies"},{" "}
                {listing.encryptedCount} encrypted
              </h3>
              <span className="rounded-full border border-[var(--surface-line-strong)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                {ENCRYPTION_COPY[listing.encryption].label}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {ENCRYPTION_COPY[listing.encryption].blurb}
            </p>

            {listing.namesVisible ? (
              <ul className="max-h-40 overflow-y-auto rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] p-2 text-xs">
                {listing.entries.map((entry) => (
                  <li key={entry.filename} className="flex items-center justify-between gap-2 px-1 py-0.5">
                    <span className="min-w-0 truncate font-mono text-[var(--text-ink)]">{entry.filename}</span>
                    <span className="shrink-0 text-[var(--text-muted)]">
                      {entry.directory ? "dir" : formatBytes(entry.uncompressedSize)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs italic text-[var(--text-muted)]">
                Filenames in an AES archive are encrypted, so they cannot be listed until the password is recovered.
              </p>
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <Field
            label="Your own words"
            hint="Tried first, before the common list. The file name, the project, the year, the company — whatever it might have been."
          >
            {({ id: fieldId, describedBy }) => (
              <Input
                id={fieldId}
                aria-describedby={describedBy}
                value={extraWords}
                disabled={busy}
                onChange={(event) => setExtraWords(event.target.value)}
                placeholder="project name, 2019, company"
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[13px] text-[var(--text-ink)]">
              <input
                type="checkbox"
                checked={includeYears}
                disabled={busy}
                onChange={(event) => setIncludeYears(event.target.checked)}
                className="size-4 accent-[var(--color-brand-500)]"
              />
              Try years
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--text-ink)]">
              <input
                type="checkbox"
                checked={includeDecorations}
                disabled={busy}
                onChange={(event) => setIncludeDecorations(event.target.checked)}
                className="size-4 accent-[var(--color-brand-500)]"
              />
              Try capitalised and numbered variants
            </label>
          </div>
        </div>

        {busy ? (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
            <ProgressBar
              stage={phase === "extracting" ? "finalizing" : "processing"}
              // Real ratio: candidates actually tried out of the total. This is
              // one of the few places where a percentage is honest.
              percent={total > 0 ? (tried / total) * 100 : null}
              caption={
                phase === "reading"
                  ? "Reading the archive"
                  : phase === "extracting"
                    ? "Extracting your files"
                    : `Trying passwords — ${tried} of ${total}`
              }
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--text-muted)]">Runs entirely in this tab.</p>
              <Button variant="outline" size="sm" onClick={cancel}>
                Stop
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <ToolError title={error} onRetry={() => void start()} />
        ) : null}

        {recovered ? (
          <div className="flex flex-col gap-4 rounded-[14px] border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
            <h3 className="text-[15px] font-semibold text-[var(--text-ink)]">
              <KeyRound className="mr-1.5 inline size-4" aria-hidden="true" />
              Password found
            </h3>

            <div className="rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] px-3 py-2.5">
              <code className="font-mono text-sm text-[var(--text-ink)]">{recovered}</code>
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              Found after {tried} attempt{tried === 1 ? "" : "s"} in {formatDuration(elapsed / 1000)}.
            </p>

            {filesOut.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {filesOut.length === 1 && filesOut[0] ? (
                    <DownloadButton
                      blob={filesOut[0].blob}
                      filename={filesOut[0].name}
                      label={`Download ${filesOut[0].name}`}
                    />
                  ) : null}
                  <DownloadGroupButton blobs={namedBlobs} />
                </div>
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] p-2 text-xs">
                  {filesOut.map((file) => (
                    <li key={file.name} className="flex items-center justify-between gap-2 px-1 py-0.5">
                      <span className="min-w-0 truncate font-mono text-[var(--text-ink)]">{file.name}</span>
                      <span className="shrink-0 text-[var(--text-muted)]">{formatBytes(file.blob.size)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No files were returned from that archive.</p>
            )}
          </div>
        ) : null}

        {!recovered && listing && listing.encryptedCount > 0 && !busy ? (
          <Button
            variant="primary"
            onClick={() => void start()}
            disabled={listing.encryptedCount === 0}
          >
            <KeyRound className="mr-1.5 inline size-4" aria-hidden="true" />
            Try to recover
          </Button>
        ) : null}

        <Notice tone="warning" icon={<ShieldAlert className="size-4" />}>
          This recovers passwords people choose, not strong ones. A list of around{" "}
          {buildWordlist().length} common passwords and years will get a forgotten archive open when the password was
          something ordinary. It cannot break a genuinely strong password, and if it finds nothing it says so rather
          than pretending to keep trying.
        </Notice>

        <Notice tone="info" icon={<TriangleAlert className="size-4" />}>
          Only use this on archives of your own. Removing protection from someone else&rsquo;s file is unlawful in
          most places regardless of the tool used.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/** Everything as one ZIP, which is what most people actually want back. */
function DownloadGroupButton({ blobs }: { blobs: NamedBlob[] }) {
  const [busy, setBusy] = React.useState(false);

  if (blobs.length < 2) return null;

  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={() => {
        setBusy(true);
        downloadZipBatch(blobs, "recovered-files.zip")
          .then(() => toast.downloadReady("recovered-files.zip"))
          .catch(() => toast.error("The files could not be packed into a ZIP."))
          .finally(() => setBusy(false));
      }}
    >
      <Download className="mr-1.5 inline size-4" aria-hidden="true" />
      Download all {blobs.length} as a ZIP
    </Button>
  );
}