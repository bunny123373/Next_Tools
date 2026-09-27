/**
 * `GET /api/ai/status`
 *
 * The single source of truth the workspaces use to decide between the working
 * interface and the setup panel. It is deliberately boring:
 *
 *  - **no secrets.** It reports whether a provider is configured and which model
 *    ids are in play. It never returns the key, the base URL, or an upstream
 *    response — a key that leaks through a status endpoint leaks to every
 *    anonymous visitor.
 *  - **uncacheable.** `no-store`, so a deployment that adds `AI_API_KEY` is
 *    picked up on the next reload without a rebuild.
 *  - **rate limited**, because it is unauthenticated and cheap to call.
 *
 * The response is `{ configured, provider, model, imageModel, features }`,
 * where `features` says what the resolved provider adapter can actually do.
 * That is what lets the image tools say "this provider has no image model"
 * instead of rendering a button that returns a 501.
 */

import {
  getAiConfig,
  getConfiguredProviderName,
  isAiConfigured,
  providerLabel,
  providerFeatures,
  resolveProvider,
} from "@/lib/ai/provider";
import { NO_STORE, guardRateLimit } from "../lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const limited = guardRateLimit(request, "status");
    if (limited) return limited;

    if (!isAiConfigured()) {
      return Response.json(
        {
          configured: false,
          provider: null,
          model: null,
          imageModel: null,
          features: { chat: false, image: false, edit: false, vision: false },
        },
        { status: 200, headers: NO_STORE },
      );
    }

    const config = getAiConfig();
    const providerId = getConfiguredProviderName();
    const features = providerFeatures(resolveProvider());

    return Response.json(
      {
        configured: true,
        // The id, not the base URL and not the label's secrets: an operator may
        // be running an internal gateway whose hostname is not public.
        provider: providerLabel(providerId),
        model: config.model,
        imageModel: config.imageModel,
        features,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch {
    // A misconfigured AI_PROVIDER must still render the setup panel rather than
    // crash the page, so we report "not configured" instead of an error status.
    return Response.json(
      {
        configured: false,
        provider: null,
        model: null,
        imageModel: null,
        features: { chat: false, image: false, edit: false, vision: false },
      },
      { status: 200, headers: NO_STORE },
    );
  }
}
