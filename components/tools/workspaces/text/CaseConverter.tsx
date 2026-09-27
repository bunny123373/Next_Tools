"use client";

import * as React from "react";
import { Copy, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { CopyButton } from "@/components/tools/DownloadButton";
import {
  TextWorkbench,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { CASE_OPTIONS, convertCase, type CaseMode } from "@/lib/tools/engines/text";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";

const SAMPLE = `the lord of the rings: a NASA-sized journey
it reads like one long sentence, and then another — until the well-known 42 words land.`;

const PREVIEW_CHARS = 72;

export default function CaseConverter() {
  const [value, setValue] = React.useState("");
  const [mode, setMode] = React.useState<CaseMode>("title");

  const results = React.useMemo(
    () => CASE_OPTIONS.map((option) => ({ ...option, output: convertCase(value, option.value) })),
    [value],
  );

  const selected = results.find((item) => item.value === mode) ?? results[0]!;
  const hint = CASE_OPTIONS.find((item) => item.value === mode)?.hint ?? "";

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value
        ? {
            text: selected.output,
            stats: [
              { label: "Case", value: selected.label, tone: "brand" },
              { label: "Characters", value: String([...value].length) },
              { label: "Words", value: String(value.trim() ? value.trim().split(/\s+/).length : 0) },
              { label: "Lines", value: String(value.split("\n").length) },
            ],
          }
        : null,
    [value, selected],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="converted-text"
        extension="txt"
        mime="text/plain;charset=utf-8"
        inputLabel="Source text"
        outputLabel={selected.label}
        inputPlaceholder="Type the text you want to re-case…"
        outputPlaceholder="Every case is listed below — pick one to see it here."
        sample={SAMPLE}
        rows={12}
        controls={
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
            <Segmented
              label="Target case"
              size="sm"
              value={mode}
              onChange={setMode}
              options={CASE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p>
          </div>
        }
        actions={
          <section aria-label="All cases" className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-[var(--text-ink)]">
              Every case at once
              <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                click a row to send it to the output pane
              </span>
            </h3>
            <ul className="flex flex-col gap-1.5">
              {results.map((item) => {
                const preview = item.output.replace(/\n/g, " ⏎ ");
                const truncated =
                  preview.length > PREVIEW_CHARS ? `${preview.slice(0, PREVIEW_CHARS)}…` : preview;
                const active = item.value === mode;
                return (
                  <li key={item.value}>
                    <div
                      className={cn(
                        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border px-3 py-2 transition-colors",
                        active
                          ? "border-brand-500/40 bg-brand-500/[0.06]"
                          : "border-[var(--surface-line)] bg-[var(--surface-card-2)]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setMode(item.value)}
                        aria-pressed={active}
                        className="w-32 shrink-0 rounded text-left font-mono text-[12px] text-[var(--text-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                      >
                        {item.label}
                      </button>
                      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text-muted)]">
                        {truncated || "—"}
                      </code>
                      <CopyButton
                        value={item.output || null}
                        size="icon-sm"
                        variant="ghost"
                        what={`${item.label} copied`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!value}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(results.map((item) => `${item.label}\n${item.output}`).join("\n\n"))
                    .then(() => toast.copied("All cases copied"))
                    .catch(() => toast.error("Couldn't copy", "Your browser blocked clipboard access."));
                }}
              >
                <Copy aria-hidden="true" className="size-3.5" />
                Copy all cases
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!value}
                onClick={() => {
                  setValue(selected.output);
                  toast.info(`Source replaced with ${selected.label}`);
                }}
              >
                <CornerDownLeft aria-hidden="true" className="size-3.5" />
                Use {selected.label} as the source
              </Button>
            </div>
          </section>
        }
      />
    </ToolShell>
  );
}
