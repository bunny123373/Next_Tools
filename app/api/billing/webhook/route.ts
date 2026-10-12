import { apiOk, withErrorHandling } from "@/lib/api/respond";
import { verifyDonationWebhook } from "@/lib/billing/donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — Stripe event receiver.
 *
 * Scope, stated plainly because it is easy to overstate. A donation grants no
 * entitlement, so there is nothing here to unlock and no plan to upgrade. In its
 * current form this endpoint **verifies and acknowledges** — and it records
 * nothing. Stripe's dashboard remains the authoritative ledger of what was paid.
 *
 * It is still worth having, for two reasons:
 *
 *   1. It is where fulfilment belongs. If a supporter benefit is ever added, the
 *      signature check and the event parsing already exist, and this is the only
 *      place Stripe events should be handled.
 *   2. A donor whose browser is blocked, closes the tab, or loses the network
 *      after paying never reaches the success URL. Without an endpoint like this
 *      there is no way for the site to notice that payment at all.
 *
 * What it does NOT do is mark anything paid. That remains impossible for a
 * donation by construction, and the hard rule in `lib/billing/provider.ts` is
 * untouched.
 *
 * Deliberately absent, and worth adding before taking real money at volume:
 *   - No persistence. Events are logged and acknowledged only. Wire this to your
 *     store if you want a donation ledger you own.
 *   - No tax handling. See the note on `automatic_tax` in `lib/billing/donations.ts`.
 */
export const POST = withErrorHandling(async (request: Request) => {
  /**
   * The RAW body, not `request.json()`. The signature Stripe sends covers the
   * exact bytes it posted, so re-serialising the parsed object produces a
   * different string and verification fails for a reason that looks like an
   * attack rather than a bug.
   */
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");

  const event = await verifyDonationWebhook(raw, signature);

  /**
   * An unverifiable event is rejected with 400 rather than silently ignored:
   * Stripe retries a 400, which is what we want for a misconfigured webhook
   * secret, and a valid event that changes nothing is a 200 so it does not
   * retry forever.
   */
  if (!event) {
    return apiOk({ received: false, reason: "signature verification failed" }, { status: 400 });
  }

  if (event.sessionId && event.amountCents !== null) {
    const dollars = (event.amountCents / 100).toFixed(2);
    /**
     * `warn`, not `log`: the repo's ESLint config permits only `warn` and
     * `error`, and `error` would be a lie — this is a normal event, not a
     * failure. Until there is persistence this line is the only server-side
     * trace of a contribution, which is worth having for reconciliation against
     * the Stripe dashboard.
     */
    console.warn(
      `[billing] donation received: ${event.type} session=${event.sessionId} ` +
        `${dollars} ${(event.currency ?? "usd").toUpperCase()}`,
    );
  } else {
    console.warn(`[billing] stripe event: ${event.type}`);
  }

  return apiOk({ received: true });
});