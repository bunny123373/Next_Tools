import "server-only";

import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";

/* ------------------------------------------------------------------ */
/*  Errors                                                             */
/* ------------------------------------------------------------------ */

/** Machine-readable error codes the client can branch on. */
export type ApiErrorCode =
  | "bad_request"
  | "validation_failed"
  | "not_configured"
  | "rate_limited"
  | "payload_too_large"
  | "unauthorized"
  | "not_found"
  | "upstream_error"
  | "internal_error";

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  not_configured: 501,
  rate_limited: 429,
  payload_too_large: 413,
  unauthorized: 401,
  not_found: 404,
  upstream_error: 502,
  internal_error: 500,
};

export interface ApiErrorBody {
  ok: false;
  error: {
    code: ApiErrorCode;
    /** Safe, human-readable. Never a stack trace and never an upstream body. */
    message: string;
    /** Field-level validation details, when applicable. */
    fields?: Record<string, string>;
  };
}

/**
 * The only shape a failed API response takes. Anything that reaches the client
 * from an error path goes through here, which is what guarantees we cannot
 * accidentally leak an env var name's *value* or a Node stack.
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  options: { fields?: Record<string, string>; headers?: HeadersInit } = {},
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(options.fields ? { fields: options.fields } : {}) } },
    { status: STATUS[code], headers: options.headers },
  );
}

export function apiOk<T>(data: T, init: ResponseInit = {}): NextResponse {
  return NextResponse.json({ ok: true, ...data }, init);
}

/**
 * Wraps a handler so an unexpected throw becomes a generic 500 rather than
 * Next's default error page (which can include a stack in development).
 * The real error is logged server-side only.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ZodError) return zodToResponse(error);
      console.error("[api] unhandled error:", error);
      return apiError("internal_error", "Something went wrong on our end. Please try again.");
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

export function flattenZod(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function zodToResponse(error: ZodError): NextResponse<ApiErrorBody> {
  return apiError("validation_failed", "Please check the highlighted fields and try again.", {
    fields: flattenZod(error),
  });
}

/**
 * Parses and validates a JSON body, returning either the typed value or a ready
 * -to-return error response. Keeps handlers free of try/catch noise.
 */
export async function parseJson<T>(
  request: Request,
  schema: ZodSchema<T>,
  options: { maxBytes?: number } = {},
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse<ApiErrorBody> }> {
  const maxBytes = options.maxBytes ?? 64 * 1024;

  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    return {
      ok: false,
      response: apiError(
        "payload_too_large",
        `That request is larger than the ${Math.round(maxBytes / 1024)} KB limit.`,
      ),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: apiError("bad_request", "Could not read the request body.") };
  }

  if (raw.length > maxBytes) {
    return {
      ok: false,
      response: apiError(
        "payload_too_large",
        `That request is larger than the ${Math.round(maxBytes / 1024)} KB limit.`,
      ),
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, response: apiError("bad_request", "The request body is not valid JSON.") };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: zodToResponse(parsed.error) };
  }

  return { ok: true, data: parsed.data };
}

/* ------------------------------------------------------------------ */
/*  Request metadata                                                   */
/* ------------------------------------------------------------------ */

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that sets it; on a
 * directly-exposed server a client can spoof it. This is acceptable for
 * rate limiting (a spoofed IP only harms the spoofer) but must never be used
 * for access control. Documented here so nobody reaches for it elsewhere.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
