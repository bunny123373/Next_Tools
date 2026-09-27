import { apiOk, withErrorHandling } from "@/lib/api/respond";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import { TOOL_COUNT, CATEGORIES, validateRegistry } from "@/lib/tools/registry";
import { getAdminMode } from "@/lib/admin/auth";
import { describeStore } from "@/lib/storage";
import { isAiConfigured } from "@/lib/ai/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness plus a configuration summary.
 *
 * Reports *presence* of configuration only, never values. This endpoint is
 * public, so it must never be able to leak a secret.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const limit = rateLimit(request, { bucket: "health", ...LIMITS.read });
  if (!limit.allowed) {
    return apiOk(
      { status: "ok", rateLimited: true },
      { status: 200, headers: rateLimitHeaders(limit) },
    );
  }

  const problems = validateRegistry();

  return apiOk(
    {
      status: problems.length === 0 ? "ok" : "degraded",
      tools: TOOL_COUNT,
      categories: CATEGORIES.length,
      registryProblems: problems.length,
      features: {
        ai: isAiConfigured(),
        admin: getAdminMode() !== "disabled",
        storage: describeStore().kind,
      },
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        ...rateLimitHeaders(limit),
        "cache-control": "no-store",
      },
    },
  );
});
