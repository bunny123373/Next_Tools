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

import type { ZodType } from "zod";
import {
  AI_ERROR_MESSAGES,
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
    ...(input.text ? { text: input.text } : {}),
    ...(input.file ? { fileBase64: await readAsDataURL(input.file) } : {}),
  });
  return parseOrFail(pdfResponseSchema, payload);
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
