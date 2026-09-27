import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, apiOk, parseJson, withErrorHandling } from "@/lib/api/respond";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import { toolBuilderSchema } from "@/lib/validations/schemas";
import { generateToolConfig } from "@/lib/tool-builder/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/builder — experimental tool builder.
 *
 * Returns a *template id and preset values*. It never returns code, and there
 * is no endpoint anywhere in this project that compiles or evaluates a model
 * response. See lib/tool-builder/generate.ts for why that is structured this
 * way.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const limit = rateLimit(request, { bucket: "tool-builder", ...LIMITS.heavy });
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please wait a moment.", {
      headers: rateLimitHeaders(limit),
    });
  }

  const parsed = await parseJson(request, toolBuilderSchema, { maxBytes: 4 * 1024 });
  if (!parsed.ok) return parsed.response;

  // Honeypot.
  if (parsed.data.website) {
    return apiOk({ template: null, reason: "ok" }, { status: 201 });
  }

  const result = await generateToolConfig(parsed.data.description);

  if ("error" in result) {
    return apiError("validation_failed", result.error, {
      fields: { description: result.error },
      headers: rateLimitHeaders(limit),
    });
  }

  return apiOk(
    {
      template: {
        id: result.template.id,
        label: result.template.label,
        summary: result.template.summary,
        presets: result.template.presets,
      },
      tool: result.baseTool
        ? { id: result.baseTool.id, name: result.baseTool.name, route: result.baseTool.route }
        : null,
      confidence: Number(result.confidence.toFixed(2)),
      method: result.method,
      reason: result.reason,
      experimental: true,
    },
    { headers: rateLimitHeaders(limit) },
  );
});

/** GET — catalogue of buildable templates. */
export const GET = withErrorHandling(async (request: Request) => {
  const limit = rateLimit(request, { bucket: "tool-builder", ...LIMITS.read });
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many requests.", { headers: rateLimitHeaders(limit) });
  }

  const { TEMPLATES } = await import("@/lib/tool-builder/templates");
  return apiOk({
    templates: TEMPLATES.map(({ id, label, summary }) => ({ id, label, summary })),
    experimental: true,
  });
});
