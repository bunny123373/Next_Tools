import "server-only";

/**
 * Tool builder — EXPERIMENTAL.
 *
 * The single most important property of this feature: **it cannot generate or
 * execute code.** There is no eval, no Function constructor, no dynamic import
 * of a user-supplied path, and no template string that reaches an interpreter.
 *
 * What it does instead: it maps a plain-language description onto one entry in
 * the closed, hand-written template list in ./templates. Each template names an
 * *existing* workspace component and a set of preset option values. The worst
 * outcome is that you get a tool you did not ask for — not a remote code
 * execution hole.
 *
 * The AI is used, when configured, purely as a *classifier*: it must return one
 * of the ids in the closed list, and the answer is validated against that list
 * before it is used. A hallucinated or malicious response cannot escape the enum.
 */

import { getTool, type Tool } from "@/lib/tools/registry";
// Credential-bearing config comes from the provider layer directly. The
// `./config` module is the public-status surface and deliberately does not
// re-export the key.
import { getAiConfig } from "@/lib/ai/provider";
import { TEMPLATES, isTemplateId, type TemplateId, type ToolTemplate } from "./templates";

export { TEMPLATES, isTemplateId };
export type { TemplateId, ToolTemplate };

export interface BuilderResult {
  template: ToolTemplate;
  /** 0–1. Below the threshold means we could not confidently match. */
  confidence: number;
  /** How the match was made, shown to the user. */
  method: "ai" | "keywords" | "fallback";
  /** Human-readable reasoning. */
  reason: string;
  /** The existing tool whose workspace is being reused. */
  baseTool: Tool | undefined;
}

const SCORE_THRESHOLD = 0.18;

function scoreTemplate(template: ToolTemplate, words: Set<string>): number {
  let hits = 0;
  for (const keyword of template.keywords) {
    if (words.has(keyword)) {
      // Longer, more specific keywords are worth more.
      hits += 1 + Math.min(keyword.length, 12) / 24;
    }
  }
  return Math.min(1, hits / Math.max(template.keywords.length * 0.5, 1));
}

function localMatch(description: string): { template: ToolTemplate; confidence: number } | null {
  const normalised = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = new Set(normalised.split(" "));

  let best: { template: ToolTemplate; confidence: number } | null = null;
  for (const template of TEMPLATES) {
    const confidence = scoreTemplate(template, words);
    if (!best || confidence > best.confidence) best = { template, confidence };
  }

  if (!best || best.confidence < SCORE_THRESHOLD) return null;
  return best;
}

/**
 * Ask the model to *classify* the request. The response is validated against
 * the closed template id list; anything else is discarded.
 */
async function aiMatch(
  description: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<TemplateId | null> {
  const catalogue = TEMPLATES.map((t) => `${t.id}: ${t.label}`).join("\n");

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 20,
        messages: [
          {
            role: "system",
            content:
              "You classify a user's tool request into exactly one id from a fixed list. " +
              "Reply with the id only. No explanation, no punctuation, no code. " +
              "If nothing fits, reply NONE.",
          },
          { role: "user", content: `Available ids:\n${catalogue}\n\nRequest: ${description}` },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";

    // Strict validation. Only an exact id from the list survives.
    return isTemplateId(raw) ? raw : null;
  } catch {
    // A classifier failure must never break the builder — fall through to the
    // local matcher.
    return null;
  }
}

/** Resolves a description to a template. Never throws, never returns code. */
export async function generateToolConfig(
  description: string,
): Promise<BuilderResult | { error: string }> {
  const trimmed = description.trim();
  if (trimmed.length < 6) {
    return { error: "Describe the tool in a sentence or two so we have something to match." };
  }

  const config = getAiConfig();

  if (config) {
    const aiId = await aiMatch(trimmed, config.apiKey, config.baseUrl, config.model);
    if (aiId) {
      const template = TEMPLATES.find((t) => t.id === aiId)!;
      const baseTool = getTool(template.baseToolId);
      if (baseTool) {
        return {
          template,
          confidence: 0.9,
          method: "ai",
          reason: `The model classified this as “${template.label}”.`,
          baseTool,
        };
      }
    }
  }

  const local = localMatch(trimmed);
  if (local) {
    const baseTool = getTool(local.template.baseToolId);
    if (baseTool) {
      return {
        template: local.template,
        confidence: local.confidence,
        method: "keywords",
        reason:
          local.confidence > 0.6
            ? "Strong keyword match against an existing tool."
            : "Best available keyword match. Check that it's what you meant.",
        baseTool,
      };
    }
  }

  return {
    error:
      "We could not confidently map that onto a tool we already have. " +
      "Try naming the format or operation — “compress images”, “merge PDFs”, “count words” — " +
      "or request it and we will build it.",
  };
}
