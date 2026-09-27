import "server-only";

/**
 * Payment provider abstraction.
 *
 * HARD RULE, enforced by the absence of any success path in this file: nothing
 * here can mark a subscription as paid without a provider saying so. There is
 * no `activateSubscription()` reachable from a client, and no "demo mode".
 *
 * Three providers are described. Only `unconfigured` is implemented, and it
 * refuses every operation with a `not_configured` error — which is the correct
 * behaviour for a deployment with no payment provider attached.
 *
 * To add a real provider:
 *   1. Implement `PaymentProvider` (see the interface below).
 *   2. `registerProvider("stripe", () => new StripeProvider(...))`.
 *   3. Add a webhook route that verifies the signature, then calls
 *      `syncSubscriptionFromProvider` — the only place a plan is ever upgraded.
 */

import type { PlanId } from "./plans";
import { isPlanId } from "./plans";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Subscription {
  /** The provider's own id, e.g. "sub_123". */
  id: string;
  plan: PlanId;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  /** ISO timestamps. */
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  seats?: number;
}

export interface CheckoutRequest {
  plan: Exclude<PlanId, "free">;
  /** Where to send the customer back to. Must be a same-origin path. */
  successUrl: string;
  cancelUrl: string;
  /** Opaque reference used to reconcile the webhook. */
  customerReference: string;
  seats?: number;
}

export interface CheckoutSession {
  url: string;
  /** Present for providers that return a session id alongside the URL. */
  id?: string;
}

export interface PortalSession {
  url: string;
}

export type PaymentErrorCode =
  | "not_configured"
  | "invalid_plan"
  | "invalid_url"
  | "upstream_error"
  | "unauthorized";

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface PaymentProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  createPortalSession(customerReference: string, returnUrl: string): Promise<PortalSession>;
  getSubscription(subscriptionId: string): Promise<Subscription | null>;
  cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  /**
   * Verifies a provider webhook. Returns null when the signature is invalid —
   * never throws, so a route can reject quietly.
   */
  verifyWebhook(request: Request, rawBody: string): Promise<{ event: string; subscription: Subscription } | null>;
}

/* ------------------------------------------------------------------ */
/*  Unconfigured provider                                              */
/* ------------------------------------------------------------------ */

class UnconfiguredProvider implements PaymentProvider {
  readonly id = "unconfigured";
  readonly label = "No payment provider";

  isConfigured() {
    return false;
  }

  async createCheckout(): Promise<CheckoutSession> {
    throw new PaymentError(
      "not_configured",
      "No payment provider is configured. Every tool is currently free, so no checkout is needed.",
    );
  }

  async createPortalSession(): Promise<PortalSession> {
    throw new PaymentError("not_configured", "No payment provider is configured.");
  }

  async getSubscription(): Promise<Subscription | null> {
    return null;
  }

  async cancelSubscription(): Promise<void> {
    throw new PaymentError("not_configured", "No payment provider is configured.");
  }

  async verifyWebhook() {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

const providers = new Map<string, () => PaymentProvider>([
  ["unconfigured", () => new UnconfiguredProvider()],
]);

export function registerProvider(id: string, factory: () => PaymentProvider): void {
  providers.set(id, factory);
}

let cachedProvider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cachedProvider) return cachedProvider;

  const id = process.env.PAYMENT_PROVIDER?.trim() || "unconfigured";
  const factory = providers.get(id);

  if (!factory) {
    console.warn(
      `[billing] PAYMENT_PROVIDER="${id}" is not registered. Falling back to "unconfigured", ` +
        `so checkout will refuse rather than pretend to work.`,
    );
    cachedProvider = new UnconfiguredProvider();
    return cachedProvider;
  }

  cachedProvider = factory();
  return cachedProvider;
}

export function isPaymentsConfigured(): boolean {
  return getPaymentProvider().isConfigured();
}

/* ------------------------------------------------------------------ */
/*  Resolution                                                         */
/* ------------------------------------------------------------------ */

/**
 * The effective plan for a request.
 *
 * Today this is always `free`, because there are no accounts and no provider.
 * The function exists so that the day a provider is wired up, the entitlement
 * lookup has one obvious place to read from — and so that no other code path
 * can accidentally invent a higher plan.
 */
export async function getSubscription(): Promise<Subscription | null> {
  if (!isPaymentsConfigured()) return null;
  return null;
}

export async function resolvePlanForRequest(_request: Request): Promise<PlanId> {
  const subscription = await getSubscription();
  // Only an *active* or *trialing* subscription grants a plan. A `past_due` or
  // `canceled` subscription falls back to free immediately.
  if (!subscription) return "free";
  if (subscription.status !== "active" && subscription.status !== "trialing") return "free";
  return isPlanId(subscription.plan) ? subscription.plan : "free";
}

/* ------------------------------------------------------------------ */
/*  URL safety                                                         */
/* ------------------------------------------------------------------ */

/**
 * Checkout return URLs must be same-origin. Without this check an attacker
 * could pass `successUrl=https://evil.example` and turn our checkout into an
 * open redirect that looks like it came from us.
 */
export function safeReturnUrl(candidate: string | null, fallbackPath = "/dashboard"): string {
  const fallback = new URL(fallbackPath, process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  if (!candidate) return fallback.toString();

  try {
    const url = new URL(candidate);
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
    if (url.origin !== site.origin) return fallback.toString();
    return url.toString();
  } catch {
    // A relative path is fine as long as it starts with a single slash.
    return candidate.startsWith("/") && !candidate.startsWith("//")
      ? new URL(candidate, fallback).toString()
      : fallback.toString();
  }
}
