import "server-only";

import { clientIp } from "./respond";

/**
 * In-memory sliding-window rate limiter.
 *
 * SCOPE LIMIT — read before deploying this anywhere with real traffic:
 * this state lives in the process memory of a single instance. With multiple
 * instances behind a load balancer each one keeps its own counters, so the
 * effective limit is multiplied by the instance count. For a multi-instance
 * deployment, swap `store` for Redis (or the platform's own limiter) — the
 * interface below is deliberately tiny so that is a one-file change.
 *
 * That limitation is fine for a single-instance self-hosted deployment, which
 * is what this project is, and it is far better than shipping no limit at all.
 */

interface Window {
  /** Timestamps of requests still inside the window, oldest first. */
  hits: number[];
}

const store = new Map<string, Window>();

/** Evict expired windows so a long-running process cannot leak memory. */
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, window] of store) {
    if (window.hits.length === 0) store.delete(key);
  }
}

export interface RateLimitOptions {
  /** Key namespace, so different routes get independent budgets. */
  bucket: string;
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the next slot frees up. */
  retryAfterSeconds: number;
  limit: number;
}

export function rateLimit(request: Request, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const key = `${options.bucket}:${clientIp(request)}`;
  const cutoff = now - options.windowMs;

  const window = store.get(key) ?? { hits: [] };
  window.hits = window.hits.filter((time) => time > cutoff);

  if (window.hits.length >= options.limit) {
    const oldest = window.hits[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
    store.set(key, window);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      limit: options.limit,
    };
  }

  window.hits.push(now);
  store.set(key, window);

  return {
    allowed: true,
    remaining: options.limit - window.hits.length,
    retryAfterSeconds: 0,
    limit: options.limit,
  };
}

/** Rate-limit headers, attached to both allowed and rejected responses. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
  };
  if (!result.allowed) headers["retry-after"] = String(result.retryAfterSeconds);
  return headers;
}

/** Test/ops helper: wipes all counters. */
export function resetRateLimits(): void {
  store.clear();
}

/* ------------------------------------------------------------------ */
/*  Common presets                                                     */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  /** Forms: generous enough for a human, tight enough to stop a script. */
  form: { limit: 5, windowMs: 60_000 },
  /** Read-only endpoints. */
  read: { limit: 120, windowMs: 60_000 },
  /** Expensive operations (AI, conversion). */
  heavy: { limit: 10, windowMs: 60_000 },
  /** Anonymous usage pings. */
  analytics: { limit: 30, windowMs: 60_000 },
} as const;

/** Clears counters older than their window. Safe to call from a cron route. */
export function pruneRateLimits(): number {
  const before = store.size;
  const now = Date.now();
  for (const [key, window] of store) {
    const oldest = window.hits[0] ?? now;
    if (oldest + 24 * 60 * 60 * 1000 < now) store.delete(key);
  }
  return before - store.size;
}
