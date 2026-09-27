import "server-only";

import type { Tool, ToolStatus } from "./types";

/**
 * Resolves a tool's *effective* status at request time.
 *
 * The registry stores the pessimistic, default-deployment truth: a tool whose
 * provider is not configured is marked `setup-required`. But that would be a
 * lie once the operator adds the API key, and hardcoding "flip it to stable"
 * in a source file is a footgun.
 *
 * So for provider-backed tools we check the environment instead. A configured
 * key upgrades the badge automatically, and the registry comment stays the
 * source of documentation.
 *
 * @see resolveProviderRequirements in lib/ai/provider.ts
 */
export function resolveToolStatus(tool: Tool): ToolStatus {
  if (tool.status !== "setup-required") return tool.status;

  // AI-backed tools: configured when a provider key exists.
  if (tool.processing === "ai") {
    return process.env.AI_API_KEY ? "stable" : "setup-required";
  }

  // Server-backed tools that depend on a named integration. We do not attempt
  // to parse the free-text setupNote; the mapping is explicit.
  const requirements: Record<string, string> = {
    "pdf-protect": "PDF_ENCRYPTION_API_KEY",
    "pdf-remove-password": "PDF_ENCRYPTION_API_KEY",
    "audio-to-text": "TRANSCRIPTION_API_KEY",
  };
  const variable = requirements[tool.id];
  if (variable && process.env[variable]) return "stable";

  return "setup-required";
}

/**
 * Environment variables an operator must set, for display in the admin panel
 * and the API docs page. Returns presence only — never a value.
 */
export interface EnvRequirement {
  name: string;
  required: boolean;
  purpose: string;
  configured: boolean;
}

export function getEnvRequirements(): readonly EnvRequirement[] {
  const requirements: Omit<EnvRequirement, "configured">[] = [
    { name: "NEXT_PUBLIC_SITE_URL", required: false, purpose: "Canonical origin for metadata, sitemap and share links" },
    { name: "AI_PROVIDER", required: false, purpose: "AI provider name (defaults to openai-compatible)" },
    { name: "AI_API_KEY", required: false, purpose: "Enables the AI tools" },
    { name: "AI_BASE_URL", required: false, purpose: "OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Ollama…)" },
    { name: "AI_MODEL", required: false, purpose: "Chat model id used by the AI tools" },
    { name: "AI_IMAGE_MODEL", required: false, purpose: "Image model id used by the AI image tools" },
    { name: "AI_TIMEOUT_MS", required: false, purpose: "Upstream request timeout (default 60000)" },
    { name: "PDF_ENCRYPTION_API_KEY", required: false, purpose: "Enables PDF password protect / remove" },
    { name: "TRANSCRIPTION_API_KEY", required: false, purpose: "Enables Audio to Text" },
    { name: "DATABASE_URL", required: false, purpose: "Persists favourites, history, usage and tool requests for signed-in users" },
    { name: "AUTH_SECRET", required: false, purpose: "Session signing secret for authentication" },
    { name: "ADMIN_SECRET", required: false, purpose: "Unlocks /admin when no auth provider is configured" },
    { name: "STRIPE_SECRET_KEY", required: false, purpose: "Enables subscription billing" },
    { name: "STRIPE_WEBHOOK_SECRET", required: false, purpose: "Verifies Stripe subscription webhooks" },
    { name: "NEXT_PUBLIC_ANALYTICS_ENDPOINT", required: false, purpose: "Receives anonymous aggregated usage counters (off by default)" },
    { name: "CONTACT_FORM_ENDPOINT", required: false, purpose: "Where /contact submissions are delivered" },
    { name: "NEXT_PUBLIC_CROSS_ORIGIN_ISOLATED", required: false, purpose: "Sets COOP/COEP headers, required only for ffmpeg.wasm" },
  ];

  return requirements.map((requirement) => ({
    ...requirement,
    configured: Boolean(process.env[requirement.name]),
  }));
}
