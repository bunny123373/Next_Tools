import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Prose, Callout } from "@/components/layout/PageShell";
import { CATEGORIES, TOOL_COUNT } from "@/lib/tools/registry";
import { SITE } from "@/lib/site";
import { getEnvRequirements } from "@/lib/tools/runtime";
import { getAiPublicStatus } from "@/lib/ai/config";
import { clampDescription } from "@/lib/seo";
import { JsonLd } from "@/components/layout/JsonLd";

export const metadata: Metadata = {
  title: "API documentation",
  description: clampDescription(
    "The Balu Tools HTTP API: the public tool catalogue, request schemas, rate limits and error codes. No API key required for the public endpoints.",
  ),
  alternates: { canonical: "/api-docs" },
};

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/health",
    auth: "None",
    summary: "Liveness plus a configuration summary. Reports which features are enabled; never reports a value.",
  },
  {
    method: "GET",
    path: "/api/tools",
    auth: "None",
    summary: `The full tool catalogue as JSON — the same registry that renders this site. Filter with ?category=, ?q= and ?status=, cap with ?limit= (max 200).`,
  },
  {
    method: "POST",
    path: "/api/requests",
    auth: "None",
    summary: "Submit a tool request. Rate limited to 5/min. Validated with Zod, protected by a honeypot field.",
  },
  {
    method: "GET",
    path: "/api/requests",
    auth: "Admin",
    summary: "List tool requests. Requires an admin credential.",
  },
  {
    method: "PATCH",
    path: "/api/requests?id=…",
    auth: "Admin",
    summary: "Set a request's status to pending, planned or completed.",
  },
  {
    method: "DELETE",
    path: "/api/requests?id=…",
    auth: "Admin",
    summary: "Delete a request.",
  },
  {
    method: "POST",
    path: "/api/contact",
    auth: "None",
    summary: "Deliver a contact message. Rate limited to 5/min. The response reports where the message was actually delivered.",
  },
  {
    method: "POST",
    path: "/api/tools/builder",
    auth: "None",
    summary: "Experimental. Map a plain-language description onto an existing tool template. Returns a template id, never code.",
  },
] as const;

const ERROR_CODES = [
  { code: "400", name: "bad_request", meaning: "The body was not valid JSON, or a required query parameter was missing." },
  { code: "413", name: "payload_too_large", meaning: "The request body exceeded the route's size limit." },
  { code: "422", name: "validation_failed", meaning: "The body parsed but failed schema validation. The `fields` object names each offending field." },
  { code: "429", name: "rate_limited", meaning: "Too many requests. A `Retry-After` header tells you how long to wait." },
  { code: "501", name: "not_configured", meaning: "The feature needs a provider this deployment has not set up. The message names the environment variable." },
  { code: "401", name: "unauthorized", meaning: "Admin credentials were required and were missing or wrong." },
  { code: "502", name: "upstream_error", meaning: "A third-party provider failed. The upstream body is never returned to the caller." },
  { code: "500", name: "internal_error", meaning: "An unexpected server error. The details are logged server-side, never returned." },
] as const;

const METHOD_STYLE: Record<string, string> = {
  GET: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  POST: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  PATCH: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  DELETE: "border-brand-500/30 bg-brand-500/10 text-brand-500",
};

