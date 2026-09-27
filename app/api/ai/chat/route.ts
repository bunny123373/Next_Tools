/**
 * `POST /api/ai/chat` — the five text tools.
 *
 * Body: `{ task, system?, prompt, options? }`
 *   - `task` picks the system prompt and the shape of the accepted options
 *     (see `lib/ai/schemas.ts`).
 *   - `system` is extra visitor instructions. It is **appended** to the task's
 *     own system prompt, never substituted for it, so the contract that makes
 *     the output plain text cannot be removed from the client.
 *   - `prompt` is length-capped, control-character-stripped and wrapped in a
 *     tag before it reaches the model.
 *
 * Out: `{ ok: true, output, model, usage? }` or
 *      `{ ok: false, error: { code, message } }`.
 *
 * Guards, in order: rate limit → body size → Zod validation → provider.
 * The API key is read inside `lib/ai/provider.ts` and never appears in the
 * request, the response, or any error text.
 */

import { AiError, isAiConfigured, resolveProvider } from "@/lib/ai/provider";
import { chatRequestSchema, type AiTextTask } from "@/lib/ai/schemas";
import { TEXT_SYSTEM_PROMPTS, buildTextUserMessage } from "@/lib/ai/prompt";
import { NO_STORE, guardRateLimit, handleAiFailure, readJsonBody } from "../lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = guardRateLimit(request, "chat");
    if (limited) return limited;

    const body = await readJsonBody(request, chatRequestSchema);

    if (!isAiConfigured()) {
      throw new AiError("not_configured", { detail: "no provider is configured" });
    }

    const task: AiTextTask = body.task;
    const provider = resolveProvider();

    const result = await provider.chat({
      system: TEXT_SYSTEM_PROMPTS[task],
      ...(body.system ? { extraSystem: `Additional instructions from the user:\n${body.system}` } : {}),
      prompt: buildTextUserMessage(task, body.prompt, body.options),
      // A little temperature is fine for prose, but a task that must stay
      // faithful to its input (translate, summarise) must not invent.
      temperature: temperatureForTask(task, body.options),
    });

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
    return handleAiFailure(error, "chat");
  }
}

/** Lower temperature = fewer inventions. */
function temperatureForTask(
  task: AiTextTask,
  options: { creativity?: number },
): number {
  const base =
    task === "translator" || task === "summarizer" ? 0.2 : task === "text-generator" ? 0.8 : 0.5;
  if (typeof options.creativity !== "number") return base;
  // Fold the visitor's creativity slider into the task's default, keeping both
  // within a range every current model handles.
  const target = task === "translator" || task === "summarizer" ? 0.1 : options.creativity;
  return Math.round(Math.min(1.2, Math.max(0, base * 0.4 + target * 0.8)) * 100) / 100;
}
