"use client";

import * as React from "react";
import { Code2, FileCode, ShieldCheck, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Checkbox, Field, Input, Stat, Textarea } from "@/components/ui/form";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { formatNumber } from "@/lib/utils/format";
import { markdownToHtml, type MarkdownOptions } from "@/lib/tools/engines/dev";

const SAMPLE = `# Release notes

A short paragraph with **bold**, *italic*, ~~struck out~~ and \`inline code\`.

## What changed

- Faster CSV parsing
- Fixed a crash on empty input
  - Nested detail, indented two spaces
- [x] Task list items work
- [ ] This one is not done

> A blockquote, because someone always asks for one.

| Column | Meaning | Default |
| --- | --- | --- |
| \`retries\` | How many times to retry | 3 |
| \`timeout\` | Milliseconds | 2500 |

\`\`\`js
const config = { retries: 3, timeout: 2500 };
if (config.retries > 0 && config.timeout < 5000) start();
\`\`\`

[Documentation](https://example.dev/docs) and an autolink: <https://example.dev>.

---

<div class="callout">A raw HTML block, only when you allow it.</div>`;

export default function MarkdownToHtmlWorkspace() {
  const [markdown, setMarkdown] = React.useState(SAMPLE);
  const [allowRawHtml, setAllowRawHtml] = React.useState(false);
  const [fullDocument, setFullDocument] = React.useState(false);
  const [includeCss, setIncludeCss] = React.useState(true);
  const [title, setTitle] = React.useState("Document");
  const [taskLists, setTaskLists] = React.useState(true);
  const [tab, setTab] = React.useState("html");

  const options = React.useMemo<MarkdownOptions>(
    () => ({ allowRawHtml, fullDocument, includeCss, title, taskLists }),
    [allowRawHtml, fullDocument, includeCss, title, taskLists],
  );

  const result = React.useMemo(() => markdownToHtml(markdown, options), [markdown, options]);
  const bytes = React.useMemo(() => new Blob([result.html]).size, [result.html]);

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <Notice tone={allowRawHtml ? "warning" : "success"} icon={allowRawHtml ? <TriangleAlert className="size-4" /> : <ShieldCheck className="size-4" />}>
          {allowRawHtml
            ? "Raw HTML is being passed through — and sanitised. <script>, <style>, <iframe>, <form> and friends are removed, every on* handler is stripped, and javascript: URLs become #. Do not treat that as a guarantee; review the output before publishing it anywhere."
            : "Raw HTML is off, which is the safe default: every character of text is HTML-escaped, so nothing in the Markdown can inject markup. The generated comment above the output states this in the file itself."}
        </Notice>

        <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Checkbox
              label="Allow raw HTML"
              description="Off by default. Even on, the sanitiser still removes scripts, event handlers and javascript: URLs."
              checked={allowRawHtml}
              onChange={(event) => setAllowRawHtml(event.target.checked)}
            />
          </div>
          <div className="lg:col-span-2">
            <Checkbox
              label="Render task list checkboxes"
              description="Turns - [x] and - [ ] into disabled checkboxes."
              checked={taskLists}
              onChange={(event) => setTaskLists(event.target.checked)}
            />
          </div>
          <div className="lg:col-span-2">
            <Checkbox
              label="Output a standalone document"
              description="Adds the doctype, <html lang>, a UTF-8 charset and a viewport meta."
              checked={fullDocument}
              onChange={(event) => setFullDocument(event.target.checked)}
            />
          </div>
          <div className="lg:col-span-2">
            <Checkbox
              label="Include minimal CSS"
              description="A small readable stylesheet. Requires the standalone document."
              checked={includeCss}
              onChange={(event) => setIncludeCss(event.target.checked)}
              disabled={!fullDocument}
            />
          </div>
          {fullDocument ? (
            <Field label="Document title" className="lg:col-span-4">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Document"
                />
              )}
            </Field>
          ) : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="markdown-input" className="text-[13px] font-medium text-[var(--text-ink)]">
              Markdown
            </label>
            <Textarea
              id="markdown-input"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              rows={20}
              spellCheck={false}
              placeholder="# Heading"
              className="min-h-[26rem] resize-y font-mono text-[12px] leading-relaxed"
            />
            <p className="font-mono text-[11px] text-[var(--text-muted)]">
              {formatNumber(markdown.length)} characters
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Tabs
              label="Output"
              value={tab}
              onChange={setTab}
              fullWidth
              items={[
                { value: "html", label: "HTML", icon: <Code2 className="size-3.5" /> },
                { value: "preview", label: "Rendered", icon: <FileCode className="size-3.5" /> },
                { value: "policy", label: "Sanitisation", icon: <ShieldCheck className="size-3.5" /> },
              ]}
            />

            <TabPanel value="html" activeValue={tab}>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">Generated HTML</span>
                  <div className="flex items-center gap-1.5">
                    <CopyButton value={result.html} what="HTML copied" size="sm" variant="ghost" />
                    <DownloadButton
                      text={result.html}
                      filename={fullDocument ? "document.html" : "fragment.html"}
                      mime="text/html;charset=utf-8"
                      label="Download"
                      size="sm"
                      variant="secondary"
                    />
                  </div>
                </div>
                <pre className="max-h-[30rem] overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                  {result.html}
                </pre>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Output size" value={`${(bytes / 1024).toFixed(1)} KB`} tone="brand" />
                  {result.stats.slice(0, 3).map((stat) => (
                    <Stat key={stat.label} label={stat.label} value={stat.value} />
                  ))}
                </dl>
              </div>
            </TabPanel>

            <TabPanel value="preview" activeValue={tab}>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Rendered</span>
                <div
                  className="max-h-[30rem] overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4 text-[14px] leading-relaxed text-[var(--text-ink)] [&_a]:text-sky-500 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--surface-line-strong)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-muted)] [&_code]:rounded [&_code]:bg-[var(--surface-card)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mb-2 [&_h1]:mt-0 [&_h1]:border-b [&_h1]:border-[var(--surface-line)] [&_h1]:pb-2 [&_h1]:text-2xl [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-lg [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[var(--surface-card)] [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--surface-line)] [&_td]:p-1.5 [&_th]:border [&_th]:border-[var(--surface-line)] [&_th]:bg-[var(--surface-card)] [&_th]:p-1.5 [&_ul]:list-disc [&_ul]:pl-5"
                  // The HTML below is produced by the converter in
                  // lib/tools/engines/dev.ts, which escapes all text and strips
                  // scripts, event handlers and javascript: URLs. It is never
                  // third-party content passed through untouched.
                  dangerouslySetInnerHTML={{ __html: result.body }}
                />
              </div>
            </TabPanel>

            <TabPanel value="policy" activeValue={tab}>
              <div className="flex flex-col gap-3">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">What the sanitiser does</span>
                <pre className="overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--text-ink)]">
                  {result.comment}
                </pre>
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  The same comment is written at the top of the generated HTML, so whoever opens the file
                  later knows how it was produced and what was stripped.
                </p>
              </div>
            </TabPanel>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
