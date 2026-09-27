/**
 * A small in-memory rate limiter for the AI routes.
 *
 * ---------------------------------------------------------------------------
 *  CAVEAT — READ THIS BEFORE DEPLOYING
 * ---------------------------------------------------------------------------
 *  This limiter is per-process. State lives in a `Map` inside the Node
 *  process, so with N instances behind a load balancer a visitor gets roughly N
 *  times the configured budget, and a rolling deploy resets every bucket.
 *  A multi-instance deployment MUST use Redis (or the hosting platform's own
 *  limiter / WAF rule) for the limit to be global — this file is a
 *  best-effort guard against a single misbehaving client, not a security
 *  boundary.
 *
 *  The window is *sliding* (timestamps are kept per key and old hits expire),
 *  not a fixed bucket, so a client cannot burn an entire minute's budget in the
 *  last second of a window and then idle.
 */

export interface RateLimitPolicy {
  /** Hits allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until the oldest hit leaves the window. */
  resetMs: number;
  retryAfterSeconds: number;
}

interface Bucket {
  /** Hit timestamps, oldest first. */
  hits: number[];
  /** Last time this key was seen, for pruning. */
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Drops buckets that have been quiet for a while so a long-running process
 * cannot accumulate one entry per IP address forever.
 */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastSeen > 10 * 60_000) buckets.delete(key);
  }
}

/** Records a hit and reports whether it is inside the budget. */
export function consume(key: string, policy: RateLimitPolicy): RateLimitDecision {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key) ?? { hits: [], lastSeen: now };
  const cutoff = now - policy.windowMs;

  // Sliding window: keep only the hits still inside it.
  const kept = existing.hits.filter((timestamp) => timestamp > cutoff);
  kept.push(now);
  existing.hits = kept;
  existing.lastSeen = now;
  buckets.set(key, existing);

  const oldest = kept[0] ?? now;
  const resetMs = Math.max(0, oldest + policy.windowMs - now);

  if (kept.length > policy.limit) {
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      resetMs,
      retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  return {
    allowed: true,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - kept.length),
    resetMs,
    retryAfterSeconds: 0,
  };
}

/** Test helper. Never called from a request handler. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

/* ------------------------------------------------------------------ */
/*  Client identity                                                    */
/* ------------------------------------------------------------------ */

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is client-controlled in general, but every deployment that
 * terminates TLS in front of this app has a proxy that appends the real address
 * as the last entry. We read the **first** entry, which is what the closest
 * trusted proxy wrote, and fall back to a shared placeholder when the header is
 * absent. This is a fairness device, not authentication — see the caveat above.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const vercel = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel.split(",")[0]?.trim()?.slice(0, 64) ?? "unknown";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/*  Policies                                                           */
/* ------------------------------------------------------------------ */

const MINUTE = 60_000;

/**
 * Per-route budgets. Image generation and PDF chat are the expensive ones, so
 * they get a tighter budget than a text completion; every route additionally
 * shares the coarse per-IP bucket below, so hammering one route cannot be
 * topped up by switching to another.
 */
export const AI_RATE_POLICIES = {
  status: { limit: 60, windowMs: MINUTE },
  chat: { limit: 12, windowMs: MINUTE },
  image: { limit: 6, windowMs: MINUTE },
  vision: { limit: 8, windowMs: MINUTE },
  pdf: { limit: 6, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;

export type AiRateBucket = keyof typeof AI_RATE_POLICIES;

/** The coarse bucket every AI route draws from, whatever it does. */
export const AI_IP_BUDGET: RateLimitPolicy = { limit: 30, windowMs: MINUTE };

/**
 * Consumes both the route budget and the shared per-IP budget. A request is
 * allowed only if both allow it; the stricter `Retry-After` wins.
 */
export function consumeAiRequest(request: Request, bucket: AiRateBucket): RateLimitDecision {
  const ip = clientIp(request);

  const route = consume(`route:${bucket}:${ip}`, AI_RATE_POLICIES[bucket]);
  const coarse = consume(`ip:${ip}`, AI_IP_BUDGET);

  if (route.allowed && coarse.allowed) {
    return { ...route, remaining: Math.min(route.remaining, coarse.remaining) };
  }
  if (!route.allowed) return route;
  return coarse;
}
