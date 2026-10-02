import "server-only";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Admin access control.
 *
 * There is no default credential anywhere in this repository, and there is no
 * hardcoded password. Three supported configurations, in priority order:
 *
 *   1. `AUTH_SECRET` set → a session cookie (`balu_admin`) whose HMAC verifies
 *      against the secret. This is the mode to use with a real auth provider.
 *   2. `ADMIN_SECRET` set → a bearer token / cookie must match it exactly.
 *      Practical for a single operator, a cron job, or a self-hosted admin.
 *   3. Neither set   → /admin is completely disabled and returns 503 with a
 *      message telling the operator exactly what to set.
 *
 * The third case is the default, which means a fresh clone cannot be
 * brute-forced into an admin panel.
 */

const SESSION_COOKIE = "balu_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AdminMode = "session" | "token" | "disabled";

export function getAdminMode(): AdminMode {
  if (process.env.AUTH_SECRET) return "session";
  if (process.env.ADMIN_SECRET) return "token";
  return "disabled";
}

/** Constant-time string comparison. Length mismatch still short-circuits safely. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    // Still burn a comparison so the timing does not leak length.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verifies a candidate secret submitted by a user, in constant time.
 *
 * Accepts whichever credential is actually configured, so the same sign-in form
 * works in both modes. Returns false when admin is disabled.
 */
export function verifyAdminSecret(candidate: string): boolean {
  const expected = process.env.ADMIN_SECRET ?? process.env.AUTH_SECRET;
  if (!expected || !candidate) return false;
  return safeEqual(candidate, expected);
}

async function sign(value: string, secret: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function createAdminSession(): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return;
  const store = await cookies();
  const issued = String(Date.now());
  store.set(SESSION_COOKIE, `${issued}.${await sign(issued, secret)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

async function hasValidSession(): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (!value) return false;
  /*
   * The cookie is `<issuedAt>.<signature>`, and verification re-signs the part
   * before the dot and compares that against the part after it.
   *
   * The bug this replaces was in the writer, not here. createAdminSession wrote
   * a bare signature with no dot, so the split returned the whole string and
   * the comparison reduced to HMAC(HMAC(t)) against HMAC(t) -- false for every
   * login, permanently. Signing in returned `signedIn: true` and set a cookie
   * that no request could then use, so /admin was unreachable in session mode.
   *
   * An intermediate attempt "fixed" it by re-signing the whole cookie value
   * instead, which was wrong: that asks whether `value === sign(value)`, and no
   * signature satisfies that. It has to be payload and signature.
   *
   * What kept this invisible is that both failure modes are a bare 401 with no
   * detail, so a broken verifier looks exactly like a wrong password, and token
   * mode never calls this function at all.
   */
  const [issued, signature] = value.split(".");
  if (!issued || !signature) return false;
  return safeEqual(signature, await sign(issued, secret));
}

/**
 * Checks admin access for a route handler. Accepts a session cookie or, in
 * token mode, an `Authorization: Bearer` header or `x-admin-token`.
 */
export async function isAdminRequest(request: Request): Promise<boolean> {
  const mode = getAdminMode();
  if (mode === "disabled") return false;

  if (mode === "session" && (await hasValidSession())) return true;

  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const header = request.headers.get("x-admin-token") ?? "";
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value ?? "";

  return [bearer, header, cookie].some((candidate) => candidate && safeEqual(candidate, secret));
}

/** Middleware-style guard for the /admin pages. */
export async function requireAdmin(): Promise<
  { ok: true } | { ok: false; response: NextResponse }
> {
  const mode = getAdminMode();

  if (mode === "disabled") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: "not_configured",
            message:
              "Admin access is not configured. Set ADMIN_SECRET (or AUTH_SECRET for session-based " +
              "access) in your environment, then restart the server.",
          },
        },
        { status: 503 },
      ),
    };
  }

  if (await hasValidSession()) return { ok: true };

  return {
    ok: false,
    response: NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in to continue." } },
      { status: 401 },
    ),
  };
}
