"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Send, TriangleAlert } from "lucide-react";
import { TOOL_CATEGORIES } from "@/lib/validations/schemas";
import { CATEGORIES } from "@/lib/tools/categories";
import { SITE } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/tools/states";

interface FieldErrors {
  [field: string]: string | undefined;
}

type Status = "idle" | "submitting" | "success" | "error";

export function RequestToolForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [toolName, setToolName] = React.useState(searchParams.get("tool") ?? "");
  const [category, setCategory] = React.useState<string>(searchParams.get("category") ?? "");
  const [description, setDescription] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [email, setEmail] = React.useState("");
  /** Honeypot. Hidden from humans, tempting to bots. */
  const [website, setWebsite] = React.useState("");

  const [status, setStatus] = React.useState<Status>("idle");
  const [message, setMessage] = React.useState<string>("");
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "submitting") return;

    setStatus("submitting");
    setMessage("");
    setErrors({});

    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName, category, description, reason, email, website }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string; fields?: FieldErrors };
      };

      if (!response.ok || !payload.ok) {
        setStatus("error");
        if (payload.error?.fields) setErrors(payload.error.fields);
        setMessage(payload.error?.message ?? "We couldn't submit that. Please try again.");
        return;
      }

      setStatus("success");
      // A tool request is a "submitted" event worth confirming in the toast too.
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("We couldn't reach the server. Check your connection and try again.");
    }
  };

  if (status === "success") {
    return (
      <div className="rounded-[14px] border border-emerald-500/30 bg-emerald-500/[0.05] p-6 text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
        >
          <CheckCircle2 className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-[var(--text-ink)]">Request submitted</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--text-muted)]">
          Thanks — that&apos;s in the queue. We read every request, and a good number of the tools
          on this site started as one.
        </p>
        <div className="mt-5 flex flex-col items-stretch justify-center gap-2 sm:flex-row">
          <Button variant="primary" size="sm" href="/tools">
            Browse all tools
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setToolName("");
              setDescription("");
              setReason("");
              setStatus("idle");
            }}
          >
            Submit another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {status === "error" ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] px-3.5 py-3">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-500" />
          <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{message}</p>
        </div>
      ) : null}

      <Field label="Tool name" error={errors.toolName} hint="What you'd call it.">
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={toolName}
            onChange={(event) => setToolName(event.target.value)}
            placeholder="e.g. HEIC to JPG converter"
            maxLength={120}
            required
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={status === "submitting"}
          />
        )}
      </Field>

      <Field label="Category" error={errors.category}>
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={status === "submitting"}
            required
          >
            <option value="">Choose a category…</option>
            {CATEGORIES.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
            {TOOL_CATEGORIES.filter((slug) => slug === "other").map((slug) => (
              <option key={slug} value={slug}>
                Something else
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Description"
        error={errors.description}
        hint="What it should do, and what a good result looks like."
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="I want to convert HEIC photos from my phone into JPGs so I can upload them to a job board that only accepts JPG."
            rows={5}
            maxLength={2000}
            required
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={status === "submitting"}
          />
        )}
      </Field>

      <Field
        label="Why do you need it?"
        hint="Optional, but context genuinely helps us prioritise."
        error={errors.reason}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="I take photos on iPhone and have to convert every single one before applying for jobs. It's a five-minute job every time."
            rows={3}
            maxLength={2000}
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={status === "submitting"}
          />
        )}
      </Field>

      <Field
        label="Email"
        hint="Optional. Only used to follow up if we have a question."
        error={errors.email}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            maxLength={254}
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={status === "submitting"}
          />
        )}
      </Field>

      {/* Honeypot: visually and programmatically hidden from real users. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="request-website">Leave this field empty</label>
        <input
          id="request-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--surface-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          No account needed. We only use your email to reply to this request.
        </p>
        <Button type="submit" variant="primary" loading={status === "submitting"}>
          <Send className="size-4" aria-hidden="true" />
          Submit request
        </Button>
      </div>
    </form>
  );
}

/** Shown when no persistence backend is configured. */
export function StorageWarning({ persistent }: { persistent: boolean }) {
  if (persistent) return null;
  return (
    <Notice tone="warning" title="Submissions are not being persisted yet.">
      This deployment has no <code className="font-mono text-[12px]">TOOL_REQUESTS_ENDPOINT</code>{" "}
      configured, so requests are validated and accepted but held in memory — they will be lost
      when the server restarts. The form works; the destination is not durable yet. Email{" "}
      {/* Read from SITE rather than written out: a hardcoded address here
          silently drifts from the one the rest of the site uses, and this one
          had already done exactly that. */}
      <a href={`mailto:${SITE.contactEmail}`} className="underline underline-offset-2">
        {SITE.contactEmail}
      </a>{" "}
      instead if your request matters.
    </Notice>
  );
}
