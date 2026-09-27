"use client";

import * as React from "react";
import { Globe, Newspaper, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Stat, Textarea } from "@/components/ui/form";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import {
  auditSecurityHeaders,
  formatPreciseMs,
  parseRawHeaderBlock,
  type HeaderRow,
  type SecurityHeaderAudit,
} from "@/lib/tools/engines/dev";

const SAMPLE_BLOCK = `HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Set-Cookie: session=abc; Secure; HttpOnly; SameSite=Lax
Set-Cookie: theme=dark; Path=/`;

const SAMPLE_REQUEST = `POST /v1/items HTTP/1.1
Host: api.example.dev
Content-Type: application/json
Accept: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig`;

type Mode = "inspect" | "parse";

interface LiveResponse {
  status: number;
  statusText: string;
  ms: number;
  requestHeaders: [string, string][];
  responseHeaders: [string, string][];
  bytes: number;
}

const VERDICT_STYLE: Record<SecurityHeaderAudit["verdict"], string> = {
  good: "border-emerald-500/30 bg-emerald-500/[0.06]",
  partial: "border-amber-500/30 bg-amber-500/[0.06]",
  missing: "border-[var(--surface-line)] bg-[var(--surface-card-2)]",
  info: "border-[var(--surface-line)] bg-[var(--surface-card-2)]",
};

const VERDICT_LABEL: Record<SecurityHeaderAudit["verdict"], string> = {
  good: "Good",
  partial: "Weak",
  missing: "Missing",
  info: "Informational",
};

