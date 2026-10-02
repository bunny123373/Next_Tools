"use client";

import * as React from "react";
import { Eraser, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import {
  readVideoMetadata,
  stripVideoMetadata,
  type VideoTag,
  type VideoTagReport,
} from "@/lib/tools/engines/video-meta";
import { formatBytes } from "@/lib/utils/format";
import { useFiles } from "@/lib/hooks";
import { SITE } from "@/lib/site";
import { ToolShell } from "@/components/tools/ToolShell";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
import {
  FileStage,
  ProcessButton,
  ResetButton,
  ResultsPanel,
  useTransform,
  type TransformFn,
  type TransformResult,
} from "@/components/tools/workspaces/shared/FileStage";
import { Stat } from "@/components/ui/form";
import { recordJob } from "@/components/user/recordJob";

const TOOL = {
  id: "video-metadata-remover",
  category: "video",
  processing: "local",
} as const satisfies Pick<Tool, "id" | "category" | "processing">;

/** There are no options: the operation is the same for every file. */
type StripOptions = Record<string, never>;

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/* Written during the transform, read back on render, so each file is parsed
 * and verified exactly once per run. Per-instance, so it cannot leak. */
type Report = {
  report: VideoTagReport;
  outcome: Awaited<ReturnType<typeof stripVideoMetadata>>;
};

function TagRow({ tag }: { tag: VideoTag }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-[var(--surface-line)] py-1.5 last:border-b-0">
      <span className="shrink-0 text-[13px] text-[var(--text-muted)]">{tag.label}</span>
      <span className="min-w-0 truncate text-right font-mono text-[12px] text-[var(--text-ink)]">
        {tag.value ?? `${formatBytes(tag.bytes)} of data`}
      </span>
    </li>
  );
}

