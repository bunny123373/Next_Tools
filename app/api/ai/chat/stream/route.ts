/**
 * `POST /api/ai/chat/stream` — the conversational tool.
 *
 * Body: `{ messages: [{ role, content }], system?, temperature? }`
 *   - The browser owns the transcript and resends it each turn. Message count
 *     and total characters are capped in the schema, because unlike a one-shot
 *     prompt there is no natural bound on a "conversation" a visitor posts.
 *   - `system` is an optional persona, **appended** to `CHAT_SYSTEM_PROMPT` so
 *     a visitor can shape the tone but cannot remove the honesty contract.
 *
 * Out: `text/event-stream`, framed as
 *      `{ type: "delta" | "done" | "error", … }`.
 *
 * Guards, in order: rate limit → body size → Zod validation → provider. Failures
 * *before* the stream opens use the usual JSON envelope, so the client renders
 * them like any other error. Once the stream is open the status can no longer
 * change, so a later failure arrives as a final `error` frame instead.
 *
 * The API key is read inside `lib/ai/provider.ts` and never appears in the
 * request, the response, or any error text.
 */

import { AiError, isAiConfigured } from "@/lib/ai/provider";
import { streamChat, type StreamChatMessage } from "@/lib/ai/stream";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { streamChatRequestSchema } from "@/lib/ai/schemas";
import { guardRateLimit, handleAiFailure, readJsonBody } from "../../lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = guardRateLimit(request, "stream");
    if (limited) return limited;

    const body = await readJsonBody(request, streamChatRequestSchema);

    if (!isAiConfigured()) {
      throw new AiError("not_configured", { detail: "no provider is configured" });
    }

    // The visitor's persona is appended, never substituted for, so the honesty
    // contract cannot be edited away from the client.
    const system = body.system
      ? `${CHAT_SYSTEM_PROMPT}\n\nPersona requested by the user:\n${body.system}`
      : CHAT_SYSTEM_PROMPT;

    const messages: StreamChatMessage[] = [
      { role: "system", content: system },
      ...body.messages.map((turn) => ({ role: turn.role, content: turn.content })),
    ];

    // A client that navigates away must abort the upstream call, not merely stop
    // reading from it. `request.signal` fires when the connection drops.
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });

    const stream = streamChat(messages, {
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      signal: abort.signal,
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        // `no-transform` and `X-Accel-Buffering` are what stop a proxy from
        // buffering the whole reply, which would make the streaming pointless.
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return handleAiFailure(error, "stream");
  }
}
