/**
 * The AI provider layer.
 *
 * ---------------------------------------------------------------------------
 *  SECURITY
 * ---------------------------------------------------------------------------
 *  - `import "server-only"` is the first line of this file. Next.js turns that
 *    specifier into a build error if any Client Component ever pulls this module
 *    into a browser bundle, which is the guarantee we need: `getAiConfig()`
 *    reads `process.env.AI_API_KEY` and the whole point is that the key never
 *    crosses the network boundary to the visitor.
 *  - The key is therefore ONLY ever read from a non-`NEXT_PUBLIC_` variable.
 *    Anything named `NEXT_PUBLIC_*` is inlined into the client bundle at build
 *    time by Next.js, is readable by anyone who opens devtools, and ends up in
 *    every cached JS chunk. Putting a provider key there would publish it. This
 *    is not a stylistic preference — it is the difference between a key and a
 *    leaked key.
 *  - No error message returned from this module contains the key, the upstream
 *    response body, a stack trace, or the visitor's own input. `AiError` carries
 *    a fixed, reviewed message per failure class (see `AI_ERROR_MESSAGES`).
 *
 * ---------------------------------------------------------------------------
 *  ENVIRONMENT VARIABLES (all server-side, none NEXT_PUBLIC_)
 * ---------------------------------------------------------------------------
 *  AI_API_KEY       Required. The credential for the provider. Any shape:
 *                   "sk-…" (OpenAI), "gsk_…" (Groq), or a bearer token
 *                   (OpenRouter). May be empty for a local Ollama / LM Studio /
 *                   vLLM server, which is why an empty key is not fatal.
 *  AI_BASE_URL      Base URL of an OpenAI-compatible API including the version
 *                   segment. Default: https://api.openai.com/v1
 *                     https://api.openai.com/v1      (OpenAI)
 *                     https://api.groq.com/openai/v1  (Groq)
 *                     https://api.together.xyz/v1    (Together)
 *                     https://openrouter.ai/api/v1    (OpenRouter)
 *                     http://127.0.0.1:11434/v1       (Ollama)
 *  AI_MODEL         Chat / vision / PDF model id. Default: gpt-4o-mini
 *  AI_IMAGE_MODEL   Image model id (gpt-image-1, dall-e-3, a Together flux id…).
 *                   Required for the image tools; without it those routes answer
 *                   501 and name this variable.
 *  AI_PROVIDER      Which adapter to use. Default: openai-compatible
 *  AI_TIMEOUT_MS    Per-attempt timeout in milliseconds. Default: 60000
 *  AI_MAX_OUTPUT_TOKENS  Completion-token ceiling. Default: 4096
 *
 * ---------------------------------------------------------------------------
 *  ADDING A PROVIDER
 * ---------------------------------------------------------------------------
 *  A provider is `{ id, label, chat, generateImage?, editImage?, listModels }`
 *  built by a factory that receives a `ProviderConfig`. Write the factory, call
 *  `registerProvider("acme", (config) => new AcmeProvider(config))` at module
 *  scope, and set `AI_PROVIDER=acme`. Nothing else in the app changes: the
 *  routes only ever call `resolveProvider()` and speak the `AiProvider`
 *  interface. The one rule a new adapter must honour is the error contract —
 *  throw `AiError`, never a raw `Error`, and never put upstream text in the
 *  public message.
 */

import "server-only";

import {
  AI_ERROR_MESSAGES,
  AI_ERROR_STATUS,
  type AiAllowedImageMime,
  type AiErrorCode,
} from "./schemas";

/* ------------------------------------------------------------------ */
/*  Errors                                                             */
/* ------------------------------------------------------------------ */

export type { AiErrorCode };

/**
 * The only error type that leaves this module. `publicMessage` is safe to send
 * to a browser; the `message` (with the upstream hint) stays on the server.
 */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  /** Seconds the client should wait, from a `Retry-After` header we honoured. */
  readonly retryAfterSeconds: number | null;

  constructor(
    code: AiErrorCode,
    options: { detail?: string; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(options.detail ? `[ai:${code}] ${options.detail}` : `[ai:${code}]`);
    this.name = "AiError";
    this.code = code;
    this.status = AI_ERROR_STATUS[code];
    this.publicMessage = AI_ERROR_MESSAGES[code];
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "upstream" || this.code === "network";
  }
}

