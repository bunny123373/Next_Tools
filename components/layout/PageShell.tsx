import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { JsonLd } from "@/components/layout/JsonLd";
import { SITE } from "@/lib/site";

/* ------------------------------------------------------------------ */
/*  Page shell                                                         */
/* ------------------------------------------------------------------ */

export interface PageShellProps {
  title: string;
  description?: string;
  /** Extra breadcrumb items after "Home". */
  trail?: { label: string; href?: string }[];
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
  /** Optional JSON-LD payload. */
  jsonLd?: unknown;
}

/** Consistent frame for every non-tool content page. */
export function PageShell({
  title,
  description,
  trail = [],
  eyebrow,
  children,
  className,
  jsonLd,
}: PageShellProps) {
  return (
    <div className={cn("mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8", className)}>
      {jsonLd ? <JsonLd data={jsonLd} /> : null}

      <Breadcrumb
        className="mb-6"
        items={[{ label: "Home", href: "/" }, ...trail, { label: title }]}
      />

      <header className="mb-9">
        {eyebrow ? (
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-brand-500">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1.5 text-3xl font-semibold tracking-[-0.03em] text-[var(--text-ink)] sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3.5 text-base leading-relaxed text-[var(--text-muted)]">{description}</p>
        ) : null}
      </header>

      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Prose                                                              */
/* ------------------------------------------------------------------ */

const PROSE = [
  "text-[15px] leading-[1.75] text-[var(--text-muted)]",
  "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-[var(--text-ink)]",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-ink)]",
  "[&_p]:mt-3",
  "[&_ul]:mt-3 [&_ul]:grid [&_ul]:gap-1.5 [&_ul]:pl-0 [&_ul]:list-none",
  "[&_ol]:mt-3 [&_ol]:grid [&_ol]:gap-1.5 [&_ol]:pl-0 [&_ol]:list-none [&_ol_counter-reset:list]",
  "[&_li]:relative [&_li]:pl-5",
  "[&_ul>li]:before:{content:'•'} [&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:text-brand-500",
  "[&_ol>li]:before:{content:counter(list)} [&_ol>li]:before:absolute [&_ol>li]:before:left-0 [&_ol>li]:before:font-mono [&_ol>li]:before:text-xs [&_ol>li]:before:text-brand-500 [&_ol>li]:counter-increment:list",
  "[&_a]:text-brand-500 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:no-underline",
  "[&_strong]:font-medium [&_strong]:text-[var(--text-ink)]",
  "[&_code]:rounded [&_code]:border [&_code]:border-[var(--surface-line)] [&_code]:bg-[var(--surface-card-2)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-[var(--text-ink)]",
  "[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-[var(--surface-line)] [&_pre]:bg-[var(--surface-card)] [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_pre]:text-[var(--text-ink)]",
  "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-8 [&_hr]:border-t [&_hr]:border-[var(--surface-line)]",
].join(" ");

/** Typography wrapper for long-form legal / help content. */
export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(PROSE, className)}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Callout                                                            */
/* ------------------------------------------------------------------ */

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "success";
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-[var(--surface-line)] bg-[var(--surface-card-2)]",
    warning: "border-amber-500/25 bg-amber-500/[0.06]",
    success: "border-emerald-500/25 bg-emerald-500/[0.06]",
  } as const;

  return (
    <div className={cn("my-6 rounded-xl border px-4 py-3.5 text-[14px] leading-relaxed", tones[tone])}>
      {title ? <p className="font-medium text-[var(--text-ink)]">{title}</p> : null}
      <div className={cn("text-[var(--text-muted)]", title && "mt-1")}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FAQ list (also emits FAQPage JSON-LD)                               */
/* ------------------------------------------------------------------ */

export function FaqList({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <div className="mt-4 grid gap-2">
      {items.map((item, index) => (
        <details
          key={index}
          className="group rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-3.5 transition-colors hover:border-[var(--surface-line-strong)]"
        >
          <summary className="cursor-pointer list-none text-[14px] font-medium text-[var(--text-ink)] marker:content-none">
            <span className="flex items-start justify-between gap-3">
              <span>{item.question}</span>
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-45"
              >
                +
              </span>
            </span>
          </summary>
          <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--text-muted)]">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function faqPageJsonLd(items: { question: string; answer: string }[], path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
    url: `${SITE.url}${path}`,
  };
}

/* ------------------------------------------------------------------ */
/*  CTA                                                                */
/* ------------------------------------------------------------------ */

export function PageCta({
  title = "Can't find what you need?",
  body = "Tell us what you were trying to do. Requests are read by a human and directly shape what gets built next.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div className="mt-12 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-6 text-center">
      <h2 className="text-base font-semibold text-[var(--text-ink)]">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--text-muted)]">
        {body}
      </p>
      <div className="mt-5 flex flex-col items-stretch justify-center gap-2 sm:flex-row">
        <Link
          href="/request-tool"
          className="inline-flex h-10 items-center justify-center rounded-[10px] bg-brand-500 px-5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
        >
          Request a tool
        </Link>
        <Link
          href="/tools"
          className="inline-flex h-10 items-center justify-center rounded-[10px] border border-[var(--surface-line-strong)] px-5 text-sm font-medium text-[var(--text-ink)] transition-colors hover:bg-[var(--surface-card-2)]"
        >
          Browse all tools
        </Link>
      </div>
    </div>
  );
}
