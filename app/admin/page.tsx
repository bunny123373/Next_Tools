import type { Metadata } from "next";
import { CATEGORIES, TOOLS, PLATFORM_STATS, validateRegistry, getPopularTools } from "@/lib/tools/registry";
import { resolveToolStatus } from "@/lib/tools/runtime";
import { describeStore, getStore } from "@/lib/storage";
import { getAiPublicStatus } from "@/lib/ai/config";
import { getAdminMode } from "@/lib/admin/auth";
import { getEnvRequirements } from "@/lib/tools/runtime";
import { getStoreUsage } from "@/lib/admin/usage";
import { Stat } from "@/components/ui/form";
import { Notice } from "@/components/tools/states";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { formatNumber } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  // Real, computable facts only. Where a number needs infrastructure that is
  // not configured, we say so instead of rendering a plausible-looking figure.
  const problems = validateRegistry();
  const statusCounts: Record<"stable" | "beta" | "setup-required", number> = {
    stable: 0,
    beta: 0,
    "setup-required": 0,
  };
  for (const tool of TOOLS) {
    const status = resolveToolStatus(tool);
    if (status === "stable") statusCounts.stable += 1;
    else if (status === "beta") statusCounts.beta += 1;
    else statusCounts["setup-required"] += 1;
  }

  const usage = await getStoreUsage();
  const ai = getAiPublicStatus();
  const store = describeStore();
  const env = getEnvRequirements();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Registry</h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Counted directly from <code className="font-mono text-[12px]">lib/tools/registry.ts</code>.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Total tools" value={formatNumber(TOOLS.length)} />
          <Stat label="Categories" value={formatNumber(CATEGORIES.length)} />
          <Stat
            label="Browser based"
            value={formatNumber(PLATFORM_STATS.browserBased)}
            tone="success"
          />
          <Stat
            label="Server / AI"
            value={formatNumber(PLATFORM_STATS.serverBacked)}
            tone={PLATFORM_STATS.serverBacked > 0 ? "brand" : "default"}
          />
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Stability</h2>
        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Stable" value={formatNumber(statusCounts.stable)} tone="success" />
          <Stat label="Beta" value={formatNumber(statusCounts.beta)} />
          <Stat
            label="Setup required"
            value={formatNumber(statusCounts["setup-required"])}
            tone={statusCounts["setup-required"] > 0 ? "brand" : "default"}
          />
        </dl>

        {problems.length > 0 ? (
          <div className="mt-4">
            <Notice tone="warning" title={`${problems.length} registry problem(s) found`}>
              <ul className="mt-1 grid gap-0.5">
                {problems.slice(0, 10).map((problem, index) => (
                  <li key={index} className="font-mono text-[12px]">
                    {problem.kind}: {problem.detail}
                  </li>
                ))}
              </ul>
              {problems.length > 10 ? <p className="mt-1">…and {problems.length - 10} more.</p> : null}
            </Notice>
          </div>
        ) : (
          <div className="mt-4">
            <Notice tone="success">Registry invariants all pass — no duplicate ids, routes or slugs.</Notice>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Usage</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Real usage requires a database. Without one there is nothing to aggregate, and we would
          rather show that than a fabricated chart.
        </p>

        {usage.available ? (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat label="Total opens" value={formatNumber(usage.totalOpens)} />
              <Stat label="Distinct tools" value={formatNumber(usage.distinctTools)} />
              <Stat label="Jobs completed" value={formatNumber(usage.jobsCompleted)} />
              <Stat label="Files processed" value={formatNumber(usage.filesProcessed)} />
            </dl>

            {usage.topTools.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--surface-line)]">
                      <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">
                        Tool
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium text-[var(--text-muted)]">
                        Opens
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.topTools.map((row) => {
                      const tool = TOOLS.find((t) => t.id === row.toolId);
                      const max = usage.topTools[0]?.count ?? 1;
                      return (
                        <tr key={row.toolId} className="border-b border-[var(--surface-line)] last:border-0">
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-2">
                              {tool ? <ToolIcon name={tool.icon} size={14} /> : null}
                              <span className="text-[var(--text-ink)]">
                                {tool?.name ?? row.toolId}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="inline-flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="h-1.5 rounded-full bg-brand-500"
                                style={{ width: `${Math.max(4, (row.count / max) * 90)}px` }}
                              />
                              <span className="font-mono tabular-nums text-[var(--text-muted)]">
                                {formatNumber(row.count)}
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-4">
            <Notice tone="info" title="Usage analytics are not available.">
              {usage.reason} Set{" "}
              <code className="font-mono text-[12px]">DATABASE_URL</code> and implement the usage
              adapter in <code className="font-mono text-[12px]">lib/admin/usage.ts</code> to see
              real numbers here.
            </Notice>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Services</h2>
        <dl className="mt-4 grid gap-2">
          <ServiceRow
            label="AI provider"
            value={
              ai.configured
                ? `${ai.provider} · ${ai.model}${ai.imageModel ? " · image model set" : ""}`
                : "Not configured — AI tools show a setup panel"
            }
            ok={ai.configured}
          />
          <ServiceRow
            label="Submission storage"
            value={store.hint}
            ok={store.persistent}
          />
          <ServiceRow
            label="Admin access"
            value={
              getAdminMode() === "disabled"
                ? "Disabled (no credential set)"
                : `Enabled (${getAdminMode()} mode)`
            }
            ok={getAdminMode() !== "disabled"}
          />
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Popular (curated)</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          These are hand-picked, not ranked from data. We do not label a tool as &ldquo;popular&rdquo;
          based on a number we invented.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {getPopularTools().map((tool) => (
            <span
              key={tool.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] px-2.5 py-1.5 text-[12px] text-[var(--text-muted)]"
            >
              <ToolIcon name={tool.icon} size={12} />
              {tool.name}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Environment</h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Presence only. Values are never read into this page.
        </p>
        <div className="mt-3 overflow-hidden rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--surface-line)]">
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Variable</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium text-[var(--text-muted)] sm:table-cell">Purpose</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-[var(--text-muted)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {env.map((requirement) => (
                <tr key={requirement.name} className="border-b border-[var(--surface-line)] last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--text-ink)]">
                    {requirement.name}
                  </td>
                  <td className="hidden px-4 py-2.5 text-[12px] text-[var(--text-muted)] sm:table-cell">
                    {requirement.purpose}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={
                        requirement.configured
                          ? "text-emerald-500"
                          : "text-[var(--text-muted)]"
                      }
                    >
                      {requirement.configured ? "set" : "not set"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Recent submissions</h2>
        <RequestsPreview />
      </section>
    </div>
  );
}

function ServiceRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-3">
      <span className="text-[13px] font-medium text-[var(--text-ink)]">{label}</span>
      <span className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        {value}
      </span>
    </div>
  );
}

async function RequestsPreview() {
  const records = await getStore().listToolRequests();
  if (records.length === 0) {
    return (
      <div className="mt-3">
        <Notice tone="info">No tool requests have been submitted yet.</Notice>
      </div>
    );
  }

  return (
    <ul className="mt-3 grid gap-2">
      {records.slice(0, 5).map((record) => (
        <li
          key={record.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-3"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-[var(--text-ink)]">
              {record.toolName}
            </span>
            <span className="block text-[11px] text-[var(--text-muted)]">{record.category}</span>
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            {new Date(record.createdAt).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
