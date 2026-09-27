/**
 * Subscription plans.
 *
 * Deliberate constraint: this file describes what a plan *would* unlock, and
 * the entitlement checks that gate it. It does not pretend any payment has
 * happened. Nothing here grants access on its own — an entitlement is only
 * honoured when `getSubscription` returns a live subscription object, and that
 * comes from a payment provider.
 *
 * The `implemented` flag on each feature is load-bearing: the UI reads it to
 * say "not built yet" rather than charging for a promise.
 */

export type PlanId = "free" | "pro" | "business";

export interface PlanFeature {
  key: string;
  label: string;
  /**
   * False means the feature is described for roadmap purposes only. The pricing
   * table renders these as "planned" and the entitlement check refuses them.
   */
  implemented: boolean;
  /** Numeric entitlement, when the feature is a limit. */
  limit?: number;
  unit?: string;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Per month, in the smallest currency unit would be overkill; use major units. */
  priceMonthly: number;
  currency: "USD";
  tagline: string;
  /** Everything in the plan, in display order. */
  features: PlanFeature[];
  /** Included in the plan for continuity when downgrading. */
  highlights: string[];
}

const FEATURES = {
  fileSizeLimit: (mb: number, implemented = true): PlanFeature => ({
    key: "fileSizeLimit",
    label: `Files up to ${mb} MB`,
    implemented,
    limit: mb,
    unit: "MB",
  }),
  batch: (maxFiles: number, implemented = true): PlanFeature => ({
    key: "batch",
    label: `Batch processing, up to ${maxFiles} files at once`,
    implemented,
    limit: maxFiles,
    unit: "files",
  }),
  dailyOps: (count: number, implemented = true): PlanFeature => ({
    key: "dailyOps",
    label: `${count} heavy operations per day`,
    implemented,
    limit: count,
    unit: "operations",
  }),
  aiMonthly: (count: number, implemented = true): PlanFeature => ({
    key: "aiMonthly",
    label: `${count.toLocaleString()} AI operations per month`,
    implemented,
    limit: count,
    unit: "operations",
  }),
  cloudHistory: (implemented = true): PlanFeature => ({
    key: "cloudHistory",
    label: "Cloud history that follows you across devices",
    implemented,
  }),
  noAds: (implemented = true): PlanFeature => ({
    key: "noAds",
    label: "No ads",
    implemented,
  }),
  apiAccess: (implemented = false): PlanFeature => ({
    key: "apiAccess",
    label: "API access with your own key",
    implemented,
  }),
  teamSeats: (count: number, implemented = false): PlanFeature => ({
    key: "teamSeats",
    label: `${count} team seats with shared history`,
    implemented,
    limit: count,
    unit: "seats",
  }),
  priority: (implemented = false): PlanFeature => ({
    key: "priority",
    label: "Priority processing queue",
    implemented,
  }),
} as const;

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    currency: "USD",
    tagline: "Everything you need to get a job done.",
    features: [
      FEATURES.fileSizeLimit(100),
      FEATURES.batch(20),
      FEATURES.dailyOps(10),
      FEATURES.aiMonthly(50),
      { key: "cloudHistory", label: "Local history in your browser", implemented: true },
      { key: "noAds", label: "No ads", implemented: true },
    ],
    highlights: [
      "All tools, no paywall",
      "Browser processing, nothing uploaded",
      "Favourites, recents and history",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 9,
    currency: "USD",
    tagline: "For people processing files all day.",
    features: [
      FEATURES.fileSizeLimit(1000),
      FEATURES.batch(200),
      FEATURES.dailyOps(500),
      FEATURES.aiMonthly(2000),
      FEATURES.cloudHistory(),
      FEATURES.noAds(),
    ],
    highlights: [
      "10× the file size limit",
      "Large batch runs",
      "Cloud history across devices",
    ],
  },
  {
    id: "business",
    name: "Business",
    priceMonthly: 29,
    currency: "USD",
    tagline: "For teams and automation.",
    features: [
      FEATURES.fileSizeLimit(5000),
      FEATURES.batch(1000),
      FEATURES.dailyOps(5000),
      FEATURES.aiMonthly(20000),
      FEATURES.cloudHistory(),
      FEATURES.noAds(),
      FEATURES.apiAccess(),
      FEATURES.teamSeats(10),
      FEATURES.priority(),
    ],
    highlights: [
      "Everything in Pro",
      "API access and team seats",
      "Priority processing",
    ],
  },
] as const;

export const PLAN_MAP: Readonly<Record<PlanId, Plan>> = Object.freeze(
  Object.fromEntries(PLANS.map((plan) => [plan.id, plan])) as Record<PlanId, Plan>,
);

/* ------------------------------------------------------------------ */
/*  Entitlements                                                       */
/* ------------------------------------------------------------------ */

export type EntitlementKey =
  | "fileSizeLimit"
  | "batch"
  | "dailyOps"
  | "aiMonthly"
  | "cloudHistory"
  | "noAds"
  | "apiAccess"
  | "teamSeats"
  | "priority";

export interface Entitlements {
  plan: PlanId;
  limits: Partial<Record<EntitlementKey, number>>;
  /** Features the plan names but that are not built yet. */
  pending: EntitlementKey[];
}

/**
 * The limits that apply to *everyone*, used by the public config and as the
 * fallback when no subscription can be resolved.
 *
 * These are enforced server-side for server-backed operations only. Browser
 * tools are already bounded by the visitor's own memory, which is a stronger
 * limit than any number we could pick.
 */
export const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",
  limits: Object.fromEntries(
    PLAN_MAP.free.features.filter((f) => f.limit !== undefined).map((f) => [f.key, f.limit!]),
  ),
  pending: [],
};

export function getEntitlements(plan: PlanId): Entitlements {
  const resolved = PLAN_MAP[plan] ?? PLAN_MAP.free;
  return {
    plan: resolved.id,
    limits: Object.fromEntries(
      resolved.features.filter((f) => f.limit !== undefined).map((f) => [f.key, f.limit!]),
    ),
    pending: resolved.features.filter((f) => !f.implemented).map((f) => f.key as EntitlementKey),
  };
}

export function isPlanId(value: string): value is PlanId {
  return value === "free" || value === "pro" || value === "business";
}
