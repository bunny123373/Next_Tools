import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, apiOk, parseJson, withErrorHandling } from "@/lib/api/respond";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import { isAdminRequest } from "@/lib/admin/auth";
import { toolRequestSchema } from "@/lib/validations/schemas";
import { getStore, type ToolRequestRecord } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusUpdateSchema = z.object({
  status: z.enum(["pending", "planned", "completed"]),
});

function readLimiter(request: Request) {
  const limit = rateLimit(request, { bucket: "requests-read", ...LIMITS.read });
  return limit.allowed
    ? null
    : apiError("rate_limited", "Too many requests.", { headers: rateLimitHeaders(limit) });
}

function writeLimiter(request: Request) {
  const limit = rateLimit(request, { bucket: "requests-write", ...LIMITS.form });
  return limit.allowed
    ? null
    : apiError("rate_limited", "Too many submissions. Please try again shortly.", {
        headers: rateLimitHeaders(limit),
      });
}

/**
 * POST /api/requests — submit a tool request.
 *
 * Public. Protected by a rate limit, Zod validation and a honeypot field.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const limited = writeLimiter(request);
  if (limited) return limited;

  const parsed = await parseJson(request, toolRequestSchema, { maxBytes: 8 * 1024 });
  if (!parsed.ok) return parsed.response;

  const input = parsed.data;
  const limit = rateLimit(request, { bucket: "requests-write", ...LIMITS.form });

  // Honeypot: a bot filled the hidden field. Report success so it does not
  // learn to adapt, but store nothing.
  if (input.website) {
    return apiOk({ id: crypto.randomUUID() }, { status: 201, headers: rateLimitHeaders(limit) });
  }

  const record: ToolRequestRecord = {
    id: crypto.randomUUID(),
    toolName: input.toolName,
    category: input.category,
    description: input.description,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.email ? { email: input.email } : {}),
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  try {
    await getStore().saveToolRequest(record);
  } catch (error) {
    console.error("[api/requests] save failed:", error);
    return apiError(
      "upstream_error",
      "We couldn't save your request. Please try again, or email us directly.",
    );
  }

  return apiOk({ id: record.id, status: record.status }, { status: 201 });
});

/** GET /api/requests — list requests. Admin only. */
export const GET = withErrorHandling(async (request: Request) => {
  const limited = readLimiter(request);
  if (limited) return limited;

  if (!(await isAdminRequest(request))) {
    return apiError("unauthorized", "Admin access is required.");
  }

  const records = await getStore().listToolRequests();
  return apiOk({ requests: records });
});

/** PATCH /api/requests?id=… — change a request's status. Admin only. */
export const PATCH = withErrorHandling(async (request: Request) => {
  const limited = writeLimiter(request);
  if (limited) return limited;

  if (!(await isAdminRequest(request))) {
    return apiError("unauthorized", "Admin access is required.");
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return apiError("bad_request", "A request id is required.");

  const parsed = await parseJson(request, statusUpdateSchema, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;

  const updated = await getStore().updateToolRequestStatus(id, parsed.data.status);
  if (!updated) return apiError("not_found", "No request with that id.");

  return apiOk({ request: updated });
});

/** DELETE /api/requests?id=… — delete a request. Admin only. */
export const DELETE = withErrorHandling(async (request: Request) => {
  const limited = writeLimiter(request);
  if (limited) return limited;

  if (!(await isAdminRequest(request))) {
    return apiError("unauthorized", "Admin access is required.");
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return apiError("bad_request", "A request id is required.");

  const deleted = await getStore().deleteToolRequest(id);
  if (!deleted) return apiError("not_found", "No request with that id.");

  return NextResponse.json({ ok: true, id });
});
