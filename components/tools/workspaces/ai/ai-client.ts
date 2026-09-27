"use client";

/**
 * The browser half of the AI integration.
 *
 * Everything the workspaces need to talk to `app/api/ai/**`:
 *
 *  - `fetchAiStatus()` — one `GET` on mount to decide between the real
 *    interface and the setup panel.
 *  - `runChat` / `runImage` / `runVision` / `runPdf` — the four POST helpers.
 *  - `AiRequestError` — the single failure type a workspace has to handle, so
 *    no component ever renders a raw `Error.message` from the network stack.
 *
 * Responses are validated with the same Zod schemas the routes are written
 * against. A server that answers with an unexpected shape produces a clean
 * "we could not understand the response" error instead of `undefined` flowing
 * into the UI.
 *
 * There is no API key here, and there never will be: the browser only ever
 * knows a route path.
 */

import { z, type ZodType } from "zod";
import {
  AI_ERROR_CODES,
  AI_ERROR_MESSAGES,
  AI_PDF_TRANSPORT_CHARS,
  aiErrorResponseSchema,
  chatResponseSchema,
  imageResponseSchema,
  pdfResponseSchema,
  statusResponseSchema,
  visionResponseSchema,
  parseDataUrl,
  type AiErrorCode,
  type AiImageTask,
  type AiOptions,
  type AiStatusResponse,
  type AiTextTask,
  type AiVisionTask,
  type ChatResponse,
  type ImageResponse,
  type PdfResponse,
  type VisionResponse,
} from "@/lib/ai/schemas";
import { readAsDataURL } from "@/lib/utils/files";

/** A failure the UI can render without leaking anything internal. */
export class AiRequestError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiRequestError";
    this.code = code;
  }
}

/** Reads the `{ ok: false, error }` envelope, whatever went wrong. */
async function toError(response: Response): Promise<AiRequestError> {
  try {
    const parsed = aiErrorResponseSchema.safeParse((await response.json()) as unknown);
    if (parsed.success) {
      return new AiRequestError(parsed.data.error.code, parsed.data.error.message);
    }
  } catch {
    // A proxy or a crashed route can answer with HTML. That is not the user's
    // fault and must not be shown to them.
  }

  if (response.status === 429) return new AiRequestError("rate_limited", AI_ERROR_MESSAGES.rate_limited);
  return new AiRequestError(
    "upstream",
    "The server sent a response we could not understand. Try again in a moment.",
  );
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiRequestError(
      "network",
      "We could not reach the server. Check your connection and try again.",
    );
  }

  if (!response.ok) throw await toError(response);

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AiRequestError("upstream", "The server sent a response we could not understand.");
  }
}

function parseOrFail<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AiRequestError("upstream", "The server sent a response we could not understand.");
  }
  return result.data;
}

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

export type AiAvailability =
  | { state: "checking" }
  | {
      state: "ready";
      provider: string;
      model: string;
      imageModel: string | null;
      features: AiStatusResponse["features"];
    }
  | { state: "unavailable"; reason: string };

/**
 * Asks the server whether an AI provider is configured. A network failure is
 * reported as `unavailable` rather than thrown: the workspace then shows the
 * setup panel with an honest explanation instead of a crash.
 */
