"use client";

import * as React from "react";
import { Lock } from "lucide-react";
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
import { Checkbox, Field, Input, Segmented, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import type { Tool } from "@/lib/tools/types";
import { PDF_TOOLS } from "@/lib/tools/definitions/pdf";
import { getPdfPageCount } from "@/lib/tools/engines/pdf";

/** Pulled straight from the definitions so the panel can never drift. */
const TOOL = PDF_TOOLS.find((tool) => tool.id === "pdf-protect") as Tool;

const TOOL_META = { id: TOOL.id, category: TOOL.category, processing: TOOL.processing } as const;

const ENCRYPTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "128", label: "128-bit AES" },
  { value: "256", label: "256-bit AES" },
];

const ENDPOINT = "/api/tools/pdf/encrypt";

interface Options {
  userPassword: string;
  ownerPassword: string;
  encryption: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  outputName: string;
}

export default function PdfProtectWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const [userPassword, setUserPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [ownerPassword, setOwnerPassword] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [encryption, setEncryption] = React.useState("128");
  const [allowPrinting, setAllowPrinting] = React.useState(false);
  const [allowCopying, setAllowCopying] = React.useState(false);
  const [outputName, setOutputName] = React.useState("protected");
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [served, setServed] = React.useState<number | null>(null);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  React.useEffect(() => {
    setPageCount(null);
    setReadError(null);
    setServed(null);
    if (!file) return;
    let cancelled = false;
    void (async () => {
      try {
        const count = await getPdfPageCount(file);
        if (!cancelled) setPageCount(count);
      } catch (error) {
        if (cancelled) return;
        setReadError(error instanceof Error ? error.message : "This file could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, file]);

  const validation = React.useMemo(() => {
    if (userPassword.length === 0) return "Choose a password to open the document with.";
    if (userPassword.length < 4) return "Use at least 4 characters — most readers refuse anything shorter.";
    if (confirmPassword !== userPassword) return "The two passwords do not match.";
    if (ownerPassword.length > 0 && ownerPassword.length < 4) {
      return "An owner password also needs at least 4 characters.";
    }
    return null;
  }, [userPassword, confirmPassword, ownerPassword]);

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");

      report({ percent: null, done: 0, total: 1, caption: "Sending the file to the encryption service" });

      const base64 = await blobToBase64(input);
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: input.name,
            file: base64,
            userPassword: options.userPassword,
            ownerPassword: options.ownerPassword.length > 0 ? options.ownerPassword : null,
            encryption: options.encryption,
            permissions: {
              printing: options.allowPrinting,
              copying: options.allowCopying,
            },
          }),
        });
      } catch {
        throw new Error(
          `No response from ${ENDPOINT}. The encryption service is not reachable, which is what happens before PDF_ENCRYPTION_API_URL is configured.`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `${ENDPOINT} responded with ${response.status}. The encryption service is not configured on this deployment, so the PDF cannot be encrypted here.`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/pdf")) {
        throw new Error(
          `${ENDPOINT} answered with "${contentType || "an unknown type"}" instead of a PDF, so it is not the encryption service this tool expects.`,
        );
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error(`${ENDPOINT} returned an empty file.`);
      setServed(blob.size);
      report({ percent: 100, done: 1, total: 1, caption: "Received the encrypted document" });

      return [
        {
          blob,
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: `${formatBytes(blob.size)} · ${options.encryption}-bit AES`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({
      transform,
      options: {
        userPassword,
        ownerPassword,
        encryption,
        allowPrinting,
        allowCopying,
        outputName,
      },
    });

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

  const canRun = Boolean(file) && !validation && !readError;

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
            emptyTitle="Drop a PDF to protect."
            emptyDescription="Set the passwords and permissions. Encryption is done by a server service this deployment has not configured yet."
            dropzoneHint="One file at a time. The file is only uploaded when you press Encrypt PDF."
            renderMeta={() =>
              pageCount === null ? (readError ? <span className="text-brand-500">Unreadable</span> : "Reading…") : `${pageCount} pages`
          }
            controls={
              <div className="grid gap-4">
                <Field label="Document password" hint="Needed to open the file. At least 4 characters.">
                  {({ id }) => (
                    <Input
                      id={id}
                      type={reveal ? "text" : "password"}
                      autoComplete="new-password"
                      value={userPassword}
                      onChange={(event) => setUserPassword(event.target.value)}
                      placeholder="Required"
                    />
                  )}
                </Field>

                <Field label="Confirm password" error={validation}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type={reveal ? "text" : "password"}
                      autoComplete="new-password"
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Type it again"
                    />
                  )}
                </Field>

                <Field
                  label="Owner password"
                  hint="Optional. Opens the file and controls the permission flags. Leave empty for none."
                >
                  {({ id }) => (
                    <Input
                      id={id}
                      type={reveal ? "text" : "password"}
                      autoComplete="new-password"
                      value={ownerPassword}
                      onChange={(event) => setOwnerPassword(event.target.value)}
                      placeholder="Optional"
                    />
                  )}
                </Field>

                <Checkbox
                  label="Show passwords"
                  description="Nothing is stored — it only changes the input type."
                  checked={reveal}
                  onChange={(event) => setReveal(event.target.checked)}
                />

                <Field label="Encryption">
                  {() => (
                    <Segmented
                      label="Encryption"
                      options={ENCRYPTION_OPTIONS}
                      value={encryption}
                      onChange={setEncryption}
                    />
                  )}
                </Field>

                <fieldset className="grid gap-2.5">
                  <legend className="text-[13px] font-medium text-[var(--text-ink)]">
                    Permissions for readers without the owner password
                  </legend>
                  <Checkbox
                    label="Allow printing"
                    checked={allowPrinting}
                    onChange={(event) => setAllowPrinting(event.target.checked)}
                  />
                  <Checkbox
                    label="Allow copying text"
                    checked={allowCopying}
                    onChange={(event) => setAllowCopying(event.target.checked)}
                  />
                </fieldset>

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
                    <Stat label="Pages" value={pageCount ?? "…"} />
                    <Stat label="Size" value={formatBytes(bytesIn)} />
                  </dl>
                ) : null}
              </div>
            }
            action={
              <ProcessButton
                label="Encrypt PDF"
                icon={<Lock className="size-4" aria-hidden="true" />}
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
                  Encrypted by {ENDPOINT}
                </p>
                <p className="text-[13px] text-[var(--text-muted)]">
                  {formatBytes(result.blob.size)} · {result.note}
                </p>
                <DownloadButton
                  blob={result.blob}
                  filename={result.filename}
                  label="Download encrypted PDF"
                  caption={formatBytes(result.blob.size)}
                />
              </div>
            ) : error ? (
              <ToolError
                title="The PDF could not be encrypted."
                detail={error}
                onRetry={canRun ? start : undefined}
              />
            ) : (
              <Notice tone="warning" icon={<Lock className="size-4" aria-hidden="true" />}>
                pdf-lib cannot write PDF encryption, and a browser cannot run the native library that
                does. This tool posts to {ENDPOINT}, which this deployment has not implemented — so
                pressing the button reports that instead of pretending to protect your file.
              </Notice>
            )}

            <SetupRequired tool={TOOL} />
          </div>
        </div>

        {file ? (
          <p className="text-xs text-[var(--text-muted)]">
            Nothing is uploaded until you press Encrypt PDF. When the service is configured, the file
            and the password are posted to {ENDPOINT} and the temporary copy is deleted when the
            request ends.
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
