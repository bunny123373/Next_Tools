/**
 * Donation amounts — pure, client-safe, no dependencies.
 *
 * This exists as its own module because of one hard constraint: the constants
 * and the validation rule are needed in two places that cannot see each other.
 * The server (`lib/billing/donations.ts`) needs them to build a price, and the
 * browser (`components/billing/SupportForm.tsx`) needs them to show sensible
 * bounds before anyone clicks. `donations.ts` is `import "server-only"`, so a
 * client component importing from it would fail the build — correctly.
 *
 * Putting the rule here means there is exactly one copy of it, and the copy the
 * browser checks against is the copy the server enforces.
 *
 * The browser check is for messaging only. It is trivially bypassed, and the
 * server re-validates every amount in `createDonationSession` before a session
 * exists. Never treat a passing client-side check as permission to charge.
 */

/** Suggested amounts. Presentation only — any valid amount is accepted. */
export const DONATION_PRESETS = [3, 5, 10, 25] as const;

/** Currency is fixed server-side. A client cannot choose one. */
export const DONATION_CURRENCY = "usd" as const;

/**
 * Stripe charges in the smallest currency unit, so every amount is cents.
 * $1 floor keeps Stripe's own minimum satisfied and stops a "donation" of $0.01.
 */
export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 50_000;

export const MIN_DONATION_DOLLARS = MIN_DONATION_CENTS / 100;
export const MAX_DONATION_DOLLARS = MAX_DONATION_CENTS / 100;

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export interface DonationValidation {
  ok: boolean;
  cents?: number;
  message?: string;
}

/**
 * Validates a client-supplied amount in dollars and returns it in cents.
 *
 * Takes a `number` rather than a formatted string so a client cannot smuggle
 * `"1e3"` or `" 3 "` past a parser and have it read as something other than
 * three dollars. Rounding to whole cents is deliberate: Stripe rejects
 * fractional cents, and silently changing what someone chose is worse than
 * telling them about it.
 */
export function validateDonationAmount(amount: unknown): DonationValidation {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return { ok: false, message: "Enter an amount as a number, for example 5." };
  }
  if (amount <= 0) {
    return { ok: false, message: "Choose an amount greater than zero." };
  }
  if (amount > MAX_DONATION_DOLLARS) {
    return { ok: false, message: `The maximum single contribution is $${MAX_DONATION_DOLLARS}.` };
  }

  const cents = Math.round(amount * 100);
  if (cents < MIN_DONATION_CENTS) {
    return { ok: false, message: `The smallest contribution we can take is $${MIN_DONATION_DOLLARS}.` };
  }
  if (cents > MAX_DONATION_CENTS) {
    return { ok: false, message: `The maximum single contribution is $${MAX_DONATION_DOLLARS}.` };
  }

  return { ok: true, cents };
}