export async function fetchAiStatus(signal?: AbortSignal): Promise<AiAvailability> {
  let response: Response;
  try {
    response = await fetch("/api/ai/status", {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  } catch {
    return {
      state: "unavailable",
      reason:
        "We could not reach the server to check whether an AI provider is configured. This is usually a connection problem — reload once you are back online.",
    };
  }

  if (!response.ok) {
    return {
      state: "unavailable",
      reason: "The server could not tell us whether an AI provider is configured.",
    };
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return { state: "unavailable", reason: "The server sent a response we could not understand." };
  }

  const status = parseOrFail(statusResponseSchema, body);

  if (!status.configured) {
    return {
      state: "unavailable",
      reason:
        "No AI provider is configured on this deployment, so this tool cannot run yet.",
    };
  }

  return {
    state: "ready",
    provider: status.provider ?? "AI provider",
    model: status.model ?? "the configured model",
    imageModel: status.imageModel,
    features: status.features,
  };
}

/* ------------------------------------------------------------------ */
/*  Requests                                                           */
/* ------------------------------------------------------------------ */

export interface ChatRequestInput {
  task: AiTextTask;
  prompt: string;
  options: AiOptions;
  extraInstructions?: string;
}

export async function runChat(input: ChatRequestInput): Promise<ChatResponse> {
  const payload = await postJson("/api/ai/chat", {
    task: input.task,
    prompt: input.prompt,
    options: input.options,
    ...(input.extraInstructions ? { system: input.extraInstructions } : {}),
  });
  return parseOrFail(chatResponseSchema, payload);
}

export interface ImageRequestInput {
  task: AiImageTask;
  prompt: string;
  options: AiOptions;
  file?: File;
}

export async function runImage(input: ImageRequestInput): Promise<ImageResponse> {
  const image = input.file ? await encodeImage(input.file) : undefined;
  const payload = await postJson("/api/ai/image", {
    task: input.task,
    prompt: input.prompt,
    options: input.options,
    ...(image ? { image } : {}),
  });
  return parseOrFail(imageResponseSchema, payload);
}

export interface VisionRequestInput {
  task: AiVisionTask;
  prompt?: string;
  options: AiOptions;
  file: File;
}

export async function runVision(input: VisionRequestInput): Promise<VisionResponse> {
  const image = await encodeImage(input.file);
  const payload = await postJson("/api/ai/vision", {
    task: input.task,
    prompt: input.prompt ?? "",
    options: input.options,
    image,
  });
  return parseOrFail(visionResponseSchema, payload);
}

export interface PdfRequestInput {
  fileName?: string;
  /** Text extracted in the browser — the PDF never leaves the device. */
  text?: string;
  /** The PDF itself, for the server-side extraction fallback. */
  file?: File;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
}

export async function runPdf(input: PdfRequestInput): Promise<PdfResponse> {
  const payload = await postJson("/api/ai/pdf", {
    question: input.question,
    history: input.history,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    // Clamped to the transport ceiling; the workspace says so in the interface
    // when a document is long enough for the clamp to bite.
    ...(input.text ? { text: input.text.slice(0, AI_PDF_TRANSPORT_CHARS) } : {}),
    ...(input.file ? { fileBase64: await readAsDataURL(input.file) } : {}),
  });
  return parseOrFail(pdfResponseSchema, payload);
}

/* ------------------------------------------------------------------ */
/*  Streaming chat                                                     */
/* ------------------------------------------------------------------ */

export interface StreamChatInput {
  /** The transcript so far, oldest first, starting with a user turn. */
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  temperature?: number;
  signal: AbortSignal;
}

/** One frame off the stream. A closed set, validated before it reaches the UI. */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: AiErrorCode; message: string };

const streamEventSchema: ZodType<StreamEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), code: z.enum(AI_ERROR_CODES), message: z.string() }),
]);

/**
 * Streams one assistant turn, invoking `onDelta` for each piece as it lands.
 *
 * Returns the full reply so the caller can commit it. Throws `AiRequestError`
 * for a failure that happened before or instead of the stream, matching
 * `postJson`: a 429 or a validation failure arrives as the usual JSON envelope,
 * not as a stream.
 */
export async function streamChatTurn(
  input: StreamChatInput,
  onDelta: (text: string) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/ai/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: input.messages,
        ...(input.system ? { system: input.system } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      }),
      signal: input.signal,
    });
  } catch (caught) {
    if (input.signal.aborted) throw caught;
    throw new AiRequestError(
      "network",
      "We could not reach the server. Check your connection and try again.",
    );
  }

  // A failure before the stream opens uses the shared JSON error envelope.
  if (!response.ok || !response.body) throw await toError(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let sawDone = false;

  // Frames are separated by a blank line; a frame split across two reads is
  // normal, so the tail is always kept rather than parsed eagerly.
  const drain = (flush: boolean) => {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;

        const parsed = streamEventSchema.safeParse(safeJson(raw));
        // An unrecognised frame is skipped, not fatal: one bad frame should not
        // discard a reply that is otherwise arriving fine.
        if (!parsed.success) continue;

        const event = parsed.data;
        if (event.type === "delta") {
          reply += event.text;
          onDelta(event.text);
        } else if (event.type === "done") {
          sawDone = true;
        } else {
          throw new AiRequestError(event.code, event.message);
        }
      }
    }
    if (flush && buffer.trim().length > 0) {
      // A provider that closes without a trailing blank line still sent us a
      // usable final frame; do not throw the text away.
      for (const line of buffer.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const parsed = streamEventSchema.safeParse(safeJson(line.slice(5).trim()));
        if (parsed.success && parsed.data.type === "delta") {
          reply += parsed.data.text;
          onDelta(parsed.data.text);
        }
      }
      buffer = "";
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    buffer += decoder.decode(value, { stream: true });
    drain(false);
  }
  drain(true);

  if (!sawDone && reply.length === 0) {
    throw new AiRequestError(
      "upstream",
      "The reply ended without any text. Try again in a moment.",
    );
  }

  return reply;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Reads a picked image into the `{ mime, base64 }` shape the routes expect. */
async function encodeImage(file: File): Promise<{ mime: string; base64: string }> {
  const dataUrl = await readAsDataURL(file);
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new AiRequestError(
      "bad_request",
      "That image could not be read. Try a different file.",
    );
  }
  return { mime: parsed.mime, base64: parsed.base64 };
}
