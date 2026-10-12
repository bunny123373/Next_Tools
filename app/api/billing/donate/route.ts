import { z } from "zod";

import { apiError, apiOk, parseJson, withErrorHandling } from "@/lib/api/respond";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import {
  DonationError,
  createDonationSession,
  isDonationsConfigured,
  validateDonationAmount,
} from "@/lib/billing/donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/donate — start a one-time contribution.
 *
 * Takes an amount in whole dollars and returns a Stripe Checkout URL to send the
 * visitor to. No card data ever reaches this process.
 *
 * The amount is validated twice, on purpose: `validateDonationAmount` here for a
 * good error message, and again inside `createDonationSession`, which is the
 * only place that builds the price. Nothing downstream reads a client number as
 * a chargeable amount.
 */
const Body = z.object({
  /** Dollars, not cents. Kept simple so the client cannot get the unit wrong. */
  amount: z.number(),
  successPath: z.string().max(200).nullish(),
  cancelPath: z.string().max(200).nullish(),
});

export const POST = withErrorHandling(async (request: Request) => {
  /**
   * `LIMITS.form` is deliberate rather than `read`. Each call creates a real
   * Checkout session upstream, so this endpoint is not free to hit — an
   * unbounded loop against it would be a way to generate sessions at the site's
   * expense.
   */
  const limit = rateLimit(request, { bucket: "donate", ...LIMITS.form });
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please wait a minute and try again.", {
      headers: rateLimitHeaders(limit),
    });
  }

  const parsed = await parseJson(request, Body);
  if (!parsed.ok) return parsed.response;

  const amount = validateDonationAmount(parsed.data.amount);
  if (!amount.ok || amount.cents === undefined) {
    return apiError("validation_failed", amount.message ?? "That amount is not valid.", {
      fields: { amount: amount.message ?? "Not a valid amount." },
    });
  }

  /**
   * Checked before the provider is touched so an unconfigured deployment gets
   * an honest 501 instead of an upstream failure that reads like a Stripe
   * outage. This mirrors how the rest of the site reports missing configuration.
   */
  if (!isDonationsConfigured()) {
    return apiError(
      "not_configured",
      "Contributions are not switched on for this deployment yet. Every tool remains free regardless.",
    );
  }

  try {
    const session = await createDonationSession({
      cents: amount.cents,
      successPath: parsed.data.successPath ?? null,
      cancelPath: parsed.data.cancelPath ?? null,
    });

    return apiOk(
      { url: session.url, id: session.id },
      { headers: { ...rateLimitHeaders(limit), "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DonationError) {
      return apiError(
        error.code === "upstream_error" ? "upstream_error" : "bad_request",
        error.message,
        { headers: rateLimitHeaders(limit) },
      );
    }
    // Logged server-side only; the client gets the generic message from
    // `withErrorHandling` only if this rethrows, so handle it here instead.
    console.error("[billing] donation checkout failed:", error);
    return apiError(
      "upstream_error",
      "We could not start the checkout just now. Please try again in a moment.",
      { headers: rateLimitHeaders(limit) },
    );
  }
});

/**
 * GET /api/billing/donate — is checkout available?
 *
 * Lets the page render a clear "not configured" panel instead of a button that
 * fails. Reports presence of configuration only, never a key value.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const limit = rateLimit(request, { bucket: "donate-status", ...LIMITS.read });
  return apiOk(
    { configured: isDonationsConfigured() },
    { headers: { ...rateLimitHeaders(limit), "cache-control": "no-store" } },
  );
});