export default function VideoMetadataRemoverWorkspace() {
  const [scan, setScan] = React.useState<{ key: string; report: VideoTagReport } | null>(null);
  const [detail, setDetail] = React.useState<Report | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);

  const { files, add, remove, clear } = useFiles({
    category: "video",
    maxBytes: SITE.limits.video,
  });

  const file = files[0];

  const options = React.useMemo<StripOptions>(() => ({}), []);

  // Read the tags as soon as a file arrives, so the user sees what is inside it
  // before deciding to remove anything. Purely informational; the strip itself
  // re-reads, because the result has to reflect the file actually processed.
  React.useEffect(() => {
    if (!file) {
      setScan(null);
      return;
    }
    const key = fileKey(file);
    let active = true;
    setScanning(true);
    setScanError(null);
    void readVideoMetadata(file)
      .then((report) => {
        if (active) setScan({ key, report });
      })
      .catch((error: unknown) => {
        if (active) {
          setScanError(error instanceof Error ? error.message : "The file could not be read.");
        }
      })
      .finally(() => {
        if (active) setScanning(false);
      });
    return () => {
      active = false;
    };
  }, [file]);

  const transform = React.useCallback<TransformFn<StripOptions>>(
    async (files, _options, report) => {
      const results: TransformResult[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const current = files[index];
        if (!current) continue;

        report({
          percent: files.length > 1 ? (index / files.length) * 100 : null,
          done: index,
          total: files.length,
          caption: `Removing metadata from ${current.name}`,
        });

        const outcome = await stripVideoMetadata(current, current.name);
        const reportRead = await readVideoMetadata(current);
        /* One file at a time, so plain state is the right home for this rather
         * than a ref-and-map. A ref would also have to be read during render,
         * which the react-hooks/refs rule correctly refuses: the value comes
         * from an async callback and a render could observe it mid-write. */
        setDetail({ report: reportRead, outcome });

        results.push({
          blob: outcome.blob,
          filename: outcome.filename,
          source: current,
          note: outcome.removed.length
            ? `${outcome.removed.length} field${outcome.removed.length === 1 ? "" : "s"} removed`
            : "no metadata found",
        });

        report({
          percent: files.length > 1 ? ((index + 1) / files.length) * 100 : null,
          done: index + 1,
          total: files.length,
        });
      }

      return results;
    },
    [],
  );

  const { results, stage, percent, done, total, caption, error, run, reset, isRunning } =
    useTransform({ transform, options });

  const start = React.useCallback(() => {
    if (!file || isRunning) return;
    reported.current = null;
    void run([file]);
  }, [file, isRunning, run]);

  const resetAll = React.useCallback(() => {
    reported.current = null;
    setDetail(null);
    reset();
    clear();
    setScan(null);
    setScanError(null);
  }, [reset, clear]);

  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (stage === "complete" && results.length > 0 && reported.current !== "complete") {
      reported.current = "complete";
      recordJob(TOOL, {
        status: "success",
        fileName: results[0]?.filename,
        inputBytes: file?.size,
        outputBytes: results[0]?.blob.size,
      });
    }
    if (error && reported.current !== error) {
      reported.current = error;
      recordJob(TOOL, {
        status: "error",
        fileName: file?.name,
        inputBytes: file?.size,
        errorMessage: error,
      });
    }
  }, [stage, results, error, file]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [start]);

  const result = results[0];
  const outcome = detail?.outcome ?? null;

  const showScan = scan?.key === (file ? fileKey(file) : null) && !outcome;
  /* After a strip the removed list is the record of what was there; before one,
   * the pre-scan is what is currently in the file. Parenthesis matters: without
   * it `a ?? b ? c : d` parses as `(a ?? b) ? c : d`, which yields `[]` instead
   * of the scan whenever the scan happens to be null. */
  const tags: VideoTag[] = outcome ? outcome.removed : showScan ? (scan?.report.tags ?? []) : [];
  const unsupported = outcome?.unsupported ?? null;
  const saved = outcome ? outcome.beforeBytes - outcome.afterBytes : 0;

  return (
    <ToolShell>
      <FileStage
        files={files}
        onAdd={add}
        onRemove={remove}
        onClear={clear}
        category="video"
        maxBytes={SITE.limits.video}
        stage={stage}
        percent={percent}
        done={done}
        total={total}
        caption={caption}
        error={error}
        onRetry={start}
        dropzoneLabel="Drop a video here to clean it"
        dropzoneHint="MP4, MOV and 3GP up to 500 MB. Everything happens in this tab — the file is never uploaded."
        emptyTitle="Drop a video here to clean it."
        emptyDescription="Removes title, author, encoder, date and location tags without re-encoding. The picture and sound are copied exactly as they were."
        action={
          <ProcessButton
            label="Remove metadata"
            icon={<Eraser className="size-4" aria-hidden="true" />}
            onClick={start}
            disabled={!file}
            loading={isRunning}
          />
        }
        secondary={<ResetButton onClick={resetAll} />}
      />

      {error ? (
        <ToolError className="mt-6" title="The video could not be cleaned." detail={error} onRetry={start}>
          <p className="max-w-md text-[13px] text-[var(--text-muted)]">
            The file is never modified in place, so trying again is safe. A truncated or partially
            downloaded video often has a container the tool cannot walk.
          </p>
        </ToolError>
      ) : null}

      {unsupported ? (
        <Notice tone="warning" icon={<TriangleAlert className="size-4" aria-hidden="true" />}>
          {unsupported}
        </Notice>
      ) : null}

      {scanError && !outcome ? <Notice tone="warning">{scanError}</Notice> : null}

      {showScan && !unsupported ? (
        <section className="mt-6 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
            What is in this file{scan?.report.brand ? ` — ${scan.report.brand}` : ""}
          </h3>
          {scanning ? (
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">Reading the container…</p>
          ) : tags.length === 0 ? (
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
              No metadata tags found. That is normal for a screen recording, and for anything already
              through an editor — most tools write a clean file rather than leaving tags behind.
            </p>
          ) : (
            <ul className="mt-2">
              {tags.map((tag) => (
                <TagRow key={tag.key} tag={tag} />
              ))}
            </ul>
          )}
          {scan?.report.hasLocation ? (
            <Notice tone="warning" icon={<TriangleAlert className="size-4" aria-hidden="true" />}>
              This file records a location. Removing it here keeps it on your device rather than
              sending it to a service that would now have a copy.
            </Notice>
          ) : null}
        </section>
      ) : null}

      {outcome && result ? (
        <ResultsPanel title="Clean copy" className="mt-6">
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Tags removed"
                value={String(outcome.removed.length)}
                hint={
                  outcome.wasAlreadyClean
                    ? "nothing was embedded"
                    : formatBytes(outcome.removedBytes) + " of atoms"
                }
              />
              <Stat
                label="Size"
                value={formatBytes(outcome.afterBytes)}
                hint={`was ${formatBytes(outcome.beforeBytes)}`}
              />
              <Stat
                label="Quality"
                value="unchanged"
                hint="no re-encode"
              />
              <Stat
                label="Verified"
                value={outcome.verified ? "yes" : "check below"}
                hint="read back after writing"
              />
            </dl>

            <Notice tone="info" icon={<ShieldCheck className="size-4" aria-hidden="true" />}>
              The video and audio data was copied byte for byte — only the metadata block was left
              out. {saved > 0 ? `${formatBytes(saved)} smaller.` : "The file size is unchanged."}{" "}
              Boxes still present: {outcome.boxes.join(", ") || "none"}.
            </Notice>

            {outcome.wasAlreadyClean ? (
              <Notice tone="info" icon={<Info className="size-4" aria-hidden="true" />}>
                This file had no metadata to remove. A clean copy was still produced so you can
                publish without checking.
              </Notice>
            ) : null}

            {outcome.removed.length > 0 ? (
              <ul>
                {outcome.removed.map((tag) => (
                  <TagRow key={tag.key} tag={tag} />
                ))}
              </ul>
            ) : null}

            {!outcome.verified ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" aria-hidden="true" />}>
                Reading the output back found metadata that should not be there. The clean copy has
                still been produced, but check it plays before publishing.
              </Notice>
            ) : null}

            <Notice tone="warning" icon={<TriangleAlert className="size-4" aria-hidden="true" />}>
              This removes data stored alongside the video, not a visible watermark. A logo burned
              into the frames is part of the picture and is left exactly as it is.
            </Notice>

            <DownloadButton
              blob={result.blob}
              filename={result.filename}
              caption={`${formatBytes(outcome.afterBytes)} · metadata removed · video and audio untouched`}
            />
          </div>
        </ResultsPanel>
      ) : null}
    </ToolShell>
  );
}