/**
 * Fails loudly if this module is ever evaluated in a browser. `server-only`
 * already makes that a build error; this is the belt to that braces, and it
 * gives a readable failure if a bundler ignores the marker.
 */
export function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/ai/provider.ts is server-only. It reads provider credentials from process.env and must never run in a browser.",
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface ProviderConfig {
  /** OpenAI-compatible base URL, no trailing slash, version segment included. */
  baseUrl: string;
  /** Empty is valid for a local provider. */
  apiKey: string;
  /** Chat, vision and PDF model. */
  model: string;
  /** Image model, or `null` when image generation is not configured. */
  imageModel: string | null;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Upper bound on completion tokens, or `null` to let the provider decide. */
  maxOutputTokens: number | null;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/** Reads the provider configuration. Server-only: never import from a client. */
export function getAiConfig(): ProviderConfig {
  assertServerOnly();

  const rawBase = env("AI_BASE_URL") ?? DEFAULT_BASE_URL;

  return {
    baseUrl: rawBase.replace(/\/+$/, ""),
    apiKey: env("AI_API_KEY") ?? "",
    model: env("AI_MODEL") ?? DEFAULT_MODEL,
    imageModel: env("AI_IMAGE_MODEL") ?? null,
    timeoutMs: parsePositiveInt(env("AI_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxOutputTokens: parsePositiveInt(
      env("AI_MAX_OUTPUT_TOKENS"),
      DEFAULT_MAX_OUTPUT_TOKENS,
      32_000,
    ),
  };
}

/** The provider id an operator asked for, defaulting to the OpenAI-compatible adapter. */
export function getConfiguredProviderName(): string {
  return env("AI_PROVIDER") ?? "openai-compatible";
}

/** Hosts where a missing credential is legitimate rather than a mistake. */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "host.docker.internal",
]);

