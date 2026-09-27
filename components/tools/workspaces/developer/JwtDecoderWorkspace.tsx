"use client";

import * as React from "react";
import {
  BadgeCheck,
  CircleX,
  Eye,
  EyeOff,
  Key,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Stat, Textarea } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import {
  decodeJwt,
  jwtCountdowns,
  verifyJwtHmac,
  type JwtDecoded,
  type JwtVerification,
} from "@/lib/tools/engines/dev";

const SAMPLE = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImVtYWlsIjoiYWRhQGV4YW1wbGUuZGV2IiwiaWF0IjoxNzM5NTc3NjAwLCJleHAiOjQxMDI0NDQ4MDB9",
  "8U3lBbfX8Y9k6K4xkK1cGQeZ0pQ7VvJ2nT5mR9wL1sHc3dA6fB0jE",
].join(".");

const VERDICT_STYLE: Record<JwtVerification["status"], string> = {
  valid: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-500",
  invalid: "border-brand-500/30 bg-brand-500/[0.06] text-brand-500",
  unsupported: "border-amber-500/30 bg-amber-500/[0.06] text-amber-500",
  "not-attempted": "border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]",
};

const VERDICT_ICON: Record<JwtVerification["status"], React.ReactNode> = {
  valid: <ShieldCheck className="size-4" />,
  invalid: <CircleX className="size-4" />,
  unsupported: <ShieldQuestion className="size-4" />,
  "not-attempted": <ShieldAlert className="size-4" />,
};

