import "server-only";

/**
 * One-time donations ("support").
 *
 * This is deliberately NOT the subscription model in `./plans.ts`.
 *
 * A donation grants nothing. It does not raise a limit, unlock a feature, or
 * produce an entitlement, which is why it never touches `getSubscription()` or
 * the hard rule in `./provider.ts` that no code path may mark anything paid
 * without a provider saying so. Every tool stays exactly as free and as
 * complete as it is for someone who pays nothing — that is the whole promise,
 * and it is what makes this safe to put on the site at all.
 *
 * Because there is no entitlement, there is also nothing to reconcile on our
 * side beyond confirming the payment completed — which is what the webhook in
 * `app/api/billing/webhook/route.ts` is for.
 *
 * AMOUNT SAFETY: the price is computed here, on the server, from a validated
 * integer. It is never read back out of the request body as a trusted number.
 * A client that posted `{ amount: 1 }` still pays $1, because that is the
 * smallest amount we allow — there is no path by which posting a smaller or
 * negative number results in a smaller charge.
 */

import Stripe from "stripe";

import { safeReturnUrl } from "./provider";
import {
  DONATION_CURRENCY,
  DONATION_PRESETS,
  MAX_DONATION_CENTS,
  MIN_DONATION_CENTS,
  validateDonationAmount,
  type DonationValidation,
} from "./donation-amounts";

/**
 * The amount rule lives in `./donation-amounts` so the browser and the server
 * share one copy of it. Re-exported here because the API route and the tests
 * both reach for it through this module.
 */
export { DONATION_PRESETS, DONATION_CURRENCY, MIN_DONATION_CENTS, MAX_DONATION_CENTS, validateDonationAmount };
export type { DonationValidation };

/* -------------------------------------------------------------------------- */
/*  Configuration                                                             */
/* -------------------------------------------------------------------------- */

let cached: Stripe | null | undefined;

/**
 * The Stripe client, or `null` when no secret key is configured.
 *
 * The key is read here and nowhere else, and this module is `server-only`, so it
 * cannot reach a browser bundle. `undefined` means "not asked yet"; `null` means
 * "asked, and there is no key" — which lets the tests avoid re-reading env.
 */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.warn(
      "[billing] STRIPE_SECRET_KEY is not set. The support page will say checkout is " +
        "unavailable rather than pretending it works.",
    );
    cached = null;
    return cached;
  }

  /**
   * No explicit `apiVersion`. The SDK ships against a pinned version and its
   * types are generated for it; passing a hand-written version string is how
   * accounts end up with type errors that do not exist at runtime.
   */
  cached = new Stripe(key, { typescript: true });
  return cached;
}

export function isDonationsConfigured(): boolean {
  return getStripe() !== null;
}

/** Test seam, and the escape hatch after the key is rotated at runtime. */
export function resetStripe(): void {
  cached = undefined;
}

/* -------------------------------------------------------------------------- */
/*  Checkout session                                                          */
/* -------------------------------------------------------------------------- */

export interface DonationSessionRequest {
  /** Validated amount in cents. */
  cents: number;
  /** Same-origin return paths; untrusted input is coerced by `safeReturnUrl`. */
  successPath: string | null;
  cancelPath: string | null;
}

export interface DonationSession {
  url: string;
  id: string;
}

export class DonationError extends Error {
  constructor(
    readonly code: "not_configured" | "invalid_amount" | "upstream_error",
    message: string,
  ) {
    super(message);
    this.name = "DonationError";
  }
}

/**
 * Creates a Stripe Checkout session for a one-time contribution.
 *
 * The customer leaves the site for Stripe's hosted page and comes back to a
 * same-origin URL. Nothing about the payment touches our own forms, so we never
 * see or store card details — that is the point of using Checkout rather than
 * building a payment form.
 */
export async function createDonationSession(
  request: DonationSessionRequest,
): Promise<DonationSession> {
  const stripe = getStripe();
  if (!stripe) {
    throw new DonationError(
      "not_configured",
      "Contributions are not switched on for this deployment yet.",
    );
  }

  if (
    !Number.isInteger(request.cents) ||
    request.cents < MIN_DONATION_CENTS ||
    request.cents > MAX_DONATION_CENTS
  ) {
    // Defence in depth: `validateDonationAmount` already gates this, so reaching
    // here means a new call site skipped it.
    throw new DonationError(
      "invalid_amount",
      `Contributions must be between $${MIN_DONATION_CENTS / 100} and $${MAX_DONATION_CENTS / 100}.`,
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    /**
     * Renders Stripe's "Donate" button and copy. A checkout page that says
     * "Pay" for something that grants nothing reads as a sale, which is not
     * what this is.
     */
    submit_type: "donate",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: DONATION_CURRENCY,
          unit_amount: request.cents,
          product_data: {
            name: "Support Balu Tools",
            description:
              "A one-time contribution towards hosting costs. Every tool stays free for everyone.",
          },
        },
      },
    ],
    /**
     * Collected so Stripe can email a receipt and so a donor can be recognised
     * if they give again. We store the address only inside Stripe.
     */
    customer_creation: "always",
    billing_address_collection: "auto",
    /**
     * The statement descriptor a donor sees on their bank statement. Without
     * it a charge shows as an unrecognised merchant, which is the single most
     * common reason a legitimate charge gets disputed.
     */
    payment_intent_data: {
      description: "Support Balu Tools (one-time)",
      statement_descriptor_suffix: "BALU TOOLS",
    },
    success_url: withDonationParams(safeReturnUrl(request.successPath, "/support?donated=1")),
    cancel_url: withDonationParams(safeReturnUrl(request.cancelPath, "/support?cancelled=1")),
  });

  if (!session.url) {
    throw new DonationError("upstream_error", "The payment provider did not return a checkout URL.");
  }

  return { url: session.url, id: session.id };
}

/**
 * Adds the donation markers without clobbering an existing query string.
 *
 * `safeReturnUrl` returns an absolute URL, and the success path may already
 * carry a query, so this uses `URL` rather than string concatenation.
 */
function withDonationParams(absolute: string): string {
  try {
    const url = new URL(absolute);
    if (!url.searchParams.has("donated") && !url.searchParams.has("cancelled")) {
      url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    }
    return url.toString();
  } catch {
    return absolute;
  }
}

/* -------------------------------------------------------------------------- */
/*  Webhook                                                                   */
/* -------------------------------------------------------------------------- */

export interface VerifiedDonationEvent {
  type: string;
  sessionId: string | null;
  amountCents: number | null;
  currency: string | null;
}

/**
 * Verifies a Stripe webhook and reduces it to the few fields we care about.
 *
 * Returns `null` for an invalid signature rather than throwing, so the route
 * can reject quietly. The raw body is required because the signature covers the
 * exact bytes Stripe sent — re-serialising the parsed JSON would break it.
 */
export async function verifyDonationWebhook(
  rawBody: string,
  signature: string | null,
): Promise<VerifiedDonationEvent | null> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret || !signature) return null;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    // Never echo the raw body or the signature into a log that could be
    // surfaced — it says only that verification failed.
    console.warn("[billing] webhook signature verification failed:", (error as Error).message);
    return null;
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return { type: event.type, sessionId: null, amountCents: null, currency: null };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  return {
    type: event.type,
    sessionId: session.id ?? null,
    amountCents: session.amount_total ?? null,
    currency: session.currency ?? null,
  };
}