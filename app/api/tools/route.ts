import { apiOk, withErrorHandling } from "@/lib/api/respond";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import { CATEGORIES, TOOLS, validateRegistry } from "@/lib/tools/registry";
import { resolveToolStatus } from "@/lib/tools/runtime";

export const runtime = "nodejs";

/**
 * GET /api/tools — the public tool catalogue as JSON.
 *
 * This is the machine-readable half of the registry: the same source of truth
 * that renders the website, so a client can never disagree with the UI about
 * which tools exist or what they do.
 *
 * Query parameters:
 *   ?category=image   filter to one category
 *   ?q=compress       search name / description / keywords
 *   ?status=setup     only tools that need configuration
 *   ?limit=50         cap the result count (max 200)
 */
export const GET = withErrorHandling(async (request: Request) => {
  const limit = rateLimit(request, { bucket: "tools", ...LIMITS.read });
  if (!limit.allowed) {
    return apiOk({ tools: [], rateLimited: true }, { headers: rateLimitHeaders(limit) });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const status = url.searchParams.get("status");
  const requestedLimit = Number(url.searchParams.get("limit") ?? 100);

  const cap = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(1, Math.floor(requestedLimit)), 200)
    : 100;

  let tools = TOOLS;

  if (category) {
    tools = tools.filter((tool) => tool.category === category);
  }

  if (status) {
    tools = tools.filter((tool) => resolveToolStatus(tool) === status);
  }

  if (query) {
    const terms = query.split(/\s+/).filter(Boolean);
    tools = tools.filter((tool) => {
      const haystack = [
        tool.name,
        tool.description,
        tool.intro,
        tool.keywords.join(" "),
        CATEGORIES.find((c) => c.slug === tool.category)?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  return apiOk(
    {
      count: tools.length,
      total: TOOLS.length,
      categories: CATEGORIES.map((c) => ({
        slug: c.slug,
        name: c.name,
        route: c.route,
        toolCount: TOOLS.filter((tool) => tool.category === c.slug).length,
      })),
      tools: tools.slice(0, cap).map((tool) => ({
        id: tool.id,
        name: tool.name,
        route: tool.route,
        category: tool.category,
        description: tool.description,
        keywords: tool.keywords,
        processing: tool.processing,
        status: resolveToolStatus(tool),
        popular: tool.popular ?? false,
        addedOn: tool.addedOn,
        setupNote: tool.status === "setup-required" ? tool.setupNote : undefined,
      })),
    },
    {
      headers: {
        ...rateLimitHeaders(limit),
        // Short public cache: the registry only changes on deploy, but we do
        // not want a stale catalogue if a rollback happens.
        "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
});