export default function ApiDocsPage() {
  const env = getEnvRequirements();
  const ai = getAiPublicStatus();

  return (
    <PageShell
      title="API"
      description="A small, honest HTTP surface. No API key is needed for anything documented here."
      eyebrow="Developer"
      className="max-w-[1100px]"
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: "Balu Tools API documentation",
          description: "HTTP API reference for the Balu Tools platform.",
          url: `${SITE.url}/api-docs`,
        }}
      />

      <Callout tone="info" title="No key required">
        Every endpoint below is public. Admin endpoints need an admin credential, which is
        environment configuration rather than a per-user API key — a full key-based API for the
        Business plan is designed but not built, and this page will say so when it is.
      </Callout>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">Base URL</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] p-4 font-mono text-[13px] text-[var(--text-ink)]">
          {SITE.url}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">Endpoints</h2>
        <div className="mt-3 overflow-x-auto rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--surface-line)]">
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Method</th>
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Path</th>
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Auth</th>
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Summary</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((endpoint) => (
                <tr key={`${endpoint.method} ${endpoint.path}`} className="border-b border-[var(--surface-line)] last:border-0">
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                        METHOD_STYLE[endpoint.method] ?? ""
                      }`}
                    >
                      {endpoint.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-[12px] text-[var(--text-ink)]">
                    {endpoint.path}
                  </td>
                  <td className="px-4 py-3 align-top text-[12px] text-[var(--text-muted)]">
                    {endpoint.auth}
                  </td>
                  <td className="px-4 py-3 align-top text-[12px] leading-relaxed text-[var(--text-muted)]">
                    {endpoint.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">Example</h2>
        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          Fetching the catalogue. No headers beyond <code className="font-mono text-[12px]">Accept</code>{" "}
          are needed.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] p-4 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
          {`curl "${SITE.url}/api/tools?category=image&limit=3"

# {
#   "ok": true,
#   "count": 3,
#   "total": ${TOOL_COUNT},
#   "categories": [ … ],
#   "tools": [
#     { "id": "image-compressor", "name": "Image Compressor",
#       "route": "/tools/image/compressor", "category": "image",
#       "description": "…", "processing": "local", "status": "stable",
#       "popular": true, "addedOn": "2026-01-05" }
#   ]
# }`}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">Response shape</h2>
        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          Every response is JSON and always carries an <code className="font-mono text-[12px]">ok</code>{" "}
          boolean, so a client never has to guess whether a 2xx body was an error.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] p-4 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
          {`// success
{ "ok": true, "count": 3, "tools": [ … ] }

// failure
{ "ok": false,
  "error": {
    "code": "validation_failed",
    "message": "Please check the highlighted fields and try again.",
    "fields": { "description": "This field is required." }
  } }`}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">
          Error codes
        </h2>
        <div className="mt-3 overflow-x-auto rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--surface-line)]">
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">HTTP</th>
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">code</th>
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">When</th>
              </tr>
            </thead>
            <tbody>
              {ERROR_CODES.map((entry) => (
                <tr key={entry.code} className="border-b border-[var(--surface-line)] last:border-0">
                  <td className="px-4 py-2.5 align-top font-mono tabular-nums text-[var(--text-ink)]">
                    {entry.code}
                  </td>
                  <td className="px-4 py-2.5 align-top font-mono text-[12px] text-[var(--text-ink)]">
                    {entry.name}
                  </td>
                  <td className="px-4 py-2.5 align-top text-[12px] leading-relaxed text-[var(--text-muted)]">
                    {entry.meaning}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">Rate limits</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Every response carries <code className="font-mono text-[12px]">x-ratelimit-limit</code> and{" "}
          <code className="font-mono text-[12px]">x-ratelimit-remaining</code>. A rejected request
          adds <code className="font-mono text-[12px]">retry-after</code>.
        </p>
        <ul className="mt-3 grid gap-1.5">
          <li><strong>Forms</strong> (requests, contact): 5 per minute per IP.</li>
          <li><strong>Heavy</strong> (tool builder): 10 per minute per IP.</li>
          <li><strong>Reads</strong> (tools, health): 120 per minute per IP.</li>
          <li><strong>Admin sign-in</strong>: 5 attempts per minute per IP.</li>
        </ul>
        <Callout tone="warning" title="Single-instance limiter">
          Rate limit counters live in process memory. On a deployment with multiple instances behind
          a load balancer, each instance counts separately, so the effective limit scales with the
          instance count. Swap the store in{" "}
          <code className="font-mono text-[12px]">lib/api/rate-limit.ts</code> for Redis to fix that.
        </Callout>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">
          Deployment state
        </h2>
        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          What this particular deployment currently supports. Presence only — no values.
        </p>
        <dl className="mt-3 grid gap-1.5">
          {env.map((requirement) => (
            <div
              key={requirement.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] px-3.5 py-2.5"
            >
              <dt className="font-mono text-[12px] text-[var(--text-ink)]">{requirement.name}</dt>
              <dd
                className={`text-[12px] ${requirement.configured ? "text-emerald-500" : "text-[var(--text-muted)]"}`}
              >
                {requirement.configured ? "configured" : "not set"}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] text-[var(--text-muted)]">
          AI provider:{" "}
          {ai.configured ? (
            <span className="text-emerald-500">
              {ai.provider} · {ai.model} (host {ai.baseUrlHost})
            </span>
          ) : (
            <span className="text-amber-500">not configured — the AI tools show a setup panel</span>
          )}
        </p>
      </section>

      <Prose>
        <h2>What is not exposed</h2>
        <ul>
          <li>
            <strong>No file-processing endpoints.</strong> The heavy tools run in your browser on
            purpose. Exposing them over HTTP would mean uploading your files, which is exactly what
            this platform avoids.
          </li>
          <li>
            <strong>No tool invocation by name.</strong> <code>/api/tools</code> returns metadata, not
            execution. There is no endpoint that takes a file and returns a processed file.
          </li>
          <li>
            <strong>No per-user API keys.</strong> Designed for the Business plan, not built.
          </li>
        </ul>

        <h2>Want something that is not here?</h2>
        <p>
          Tell us. <Link href="/request-tool">Request an API endpoint</Link> and include the shape you
          need — an example request and response is more useful than a description.
        </p>
      </Prose>

      <p className="mt-8 text-[12px] text-[var(--text-muted)]">
        {TOOL_COUNT} tools across {CATEGORIES.length} categories are described by this API.
      </p>
    </PageShell>
  );
}