export default function JwtDecoderWorkspace() {
  const [value, setValue] = React.useState(SAMPLE);
  const [secret, setSecret] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [verification, setVerification] = React.useState<JwtVerification | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [now, setNow] = React.useState(0);

  const decoded = React.useMemo(() => (value.trim() === "" ? null : decodeJwt(value)), [value]);
  const jwt = decoded?.ok === true ? decoded.jwt : null;

  React.useEffect(() => {
    // The first tick is deferred so the server-rendered HTML and the first
    // client render agree; everything clock-dependent stays "—" until then.
    const start = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, []);

  const verify = React.useCallback(async (target: JwtDecoded, key: string) => {
    setVerifying(true);
    try {
      setVerification(await verifyJwtHmac(target, key));
    } finally {
      setVerifying(false);
    }
  }, []);

  // The visible verdict is derived: "no verdict" is simply the absence of a
  // result for the current token and secret, so nothing has to be reset in an
  // effect when the secret is cleared.
  const verdict = React.useMemo<JwtVerification>(
    () => (jwt && secret ? (verification ?? { status: "not-attempted" }) : { status: "not-attempted" }),
    [jwt, secret, verification],
  );

  React.useEffect(() => {
    if (!jwt || !secret) return;
    // Debounced: an HMAC over a pasted secret is real work, and a fast typist
    // should not queue one per keystroke.
    const timer = setTimeout(() => {
      void verify(jwt, secret);
    }, 200);
    return () => clearTimeout(timer);
  }, [jwt, secret, verify]);

  const countdowns = React.useMemo(() => (jwt && now > 0 ? jwtCountdowns(jwt, now) : []), [jwt, now]);
  const report = jwt
    ? [
        `alg: ${jwt.alg || "(none)"}`,
        "",
        "HEADER",
        jwt.header.formatted,
        "",
        "PAYLOAD",
        jwt.payload.formatted,
        "",
        `SIGNATURE (base64url, ${jwt.signatureBytes.length} bytes)`,
        jwt.signature || "(none)",
      ].join("\n")
    : "";

  return (
    <ToolShell>
      <div className="flex flex-col gap-4">
        <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="Decoding is not verifying.">
          A JWT payload is base64, not encryption. Anyone holding this token can read every claim, and
          nothing in the payload proves who issued it. Treat everything below as untrusted text from an
          anonymous source: this page renders claim values as plain text and never as HTML.
        </Notice>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="jwt-input" className="text-[13px] font-medium text-[var(--text-ink)]">
            JWT
          </label>
          <Textarea
            id="jwt-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={5}
            spellCheck={false}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature"
            className="resize-y font-mono text-[12px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue(SAMPLE);
                toast.info("Sample loaded");
              }}
            >
              Load sample
            </Button>
            <Button size="sm" variant="ghost" disabled={!value} onClick={() => setValue("")}>
              Clear
            </Button>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {value ? `${formatNumber(value.length)} chars · ${value.split(".").length} segments` : ""}
            </span>
          </div>
        </div>

        {!value.trim() ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Paste a JWT to decode it."
              description="A leading “Bearer ” is stripped for you."
              icon={<Key className="size-5" />}
            />
          </div>
        ) : decoded && !decoded.ok ? (
          <div role="alert" className="rounded-[10px] border border-brand-500/30 bg-brand-500/[0.06] px-4 py-3.5">
            <p className="text-[13px] font-medium text-[var(--text-ink)]">This is not a decodable JWT.</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-ink)]">{decoded.error}</p>
          </div>
        ) : jwt ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Algorithm" value={jwt.alg || "unknown"} tone={jwt.alg ? "default" : "brand"} />
              <Stat label="Header bytes" value={String(jwt.header.text.length)} />
              <Stat label="Payload bytes" value={String(jwt.payload.text.length)} />
              <Stat label="Signature" value={`${jwt.signatureBytes.length} bytes`} />
            </dl>

            {jwt.warnings.map((warning) => (
              <Notice key={warning} tone="warning" icon={<TriangleAlert className="size-4" />}>
                {warning}
              </Notice>
            ))}

            {countdowns.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-3">
                {countdowns.map((entry) => (
                  <li
                    key={entry.label}
                    className={`flex items-center gap-2 rounded-[10px] border px-3.5 py-2.5 ${
                      entry.verdict === "expired"
                        ? "border-brand-500/30 bg-brand-500/[0.06]"
                        : entry.verdict === "not-yet"
                          ? "border-amber-500/30 bg-amber-500/[0.06]"
                          : "border-[var(--surface-line)] bg-[var(--surface-card-2)]"
                    }`}
                  >
                    <Timer
                      aria-hidden="true"
                      className={`size-4 shrink-0 ${
                        entry.verdict === "expired"
                          ? "text-brand-500"
                          : entry.verdict === "not-yet"
                            ? "text-amber-500"
                            : "text-[var(--text-muted)]"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[11px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
                        {entry.label}
                      </span>
                      <span
                        className={`block truncate font-mono text-[13px] font-semibold ${
                          entry.verdict === "expired"
                            ? "text-brand-500"
                            : entry.verdict === "not-yet"
                              ? "text-amber-500"
                              : "text-[var(--text-ink)]"
                        }`}
                      >
                        {entry.text}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <section aria-label="Signature verification" className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
              <h3 className="text-sm font-semibold text-[var(--text-ink)]">Verify the signature</h3>
              <Field
                label="HMAC secret"
                hint="Only needed for HS256, HS384 and HS512. It is used in this tab and never stored or sent."
              >
                {({ id, describedBy, invalid }) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type={showSecret ? "text" : "password"}
                      value={secret}
                      autoComplete="off"
                      onChange={(event) => setSecret(event.target.value)}
                      placeholder="The shared secret your issuer signed with"
                      className="font-mono"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={showSecret ? "Hide the secret" : "Show the secret"}
                      onClick={() => setShowSecret((current) => !current)}
                    >
                      {showSecret ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                    </Button>
                  </div>
                )}
              </Field>
              <div
                className={`flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 ${VERDICT_STYLE[verdict.status]}`}
                role="status"
              >
                <span aria-hidden="true" className="mt-0.5 shrink-0">
                  {VERDICT_ICON[verdict.status]}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {verdict.status === "valid"
                      ? "Signature valid"
                      : verdict.status === "invalid"
                        ? "Signature invalid"
                        : verdict.status === "unsupported"
                          ? "Cannot verify in a browser"
                          : verifying
                            ? "Checking…"
                            : "No verdict yet"}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-ink)]">
                    {verdict.status === "not-attempted"
                      ? "Paste an HMAC secret to recompute the signature over header.payload and compare it in constant time."
                      : verdict.message}
                  </p>
                </div>
              </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <Section title="Header" mono={jwt.header.formatted} copyValue={jwt.header.formatted} />
              <Section title="Payload claims" mono={jwt.payload.formatted} copyValue={jwt.payload.formatted}>
                {jwt.claims.length > 0 ? (
                  <div className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)]">
                    <table className="w-full min-w-[26rem] border-collapse text-left">
                      <caption className="sr-only">Registered and custom claims, with human labels</caption>
                      <thead>
                        <tr className="border-b border-[var(--surface-line)] bg-[var(--surface-card-2)]">
                          <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                            Claim
                          </th>
                          <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                            Meaning
                          </th>
                          <th scope="col" className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                            Value
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {jwt.claims.map((claim) => (
                          <tr key={claim.key} className="border-b border-[var(--surface-line)] last:border-0">
                            <th scope="row" className="whitespace-nowrap px-3 py-2 align-top font-mono text-[12px] font-medium text-[var(--text-ink)]">
                              {claim.key}
                            </th>
                            <td className="whitespace-nowrap px-3 py-2 align-top text-[12px] text-[var(--text-muted)]">
                              {claim.label}
                            </td>
                            <td className="px-3 py-2 align-top font-mono text-[12px] break-all text-emerald-500">
                              {claim.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Section>
            </div>

            <section aria-label="Signature" className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Signature (base64url)</span>
                <CopyButton value={jwt.signature || null} what="Signature copied" size="sm" variant="ghost" />
              </div>
              <code className="overflow-x-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] break-all text-[var(--text-ink)]">
                {jwt.signature || "(no signature on this token)"}
              </code>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                The signature covers <code className="font-mono">header.payload</code> — not the signature
                itself. Rewriting either of the first two segments invalidates it, which is exactly how a
                server detects a tampered token.
              </p>
            </section>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <CopyButton value={report} what="Full decode copied" size="sm" variant="secondary" />
              <DownloadButton
                text={report}
                filename="jwt-decoded.txt"
                mime="text/plain;charset=utf-8"
                label="Download decode"
                size="sm"
                variant="secondary"
              />
            </div>

            {verdict.status === "valid" ? (
              <Notice tone="success" icon={<BadgeCheck className="size-4" />} title="What a valid signature does and does not mean.">
                It proves the token was signed with a key you hold and has not been altered since. It says
                nothing about whether the claims are true, whether the issuer is trustworthy, or whether the
                token has since been revoked — for that you need the issuer&apos;s keys and a revocation list.
              </Notice>
            ) : null}
          </>
        ) : null}
      </div>
    </ToolShell>
  );
}

function Section({
  title,
  mono,
  copyValue,
  children,
}: {
  title: string;
  mono: string;
  copyValue: string;
  children?: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-[var(--text-ink)]">{title}</span>
        <CopyButton value={copyValue} what={`${title} copied`} size="sm" variant="ghost" />
      </div>
      <pre className="max-h-72 overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
        {mono}
      </pre>
      {children}
    </section>
  );
}
