"use client";

import * as React from "react";
import { CheckCircle2, Info, Wrench } from "lucide-react";
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
import { Notice } from "@/components/tools/states";
import { Checkbox, Stat } from "@/components/ui/form";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils/cn";
import { recordJob } from "@/components/user/recordJob";
import { formatBytes } from "@/lib/utils/format";
import { withExtension } from "@/lib/utils/files";
import { repairPdf, type RepairFinding, type RepairResult } from "@/lib/tools/engines/pdf";

const TOOL = { id: "pdf-repair", category: "pdf", processing: "local" } as const;

interface Options {
  dropOrphans: boolean;
  outputName: string;
}

export default function PdfRepairWorkspace() {
  const queue = useFiles({
    category: "pdf",
    maxBytes: SITE.limits.pdf,
    multiple: false,
  });
  const { files } = queue;
  const file = files[0] ?? null;

  const [dropOrphans, setDropOrphans] = React.useState(true);
  const [outputName, setOutputName] = React.useState("repaired");
  const [report, setReport] = React.useState<RepairResult | null>(null);

  const transform = React.useCallback<TransformFn<Options>>(
    async (inputs, options, report) => {
      const input = inputs[0];
      if (!input) throw new Error("Add a PDF first.");
      report({ percent: null, done: 0, total: 1, caption: "Parsing the file structure" });
      const result = await repairPdf(input, { dropOrphans: options.dropOrphans });
      setReport(result);
      report({ percent: 100, done: 1, total: 1, caption: "Rewrote the document" });
      return [
        {
          blob: result.blob,
          filename: withExtension(options.outputName, "pdf"),
          source: input,
          note: result.nothingToRepair
            ? "structure was already valid"
            : `${result.findings.filter((finding) => finding.kind === "fixed").length} fix${
                result.findings.filter((finding) => finding.kind === "fixed").length === 1 ? "" : "es"
              } applied`,
        },
      ];
    },
    [],
  );

  const { run, reset, results, stage, percent, done, total, caption, error, isRunning } =
    useTransform<Options>({ transform, options: { dropOrphans, outputName } });

  const resetAll = React.useCallback(() => {
    reset();
    setReport(null);
  }, [reset]);

  const bytesIn = file?.size ?? 0;
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";

  const recordedKey = React.useRef("");
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0) {
      const key = `${fileKey}::${dropOrphans}::ok`;
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
  }, [stage, results, error, fileKey, file, dropOrphans, bytesIn]);

  const start = React.useCallback(() => {
    if (!file) return;
    void run(files);
  }, [file, files, run]);

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
  const fixed = report?.findings.filter((finding) => finding.kind === "fixed") ?? [];

  return (
    <ToolShell>
      <div className="grid gap-6 lg:grid-cols-2">
        <FileStage
          files={files}
          onAdd={(incoming) => {
            queue.add(incoming);
            resetAll();
          }}
          onRemove={() => {
            queue.remove(0);
            resetAll();
          }}
          onClear={() => {
            queue.clear();
            resetAll();
          }}
          category="pdf"
          multiple={false}
          maxBytes={SITE.limits.pdf}
          emptyTitle="Drop a PDF that will not open."
          emptyDescription="It is parsed, its cross-reference table is rebuilt, and you get a clean file back."
          dropzoneHint="One file at a time. Structural repair only — content that is genuinely missing cannot be recovered."
          controls={
            <div className="grid gap-4">
              <Checkbox
                label="Drop orphaned objects"
                description="Removes indirect objects that nothing references any more, and reports the count."
                checked={dropOrphans}
                onChange={(event) => {
                  setDropOrphans(event.target.checked);
                  resetAll();
                }}
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Output name</span>
                <input
                  value={outputName}
                  onChange={(event) => setOutputName(event.target.value)}
                  spellCheck={false}
                  aria-label="Output file name"
                  className="h-10 w-full rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                />
              </label>
            </div>
          }
          action={
            <ProcessButton
              label="Repair PDF"
              icon={<Wrench className="size-4" aria-hidden="true" />}
              onClick={start}
              disabled={!file}
              loading={isRunning}
            />
          }
          secondary={<ResetButton onClick={resetAll} />}
          stage={stage}
          percent={percent}
          done={done}
          total={total}
          caption={caption}
          error={error}
          onRetry={start}
        />

        <div className="flex flex-col gap-4">
          {report ? (
            <ResultsPanel title="Diagnostics">
              {report.nothingToRepair ? (
                <Notice tone="success" icon={<CheckCircle2 className="size-4" aria-hidden="true" />}>
                  This PDF loaded without errors; nothing needed repairing. The file below is a
                  re-save with a freshly written cross-reference table, which is harmless and sometimes
                  enough to satisfy a stricter reader.
                </Notice>
              ) : (
                <Notice tone="success" title={`${fixed.length} fix${fixed.length === 1 ? "" : "es"} applied.`}>
                  Everything below was measured from the file, not guessed.
                </Notice>
              )}

              <ul className="grid gap-2">
                {report.findings.map((finding) => (
                  <li key={finding.text}>
                    <FindingRow finding={finding} />
                  </li>
                ))}
              </ul>

              <dl className="grid grid-cols-3 gap-2">
                <Stat label="Pages" value={report.pageCount} />
                <Stat label="Before" value={formatBytes(report.bytesBefore)} />
                <Stat label="After" value={formatBytes(report.bytesAfter)} />
              </dl>

              {result ? (
                <div className="flex flex-wrap items-center gap-2">
                  <DownloadButton
                    blob={result.blob}
                    filename={result.filename}
                    label="Download rewritten PDF"
                    caption={result.note ?? undefined}
                  />
                  <OpenButton blob={result.blob} filename={result.filename} />
                </div>
              ) : null}
            </ResultsPanel>
          ) : (
            <Notice tone="info" icon={<Wrench className="size-4" aria-hidden="true" />}>
              A PDF that parses cleanly was never badly broken, and this tool will say exactly that
              rather than claim a repair that did not happen. What it genuinely does is rewrite the
              file with a fresh cross-reference table, restore a missing end-of-file marker, drop
              orphaned objects, and normalise the trailer — each with a real count. It cannot help a
              file whose cross-reference table is gone, because a browser has no way to find objects
              that were never indexed.
            </Notice>
          )}
        </div>
      </div>
    </ToolShell>
  );
}

const FINDING_TONES: Record<RepairFinding["kind"], string> = {
  fixed: "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-500",
  clean: "border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-ink)]",
  info: "border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]",
};

function FindingRow({ finding }: { finding: RepairFinding }) {
  const icon =
    finding.kind === "fixed" ? (
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
    ) : (
      <Info className="size-3.5" aria-hidden="true" />
    );

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
        FINDING_TONES[finding.kind],
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {icon}
      </span>
      <span className="min-w-0 leading-relaxed">
        {finding.kind === "fixed" ? <strong className="font-semibold">Fixed: </strong> : null}
        {finding.text}
      </span>
    </div>
  );
}
