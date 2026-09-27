"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

/**
 * Admin sign-in.
 *
 * The secret is posted to a server route that compares it in constant time and
 * sets an httpOnly cookie. The secret is never stored in React state beyond the
 * request, never written to localStorage, and never logged.
 */
export function AdminSignIn() {
  const router = useRouter();
  const [secret, setSecret] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || !secret) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };

      if (!response.ok || !payload.ok) {
        setError(payload.error?.message ?? "That credential was not accepted.");
        setSecret("");
        return;
      }

      setSecret("");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
        <Field
          label="Admin secret"
          error={error}
          hint="The value of ADMIN_SECRET, or AUTH_SECRET if you are using session auth."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={loading}
            />
          )}
        </Field>

        <Button type="submit" variant="primary" className="mt-4 w-full" loading={loading}>
          <KeyRound className="size-4" aria-hidden="true" />
          Sign in
        </Button>
      </div>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        There is no default password. If you have not set an admin secret, /admin stays closed.
      </p>
    </form>
  );
}
