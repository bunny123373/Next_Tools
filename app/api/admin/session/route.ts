import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, apiOk, parseJson, withErrorHandling } from "@/lib/api/respond";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import {
  clearAdminSession,
  createAdminSession,
  getAdminMode,
  verifyAdminSecret,
} from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const signInSchema = z.object({ secret: z.string().min(1).max(512) });

/**
 * POST /api/admin/session — exchange the admin secret for an httpOnly cookie.
 *
 * Rate limited to 5 attempts per minute per IP. `isAdminRequest` performs a
 * constant-time comparison, so the comparison itself does not leak the secret
 * through timing.
 */
export const POST = withErrorHandling(async (request: Request) => {
  if (getAdminMode() === "disabled") {
    return apiError(
      "not_configured",
      "Admin access is not configured. Set ADMIN_SECRET or AUTH_SECRET in your environment.",
    );
  }

  const limit = rateLimit(request, { bucket: "admin-signin", limit: 5, windowMs: 60_000 });
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many attempts. Wait a minute and try again.", {
      headers: rateLimitHeaders(limit),
    });
  }

  const parsed = await parseJson(request, signInSchema, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;

  if (!verifyAdminSecret(parsed.data.secret)) {
    return apiError("unauthorized", "That credential was not accepted.");
  }

  await createAdminSession();
  return apiOk({ signedIn: true });
});

/** DELETE /api/admin/session — sign out. */
export const DELETE = withErrorHandling(async (request: Request) => {
  const limit = rateLimit(request, { bucket: "admin-signin", limit: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many requests.", { headers: rateLimitHeaders(limit) });
  }

  await clearAdminSession();
  return NextResponse.json({ ok: true, signedIn: false });
});