/** True when the endpoint is self-hosted (Ollama, LM Studio, vLLM). */
export function isLocalEndpoint(config: ProviderConfig): boolean {
  try {
    const { hostname } = new URL(config.baseUrl);
    return LOCAL_HOSTS.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * True when a chat request can actually be served.
 *
 * A missing key is fine for a *local* provider, which legitimately has none.
 * Against a hosted provider it is a misconfiguration, and treating it as
 * configured would render a working-looking tool that 401s on the first click
 * — so a remote host with no key reports as not configured here.
 */
export function isAiConfigured(): boolean {
  const config = getAiConfig();
  if (!config.baseUrl || !config.model) return false;
  if (config.apiKey) return true;
  return isLocalEndpoint(config);
}

/** Human-readable label for a provider id, used by the status route. */
export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/** One part of a multimodal user turn (the OpenAI `content` array shape). */
export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string | AiContentPart[];
}

/** A previous turn, replayed for a document chat. */
export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiChatRequest {
  system?: string;
  /** Extra instructions appended after `system`. */
  extraSystem?: string;
  prompt: string;
  /**
   * Image content parts appended after `prompt` in the same user turn. A model
   * that cannot read images ignores them and answers from the text — which is
   * why the workspaces always name the model in play.
   */
  images?: { mime: string; base64: string }[];
  /** Previous turns, oldest first. Used by AI PDF Chat. */
  history?: AiChatTurn[];
  /** Defaults to the configured model. */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AiChatResult {
  text: string;
  model: string;
  usage: AiUsage;
  /** The provider's own finish reason, when it sent one. */
  finishReason: string | null;
}

export interface AiImageRequest {
  prompt: string;
  model?: string;
  /** "WIDTHxHEIGHT". */
  size?: string;
  signal?: AbortSignal;
}

export interface AiImageEditRequest extends AiImageRequest {
  image: { mime: AiAllowedImageMime; base64: string };
}

export interface AiImageResult {
  mime: string;
  base64: string;
  model: string;
  revisedPrompt?: string;
}

export interface AiProvider {
  id: string;
  label: string;
  chat(request: AiChatRequest): Promise<AiChatResult>;
  generateImage?(request: AiImageRequest): Promise<AiImageResult>;
  /** Image in, image out. Providers without an edit model simply omit this. */
  editImage?(request: AiImageEditRequest): Promise<AiImageResult>;
  /** Model ids the provider offers, or `[]` when it cannot be enumerated. */
  listModels(): Promise<string[]>;
}

export type ProviderFactory = (config: ProviderConfig) => AiProvider;

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  "openai-compatible": "OpenAI-compatible API",
};

const factories = new Map<string, ProviderFactory>();
const instances = new Map<string, AiProvider>();

/**
 * Registers an adapter. Call this at module scope, before the first request.
 * Re-registering a name replaces the previous adapter and drops the cached
 * instance, which is what makes adapter selection testable without touching
 * the environment.
 */
export function registerProvider(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
  instances.delete(name);
}

/** Adapter ids an operator can put in `AI_PROVIDER`. */
export function listAvailableProviders(): readonly string[] {
  return Object.keys(PROVIDER_LABELS);
}

/**
 * Instantiates the provider for this request. Passing an explicit name is
 * useful in tests and on the status route; in production it is always
 * `AI_PROVIDER`, or the default.
 */
export function resolveProvider(name?: string): AiProvider {
  assertServerOnly();

  const id = (name ?? getConfiguredProviderName()).trim() || "openai-compatible";
  const cached = instances.get(id);
  if (cached) return cached;

  const factory = factories.get(id) ?? factories.get("openai-compatible");
  if (!factory) {
    throw new AiError("not_configured", { detail: `no adapter registered for "${id}"` });
  }

  const provider = factory(getAiConfig());
  instances.set(id, provider);
  return provider;
}

/** Which capabilities the resolved provider actually implements. */
export function providerFeatures(provider: AiProvider): {
  chat: boolean;
  image: boolean;
  edit: boolean;
  vision: boolean;
} {
  return {
    chat: typeof provider.chat === "function",
    image: typeof provider.generateImage === "function",
    edit: typeof provider.editImage === "function",
    vision: typeof provider.chat === "function",
  };
}

/* ------------------------------------------------------------------ */
/*  Robust fetch                                                       */
/* ------------------------------------------------------------------ */

/** Refuse to buffer a response larger than this, whatever the provider claims. */
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_ATTEMPTS = 3; // one call plus two retries
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 8_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Exponential backoff with full jitter, so a burst does not retry in lockstep. */
function backoffDelay(attempt: number): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(Math.random() * ceiling);
}

/** `Retry-After` in seconds, or as an HTTP date. Returns null when unusable. */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 60);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.min(Math.ceil((date - Date.now()) / 1000), 60));
}

interface RawResponse {
  status: number;
  headers: Headers;
  payload: Record<string, unknown>;
}

/**
 * Reads a response with a hard size ceiling. We check `content-length` first
 * (cheap) and then the buffered length (lies-proof), so a provider that streams
 * an unbounded error page cannot exhaust memory here.
 */
async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new AiError("upstream", { detail: "response exceeded the size limit" });
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new AiError("upstream", { detail: "response exceeded the size limit" });
  }
  return text;
}

/** Parses JSON, tolerating the HTML error page a proxy returns instead. */
function parseJson(body: string): Record<string, unknown> | null {
  if (!body.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // An upstream proxy answering with HTML is a real failure mode, not a bug
    // in our parsing — the caller turns this into a clean `upstream` error.
    return null;
  }
}

