import "server-only";

/**
 * Aggregated usage adapter.
 *
 * Usage analytics need somewhere to aggregate from. That means a database, and
 * we deliberately do not ship one — there are no credentials in this repository
 * and there never will be.
 *
 * So this module reports *availability*, and the admin UI says plainly when
 * numbers are unavailable instead of rendering a plausible-looking chart. When
 * `DATABASE_URL` is configured, implement `queryUsage` below and the whole
 * admin surface lights up with real data.
 */

export interface UsageRow {
  toolId: string;
  count: number;
}

export interface UsageSummary {
  available: boolean;
  /** Why the numbers are missing, when `available` is false. */
  reason: string;
  totalOpens: number;
  distinctTools: number;
  jobsCompleted: number;
  filesProcessed: number;
  topTools: UsageRow[];
  dailyUsers?: { date: string; users: number }[];
  errorCount?: number;
}

const UNAVAILABLE = (reason: string): UsageSummary => ({
  available: false,
  reason,
  totalOpens: 0,
  distinctTools: 0,
  jobsCompleted: 0,
  filesProcessed: 0,
  topTools: [],
});

export async function getStoreUsage(): Promise<UsageSummary> {
  if (!process.env.DATABASE_URL) {
    return UNAVAILABLE(
      "DATABASE_URL is not set, so there is no usage data to aggregate. Usage counters live in each visitor's browser and are never sent anywhere.",
    );
  }

  // A database is configured. Until the query is implemented we still must not
  // invent numbers, so we report the gap rather than guessing at it.
  return UNAVAILABLE(
    "DATABASE_URL is set, but the usage query has not been implemented yet. Implement queryUsage() in lib/admin/usage.ts.",
  );
}

/**
 * Contract for a real implementation. Kept here so the shape is documented
 * even though no adapter ships.
 *
 * ```ts
 * export async function getStoreUsage(): Promise<UsageSummary> {
 *   const rows = await sql`
 *     SELECT tool_id, COUNT(*)::int AS count
 *     FROM tool_opens
 *     WHERE created_at > now() - interval '30 days'
 *     GROUP BY tool_id
 *     ORDER BY count DESC
 *     LIMIT 20
 *   `;
 *   // …map rows into UsageSummary
 * }
 * ```
 */
export interface UsageQuery {
  (): Promise<UsageSummary>;
}
