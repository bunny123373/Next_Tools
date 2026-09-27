"use client";

import * as React from "react";
import {
  Copy,
  Eraser,
  Globe,
  Plus,
  Send,
  Terminal,
  Timer,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Select, Stat, Textarea } from "@/components/ui/form";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import { formatPreciseMs, parseJsonDetailed } from "@/lib/tools/engines/dev";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];

type BodyMode = "none" | "raw" | "json" | "form";

interface HeaderRow {
  id: number;
  name: string;
  value: string;
  enabled: boolean;
}

interface ParamRow {
  id: number;
  name: string;
  value: string;
  enabled: boolean;
}

interface ResponseState {
  status: number;
  statusText: string;
  ms: number;
  bytes: number;
  headers: [string, string][];
  body: string;
  kind: "json" | "html" | "text";
}

const SAMPLE_URL = "https://httpbin.org/get";

let nextId = 1;
const makeRow = (name = "", value = ""): HeaderRow => ({ id: nextId++, name, value, enabled: true });

export default function ApiTesterWorkspace() {
  const [method, setMethod] = React.useState<Method>("GET");
  const [url, setUrl] = React.useState(SAMPLE_URL);
  const [headers, setHeaders] = React.useState<HeaderRow[]>([makeRow("Accept", "application/json")]);
  const [params, setParams] = React.useState<ParamRow[]>([]);
  const [bodyMode, setBodyMode] = React.useState<BodyMode>("none");
  const [body, setBody] = React.useState('{\n  "hello": "world"\n}');
  const [timeout, setTimeoutValue] = React.useState(15);
  const [followRedirects, setFollowRedirects] = React.useState(true);
  const [response, setResponse] = React.useState<ResponseState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [corsBlocked, setCorsBlocked] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [tab, setTab] = React.useState("body");

  const jsonError = React.useMemo(() => {
    if (bodyMode !== "json") return null;
    const parsed = parseJsonDetailed(body);
    return parsed.ok ? null : parsed.error;
  }, [bodyMode, body]);

  const jsonValid = jsonError === null;

  const fullUrl = React.useMemo(() => {
    const active = params.filter((param) => param.enabled && param.name.trim() !== "");
    if (active.length === 0) return url.trim();
    try {
      const parsed = new URL(url.trim());
      for (const param of active) parsed.searchParams.set(param.name.trim(), param.value);
      return parsed.toString();
    } catch {
      const query = active
        .map((param) => `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`)
        .join("&");
      const separator = url.includes("?") ? "&" : "?";
      return `${url.trim()}${separator}${query}`;
    }
  }, [url, params]);

  const requestBody = React.useMemo(() => {
    if (bodyMode === "none") return { text: undefined, contentType: undefined };
    if (bodyMode === "json") return { text: body, contentType: "application/json" };
    if (bodyMode === "form") {
      const pairs: [string, string][] = [];
      for (const line of body.split("\n")) {
        const index = line.indexOf("=");
        if (index === -1) {
          if (line.trim() !== "") pairs.push([line.trim(), ""]);
          continue;
        }
        pairs.push([line.slice(0, index).trim(), line.slice(index + 1)]);
      }
      return {
        text: new URLSearchParams(pairs).toString(),
        contentType: "application/x-www-form-urlencoded",
      };
    }
    return { text: body, contentType: undefined };
  }, [bodyMode, body]);

  const effectiveHeaders = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const header of headers) {
      const name = header.name.trim();
      if (!header.enabled || name === "") continue;
      out.set(name, header.value);
    }
    if (requestBody.contentType && !out.has("Content-Type")) out.set("Content-Type", requestBody.contentType);
    return out;
  }, [headers, requestBody]);

  const forbiddenHeaders = React.useMemo(
    () => [...effectiveHeaders.keys()].filter((name) => BLOCKED_HEADERS.has(name.toLowerCase())),
    [effectiveHeaders],
  );

  const send = React.useCallback(async () => {
    if (method !== "GET" && method !== "HEAD" && bodyMode === "none" && requestBody.text === undefined) {
      // Fine: a body is optional.
    }
    if (jsonError) {
      toast.error(
        `The JSON body is not valid — line ${jsonError.line}, column ${jsonError.column}`,
        jsonError.message,
      );
      return;
    }
    let target: URL;
    try {
      target = new URL(fullUrl);
    } catch {
      setCorsBlocked(false);
      setResponse(null);
      setError("That is not a URL the browser can parse. Include the scheme, for example https://example.dev/api.");
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      setCorsBlocked(false);
      setResponse(null);
      setError(`A browser will not fetch ${target.protocol}//… from a page. Only http and https are allowed.`);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);
    const started = performance.now();
    setSending(true);
    setError(null);
    setCorsBlocked(false);
    setResponse(null);

    try {
      const result = await fetch(target.toString(), {
        method,
        headers: Object.fromEntries(effectiveHeaders),
        body: method === "GET" || method === "HEAD" ? undefined : requestBody.text,
        signal: controller.signal,
        redirect: followRedirects ? "follow" : "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        mode: "cors",
      });
      const ms = performance.now() - started;
      const text = await result.text();
      const kind: ResponseState["kind"] = (() => {
        const type = result.headers.get("content-type") ?? "";
        if (type.includes("json")) return "json";
        if (type.includes("html")) return "html";
        return "text";
      })();
      let display = text;
      if (kind === "json") {
        try {
          display = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          display = text;
        }
      }
      setResponse({
        status: result.status,
        statusText: result.statusText,
        ms,
        bytes: new Blob([text]).size,
        headers: [...result.headers.entries()],
        body: display,
        kind,
      });
      setTab("body");
    } catch (caught) {
      const ms = performance.now() - started;
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setError(
          `The request was still running after ${timeout} second${timeout === 1 ? "" : "s"} and was cancelled. Raise the timeout or check whether the host is reachable.`,
        );
      } else {
        // The browser refuses to tell us *why* a cross-origin fetch failed, so
        // the only honest thing to say is what it almost always is.
        setCorsBlocked(true);
        setError(
          `The request failed after ${formatPreciseMs(ms)}. A cross-origin request that fails with no status code is almost always CORS: the browser will not show you the server's real response or even its error message, by design.`,
        );
      }
      setResponse(null);
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }, [method, bodyMode, fullUrl, effectiveHeaders, requestBody, timeout, followRedirects, jsonError]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  };

  const curl = React.useMemo(() => buildCurl(method, fullUrl, effectiveHeaders, requestBody.text), [method, fullUrl, effectiveHeaders, requestBody]);
  const fetchSnippet = React.useMemo(
    () => buildFetch(method, fullUrl, effectiveHeaders, requestBody),
    [method, fullUrl, effectiveHeaders, requestBody],
  );

  return (
    <ToolShell>
      <div
        className="flex flex-col gap-4"
        onKeyDown={onKeyDown}
        role="group"
        aria-label="API tester"
      >
        <Notice tone="warning" icon={<Globe className="size-4" />} title="This request comes from your browser.">
          It is an ordinary <code className="font-mono">fetch</code> from this page, so it is subject to the
          same-origin policy. If the target does not send{" "}
          <code className="font-mono">Access-Control-Allow-Origin</code> for this site&apos;s origin, the
          browser blocks the response and shows you a failure with no status code — even if the server
          answered perfectly. The browser also refuses to let a page set{" "}
          <code className="font-mono">Host</code>, <code className="font-mono">Origin</code>,{" "}
          <code className="font-mono">Referer</code> or <code className="font-mono">User-Agent</code>. And
          nothing you type here is stored, logged or sent anywhere except to the URL you request — no
          credentials are kept by this page at all.
        </Notice>

        <section aria-label="Request" className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Method">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as Method)}
                  className="sm:w-32"
                >
                  {METHODS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="min-w-0 flex-1">
              <Field label="URL" hint="The scheme is required.">
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://api.example.dev/v1/items"
                    autoComplete="url"
                    spellCheck={false}
                    className="font-mono"
                  />
                )}
              </Field>
            </div>
            <Button variant="primary" onClick={() => void send()} loading={sending} className="sm:w-auto">
              <Send aria-hidden="true" className="size-4" />
              Send
            </Button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            or press{" "}
            <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">
              Ctrl + Enter
            </kbd>
            {fullUrl !== url.trim() ? (
              <>
                {" "}
                · full request URL:{" "}
                <code className="break-all font-mono text-[var(--text-ink)]">{fullUrl}</code>
              </>
            ) : null}
          </p>
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <section aria-label="Query parameters" className="flex flex-col gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Query parameters</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setParams([...params, { id: nextId++, name: "", value: "", enabled: true }])}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                Add
              </Button>
            </div>
            {params.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                None. Any <code className="font-mono">?a=1</code> already in the URL is kept as it is.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {params.map((param) => (
                  <li key={param.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={param.enabled}
                      onChange={(event) =>
                        setParams(params.map((entry) => (entry.id === param.id ? { ...entry, enabled: event.target.checked } : entry)))
                      }
                      aria-label={`Enable parameter ${param.name || "unnamed"}`}
                      className="size-4 shrink-0 accent-[var(--color-brand-500,#FF3B30)]"
                    />
                    <Input
                      value={param.name}
                      onChange={(event) =>
                        setParams(params.map((entry) => (entry.id === param.id ? { ...entry, name: event.target.value } : entry)))
                      }
                      placeholder="name"
                      aria-label="Parameter name"
                      className="h-9 font-mono text-[12px]"
                    />
                    <Input
                      value={param.value}
                      onChange={(event) =>
                        setParams(params.map((entry) => (entry.id === param.id ? { ...entry, value: event.target.value } : entry)))
                      }
                      placeholder="value"
                      aria-label="Parameter value"
                      className="h-9 font-mono text-[12px]"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove parameter ${param.name || "unnamed"}`}
                      onClick={() => setParams(params.filter((entry) => entry.id !== param.id))}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Headers" className="flex flex-col gap-2 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Headers</span>
              <Button size="sm" variant="ghost" onClick={() => setHeaders([...headers, makeRow()])}>
                <Plus aria-hidden="true" className="size-3.5" />
                Add
              </Button>
            </div>
            {headers.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                None. The browser adds its own <code className="font-mono">Accept</code>,{" "}
                <code className="font-mono">Accept-Language</code> and <code className="font-mono">Origin</code>.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {headers.map((header) => (
                  <li key={header.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={header.enabled}
                      onChange={(event) =>
                        setHeaders(headers.map((entry) => (entry.id === header.id ? { ...entry, enabled: event.target.checked } : entry)))
                      }
                      aria-label={`Enable header ${header.name || "unnamed"}`}
                      className="size-4 shrink-0 accent-[var(--color-brand-500,#FF3B30)]"
                    />
                    <Input
                      value={header.name}
                      onChange={(event) =>
                        setHeaders(headers.map((entry) => (entry.id === header.id ? { ...entry, name: event.target.value } : entry)))
                      }
                      placeholder="Header"
                      aria-label="Header name"
                      className="h-9 font-mono text-[12px]"
                    />
                    <Input
                      value={header.value}
                      onChange={(event) =>
                        setHeaders(headers.map((entry) => (entry.id === header.id ? { ...entry, value: event.target.value } : entry)))
                      }
                      placeholder="value"
                      aria-label="Header value"
                      className="h-9 font-mono text-[12px]"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove header ${header.name || "unnamed"}`}
                      onClick={() => setHeaders(headers.filter((entry) => entry.id !== header.id))}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {forbiddenHeaders.length > 0 ? (
              <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
                The browser silently drops{" "}
                {forbiddenHeaders.map((name) => (
                  <code key={name} className="mx-0.5 rounded bg-[var(--surface-card)] px-1 font-mono text-[11px]">
                    {name}
                  </code>
                ))}
                — a page is not allowed to set those. They will not reach the server, whatever the response says.
              </Notice>
            ) : null}
          </section>
        </div>

        <section aria-label="Body" className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Field label="Request body">
              {() => (
                <Segmented
                  label="Request body"
                  size="sm"
                  value={bodyMode}
                  onChange={setBodyMode}
                  options={[
                    { value: "none", label: "None" },
                    { value: "raw", label: "Raw text" },
                    { value: "json", label: "JSON", title: "Validated before sending" },
                    { value: "form", label: "Form", title: "One name=value pair per line" },
                  ]}
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox
                label="Follow redirects"
                checked={followRedirects}
                onChange={(event) => setFollowRedirects(event.target.checked)}
              />
              <Field label="Timeout (seconds)">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min={1}
                    max={120}
                    value={timeout}
                    onChange={(event) => setTimeoutValue(Math.max(1, Math.min(120, Number(event.target.value) || 15)))}
                    className="h-8 w-20 text-center"
                  />
                )}
              </Field>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setUrl(SAMPLE_URL);
                  setHeaders([makeRow("Accept", "application/json")]);
                  setParams([]);
                  setBodyMode("none");
                  setResponse(null);
                  setError(null);
                  setCorsBlocked(false);
                  toast.info("Reset to a fresh request");
                }}
              >
                <Eraser aria-hidden="true" className="size-3.5" />
                Reset
              </Button>
            </div>
          </div>

          {bodyMode !== "none" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="api-body" className="text-[13px] font-medium text-[var(--text-ink)]">
                {bodyMode === "form" ? "Body — one name=value pair per line" : "Body"}
              </label>
              <Textarea
                id="api-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={6}
                spellCheck={false}
                invalid={!jsonValid}
                className="resize-y font-mono text-[12px] leading-relaxed"
              />
              {bodyMode === "json" ? (
                <>
                  <p className={cn("text-xs", jsonValid ? "text-[var(--text-muted)]" : "text-brand-500")}>
                    {jsonValid
                      ? `Valid JSON. It will be sent as ${formatBytes(new Blob([body]).size)} with Content-Type: application/json.`
                      : `Not valid JSON, so sending is blocked. Line ${jsonError!.line}, column ${jsonError!.column}: ${jsonError!.message}`}
                  </p>
                  {jsonError ? (
                    <pre className="overflow-x-auto rounded-lg border border-brand-500/30 bg-brand-500/[0.05] p-2.5 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
                      {jsonError.preview}
                    </pre>
                  ) : null}
                </>
              ) : null}
              {bodyMode === "form" ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Sent as <code className="font-mono">application/x-www-form-urlencoded</code>:{" "}
                  {formatBytes(new Blob([requestBody.text ?? ""]).size)} encoded.
                </p>
              ) : null}
            </div>
          ) : method === "GET" || method === "HEAD" ? (
            <p className="text-xs text-[var(--text-muted)]">
              {method} requests cannot carry a body, so none will be sent.
            </p>
          ) : null}
        </section>

        {error ? (
          <div role="alert" className="flex flex-col gap-2 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5">
            <p className="flex items-start gap-2 text-[13px] font-medium text-[var(--text-ink)]">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-500" />
              {corsBlocked ? "Blocked by CORS, or the host could not be reached." : "The request did not complete."}
            </p>
            <p className="text-[13px] leading-relaxed text-[var(--text-ink)]">{error}</p>
            {corsBlocked ? (
              <ul className="mt-1 grid gap-1 text-xs leading-relaxed text-[var(--text-muted)]">
                <li>• The target must answer with <code className="font-mono">Access-Control-Allow-Origin</code> set to this site&apos;s origin, or to <code className="font-mono">*</code> for a request with no credentials.</li>
                <li>• A preflight <code className="font-mono">OPTIONS</code> is sent first for anything beyond a simple request. It must answer that too.</li>
                <li>• If the server really is unreachable, the browser reports it the same way. There is no way to tell the two apart from a page — that is the privacy model working as intended.</li>
              </ul>
            ) : null}
          </div>
        ) : null}

        {response ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Status"
                value={`${response.status} ${response.statusText}`}
                tone={response.status >= 200 && response.status < 300 ? "success" : "brand"}
              />
              <Stat label="Elapsed" value={formatPreciseMs(response.ms)} />
              <Stat label="Size" value={formatBytes(response.bytes)} />
              <Stat label="Headers" value={String(response.headers.length)} />
            </dl>

            <Tabs
              label="Response"
              value={tab}
              onChange={setTab}
              fullWidth
              items={[
                { value: "body", label: "Body" },
                { value: "headers", label: "Response headers", badge: String(response.headers.length) },
                { value: "curl", label: "cURL", icon: <Terminal className="size-3.5" /> },
                { value: "fetch", label: "fetch", icon: <Code2Icon /> },
              ]}
            />

            <TabPanel value="body" activeValue={tab}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">
                    Response body
                    <span className="ml-2 text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
                      {response.kind}
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <CopyButton value={response.body || null} what="Response copied" size="sm" variant="ghost" />
                    <DownloadButton
                      text={response.body}
                      filename="response.json"
                      mime={response.kind === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8"}
                      label="Download"
                      size="sm"
                      variant="secondary"
                    />
                  </div>
                </div>
                {response.body === "" ? (
                  <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                    <ToolEmptyState
                      title="The response has no body."
                      description={`${response.status} ${response.statusText} arrived with zero bytes, which is normal for 204, 304 and many HEAD responses.`}
                    />
                  </div>
                ) : (
                  <pre className="max-h-[28rem] overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-ink)]">
                    {response.body}
                  </pre>
                )}
                <p className="text-xs text-[var(--text-muted)]">
                  {formatNumber(response.bytes)} bytes read · {response.ms.toFixed(1)} ms round trip, measured
                  around the <code className="font-mono">fetch</code> with{" "}
                  <code className="font-mono">performance.now()</code>, including reading the body.
                </p>
              </div>
            </TabPanel>

            <TabPanel value="headers" activeValue={tab}>
              <div className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)]">
                <table className="w-full min-w-[30rem] border-collapse text-left">
                  <caption className="sr-only">Response headers the browser chose to expose</caption>
                  <thead>
                    <tr className="border-b border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                      <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                        Name
                      </th>
                      <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {response.headers.map(([name, value], index) => (
                      <tr key={`${name}-${index}`} className="border-b border-[var(--surface-line)] last:border-0">
                        <th scope="row" className="whitespace-nowrap px-3 py-1.5 align-top font-mono text-[12px] font-medium text-[var(--text-ink)]">
                          {name}
                        </th>
                        <td className="px-3 py-1.5 align-top font-mono text-[12px] break-all text-emerald-500">
                          {value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                These are only the headers the browser chose to expose to a page. A cross-origin response hides
                everything outside the CORS-safelisted set, so a missing header here does not mean the server
                did not send it.
              </p>
            </TabPanel>

            <TabPanel value="curl" activeValue={tab}>
              <Snippet code={curl} language="bash" label="Equivalent cURL command" />
            </TabPanel>

            <TabPanel value="fetch" activeValue={tab}>
              <Snippet code={fetchSnippet} language="js" label="Equivalent fetch call" />
            </TabPanel>
          </>
        ) : sending ? (
          <p className="flex items-center justify-center gap-2 py-6 text-[13px] text-[var(--text-muted)]">
            <Timer aria-hidden="true" className="size-4" />
            Waiting for the response…
          </p>
        ) : url.trim() === "" ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Enter a URL and press Send."
              description="The request is fired from this page, with all the limits that implies."
              icon={<Send className="size-5" />}
            />
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}

const BLOCKED_HEADERS = new Set(["host", "origin", "referer", "user-agent", "cookie", "cookie2", "connection", "content-length"]);

function Snippet({ code, language, label }: { code: string; language: string; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-[var(--text-ink)]">{label}</span>
        <CopyButton value={code} what="Copied to clipboard" size="sm" variant="secondary" />
      </div>
      <pre className="overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
        <code data-language={language}>{code}</code>
      </pre>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Generated from the request above, exactly as it would be sent. The cURL version has no CORS
        restriction, so it will often work where this page cannot — that difference is the whole story.
      </p>
    </div>
  );
}

function Code2Icon() {
  return <Copy aria-hidden="true" className="size-3.5" />;
}

function buildCurl(
  method: Method,
  url: string,
  headers: Map<string, string>,
  body: string | undefined,
): string {
  const parts = [`curl -X ${method} ${shellQuote(url)}`];
  for (const [name, value] of headers) parts.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  if (body !== undefined && body !== "" && method !== "GET" && method !== "HEAD") {
    parts.push(`  -d ${shellQuote(body)}`);
  }
  return parts.join(" \\\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildFetch(
  method: Method,
  url: string,
  headers: Map<string, string>,
  request: { text: string | undefined; contentType: string | undefined },
): string {
  const lines: string[] = [
    `const response = await fetch(${JSON.stringify(url)}, {`,
    `  method: ${JSON.stringify(method)},`,
    `  headers: ${JSON.stringify(Object.fromEntries(headers), null, 2).split("\n").join("\n  ")},`,
  ];
  if (request.text !== undefined && method !== "GET" && method !== "HEAD") {
    lines.push(`  body: ${JSON.stringify(request.text)},`);
  }
  lines.push(`});`, "", `const text = await response.text();`, `console.log(response.status, text);`);
  return lines.join("\n");
}
