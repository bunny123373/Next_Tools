/**
 * `POST /api/ai/image` — the five image tools.
 *
 * Body: `{ task, prompt, image?, options? }`
 *   - `image-generator` and `background-generator` are text-to-image: no upload.
 *   - `image-enhancer`, `image-upscaler` and `background-remover` are edits and
 *     require `image: { mime, base64 }`. The MIME type is checked against an
 *     allow-list and the decoded size against a ceiling before anything is
 *     forwarded, so a visitor cannot use this route as an arbitrary file proxy.
 *   - Note that background removal lives here, not on `/api/ai/vision`: it takes
 *     an image in and returns an image out, and `/api/ai/vision` is the
 *     image-in/text-out route. The two share the same MIME and size guards.
 *
 * Out: `{ ok: true, image: { mime, base64 }, model, revisedPrompt? }`.
 *
 * Setup: when `AI_IMAGE_MODEL` is missing, or the resolved adapter has no image
 * capability, this answers `501` and names the exact variable to set. It never
 * pretends to have generated something.
 */

import { AiError, getAiConfig, isAiConfigured, resolveProvider, type AiImageResult } from "@/lib/ai/provider";
import { HttpError, NO_STORE, guardRateLimit, handleAiFailure, readJsonBody } from "../lib/http";
import { IMAGE_SYSTEM_PROMPTS, IMAGE_TASK_DIRECTIVES, buildImageUserMessage } from "@/lib/ai/prompt";
import { imageRequestSchema, isImageEditTask, type AiImageTask } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = guardRateLimit(request, "image");
    if (limited) return limited;

    const body = await readJsonBody(request, imageRequestSchema);
    const task: AiImageTask = body.task;

    if (!isAiConfigured()) {
      throw new HttpError(
        "not_configured",
        "No AI provider is configured on this deployment. Set AI_API_KEY, AI_BASE_URL and AI_MODEL, then restart the server.",
      );
    }

    const config = getAiConfig();
    if (!config.imageModel) {
      throw new HttpError(
        "not_configured",
        "Image generation is not configured. Set AI_IMAGE_MODEL to an image model id your provider offers (for example gpt-image-1 or dall-e-3) and restart the server.",
      );
    }

    const provider = resolveProvider();
    const edit = isImageEditTask(task);

    if (edit && typeof provider.editImage !== "function") {
      throw new HttpError(
        "not_configured",
        `The "${provider.id}" adapter has no image-editing endpoint, so ${task.replace(/-/g, " ")} cannot run here. Choose an AI_PROVIDER that supports /v1/images/edits.`,
      );
    }
    if (!edit && typeof provider.generateImage !== "function") {
      throw new HttpError(
        "not_configured",
        `The "${provider.id}" adapter has no image-generation endpoint. Choose an AI_PROVIDER that supports /v1/images/generations.`,
      );
    }

    const prompt = buildImageUserMessage(
      body.prompt,
      body.options,
      IMAGE_TASK_DIRECTIVES[task] ?? [],
    );
    const size = body.options.size;

    let result: AiImageResult | undefined;
    if (edit) {
      const image = body.image;
      if (!image) {
        throw new HttpError("bad_request", "This tool needs an uploaded image to work on.");
      }
      result = await provider.editImage?.({
        prompt: `${IMAGE_SYSTEM_PROMPTS.edit ?? ""}\n\n${prompt}`,
        image,
        ...(size ? { size } : {}),
      });
    } else {
      result = await provider.generateImage?.({ prompt, ...(size ? { size } : {}) });
    }

    if (!result) {
      throw new AiError("upstream", { detail: "the provider returned no image" });
    }

    return Response.json(
      {
        ok: true as const,
        image: { mime: result.mime, base64: result.base64 },
        model: result.model,
        ...(result.revisedPrompt ? { revisedPrompt: result.revisedPrompt } : {}),
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    return handleAiFailure(error, "image");
  }
}
