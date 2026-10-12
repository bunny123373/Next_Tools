"use client";

/**
 * The donation form on /support.
 *
 * Responsibilities, kept deliberately small:
 *   - Collect an amount (preset or custom).
 *   - Ask the server to open a Stripe Checkout session.
 *   - Hand the visitor over to Stripe and let them come back.
 *
 * It does NOT compute a price, and it does not decide what is valid. The amount
 * is re-validated server-side in `validateDonationAmount` before a session is
 * ever created, so a tampered request cannot change what someone is charged.
 * The client-side checks here exist to give a fast, friendly message — the
 * server is the one that actually decides.
 */

import * as React from "react";
import { Heart, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/tools/states";
import {
  MAX_DONATION_DOLLARS,
  MIN_DONATION_DOLLARS,
} from "@/lib/billing/donation-amounts";

const PRESETS = [3, 5, 10, 25] as const;

const MIN = MIN_DONATION_DOLLARS;
const MAX = MAX_DONATION_DOLLARS;

export function SupportForm({ configured }: { configured: boolean }) {
  const [amount, setAmount] = React.useState<string>("5");
  const [custom, setCustom] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /** The preset buttons fill the same field the custom box writes to. */
  const chosen = custom.trim() !== "" ? Number(custom) : Number(amount);
  const parsed = Number.isFinite(chosen) ? chosen : 0;
  const localError =
    !Number.isFinite(parsed) || parsed <= 0
      ? "Enter an amount, for example 5."
      : parsed < MIN
        ? `The smallest contribution is $${MIN}.`
        : parsed > MAX
          ? `The largest single contribution is $${MAX}.`
          : null;

  const startCheckout = React.useCallback(async () => {
    if (!configured || busy || localError) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/donate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: parsed,
          successPath: "/support?donated=1",
          cancelPath: "/support?cancelled=1",
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        url?: string;
        error?: { message?: string };
      };

      if (!response.ok || !payload.ok || !payload.url) {
        setError(payload.error?.message ?? "We could not start the checkout. Please try again.");
        return;
      }

      /**
       * Full navigation, not `window.open`. Stripe's own hosted page is the
       * secure step, and a same-tab redirect is what a donor expects — and it
       * means the back button returns them here rather than to a blank tab.
       */
      window.location.assign(payload.url);
    } catch {
      setError("We could not reach the payment provider. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [configured, busy, localError, parsed]);

  if (!configured) {
    return (
      <Notice tone="info" icon={<ShieldCheck className="size-4" />}>
        Contributions are not switched on for this deployment, so there is nothing to pay here. Every tool
        stays free and fully usable regardless — if you want to help, emailing{" "}
        <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "the address on the contact page"}`} className="underline underline-offset-2">
          us
        </a>{" "}
        still works.
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5 sm:p-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
          One-time amount
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const active = custom.trim() === "" && Number(amount) === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setAmount(String(preset));
                  setCustom("");
                }}
                disabled={busy}
                aria-pressed={active}
                className={
                  active
                    ? "rounded-[10px] border border-brand-500 bg-brand-500/10 px-4 py-2 text-sm font-semibold text-brand-500"
                    : "rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-4 py-2 text-sm font-medium text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)] disabled:opacity-50"
                }
              >
                ${preset}
              </button>
            );
          })}
        </div>
      </div>

      <Field
        label="Or enter your own amount"
        hint={`One payment, in dollars, between $${MIN} and $${MAX}. No recurring charge and nothing to cancel.`}
        error={error ?? localError}
      >
        {({ id, describedBy, invalid }) => (
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-sm text-[var(--text-muted)]">
              $
            </span>
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              inputMode="decimal"
              value={custom}
              disabled={busy}
              placeholder="5"
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void startCheckout();
                }
              }}
            />
          </div>
        )}
      </Field>

      <Button
        variant="primary"
        onClick={() => void startCheckout()}
        disabled={busy || Boolean(localError)}
        loading={busy}
      >
        {busy ? (
          <>
            <Loader2 className="mr-1.5 inline size-4 animate-spin" aria-hidden="true" />
            Opening checkout…
          </>
        ) : (
          <>
            <Heart className="mr-1.5 inline size-4" aria-hidden="true" />
            Contribute ${parsed > 0 ? parsed : "—"}
          </>
        )}
      </Button>

      <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
        You will be taken to Stripe&rsquo;s secure page. Card details never touch this site, and this unlocks
        nothing — every tool stays free either way.
      </p>
    </div>
  );
}