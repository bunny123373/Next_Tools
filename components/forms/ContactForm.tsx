"use client";

import * as React from "react";
import { CheckCircle2, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { toast } from "@/lib/utils/toast";

interface FieldErrors {
  [field: string]: string | undefined;
}

type Status = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [context, setContext] = React.useState("");
  const [website, setWebsite] = React.useState("");

  const [status, setStatus] = React.useState<Status>("idle");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [ephemeral, setEphemeral] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "submitting") return;

    setStatus("submitting");
    setErrors({});
    setErrorMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, message, context, website }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        destination?: string;
        error?: { message: string; fields?: FieldErrors };
      };

      if (!response.ok || !payload.ok) {
        setStatus("error");
        if (payload.error?.fields) setErrors(payload.error.fields);
        setErrorMessage(payload.error?.message ?? "We couldn't send that. Please try again.");
        return;
      }

      // Be honest about where the message went.
      if (payload.destination === "memory") setEphemeral(true);
      setStatus("success");
      toast.success("Message sent", "Thanks for getting in touch.");
    } catch {
      setStatus("error");
      setErrorMessage("We couldn't reach the server. Check your connection and try again.");
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
        <h2 className="mt-4 text-base font-semibold text-[var(--text-ink)]">Message sent</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--text-muted)]">
          {ephemeral
            ? "This deployment has no mail provider configured, so your message was accepted but is being held in memory rather than emailed. Please also email us directly so it isn't lost."
            : "Thanks for getting in touch. We read everything and usually reply within a few days."}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-5"
          onClick={() => {
            setName("");
            setEmail("");
            setMessage("");
            setContext("");
            setStatus("idle");
            setEphemeral(false);
          }}
        >
          Send another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {status === "error" ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] px-3.5 py-3"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-500" />
          <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{errorMessage}</p>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={120}
              required
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={status === "submitting"}
            />
          )}
        </Field>

        <Field label="Email" error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              maxLength={254}
              required
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={status === "submitting"}
            />
          )}
        </Field>
      </div>

      <Field
        label="Message"
        error={errors.message}
        hint="Bug reports, feedback, or anything else on your mind."
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={6}
            maxLength={4000}
            required
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={status === "submitting"}
          />
        )}
      </Field>

      <Field
        label="What were you doing?"
        hint="Optional. Very helpful for bug reports."
        error={errors.context}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="e.g. Compressing a 40 MB PNG on Firefox 141"
            maxLength={500}
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={status === "submitting"}
          />
        )}
      </Field>

      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Leave this field empty</label>
        <input
          id="contact-website"
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
          We use your email only to reply to this message.
        </p>
        <Button type="submit" variant="primary" loading={status === "submitting"}>
          <Send className="size-4" aria-hidden="true" />
          Send Message
        </Button>
      </div>
    </form>
  );
}
