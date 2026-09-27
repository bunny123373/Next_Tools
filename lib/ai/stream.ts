import "server-only";

/**
 * Server-SSE bridge for streaming chat.
 *
 * The provider layer is deliberately buffered — it validates, bounds and
 * redacts a complete response before anything reaches a client, which is the
 * right default for the one-shot tools. A conversational tool, however, is
 * unusable without token-by-token feedback, so this adds a *narrow* streaming
 * path that changes only the transport:
 *
 *   - Upstream is called with the same auth and timeout rules as
 *     `providerFetch`, but without the bounded body read (a stream has no
 *     end yet, so the byte guard is replaced by a character guard below).
 *   - Only assistant text deltas cross the wire. Frames are assembled here
 *     from `delta.content` alone, so no part of the upstream envelope — and no
 *     credential that might appear in one — can reach a client.
 *   - The accumulated reply is capped, so a runaway stream cannot exhaust
 *     memory. This replaces the buffered path's byte ceiling.
 *   - An upstream that ignores `stream: true` and returns plain JSON still
 *     works: the body is read whole and emitted as a single delta.
 *
 * The client receives `text/event-stream` frames of the form:
 *
 *   data: {"type":"delta","text":"…"}
 *   data: {"type":"done","usage":{…}}
 *   data: {"type":"error","code":"…","message":"…"}
 */

import {
  AiError,
  classifyHttpError,
  getAiConfig,
  type ProviderConfig,
} from "./provider";

export interface StreamChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Abort signal, wired to the client's disconnect. */
  signal?: AbortSignal;
}

/**
 * Hard ceiling on accumulated reply text, so a runaway stream cannot exhaust
 * memory. Deliberately far above any conversational reply.
 */
const MAX_STREAM_CHARS = 200_000;

/** Chunks larger than this are impossible for any provider we support. */
const MAX_FRAME_BYTES = 1024 * 1024;

/**
 * Streams an assistant reply as SSE frames.
 *
 * The caller owns the returned stream; pass the request's abort signal in
 * `options.signal` so a client navigating away tears down the upstream call
 * instead of leaving it running.
 */
export function streamChat(
  messages: readonly StreamChatMessage[],
  options: StreamChatOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frame = (payload: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const enqueue = (payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(frame(payload));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by a cancel() */
        }
      };

      // A client that navigates away must not leave the upstream running.
      const onAbort = () => finish();
      options.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const config = getAiConfig();
        const response = await openStream(config, messages, options);

        if (!response.ok || !response.body) {
          // Reuse the buffered path's error classification so a streaming
          // failure reads identically to a non-streaming one.
          const text = await response.text().catch(() => "");
          let payload: Record<string, unknown> | null = null;
          try {
            const parsed: unknown = JSON.parse(text);
            if (parsed && typeof parsed === "object") {
              payload = parsed as Record<string, unknown>;
            }
          } catch {
            /* an HTML error page; the status alone will do */
          }
          throw classifyHttpError(response.status, payload, null);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/event-stream")) {
          // The provider ignored `stream: true` and buffered the whole reply.
          // Still a valid answer, so surface it as one delta rather than
          // failing a request that succeeded.
          const text = await response.text();
          const whole = text.trim();
          if (whole) enqueue({ type: "delta", text: whole });
          enqueue({ type: "done" });
          return;
        }

        const usage = await pump(response.body, (delta) => enqueue({ type: "delta", text: delta }));
        enqueue(usage ? { type: "done", usage } : { type: "done" });
      } catch (error) {
        // A cancelled request is not a failure worth reporting.
        if (!options.signal?.aborted) {
          const code = error instanceof AiError ? error.code : "upstream";
          // `message` is the public, fixed string from the closed set, so it is
          // safe to send. The upstream hint stays server-side in `detail`.
          const message =
            error instanceof AiError
              ? error.message
              : "The model stream ended unexpectedly. Try again.";
          enqueue({ type: "error", code, message });
        }
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
        finish();
      }
    },
  });
}

/**
 * The single upstream call: one bounded timeout, composed with the caller's
 * signal. No retry — a retry would restart a reply the user is already
 * watching, which is worse than an honest error they can retry themselves.
 */
async function openStream(
  config: ProviderConfig,
  messages: readonly StreamChatMessage[],
  options: StreamChatOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const maxTokens = options.maxOutputTokens ?? config.maxOutputTokens;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  try {
    return await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.model ?? config.model,
        stream: true,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(maxTokens !== null ? { max_tokens: maxTokens } : {}),
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (cause) {
    if (options.signal?.aborted) {
      throw new AiError("timeout", { detail: "cancelled by the client", cause });
    }
    throw controller.signal.aborted
      ? new AiError("timeout", { detail: `no response within ${config.timeoutMs} ms`, cause })
      : new AiError("network", { cause });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Reads SSE frames off the upstream body, forwarding assistant text deltas.
 *
 * Returns the usage object when the provider sent one. Note the accumulated
 * text is measured, not stored, so a long reply costs one string.
 */
async function pump(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<Record<string, unknown> | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let produced = 0;
  let usage: Record<string, unknown> | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    if (value.byteLength > MAX_FRAME_BYTES) {
      throw new AiError("upstream", { detail: "stream chunk exceeded 1 MB" });
    }
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. The tail is kept: a frame
    // split across two reads is normal and must not be dropped.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frameText = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      for (const line of frameText.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        // `[DONE]` is the terminator; the stream simply ends after it.
        if (!data || data === "[DONE]") continue;

        let chunk: {
          choices?: { delta?: { content?: string } }[];
          usage?: Record<string, unknown>;
        };
        try {
          chunk = JSON.parse(data) as typeof chunk;
        } catch {
          // A frame we cannot parse is skipped rather than failing a reply
          // that is otherwise fine.
          continue;
        }

        if (chunk.usage) usage = chunk.usage;

        const delta = chunk.choices?.[0]?.delta?.content;
        if (!delta) continue;

        produced += delta.length;
        if (produced > MAX_STREAM_CHARS) {
          await reader.cancel().catch(() => {});
          throw new AiError("upstream", {
            detail: `reply exceeded ${MAX_STREAM_CHARS} characters`,
          });
        }
        onDelta(delta);
      }
    }
  }

  return usage;
}
