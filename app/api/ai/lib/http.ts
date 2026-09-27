/**
 * Shared plumbing for every `app/api/ai/**` route handler.
 *
 * All of it lives in one place so the five routes cannot drift apart: one body
 * size guard, one Zod error formatter, one `AiError` → JSON mapper, one rate
 * limit guard. Nothing here ever echoes the API key, the upstream body, the
 * visitor's input, or a stack trace.
 *
 * NOTE: this is a plain module inside `app/`, not a `route.ts`, so Next.js does
 * not turn it into an endpoint.
 */

import { z, ZodError, type ZodType } from "zod";
import {
  AI_ERROR_MESSAGES,
  AI_ERROR_STATUS,
  AI_MAX_BODY_BYTES,
  type AiErrorCode,
  type AiErrorResponse,
} from "@/lib/ai/schemas";
import { AiError } from "@/lib/ai/provider";
import { consumeAiRequest, type AiRateBucket } from "@/lib/ai/rate-limit";

/**
 * A failure we raised ourselves, with wording we have already reviewed.
 * Distinct from `AiError`, whose messages describe provider failures.
 */
export class HttpError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = AI_ERROR_STATUS[code];
  }
}

/** The one JSON error shape every AI route returns. */
export function aiError(
  code: AiErrorCode,
  message: string = AI_ERROR_MESSAGES[code],
  headers: Record<string, string> = {},
): Response {
  const body: AiErrorResponse = { ok: false, error: { code, message } };
  return Response.json(body, {
    status: AI_ERROR_STATUS[code],
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Turns a thrown value into a safe response.
 *
 * `HttpError` and `AiError` both carry a reviewed public message. Anything else
 * is an unexpected bug, and we answer with the generic `upstream` wording so an
 * accidental `throw new Error(JSON.stringify(process.env))` can never reach a
 * browser. `context` is a short static label chosen by the route; it never
 * contains user input.
 */
export function handleAiFailure(error: unknown, context: string): Response {
  if (error instanceof AiError) {
    const headers: Record<string, string> = {};
    if (error.code === "rate_limited" && error.retryAfterSeconds !== null) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return aiError(error.code, error.publicMessage, headers);
  }

  if (error instanceof HttpError) {
    return aiError(error.code, error.message);
  }

  if (error instanceof ZodError) {
    return aiError("bad_request", formatZodError(error));
  }

  if (error instanceof SyntaxError) {
    return aiError("bad_request", "The request body was not valid JSON.");
  }

  return aiError("upstream", `${AI_ERROR_MESSAGES.upstream} (${context})`);
}

/**
 * A visitor-facing validation message. Zod's own messages are safe — they
 * describe the constraint, never the value — so only the field path is added.
 */
export function formatZodError(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return "That request was not valid.";
  const field = first.path.length > 0 ? first.path.join(".") : "request";
  return `${field}: ${first.message}`;
}

/**
 * Parses and validates a JSON body, refusing anything over the size ceiling
 * before it is buffered. `Content-Length` is checked first (cheap), then the
 * buffered text, so a chunked request cannot sneak past.
 */
export async function readJsonBody<S extends ZodType>(
  request: Request,
  schema: S,
  maxBytes: number = AI_MAX_BODY_BYTES,
): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(
      "bad_request",
      `That request is too large. The limit is ${Math.round(maxBytes / 1024)} KB.`,
    );
  }

  const text = await request.text();
  if (text.length > maxBytes) {
    throw new HttpError(
      "bad_request",
      `That request is too large. The limit is ${Math.round(maxBytes / 1024)} KB.`,
    );
  }

  return schema.parse(JSON.parse(text) as unknown) as z.infer<S>;
}

/**
 * Applies the per-route budget plus the shared per-IP budget. Returns a `429`
 * with `Retry-After` when the visitor is over either of them.
 */
export function guardRateLimit(request: Request, bucket: AiRateBucket): Response | null {
  const decision = consumeAiRequest(request, bucket);
  if (decision.allowed) return null;

  return aiError("rate_limited", AI_ERROR_MESSAGES.rate_limited, {
    "Retry-After": String(decision.retryAfterSeconds),
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": "0",
  });
}

/** Every AI response is uncacheable — results are per-visitor and per-request. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;