function truncate(value: string, max: number): string {
  const clean = redactCredentials(value.replace(/\s+/g, " ").trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Masks anything shaped like a credential.
 *
 * The *public* message is a fixed string and can never leak, but the internal
 * `message` carries a truncated upstream hint for the operator's logs. Upstream
 * error bodies do sometimes echo the request — including the `Authorization`
 * header — so we scrub by shape before it goes anywhere. Belt and braces: the
 * hint never leaves the server either way.
 */
export function redactCredentials(value: string): string {
  return value
    .replace(/\b(?:sk|rk|gsk|csk|xai|hf|pat|key|api)[-_][A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/\bBearer\s+\S{6,}/gi, "Bearer [redacted]")
    .replace(
      /("(?:api[-_]?key|authorization|access[_-]?token)")\s*:\s*"[^"]*"/gi,
      '"$1":"[redacted]"',
    )
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]");
}

/** Pulls a short, non-sensitive hint out of an upstream error body. */
function upstreamHint(payload: Record<string, unknown> | null): string | undefined {
  if (!payload) return undefined;
  const error = payload.error;
  if (typeof error === "string") return truncate(error, 160);
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return truncate(message, 160);
  }
  return undefined;
}

/** Recognises a safety refusal, which several providers report as a 400. */
function looksLikeContentFilter(hint: string | undefined): boolean {
  if (!hint) return false;
  return /content[_ -]?policy|safety (filter|system)|moderation|guardrail|responsible ai|blocked by/i.test(
    hint,
  );
}

