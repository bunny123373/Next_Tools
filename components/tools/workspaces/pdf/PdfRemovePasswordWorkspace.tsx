"use client";

import * as React from "react";
import { Unlock } from "lucide-react";
import { ToolShell, SetupRequired } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
import { Checkbox, Field, Input, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import type { Tool } from "@/lib/tools/types";
import { PDF_TOOLS } from "@/lib/tools/definitions/pdf";
import { readDocumentInfo } from "@/lib/tools/engines/pdf";

/** Pulled straight from the definitions so the panel can never drift. */
const TOOL = PDF_TOOLS.find((tool) => tool.id === "pdf-remove-password") as Tool;

const TOOL_META = { id: TOOL.id, category: TOOL.category, processing: TOOL.processing } as const;

const ENDPOINT = "/api/tools/pdf/decrypt";

interface Options {
  password: string;
  ownerPassword: string;
  outputName: string;
}

export default function PdfRemovePasswordWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const [password, setPassword] = React.useState("");
  const [ownerPassword, setOwnerPassword] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [outputName, setOutputName] = React.useState("unlocked");
  const [encrypted, setEncrypted] = React.useState<boolean | null>(null);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [served, setServed] = React.useState<number | null>(null);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  React.useEffect(() => {
    setEncrypted(null);
    setPageCount(null);
    setReadError(null);
    setServed(null);
    if (!file) return;
    let cancelled = false;
    void (async () => {
      try {
        // `readDocumentInfo` reads the structure only, which is exactly what we
        // need: whether the file declares an /Encrypt dictionary.
        const info = await readDocumentInfo(file);
        if (cancelled) return;
        setEncrypted(info.isEncrypted);
        setPageCount(info.pageCount);
      } catch (error) {
        if (cancelled) return;
        setReadError(error instanceof Error ? error.message : "This file could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, file]);

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      if (options.password.length === 0) throw new Error("Enter the password for this PDF.");

      report({ percent: null, done: 0, total: 1, caption: "Sending the file to the decryption service" });

      const base64 = await blobToBase64(input);
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: input.name,
            file: base64,
            password: options.password,
            ownerPassword: options.ownerPassword.length > 0 ? options.ownerPassword : null,
          }),
        });
      } catch {
        throw new Error(
          `No response from ${ENDPOINT}. The decryption service is not reachable, which is what happens before PDF_ENCRYPTION_API_URL is configured.`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `${ENDPOINT} responded with ${response.status}. The decryption service is not configured on this deployment, so the PDF cannot be decrypted here.`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/pdf")) {
        throw new Error(
          `${ENDPOINT} answered with "${contentType || "an unknown type"}" instead of a PDF, so it is not the decryption service this tool expects.`,
        );
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error(`${ENDPOINT} returned an empty file.`);
      setServed(blob.size);
      report({ percent: 100, done: 1, total: 1, caption: "Received the decrypted document" });

      return [
        {
          blob,
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: formatBytes(blob.size),
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({ transform, options: { password, ownerPassword, outputName } });

  const bytesIn = file?.size ?? 0;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::ok`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL_META, {
        status: "success",
        fileName: file?.name,
        fileCount: 1,
        inputBytes: bytesIn,
        outputBytes: results.reduce((sum, r) => sum + r.blob.size, 0),
        outputName: results[0]?.filename,
      });
    } else if (error) {
      const key = `${fileKey}::err::${error}`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL_META, {
        status: "error",
        fileName: file?.name,
        fileCount: 1,
        inputBytes: bytesIn,
        errorMessage: error,
      });
    }
  }, [stage, results, error, fileKey, file, bytesIn]);

  const canRun = Boolean(file) && password.length > 0 && !readError;

  const start = React.useCallback(() => {
    if (!canRun) return;
    void run(files);
  }, [canRun, files, run]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [start]);

  const result = results[0];

  return (
    <ToolShell>
      <div className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <FileStage
            files={files}
            onAdd={(incoming) => {
              queue.add(incoming);
              reset();
            }}
            onRemove={() => {
              queue.remove(0);
              reset();
            }}
            onClear={() => {
              queue.clear();
              reset();
            }}
            category="pdf"
            multiple={false}
            maxBytes={SITE.limits.pdf}
            dropzoneLabel="Drop a password-protected PDF here"
            dropzoneHint="One file at a time. The file is only uploaded when you press Remove password."
            renderMeta={() => {
              if (encrypted === null) {
                return readError ? <span className="text-brand-500">Unreadable</span> : "Reading…";
              }
              return encrypted
                ? `${pageCount ?? "?"} pages · encrypted`
                : `${pageCount ?? "?"} pages · not encrypted`;
            }}
            controls={
              <div className="grid gap-4">
                <Field label="Password" hint="The password the file was opened with. Never stored.">
                  {({ id }) => (
                    <Input
                      id={id}
                      type={reveal ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Required"
                    />
                  )}
                </Field>

                <Field
                  label="Owner password"
                  hint="Optional. Only needed for files where an owner password set the restrictions."
                >
                  {({ id }) => (
                    <Input
                      id={id}
                      type={reveal ? "text" : "password"}
                      autoComplete="current-password"
                      value={ownerPassword}
                      onChange={(event) => setOwnerPassword(event.target.value)}
                      placeholder="Optional"
                    />
                  )}
                </Field>

                <Checkbox
                  label="Show password"
                  description="Nothing is stored — it only changes the input type."
                  checked={reveal}
                  onChange={(event) => setReveal(event.target.checked)}
                />

                <Field label="Output name">
                  {({ id }) => (
                    <input
                      id={id}
                      value={outputName}
                      onChange={(event) => setOutputName(event.target.value)}
                      spellCheck={false}
                      className="h-10 w-full rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                    />
                  )}
                </Field>

                {file ? (
                  <dl className="grid grid-cols-2 gap-2">
                    <Stat
                      label="Encryption"
                      value={encrypted === null ? "…" : encrypted ? "Encrypted" : "Not encrypted"}
                      tone={encrypted ? "brand" : "default"}
                    />
                    <Stat label="Size" value={formatBytes(bytesIn)} />
                  </dl>
                ) : null}

                {encrypted === false ? (
                  <Notice tone="info" title="This file is not encrypted.">
                    Its info dictionary has no /Encrypt entry, so there is no password to remove. The
                    button below will still contact the service, which will have nothing to decrypt.
                  </Notice>
                ) : null}
              </div>
            }
            action={
              <ProcessButton
                label="Remove password"
                icon={<Unlock className="size-4" aria-hidden="true" />}
                onClick={start}
                disabled={!canRun}
                loading={isRunning}
              />
            }
            secondary={<ResetButton onClick={reset} />}
            stage={stage}
            percent={percent}
            done={done}
            total={total}
            caption={caption}
            error={error}
            onRetry={start}
          />

          <div className="flex flex-col gap-4">
            {result && served !== null ? (
              <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
                <p className="text-[15px] font-medium text-[var(--text-ink)]">
                  Decrypted by {ENDPOINT}
                </p>
                <p className="text-[13px] text-[var(--text-muted)]">{result.note}</p>
                <DownloadButton
                  blob={result.blob}
                  filename={result.filename}
                  label="Download decrypted PDF"
                  caption={formatBytes(result.blob.size)}
                />
              </div>
            ) : error ? (
              <ToolError
                title="The PDF could not be decrypted."
                detail={error}
                onRetry={canRun ? start : undefined}
              />
            ) : (
              <Notice tone="warning" icon={<Unlock className="size-4" aria-hidden="true" />}>
                Decrypting a PDF means applying the key derivation the file itself defines to every
                string and stream. pdf-lib can read an encrypted file&apos;s structure but not undo it,
                and Web Crypto has no PDF envelope — so this posts to {ENDPOINT}, which this
                deployment has not implemented.
              </Notice>
            )}

            <SetupRequired tool={TOOL} />
          </div>
        </div>

        {file ? (
          <p className="text-xs text-[var(--text-muted)]">
            Nothing is uploaded until you press Remove password. When the service is configured, the
            file and the password are posted to {ENDPOINT}; neither is written to a database and the
            temporary copy is deleted when the request ends.
          </p>
        ) : null}
      </div>
    </ToolShell>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunk) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
