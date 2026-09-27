"use client";

import * as React from "react";
import { Eraser, Save, Tags } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
} from "@/components/tools/workspaces/shared/FileStage";
import { DownloadButton, OpenButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes, formatDateTime } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import {
  applyMetadataFields,
  emptyMetadataFields,
  fieldsFromInfo,
  loadPdfDocument,
  readDocumentInfo,
  stripDocumentMetadata,
  type DocumentInfo,
  type MetadataFields,
} from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-metadata", category: "pdf", processing: "local" } as const;

type Action = "set" | "strip";

interface Options {
  fields: MetadataFields;
  outputName: string;
}

const FIELD_LABELS: Record<keyof MetadataFields, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
  producer: "Producer",
};

export default function PdfMetadataWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const [info, setInfo] = React.useState<DocumentInfo | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);
  const [fields, setFields] = React.useState<MetadataFields>(emptyMetadataFields);
  const [fieldsDirty, setFieldsDirty] = React.useState(false);
  const [outputName, setOutputName] = React.useState("metadata");
  const [applied, setApplied] = React.useState<{ action: Action; count: number } | null>(null);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";

  React.useEffect(() => {
    setInfo(null);
    setReadError(null);
    setFieldsDirty(false);
    setApplied(null);
    if (!file) return;
    let cancelled = false;
    setReading(true);
    void (async () => {
      try {
        const document = await readDocumentInfo(file);
        if (cancelled) return;
        setInfo(document);
        setFields(fieldsFromInfo(document));
      } catch (error) {
        if (cancelled) return;
        setReadError(error instanceof Error ? error.message : "This file could not be read.");
      } finally {
        if (!cancelled) setReading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, file]);

  /**
   * Which button was pressed. This is a control channel, not displayed state,
   * so a ref is the right tool: `run()` reads it synchronously.
   */
  const actionRef = React.useRef<Action>("set");

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      const action = actionRef.current;
      report({ percent: null, done: 0, total: inputs.length, caption: "Opening the document" });

      const doc = await loadPdfDocument(input, { inspectOnly: action === "strip" });
      if (action === "set") {
        applyMetadataFields(doc, options.fields);
      } else {
        await stripDocumentMetadata(doc);
      }
      report({ percent: 100, done: inputs.length, total: inputs.length, caption: "Writing the document" });

      const bytes = await doc.save();
      const after = await readDocumentInfo(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      );
      setInfo(after);
      setFields(fieldsFromInfo(after));
      setFieldsDirty(false);
      setApplied({ action, count: countPopulated(after) });

      return [
        {
          blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: action === "strip" ? "Metadata removed" : "Metadata updated",
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({ transform, options: { fields, outputName } });

  const bytesIn = file?.size ?? 0;

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${applied?.action}::ok`;
      if (recordedKey.current === key) return;
      recordedKey.current = key;
      recordJob(TOOL, {
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
      recordJob(TOOL, {
        status: "error",
        fileName: file?.name,
        fileCount: 1,
        inputBytes: bytesIn,
        errorMessage: error,
      });
    }
  }, [stage, results, error, fileKey, applied, file, bytesIn]);

  const runAction = React.useCallback(
    (action: Action) => {
      if (!file || readError) return;
      actionRef.current = action;
      void run(files);
    },
    [file, readError, files, run],
  );

  const start = React.useCallback(() => runAction("set"), [runAction]);

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
            dropzoneLabel="Drop a PDF here to read its properties"
            dropzoneHint="One file at a time. Reading the properties does not change the file."
            renderMeta={() =>
              reading ? "Reading…" : info ? `${info.pageCount} pages` : undefined
            }
            controls={
              <div className="grid gap-4">
                {(Object.keys(FIELD_LABELS) as (keyof MetadataFields)[]).map((key) => (
                  <Field key={key} label={FIELD_LABELS[key]}>
                    {({ id }) => (
                      <Input
                        id={id}
                        value={fields[key]}
                        placeholder="Not set — leave empty to keep it clear"
                        spellCheck={false}
                        onChange={(event) => {
                          setFields((current) => ({ ...current, [key]: event.target.value }));
                          setFieldsDirty(true);
                        }}
                      />
                    )}
                  </Field>
                ))}
                <Field
                  label="Output name"
                  hint="The rewritten document is saved under this name."
                >
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
              </div>
            }
            action={
              <ProcessButton
                label="Save changes"
                icon={<Save className="size-4" aria-hidden="true" />}
                onClick={start}
                disabled={!file || Boolean(readError) || !fieldsDirty}
                loading={isRunning}
              />
            }
            secondary={
              <Button
                variant="danger"
                onClick={() => runAction("strip")}
                disabled={!file || Boolean(readError) || isRunning}
                destructive
              >
                <Eraser className="size-4" aria-hidden="true" />
                Remove all metadata
              </Button>
            }
            stage={stage}
            percent={percent}
            done={done}
            total={total}
            caption={caption}
            error={error}
            onRetry={start}
          />

          <div className="flex flex-col gap-4">
            {readError ? (
              <ToolError title="This PDF's properties could not be read." detail={readError} />
            ) : info ? (
              <ResultsPanel title="Document properties">
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Pages" value={info.pageCount} />
                  <Stat
                    label="Page size"
                    value={
                      info.distinctPageSizes.length > 0
                        ? `${Math.round(info.distinctPageSizes[0]!.size.width)} × ${Math.round(
                            info.distinctPageSizes[0]!.size.height,
                          )}`
                        : "—"
                    }
                    hint={
                      info.distinctPageSizes.length > 1
                        ? `${info.distinctPageSizes.length} different sizes`
                        : "points"
                    }
                  />
                  <Stat
                    label="Encrypted"
                    value={info.isEncrypted ? "Yes" : "No"}
                    tone={info.isEncrypted ? "brand" : "default"}
                  />
                  <Stat label="PDF version" value={info.pdfVersion ?? "—"} />
                  <Stat
                    label="XMP stream"
                    value={info.hasXmp ? "Present" : "None"}
                    hint={info.hasXmp ? "removable" : "nothing to strip"}
                  />
                  <Stat
                    label="Indirect objects"
                    value={info.objectCount}
                    hint={info.invalidObjectCount > 0 ? `${info.invalidObjectCount} unreadable` : undefined}
                  />
                </dl>

                <dl className="grid gap-2">
                  <InfoRow label="Title" value={info.title} />
                  <InfoRow label="Author" value={info.author} />
                  <InfoRow label="Subject" value={info.subject} />
                  <InfoRow
                    label="Keywords"
                    value={info.keywords.length > 0 ? info.keywords.join(", ") : null}
                  />
                  <InfoRow label="Creator" value={info.creator} />
                  <InfoRow label="Producer" value={info.producer} />
                  <InfoRow
                    label="Created"
                    value={info.creationDate ? formatDateTime(info.creationDate) : null}
                  />
                  <InfoRow
                    label="Modified"
                    value={info.modificationDate ? formatDateTime(info.modificationDate) : null}
                  />
                </dl>

                <Notice tone="info" icon={<Tags className="size-4" aria-hidden="true" />}>
                  {countPopulated(info) === 0
                    ? "This PDF has no document properties at all — nothing has been written into it."
                    : `${countPopulated(info)} of the 6 writable fields are set. Creator and Producer often name the tool that last wrote the file, which is worth checking before you share it publicly.`}
                </Notice>

                {applied ? (
                  <Notice
                    tone="success"
                    title={applied.action === "strip" ? "Metadata removed." : "Metadata updated."}
                  >
                    {applied.action === "strip"
                      ? "The info dictionary is cleared and the XMP stream is gone. Anything drawn into the page content itself is untouched."
                      : "The six writable fields were written into the document."}{" "}
                    {countPopulated(info)} field{countPopulated(info) === 1 ? " is" : "s are"} now set.
                  </Notice>
                ) : null}

                {result ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <DownloadButton
                      blob={result.blob}
                      filename={result.filename}
                      label="Download updated PDF"
                      caption={`${formatBytes(result.blob.size)}${
                        bytesIn > 0 ? ` · from ${formatBytes(bytesIn)}` : ""
                      }`}
                    />
                    <OpenButton blob={result.blob} filename={result.filename} />
                  </div>
                ) : null}
              </ResultsPanel>
            ) : (
              <Notice tone="info" icon={<Tags className="size-4" aria-hidden="true" />}>
                {reading
                  ? "Reading the document information dictionary…"
                  : "Drop a PDF and its real title, author, producer, dates and encryption state appear here."}
              </Notice>
            )}
          </div>
        </div>

        {result ? <ResetButton onClick={reset} /> : null}
      </div>
    </ToolShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2">
      <dt className="shrink-0 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-[13px] text-[var(--text-ink)]">
        {value ?? <span className="text-[var(--text-muted)]">Not set</span>}
      </dd>
    </div>
  );
}

function countPopulated(info: DocumentInfo): number {
  return (
    (info.title ? 1 : 0) +
    (info.author ? 1 : 0) +
    (info.subject ? 1 : 0) +
    (info.keywords.length > 0 ? 1 : 0) +
    (info.creator ? 1 : 0) +
    (info.producer ? 1 : 0)
  );
}