export interface ProviderFetchOptions {
  method: "GET" | "POST";
  path: string;
  body?: string;
  /** Set for multipart requests, which must not carry a JSON content type. */
  formData?: FormData;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * The single outbound call: timeout, retry with jitter on 429/5xx and on network
 * failures, size guard, and a JSON parse that survives an HTML error page.
 */
async function providerFetch(
  config: ProviderConfig,
  options: ProviderFetchOptions,
): Promise<RawResponse> {
  const url = `${config.baseUrl}${options.path}`;
  let lastError: AiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) {
      throw new AiError("timeout", { detail: "cancelled by the client" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let response: Response;
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      if (!options.formData) headers["Content-Type"] = "application/json";

      response = await fetch(url, {
        method: options.method,
        headers,
        body: options.formData ?? options.body,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (cause) {
      const cancelledByCaller = options.signal?.aborted === true;
      const error = cancelledByCaller
        ? new AiError("timeout", { detail: "cancelled by the client", cause })
        : controller.signal.aborted
          ? new AiError("timeout", { detail: `no response within ${options.timeoutMs} ms`, cause })
          : new AiError("network", { cause });
      lastError = error;
      if (!cancelledByCaller && attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }

    const body = await readBounded(response);
    const payload = parseJson(body);

    if (response.ok) {
      if (!payload) {
        throw new AiError("upstream", { detail: "response body was not JSON" });
      }
      return { status: response.status, headers: response.headers, payload };
    }

    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      lastError = new AiError(response.status === 429 ? "rate_limited" : "upstream", {
        detail: `HTTP ${response.status}`,
        ...(retryAfter !== null ? { retryAfterSeconds: retryAfter } : {}),
      });
      await sleep(retryAfter !== null ? retryAfter * 1000 : backoffDelay(attempt));
      continue;
    }

    throw classifyHttpError(response.status, payload, retryAfter);
  }

  throw lastError ?? new AiError("upstream", { detail: "exhausted all retries" });
}

/** Maps an upstream HTTP status onto our closed set of failure codes. */
export function classifyHttpError(
  status: number,
  payload: Record<string, unknown> | null,
  retryAfter: number | null,
): AiError {
  const hint = upstreamHint(payload);
  const detail = hint ? `HTTP ${status}: ${hint}` : `HTTP ${status}`;
  const retry = retryAfter !== null ? { retryAfterSeconds: retryAfter } : {};

  if (status === 401 || status === 403) return new AiError("auth", { detail });
  if (status === 429) return new AiError("rate_limited", { detail, ...retry });
  if (status === 408 || status === 504) return new AiError("timeout", { detail });
  if (looksLikeContentFilter(hint)) return new AiError("content_filtered", { detail });
  if (status === 400 || status === 422) return new AiError("bad_request", { detail });
  if (status >= 500) return new AiError("upstream", { detail, ...retry });
  return new AiError("upstream", { detail, ...retry });
}

/* ------------------------------------------------------------------ */
/*  Response shaping                                                   */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** Pulls token counts out of the response so usage can be metered. */
function readUsage(payload: Record<string, unknown>): AiUsage {
  const raw =
    typeof payload.usage === "object" && payload.usage !== null
      ? (payload.usage as Record<string, unknown>)
      : {};
  const promptTokens = asInt(raw.prompt_tokens);
  const completionTokens = asInt(raw.completion_tokens);
  const totalTokens =
    asInt(raw.total_tokens) ??
    (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);
  return { promptTokens, completionTokens, totalTokens };
}

/** Reads `choices[0].message.content` from an OpenAI-compatible chat response. */
function readChatText(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    throw new AiError("upstream", { detail: "no choices in the response" });
  }
  const message = (first as Record<string, unknown>).message;
  const content =
    typeof message === "object" && message !== null
      ? asString((message as Record<string, unknown>).content)
      : null;
  if (content === null) {
    throw new AiError("upstream", { detail: "no message content in the response" });
  }
  const text = content.trim();
  if (!text) {
    throw new AiError("upstream", { detail: "the model returned an empty answer" });
  }
  return text;
}

/** Reads the first image from an OpenAI-compatible image response. */
/**
 * Downloads an image the provider itself pointed us at and returns it inline.
 *
 * The URL is **never** accepted from a caller. It is read out of a response
 * from the provider we just authenticated to, which is what keeps this from
 * becoming an open proxy: a client cannot choose what we fetch. Guards:
 *
 *   - https only
 *   - the host must share a registrable suffix with the provider's base URL,
 *     so a compromised response pointing at `evil.example` is refused
 *   - content-type must be an image
 *   - hard byte ceiling, enforced on the real body length
 */
async function inlineProviderImage(
  config: ProviderConfig,
  url: string,
  model: string,
  signal?: AbortSignal,
): Promise<AiImageResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AiError("upstream", { detail: "the provider returned an unparseable image URL" });
  }

  if (parsed.protocol !== "https:") {
    throw new AiError("upstream", { detail: "the provider returned a non-https image URL" });
  }

  // Require the image host to be related to the provider host. `cdn.xkiro.com`
  // passes for `api.xkiro.com`; `evil.com` does not.
  const providerHost = new URL(config.baseUrl).hostname;
  const registrable = (host: string) => host.split(".").slice(-2).join(".");
  if (registrable(parsed.hostname) !== registrable(providerHost)) {
    throw new AiError("upstream", {
      detail: "the provider returned an image URL on an unrelated host; refused",
    });
  }

  const response = await fetch(parsed.toString(), {
    ...(signal ? { signal } : {}),
    redirect: "error",
  });
  if (!response.ok) {
    throw new AiError("upstream", { detail: `image download returned ${response.status}` });
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new AiError("upstream", { detail: `image URL returned ${contentType || "no content type"}` });
  }

  const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new AiError("upstream", { detail: "image URL returned an empty body" });
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AiError("upstream", { detail: "image exceeded the 24 MB ceiling" });
  }

  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return { mime: contentType, base64: btoa(binary), model };
}

function readImage(payload: Record<string, unknown>, model: string): AiImageResult {
  const first = Array.isArray(payload.data) ? payload.data[0] : undefined;
  if (typeof first !== "object" || first === null) {
    throw new AiError("upstream", { detail: "no image data in the response" });
  }
  const record = first as Record<string, unknown>;
  const revised = asString(record.revised_prompt);

  const base64 = asString(record.b64_json);
  if (base64) {
    return revised
      ? { mime: "image/png", base64, model, revisedPrompt: revised }
      : { mime: "image/png", base64, model };
  }

  if (asString(record.url)) {
    // We refuse to fetch the URL ourselves: it would turn this server into an
    // open proxy. Ask the operator for a provider that returns inline data.
    throw new AiError("upstream", {
      detail: "the provider returned an image URL instead of inline data",
    });
  }

  throw new AiError("upstream", { detail: "no usable image payload" });
}

