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
 * Setup: when `AI_IMAGE_MODEL` (or `AI_EDIT_MODEL` for the edit tasks) is
 * missing, or the resolved adapter has no image capability, this answers `501`
 * and names the exact variable to set. It never pretends to have generated
 * something.
 */

import { AiError, getAiConfig, isAiConfigured, resolveProvider, type AiImageResult } from "@/lib/ai/provider";
import { HttpError, NO_STORE, guardRateLimit, handleAiFailure, readJsonBody } from "../lib/http";
import { IMAGE_SYSTEM_PROMPTS, IMAGE_TASK_DIRECTIVES, buildImageUserMessage } from "@/lib/ai/prompt";
import {
  AI_MAX_IMAGE_BODY_BYTES,
  imageRequestSchema,
  isImageEditTask,
  type AiImageTask,
} from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = guardRateLimit(request, "image");
    if (limited) return limited;

    const body = await readJsonBody(request, imageRequestSchema, AI_MAX_IMAGE_BODY_BYTES);
    const task: AiImageTask = body.task;

    if (!isAiConfigured()) {
      throw new HttpError(
        "not_configured",
        "No AI provider is configured on this deployment. Set AI_API_KEY, AI_BASE_URL and AI_MODEL, then restart the server.",
      );
    }

    const config = getAiConfig();
    const edit = isImageEditTask(task);

    if (edit) {
      // Editing needs a model that can edit. Most providers split generation and
      // editing across different ids — xkiro's own error names the one it wants:
      //   'Image editing is not available for model "sensenova/sensenova-u1.5-lite".
      //    Models that support editing: openai/gpt-image-2.5.'
      // Saying that here means a misconfiguration produces a 501 naming the
      // variable, rather than a confusing 400 from the provider.
      if (!config.editModel && !config.imageModel) {
        throw new HttpError(
          "not_configured",
          "Image editing is not configured. Set AI_EDIT_MODEL to a model that supports /v1/images/edits (for example gpt-image-1) and restart the server.",
        );
      }
    } else if (!config.imageModel) {
      throw new HttpError(
        "not_configured",
        "Image generation is not configured. Set AI_IMAGE_MODEL to an image model id your provider offers (for example gpt-image-1 or dall-e-3) and restart the server.",
      );
    }

    const provider = resolveProvider();

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
