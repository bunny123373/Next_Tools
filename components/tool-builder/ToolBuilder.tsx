"use client";

import * as React from "react";
import Link from "next/link";
import { Beaker, Lightbulb, Lock, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, ToolError } from "@/components/tools/states";
import { toast } from "@/lib/utils/toast";

interface BuilderResponse {
  template: { id: string; label: string; summary: string; presets: Record<string, string> };
  tool: { id: string; name: string; route: string } | null;
  confidence: number;
  method: "ai" | "keywords" | "fallback";
  reason: string;
}

const EXAMPLES = [
  "I want an image compressor that converts images to WebP",
  "Merge several PDFs into one",
  "Turn a bunch of photos into a single PDF",
  "Count words and estimate reading time",
  "Generate a QR code for a URL and download it as SVG",
  "Hash a file with SHA-256",
];

export function ToolBuilder() {
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<BuilderResponse | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const build = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/tools/builder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        template?: BuilderResponse["template"];
        tool?: BuilderResponse["tool"];
        confidence?: number;
        method?: BuilderResponse["method"];
        reason?: string;
        error?: { message: string; fields?: Record<string, string> };
      };

      if (!response.ok || !payload.ok || !payload.template) {
        setError(
          payload.error?.message ??
            "We couldn't build anything from that description. Try naming the format or operation.",
        );
        return;
      }

      setResult({
        template: payload.template,
        tool: payload.tool ?? null,
        confidence: payload.confidence ?? 0,
        method: payload.method ?? "keywords",
        reason: payload.reason ?? "",
      });
      toast.success("Configuration ready");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* The safety guarantee, stated up front and not buried. */}
      <Notice tone="warning" icon={<Lock className="size-3.5" />} title="How this actually works">
        This does not write code. Your description is matched against a fixed catalogue of{" "}
        <strong>hand-written, already-tested tools</strong>, and you get one with your options
        preset. There is no <code className="font-mono text-[12px]">eval</code>, no dynamic import
        of a generated path, and nothing a model writes ever reaches an interpreter. The worst a
        confused model can do is pick the wrong tool from the list.
      </Notice>

      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5 sm:p-6">
        <label htmlFor="builder-input" className="text-[13px] font-medium text-[var(--text-ink)]">
          Describe the tool you want
        </label>
        <textarea
          id="builder-input"
          ref={inputRef}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void build();
            }
          }}
          rows={4}
          maxLength={600}
          placeholder="I want an image compressor that converts images to WebP so they upload faster to my portfolio"
          aria-describedby="builder-help"
          aria-invalid={Boolean(error)}
          className="mt-2 w-full resize-y rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 text-sm leading-relaxed text-[var(--text-ink)] placeholder:text-[var(--text-muted)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
        />

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p id="builder-help" className="text-[12px] leading-relaxed text-[var(--text-muted)]">
            Naming the format or operation helps a lot: &ldquo;compress images&rdquo;, &ldquo;merge
            PDFs&rdquo;, &ldquo;count words&rdquo;.
          </p>
          <Button
            variant="primary"
            onClick={build}
            loading={loading}
            disabled={description.trim().length < 6}
          >
            <Wand2 className="size-4" aria-hidden="true" />
            Build it
          </Button>
        </div>
      </div>

      {error ? <ToolError title={error} /> : null}

      {result ? (
        <div className="rounded-[14px] border border-emerald-500/30 bg-emerald-500/[0.04] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-emerald-500">
                <Sparkles className="size-3" aria-hidden="true" />
                Configuration ready
              </p>
              <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">
                {result.template.label}
              </h2>
              <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-[var(--text-muted)]">
                {result.template.summary}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="font-mono text-lg font-semibold tabular-nums text-[var(--text-ink)]">
                {Math.round(result.confidence * 100)}%
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {result.method === "ai" ? "via model" : "via keywords"}
              </p>
            </div>
          </div>

          <p className="mt-4 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
            {result.reason}
          </p>

          {Object.keys(result.template.presets).length > 0 ? (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                Applied presets
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(result.template.presets).map(([key, value]) => (
                  <li
                    key={key}
                    className="rounded-md border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2 py-1 font-mono text-[11px] text-[var(--text-ink)]"
                  >
                    {key} = {value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.tool ? (
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--surface-line)] pt-4">
              <Button variant="primary" href={result.tool.route}>
                Open {result.tool.name}
                <span aria-hidden="true">→</span>
              </Button>
              <p className="text-[12px] text-[var(--text-muted)]">
                Every option is editable there — the presets are a starting point, not a constraint.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-ink)]">
          <Lightbulb className="size-3.5 text-brand-500" aria-hidden="true" />
          Try one of these
        </h2>
        <ul className="mt-3 grid gap-1.5">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  setDescription(example);
                  inputRef.current?.focus();
                }}
                className="w-full rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2 text-left text-[13px] text-[var(--text-muted)] transition-colors hover:border-[var(--surface-line-strong)] hover:text-[var(--text-ink)]"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Notice tone="info" icon={<TriangleAlert className="size-3.5" />} title="Why is this experimental?">
        The mapping works, but &ldquo;describe it in English and get the right tool&rdquo; is a hard
        problem, and this solves it with a closed catalogue rather than synthesis. That is the right
        trade for now — reliable and safe — but it means the builder can only express what already
        exists. If you want something outside the catalogue,{" "}
        <Link href="/request-tool" className="underline underline-offset-2">
          request it
        </Link>{" "}
        and we will add it properly.
      </Notice>

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <Beaker className="size-3" aria-hidden="true" />
        Experimental feature. The mapping can be wrong — always check which tool you got.
      </p>
    </div>
  );
}