/* ------------------------------------------------------------------ */
/*  OpenAI-compatible provider                                         */
/* ------------------------------------------------------------------ */

/**
 * Works with anything that exposes `/v1/chat/completions`: OpenAI, Groq,
 * Together, OpenRouter, Fireworks, DeepSeek, Mistral, NVIDIA NIM, Ollama,
 * LM Studio, llama.cpp and vLLM.
 */
class OpenAiCompatibleProvider implements AiProvider {
  readonly id = "openai-compatible";
  readonly label = PROVIDER_LABELS["openai-compatible"] ?? "OpenAI-compatible API";

  constructor(private readonly config: ProviderConfig) {}

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    const systemParts = [request.system, request.extraSystem].filter(
      (part): part is string => Boolean(part && part.trim()),
    );

    const userContent: string | AiContentPart[] = request.images?.length
      ? [
          { type: "text", text: request.prompt },
          ...request.images.map((image) => ({
            type: "image_url" as const,
            image_url: { url: `data:${image.mime};base64,${image.base64}` },
          })),
        ]
      : request.prompt;

    const messages: AiChatMessage[] = [
      ...(systemParts.length > 0
        ? [{ role: "system" as const, content: systemParts.join("\n\n") }]
        : []),
      ...(request.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: userContent },
    ];

    const model = request.model ?? this.config.model;
    const payload: Record<string, unknown> = { model, messages, stream: false };
    if (typeof request.temperature === "number") payload.temperature = request.temperature;
    const maxTokens = request.maxOutputTokens ?? this.config.maxOutputTokens;
    if (maxTokens !== null) payload.max_tokens = maxTokens;

    const response = await providerFetch(this.config, {
      method: "POST",
      path: "/chat/completions",
      body: JSON.stringify(payload),
      timeoutMs: this.config.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const choices = Array.isArray(response.payload.choices) ? response.payload.choices : [];
    const first = choices[0];
    const finishReason =
      typeof first === "object" && first !== null
        ? asString((first as Record<string, unknown>).finish_reason)
        : null;

    return {
      text: readChatText(response.payload),
      model: asString(response.payload.model) ?? model,
      usage: readUsage(response.payload),
      finishReason,
    };
  }

  async generateImage(request: AiImageRequest): Promise<AiImageResult> {
    const model = this.requireImageModel(request.model);
    // `response_format` is deliberately NOT sent.
    //
    // OpenAI accepts "b64_json". xkiro rejects that value outright:
    //   'Only response_format "url" is supported - images are served from the CDN.'
    // Other gateways vary again. Both shapes are handled downstream —
    // `readImage` for inline bytes, `pollImageJob` + `inlineProviderImage` for a
    // CDN URL — so omitting the field works everywhere rather than hardcoding
    // one vendor's dialect.
    const payload: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: 1,
    };
    if (request.size) payload.size = request.size;

    const response = await providerFetch(this.config, {
      method: "POST",
      path: "/images/generations",
      body: JSON.stringify(payload),
      timeoutMs: this.config.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
    });

    // Some gateways answer synchronously (OpenAI) with inline data.
    if (Array.isArray(response.payload.data)) {
      return readImage(response.payload, model);
    }

    // Others queue the work: HTTP 202 with a job id, polled until it settles.
    // xkiro is one of them, and says so in its own error text:
    //   "use POST /v1/images/generations (asynchronous - it returns a job id;
    //    poll GET /v1/images/generations/:id for the image)"
    return this.pollImageJob(response.payload, model, request.signal);
  }

