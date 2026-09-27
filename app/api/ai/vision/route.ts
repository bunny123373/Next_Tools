/**
 * `POST /api/ai/vision` — image in, text out. Used by AI Image Analyzer.
 *
 * Body: `{ task, prompt?, image: { mime, base64 }, options? }`
 * Out: `{ ok: true, output, model, usage? }`.
 *
 * Why this route and `/api/ai/image` are separate: one returns text and one
 * returns pixels. The three tools that transform an image (enhance, upscale,
 * background-remover) all produce another image, so they go to `/api/ai/image`;
 * AI Image Analyzer produces words, so it comes here. Both routes share the
 * same MIME allow-list and the same decoded-size ceiling, so the distinction is
 * about output shape only.
 *
 * The image is forwarded to the provider as an OpenAI-style
 * `image_url` content part. Only the four types in `AI_ALLOWED_IMAGE_MIME` and
 * only up to `AI_MAX_IMAGE_BYTES` are ever sent, which keeps this endpoint from
 * becoming a general-purpose file uploader.
 */

import { AiError, isAiConfigured, resolveProvider } from "@/lib/ai/provider";
import { HttpError, NO_STORE, guardRateLimit, handleAiFailure, readJsonBody } from "../lib/http";
import {
  IMAGE_SYSTEM_PROMPTS,
  IMAGE_TASK_DIRECTIVES,
  buildImageUserMessage,
} from "@/lib/ai/prompt";
import { visionRequestSchema, AI_MAX_IMAGE_BODY_BYTES } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = guardRateLimit(request, "vision");
    if (limited) return limited;

    const body = await readJsonBody(request, visionRequestSchema, AI_MAX_IMAGE_BODY_BYTES);

    if (!isAiConfigured()) {
      throw new HttpError(
        "not_configured",
        "No AI provider is configured on this deployment. Set AI_API_KEY, AI_BASE_URL and AI_MODEL, then restart the server.",
      );
    }

    const provider = resolveProvider();

    // The visitor's own words, when they gave any, become the question; the
    // system prompt sets the rules and the image travels as a content part.
    const taskInstruction = body.prompt ?? "Describe what is in this image.";

    const result = await provider.chat({
      system: [
        IMAGE_SYSTEM_PROMPTS.analysis ?? "",
        ...(IMAGE_TASK_DIRECTIVES[body.task] ?? []),
      ].join("\n"),
      prompt: buildImageUserMessage(taskInstruction, body.options),
      images: [{ mime: body.image.mime, base64: body.image.base64 }],
      // Vision models are slower and cost more per token; a tight budget keeps
      // both the latency and the cost honest for a one-shot description.
      maxOutputTokens: 1_200,
    });

    if (!result.text) {
      throw new AiError("upstream", { detail: "the model returned an empty answer" });
    }

    return Response.json(
      {
        ok: true as const,
        output: result.text,
        model: result.model,
        usage: result.usage,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    return handleAiFailure(error, "vision");
  }
}
