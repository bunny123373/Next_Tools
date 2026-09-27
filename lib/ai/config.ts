import "server-only";

/**
 * AI provider configuration.
 *
 * This is the ONLY place environment variables are read for the AI features,
 * and it is `server-only` so a bundler error surfaces at build time if any
 * client component ever imports it.
 *
 * SECURITY: `AI_API_KEY` is a plain server variable. It must never be a
 * `NEXT_PUBLIC_*` variable — anything prefixed that way is inlined into the
 * JavaScript bundle and readable by anyone who opens the page. If you find
 * yourself wanting to reach the key from a component, the answer is always
 * another API route.
 *
 * Recognised variables:
 *   AI_PROVIDER       provider id (default: "openai-compatible")
 *   AI_API_KEY        the credential — required
 *   AI_BASE_URL       OpenAI-compatible base URL (default: OpenAI)
 *   AI_MODEL          chat model id
 *   AI_IMAGE_MODEL    image model id
 *   AI_TIMEOUT_MS     upstream timeout, default 60000
 *   AI_MAX_OUTPUT     max output tokens, default 2000
 */

export interface AiConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  imageModel: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 2000;

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Returns the resolved config, or null when the provider is not configured.
 * Callers must handle null — that is the "setup required" path.
 */
export function getAiConfig(): AiConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    provider: process.env.AI_PROVIDER?.trim() || "openai-compatible",
    apiKey,
    baseUrl: (process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL,
    imageModel: process.env.AI_IMAGE_MODEL?.trim() || null,
    timeoutMs: readInt(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxOutputTokens: readInt(process.env.AI_MAX_OUTPUT, DEFAULT_MAX_OUTPUT),
  };
}

/** True when an AI provider is available. Never reveals the key. */
export function isAiConfigured(): boolean {
  return getAiConfig() !== null;
}

/**
 * Safe-to-serialise summary for API responses and the admin panel.
 * Contains no credential material of any kind.
 */
export interface AiPublicStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  imageModel: boolean;
  baseUrlHost: string | null;
}

export function getAiPublicStatus(): AiPublicStatus {
  const config = getAiConfig();
  if (!config) {
    return { configured: false, provider: null, model: null, imageModel: false, baseUrlHost: null };
  }

  let baseUrlHost: string | null = null;
  try {
    baseUrlHost = new URL(config.baseUrl).host;
  } catch {
    baseUrlHost = null;
  }

  return {
    configured: true,
    provider: config.provider,
    model: config.model,
    imageModel: config.imageModel !== null,
    baseUrlHost,
  };
}

/** The env vars an operator needs, in copy-paste form. */
export const AI_SETUP_INSTRUCTIONS = `Add these to your environment and restart the server:

  AI_API_KEY=sk-...
  AI_BASE_URL=https://api.openai.com/v1
  AI_MODEL=gpt-4o-mini

AI_BASE_URL can point at any OpenAI-compatible endpoint: OpenAI, Groq,
Together, OpenRouter, Ollama, LM Studio or vLLM. AI_IMAGE_MODEL is only
needed for the AI image tools.

Keep AI_API_KEY server-side. A NEXT_PUBLIC_ prefix would publish it in the
browser bundle.`;