  /**
   * Polls an asynchronous image job to completion, then inlines the result.
   *
   * The finished image lives on the provider's CDN, so it is downloaded here
   * rather than handed to the browser as a bare URL: that keeps the API
   * response shape identical to a synchronous provider, and it avoids leaking a
   * CDN path to the client. `inlineProviderImage` requires the host to be
   * related to the provider's own host, so this is not an open proxy.
   */
  private async pollImageJob(
    submitted: Record<string, unknown>,
    model: string,
    signal?: AbortSignal,
  ): Promise<AiImageResult> {
    const jobId = asString(submitted.id);
    if (!jobId) {
      throw new AiError("upstream", { detail: "provider accepted the job but returned no id" });
    }

    const deadline = Date.now() + this.config.timeoutMs;
    const pollEveryMs = 2000;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new AiError("upstream", { detail: "image generation was cancelled" });
      }
      await new Promise((resolve) => setTimeout(resolve, pollEveryMs));

      const job = await providerFetch(this.config, {
        method: "GET",
        path: `/images/generations/${encodeURIComponent(jobId)}`,
        timeoutMs: 20_000,
        ...(signal ? { signal } : {}),
      });

      const status = asString(job.payload.status) ?? "processing";

      if (status === "succeeded" || status === "completed" || status === "success") {
        const first = Array.isArray(job.payload.data) ? job.payload.data[0] : undefined;
        const url =
          typeof first === "object" && first !== null
            ? asString((first as Record<string, unknown>).url)
            : undefined;
        if (url) return inlineProviderImage(this.config, url, model, signal);
        // Some gateways inline the bytes in the job result.
        if (first) return readImage(job.payload, model);
        throw new AiError("upstream", { detail: "image job succeeded with no payload" });
      }

      if (status === "failed" || status === "cancelled" || status === "canceled") {
        const reason =
          asString((job.payload.error as Record<string, unknown> | undefined)?.message) ??
          `image job ${status}`;
        throw new AiError("upstream", { detail: reason });
      }
    }

    throw new AiError("timeout", {
      detail: `image job ${jobId} did not finish within ${this.config.timeoutMs}ms`,
    });
  }

  async editImage(request: AiImageEditRequest): Promise<AiImageResult> {
    const model = this.requireImageModel(request.model);
    const extension = request.image.mime.split("/")[1] ?? "png";

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", request.prompt);
    form.append("n", "1");
    if (request.size) form.append("size", request.size);
    form.append(
      "image",
      new Blob([base64ToBytes(request.image.base64)], { type: request.image.mime }),
      `input.${extension}`,
    );

    const response = await providerFetch(this.config, {
      method: "POST",
      path: "/images/edits",
      formData: form,
      timeoutMs: this.config.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
    });

    return readImage(response.payload, model);
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await providerFetch(this.config, {
        method: "GET",
        path: "/models",
        timeoutMs: Math.min(this.config.timeoutMs, 15_000),
      });
      const data = Array.isArray(response.payload.data) ? response.payload.data : [];
      return data
        .map((entry) =>
          typeof entry === "object" && entry !== null
            ? asString((entry as Record<string, unknown>).id)
            : null,
        )
        .filter((id): id is string => Boolean(id));
    } catch {
      // Plenty of local providers do not implement /models at all. That is not
      // an error — the tool works with whatever AI_MODEL points at.
      return [];
    }
  }

  private requireImageModel(requested?: string): string {
    // Re-read the environment rather than trusting the snapshot taken when this
    // adapter was constructed: an operator adding AI_IMAGE_MODEL and the next
    // request agreeing about it is worth more than the micro-optimisation.
    const model = requested ?? getAiConfig().imageModel;
    if (!model) {
      throw new AiError("not_configured", { detail: "AI_IMAGE_MODEL is not set" });
    }
    return model;
  }
}

registerProvider("openai-compatible", (config) => new OpenAiCompatibleProvider(config));

/** Decodes standard base64 into bytes for the multipart upload. */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const binary = atob(clean);
    // Allocated from an explicit ArrayBuffer so the result is a plain
    // `Uint8Array<ArrayBuffer>`, which is what `Blob` accepts.
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const source = Buffer.from(clean, "base64");
  const bytes = new Uint8Array(new ArrayBuffer(source.length));
  bytes.set(source);
  return bytes;
}
