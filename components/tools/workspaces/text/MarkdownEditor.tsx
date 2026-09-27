"use client";

import * as React from "react";
import { ClipboardPaste, Code, Download, Eraser, FileCode, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Segmented, Textarea } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import {
  TextWorkbench,
  readingStats,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { markdownStats, renderMarkdown, wrapHtmlDocument, MARKDOWN_RENDER_LIMIT } from "@/lib/tools/engines/text";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { toast } from "@/lib/utils/toast";

const SAMPLE = `# Release notes

Balu Tools is a **toolbox that runs in your browser**. Nothing is uploaded, so there is
no upload limit and no wait.

## What is new

- A diff checker that keeps \`$1\` substitutions working
- Word-level highlighting *inside* changed lines
- ~~Manual line numbering~~ — automatic now

> Every tool is a pure string transform, computed on the keystroke that produced it.

1. Open a tool
2. Paste your text
3. Copy the result

\`\`\`ts
const escaped = escapeHtml("<script>alert(1)</script>");
// &lt;script&gt;alert(1)&lt;/script&gt;
\`\`\`

Read more at [balu.tools](https://balu.tools) or mail <hello@balu.tools>.

- [x] Escapes raw HTML
- [ ] Adds reference-style links

---

*Everything above is sample content.*`;

type Pane = "write" | "preview";

/**
 * Styles for the rendered document. Scoped as descendant variants on the
 * preview container so no global stylesheet is needed — Tailwind keeps the
 * markdown output self-contained.
 */
const PREVIEW_CLASSES = cn(
  "text-sm leading-relaxed text-[var(--text-ink)]",
  "[&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold",
  "[&_h4]:mb-1.5 [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold",
  "[&_h5]:mb-1 [&_h5]:mt-3 [&_h5]:text-sm [&_h5]:font-semibold",
  "[&_h6]:mb-1 [&_h6]:mt-3 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-[0.07em]",
  "[&_p]:my-2",
  "[&_a]:text-brand-500 [&_a]:underline [&_a]:underline-offset-2",
  "[&_strong]:font-semibold",
  "[&_del]:text-[var(--text-muted)] [&_del]:line-through",
  "[&_code]:rounded-md [&_code]:border [&_code]:border-[var(--surface-line)] [&_code]:bg-[var(--surface-card)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-[10px] [&_pre]:border [&_pre]:border-[var(--surface-line)] [&_pre]:bg-[var(--surface-canvas)] [&_pre]:p-3",
  "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px]",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-brand-500/50 [&_blockquote]:pl-3.5 [&_blockquote]:text-[var(--text-muted)]",
  "[&_blockquote_p]:my-1",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1 [&_li>ul]:my-1 [&_li>ol]:my-1",
  "[&_li_input]:mr-1.5 [&_li_input]:accent-brand-500",
  "[&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--surface-line)]",
  "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg",
  "[&_kbd]:rounded [&_kbd]:border [&_kbd]:border-[var(--surface-line-strong)] [&_kbd]:px-1 [&_kbd]:font-mono [&_kbd]:text-[0.8em]",
  "[&_mark]:bg-brand-500/20 [&_mark]:text-[var(--text-ink)]",
);

export default function MarkdownEditor() {
  const [source, setSource] = React.useState("");
  const [allowInlineHtml, setAllowInlineHtml] = React.useState(false);
  const [pane, setPane] = React.useState<Pane>("write");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const previewId = React.useId();

  const rendered = React.useMemo(
    () => renderMarkdown(source, { allowInlineHtml }),
    [source, allowInlineHtml],
  );
  const stats = React.useMemo(() => markdownStats(source), [source]);
  const reading = React.useMemo(() => readingStats(source), [source]);
  const documentHtml = React.useMemo(
    () => (source.trim() ? wrapHtmlDocument("Markdown document", rendered.html) : ""),
    [source, rendered.html],
  );

  const result = React.useMemo<TextToolResult | null>(
    () =>
      source
        ? {
            text: rendered.html,
            stats: [
              { label: "Words", value: formatNumber(reading.words), tone: "brand" },
              { label: "Characters", value: formatNumber(stats.characters) },
              { label: "Headings", value: formatNumber(stats.headings) },
              { label: "Links", value: formatNumber(stats.links) },
              { label: "Code blocks", value: formatNumber(stats.codeBlocks) },
              { label: "Read time", value: reading.readingTimeLabel },
            ],
          }
        : null,
    [source, rendered.html, stats, reading],
  );

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.warning("Clipboard is empty");
        return;
      }
      setSource(text);
      toast.copied("Pasted from clipboard");
    } catch {
      toast.error("Couldn't read the clipboard", "Your browser blocked clipboard access.");
    }
  };

  const download = async () => {
    if (!documentHtml) return;
    const { downloadText } = await import("@/lib/utils/files");
    downloadText(documentHtml, "document.html", "text/html;charset=utf-8");
    toast.downloadReady("document.html");
  };

  return (
    <ToolShell>
      <TextWorkbench
        value={source}
        onChange={setSource}
        result={result}
        outputName="document"
        extension="html"
        mime="text/html;charset=utf-8"
        outputLabel="Generated HTML"
        outputPlaceholder="The HTML appears here as you type, ready to copy or download."
        hideInput
        hideDownload
        sample={SAMPLE}
        controls={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3">
              <Checkbox
                label="Allow inline HTML"
                description="Off by default. Even on, scripts, event handlers and javascript: URLs are stripped."
                checked={allowInlineHtml}
                onChange={(event) => setAllowInlineHtml(event.target.checked)}
              />
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={paste}>
                  <ClipboardPaste aria-hidden="true" className="size-3.5" />
                  Paste
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!source}
                  onClick={() => {
                    setSource("");
                    textareaRef.current?.focus();
                  }}
                >
                  <Eraser aria-hidden="true" className="size-3.5" />
                  Clear
                </Button>
              </div>
            </div>

            {/* Two panes cannot both fit on a phone, so one at a time. */}
            <Segmented
              label="Editor view"
              size="sm"
              value={pane}
              onChange={setPane}
              options={[
                { value: "write", label: "Write" },
                { value: "preview", label: "Preview" },
              ]}
              className="lg:hidden"
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <div
                className={
                  pane === "write"
                    ? "flex min-w-0 flex-col gap-1.5"
                    : "hidden min-w-0 flex-col gap-1.5 lg:flex"
                }
              >
                <label htmlFor="markdown-source" className="text-[13px] font-medium text-[var(--text-ink)]">
                  Markdown
                </label>
                <Textarea
                  id="markdown-source"
                  ref={textareaRef}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  rows={18}
                  spellCheck
                  placeholder={"# Heading\n\nWrite **Markdown** on the left…"}
                  className="min-h-[18rem] resize-y font-mono text-[13px] leading-relaxed"
                />
              </div>

              <div
                className={
                  pane === "preview"
                    ? "flex min-w-0 flex-col gap-1.5"
                    : "hidden min-w-0 flex-col gap-1.5 lg:flex"
                }
              >
                <label htmlFor={previewId} className="text-[13px] font-medium text-[var(--text-ink)]">
                  Live preview
                </label>
                {rendered.html ? (
                  <div
                    id={previewId}
                    role="region"
                    aria-label="Rendered Markdown preview"
                    aria-live="polite"
                    className={cn(
                      "min-h-[18rem] max-h-[34rem] overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4",
                      PREVIEW_CLASSES,
                    )}
                    /* The HTML is produced by our own renderer, which escapes every
                       character of user text and only ever emits the small tag
                       allowlist. See `renderMarkdown` in lib/tools/engines/text.ts. */
                    dangerouslySetInnerHTML={{ __html: rendered.html }}
                  />
                ) : (
                  <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                    <p
                      id={previewId}
                      className="px-4 py-12 text-center text-[13px] text-[var(--text-muted)]"
                    >
                      The rendered document appears here as you type.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        }
        actions={
          <div className="flex flex-col gap-3">
            {allowInlineHtml ? (
              <Notice
                tone="warning"
                icon={<TriangleAlert aria-hidden="true" className="size-4" />}
                title="Inline HTML is on."
              >
                Only inline formatting tags survive. Script, style and iframe elements are removed
                with their contents, every <code>on*</code> handler is dropped, and an{" "}
                <code>href</code> is only kept when the scheme is http, https, mailto, tel or ftp.
              </Notice>
            ) : (
              <Notice
                tone="info"
                icon={<ShieldCheck aria-hidden="true" className="size-4" />}
                title="Raw HTML is escaped."
              >
                A pasted <code>&lt;script&gt;</code> tag is displayed as text, not executed. Turn
                the toggle on only if you genuinely need <code>&lt;kbd&gt;</code> or{" "}
                <code>&lt;mark&gt;</code>.
              </Notice>
            )}
            {rendered.truncatedFrom !== null ? (
              <Notice tone="warning">
                This document is {formatNumber(rendered.truncatedFrom)} characters, so the preview
                shows the first {formatNumber(MARKDOWN_RENDER_LIMIT)} to keep the page responsive. The
                word counts above still cover everything.
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!rendered.html}
                onClick={() => void toast.copy(rendered.html, "HTML copied to clipboard")}
              >
                <Code aria-hidden="true" className="size-3.5" />
                Copy HTML
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!documentHtml}
                onClick={() => void download()}
              >
                <FileCode aria-hidden="true" className="size-3.5" />
                Download .html
              </Button>
              <p className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                <Download aria-hidden="true" className="size-3" />
                The download is a complete document with a{" "}
                <code className="font-mono">&lt;meta charset&gt;</code> — it opens offline.
              </p>
            </div>
          </div>
        }
      />
    </ToolShell>
  );
}
