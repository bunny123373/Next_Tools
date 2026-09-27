import "server-only";

/**
 * AI provider status, for callers that only need to know *whether* AI is
 * available — the admin panel, /api/health, /api-docs and the tool builder.
 *
 * IMPORTANT: this module deliberately does NOT read `process.env` itself. It
 * delegates to the provider layer, which is the single place AI configuration
 * is interpreted. An earlier version of this file had its own reader, which
 * caused two real bugs:
 *
 *   1. It treated an empty `AI_API_KEY` as "not configured". That is wrong for
 *      a local provider — Ollama, LM Studio and vLLM need no credential at
 *      all, so those deployments would have been told their AI tools were
 *      broken while they worked fine.
 *   2. It read `AI_MAX_OUTPUT` while the provider read `AI_MAX_OUTPUT_TOKENS`,
 *      so the two could disagree about the same setting.
 *
 * Both are the class of bug that comes from having two readers of one source of
 * truth. `lib/ai/provider.ts` is the only reader now.
 *
 * SECURITY: `AI_API_KEY` is a plain server variable. It must never be a
 * `NEXT_PUBLIC_*` variable — anything with that prefix is inlined into the
 * JavaScript bundle and readable by anyone who opens the page. If you want to
 * reach the key from a component, the answer is always another API route.
 *
 * Recognised variables (all read by lib/ai/provider.ts):
 *   AI_PROVIDER        provider id (default: "openai-compatible")
 *   AI_API_KEY         credential — may be empty for a local provider
 *   AI_BASE_URL        OpenAI-compatible base URL (default: OpenAI)
 *   AI_MODEL           chat model id
 *   AI_IMAGE_MODEL     image model id
 *   AI_TIMEOUT_MS      upstream timeout
 *   AI_MAX_OUTPUT_TOKENS  max output tokens
 */

import {
  getAiConfig,
  getConfiguredProviderName,
  type ProviderConfig,
} from "./provider";

export type { ProviderConfig };
/** Re-exported so callers can narrow on the same type the provider uses. */
export type AiConfig = ProviderConfig;

/** True when an AI provider is available. Never reveals the credential. */
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
  /**
   * True when the endpoint is a local/self-hosted provider, where an empty
   * API key is expected rather than a misconfiguration.
   */
  localProvider: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);

export function getAiPublicStatus(): AiPublicStatus {
  const config = getAiConfig();
  if (!config) {
    return {
      configured: false,
      provider: null,
      model: null,
      imageModel: false,
      baseUrlHost: null,
      localProvider: false,
    };
  }

  let baseUrlHost: string | null = null;
  try {
    baseUrlHost = new URL(config.baseUrl).host;
  } catch {
    baseUrlHost = null;
  }

  return {
    configured: true,
    provider: getConfiguredProviderName(),
    model: config.model,
    imageModel: config.imageModel !== null,
    baseUrlHost,
    localProvider: isLocalEndpoint(config),
  };
}

function isLocalEndpoint(config: ProviderConfig): boolean {
  try {
    const { hostname } = new URL(config.baseUrl);
    return LOCAL_HOSTS.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The env vars an operator needs, in copy-paste form. */
export const AI_SETUP_INSTRUCTIONS = `Add these to your environment and restart the server:

  AI_API_KEY=sk-...
  AI_BASE_URL=https://api.openai.com/v1
  AI_MODEL=gpt-4o-mini

AI_BASE_URL can point at any OpenAI-compatible endpoint: OpenAI, Groq,
Together, OpenRouter, Ollama, LM Studio or vLLM. AI_IMAGE_MODEL is only
needed for the AI image tools.

For a local provider (Ollama, LM Studio, vLLM) you can leave AI_API_KEY
empty and set AI_BASE_URL to its address instead.

Keep AI_API_KEY server-side. A NEXT_PUBLIC_ prefix would publish it in the
browser bundle.`;