export default function HttpHeaderViewerWorkspace() {
  const [mode, setMode] = React.useState<Mode>("parse");
  const [block, setBlock] = React.useState(SAMPLE_BLOCK);
  const [url, setUrl] = React.useState("https://example.dev/");
  const [live, setLive] = React.useState<LiveResponse | null>(null);
  const [liveError, setLiveError] = React.useState<string | null>(null);
  const [corsBlocked, setCorsBlocked] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [tab, setTab] = React.useState("audit");

  const parsed = React.useMemo(() => (block.trim() === "" ? null : parseRawHeaderBlock(block)), [block]);
  const audit = React.useMemo<SecurityHeaderAudit[]>(
    () => (parsed && parsed.ok ? auditSecurityHeaders(parsed.headers) : []),
    [parsed],
  );

  const inspect = async (): Promise<void> => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      setLive(null);
      setCorsBlocked(false);
      setLiveError("That is not a URL the browser can parse. Include the scheme, for example https://example.dev.");
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      setLive(null);
      setCorsBlocked(false);
      setLiveError(`A browser will not fetch ${target.protocol}//… from a page. Only http and https are allowed.`);
      return;
    }

    setSending(true);
    setLiveError(null);
    setCorsBlocked(false);
    setLive(null);
    const started = performance.now();
    try {
      // A HEAD request keeps the download small, but not every server implements
      // it, so fall back to a GET range request if HEAD is not allowed.
      let response = await fetch(target.toString(), {
        method: "HEAD",
        redirect: "follow",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        mode: "cors",
      });
      if (response.status === 405 || response.status === 501) {
        response = await fetch(target.toString(), {
          method: "GET",
          redirect: "follow",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          mode: "cors",
        });
      }
      const ms = performance.now() - started;
      const contentLength = response.headers.get("content-length");
      setLive({
        status: response.status,
        statusText: response.statusText,
        ms,
        requestHeaders: [],
        responseHeaders: [...response.headers.entries()],
        bytes: contentLength ? Number(contentLength) : 0,
      });
    } catch (caught) {
      const ms = performance.now() - started;
      setCorsBlocked(true);
      setLiveError(
        caught instanceof Error && caught.name === "AbortError"
          ? "The request was cancelled before it finished."
          : `The request failed after ${formatPreciseMs(ms)}. A cross-origin request that fails with no status code is almost always CORS — the browser refuses to show you the server's real response, by design.`,
      );
    } finally {
      setSending(false);
    }
  };

  const liveAudit = React.useMemo<SecurityHeaderAudit[]>(
    () => (live ? auditSecurityHeaders(live.responseHeaders.map(([name, value]) => ({ name, value, line: 0 }))) : []),
    [live],
  );

  const report = React.useMemo(() => {
    const rows = audit.map((entry) => `${entry.header}\t${entry.verdict}\t${entry.finding}`);
    const problems = (parsed?.problems ?? []).map((problem) => `line ${problem.line}\t${problem.severity}\t${problem.header}\t${problem.message}`);
    return [...rows, "", ...problems].join("\n");
  }, [audit, parsed]);

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <Segmented
          label="Mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "parse", label: "Decode a pasted header block", icon: <Newspaper className="size-3.5" /> },
            { value: "inspect", label: "Inspect a live request", icon: <Globe className="size-3.5" /> },
          ]}
        />

        {mode === "inspect" ? (
          <section aria-label="Live inspection" className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="CORS applies here too.">
              This fires a real <code className="font-mono">fetch</code> from your browser at the URL below.
              Unless that host sends an{" "}
              <code className="font-mono">Access-Control-Allow-Origin</code> covering this site, the
              browser will block the response and you will see a failure with no status code. Two things are
              also impossible to see from a page: which request headers the browser actually sent (it sets{" "}
              <code className="font-mongo">User-Agent</code>, <code className="font-mono">Accept</code> and{" "}
              <code className="font-mongo">Origin</code> itself, and any response header outside the
              CORS-safelisted set.
            </Notice>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Field label="URL to inspect">
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.dev/"
                      autoComplete="url"
                      spellCheck={false}
                      className="font-mono"
                    />
                  )}
                </Field>
              </div>
              <Button variant="primary" onClick={() => void inspect()} loading={sending}>
                <Send aria-hidden="true" className="size-4" />
                Inspect
              </Button>
            </div>

            {liveError ? (
              <div role="alert" className="rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5">
                <p className="text-[13px] font-medium text-[var(--text-ink)]">
                  {corsBlocked ? "Blocked by CORS, or the host could not be reached." : "The request did not complete."}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-ink)]">{liveError}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
                  A browser will not tell a page whether the DNS lookup failed, the connection was refused,
                  or the response was simply not allowed through. All three look identical from here.
                </p>
              </div>
            ) : null}

            {live ? (
              <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat
                    label="Status"
                    value={`${live.status} ${live.statusText}`}
                    tone={live.status >= 200 && live.status < 300 ? "success" : "brand"}
                  />
                  <Stat label="Elapsed" value={formatPreciseMs(live.ms)} />
                  <Stat label="Content length" value={live.bytes > 0 ? formatBytes(live.bytes) : "not exposed"} />
                  <Stat label="Headers visible" value={String(live.responseHeaders.length)} />
                </dl>

                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
                    <ShieldCheck aria-hidden="true" className="size-3.5" />
                    Security headers on this response
                  </span>
                  <AuditTable entries={liveAudit} />
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">Every header the browser exposed</span>
                  <HeaderTable rows={live.responseHeaders.map(([name, value]) => ({ name, value, line: 0 }))} />
                </div>
              </>
            ) : sending ? (
              <p className="py-4 text-center text-[13px] text-[var(--text-muted)]">Contacting the host…</p>
            ) : (
              <div className="rounded-[10px] border border-[var(--surface-line)]">
                <ToolEmptyState
                  title="Press Inspect to make a request."
                  description="Nothing is stored, and the request carries no cookies or credentials."
                />
              </div>
            )}
          </section>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="header-block" className="text-[13px] font-medium text-[var(--text-ink)]">
                  Raw header block
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setBlock(SAMPLE_BLOCK);
                      toast.info("Response sample loaded");
                    }}
                  >
                    Response sample
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setBlock(SAMPLE_REQUEST);
                      toast.info("Request sample loaded");
                    }}
                  >
                    Request sample
                  </Button>
                  <CopyButton value={block || null} what="Header block copied" size="sm" variant="ghost" />
                  <DownloadButton
                    text={report}
                    filename="header-report.txt"
                    mime="text/plain;charset=utf-8"
                    label="Download report"
                    size="sm"
                    variant="secondary"
                  />
                </div>
              </div>
              <Textarea
                id="header-block"
                value={block}
                onChange={(event) => setBlock(event.target.value)}
                rows={12}
                spellCheck={false}
                placeholder={"HTTP/1.1 200 OK\nContent-Type: application/json\nStrict-Transport-Security: max-age=31536000"}
                className="resize-y font-mono text-[12px] leading-relaxed"
              />
              <p className="text-xs text-[var(--text-muted)]">
                A request line is optional. Paste either <code className="font-mono">GET /path HTTP/1.1</code>{" "}
                followed by headers, or just the headers on their own. {formatNumber(block.length)} characters.
              </p>
            </div>

            {block.trim() === "" ? (
              <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                <ToolEmptyState
                  title="Paste a header block."
                  description="It is split into a table, checked for the RFC 9110 problems that actually break things, and audited for the security headers browsers honour."
                  icon={<Newspaper className="size-5" />}
                />
              </div>
            ) : !parsed || !parsed.ok ? (
              <Notice tone="warning">{parsed?.error ?? "Nothing to parse."}</Notice>
            ) : (
              <>
                {parsed.requestLine ? (
                  <Notice tone="info" title="Request line">
                    <code className="font-mono">{parsed.requestLine.method}</code> to{" "}
                    <code className="font-mono">{parsed.requestLine.target}</code> over{" "}
                    <code className="font-mono">{parsed.requestLine.version}</code>
                  </Notice>
                ) : null}

                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Headers" value={String(parsed.headers.length)} />
                  <Stat
                    label="Problems"
                    value={String(parsed.problems.length)}
                    tone={parsed.problems.some((p) => p.severity === "error") ? "brand" : "default"}
                  />
                  <Stat
                    label="Duplicates"
                    value={String(parsed.problems.filter((p) => p.message.includes("more than once")).length)}
                  />
                  <Stat label="Security headers" value={`${audit.filter((a) => a.present).length} / ${audit.length}`} />
                </dl>

                <Tabs
                  label="Analysis"
                  value={tab}
                  onChange={setTab}
                  fullWidth
                  items={[
                    { value: "audit", label: "Security audit" },
                    { value: "table", label: "Parsed headers", badge: String(parsed.headers.length) },
                    { value: "problems", label: "RFC problems", badge: String(parsed.problems.length) },
                  ]}
                />

                <TabPanel value="audit" activeValue={tab}>
                  <div className="flex flex-col gap-2">
                    <span className="text-[13px] font-medium text-[var(--text-ink)]">
                      What these headers actually do
                    </span>
                    <AuditTable entries={audit} />
                  </div>
                </TabPanel>

                <TabPanel value="table" activeValue={tab}>
                  <HeaderTable rows={parsed.headers} />
                </TabPanel>

                <TabPanel value="problems" activeValue={tab}>
                  {parsed.problems.length === 0 ? (
                    <Notice tone="success" icon={<ShieldCheck className="size-4" />} title="Nothing wrong found.">
                      Every header name is a valid token, every value is on one line, there are no folds, no
                      whitespace before a colon, and no unexpected duplicates.
                    </Notice>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {parsed.problems.map((problem, index) => (
                        <li
                          key={`${problem.line}-${index}`}
                          className={cn(
                            "rounded-[10px] border px-3.5 py-2.5",
                            problem.severity === "error"
                              ? "border-brand-500/30 bg-brand-500/[0.06]"
                              : problem.severity === "warning"
                                ? "border-amber-500/30 bg-amber-500/[0.06]"
                                : "border-[var(--surface-line)] bg-[var(--surface-card-2)]",
                          )}
                        >
                          <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.07em]">
                            <span
                              className={
                                problem.severity === "error"
                                  ? "text-brand-500"
                                  : problem.severity === "warning"
                                    ? "text-amber-500"
                                    : "text-[var(--text-muted)]"
                              }
                            >
                              {problem.severity}
                            </span>
                            <span className="text-[var(--text-ink)]">{problem.header}</span>
                            {problem.line > 0 ? (
                              <span className="font-mono normal-case tracking-normal text-[var(--text-muted)]">
                                line {problem.line}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-ink)]">
                            {problem.message}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabPanel>
              </>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}

function AuditTable({ entries }: { entries: SecurityHeaderAudit[] }) {
  if (entries.length === 0) return null;
  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {entries.map((entry) => (
        <li key={entry.header} className={cn("flex flex-col gap-1.5 rounded-[10px] border px-3.5 py-3", VERDICT_STYLE[entry.verdict])}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="font-mono text-[12px] font-semibold text-[var(--text-ink)]">{entry.header}</code>
            <span className="rounded-md border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              {VERDICT_LABEL[entry.verdict]}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--text-ink)]">{entry.finding}</p>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">{entry.guidance}</p>
        </li>
      ))}
    </ul>
  );
}

function HeaderTable({ rows }: { rows: HeaderRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)]">
      <table className="w-full min-w-[30rem] border-collapse text-left">
        <caption className="sr-only">Parsed headers with their line numbers</caption>
        <thead>
          <tr className="border-b border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <th scope="col" className="w-14 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
              Line
            </th>
            <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
              Name
            </th>
            <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.name}-${row.line}-${index}`} className="border-b border-[var(--surface-line)] last:border-0">
              <td className="px-3 py-1.5 align-top font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                {row.line > 0 ? row.line : "—"}
              </td>
              <th scope="row" className="whitespace-nowrap px-3 py-1.5 align-top font-mono text-[12px] font-medium text-[var(--text-ink)]">
                {row.name}
              </th>
              <td className="px-3 py-1.5 align-top font-mono text-[12px] break-all text-emerald-500">
                {row.value === "" ? <span className="text-[var(--text-muted)]">(empty)</span> : row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
