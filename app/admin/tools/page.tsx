import type { Metadata } from "next";
import { CATEGORY_MAP, CATEGORY_ORDER, TOOLS, validateRegistry } from "@/lib/tools/registry";
import { resolveToolStatus } from "@/lib/tools/runtime";
import { WORKSPACES } from "@/components/tools/workspaces/registry";
import { Stat } from "@/components/ui/form";
import { Notice } from "@/components/tools/states";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Tools" };
export const dynamic = "force-static";

export default function AdminToolsPage() {
  const problems = validateRegistry();
  const missingWorkspaces = TOOLS.filter((tool) => !(tool.id in WORKSPACES));

  const byCategory = CATEGORY_ORDER.map((slug) => ({
    category: CATEGORY_MAP[slug],
    tools: TOOLS.filter((tool) => tool.category === slug),
  }));

  return (
    <div className="flex flex-col gap-8">
      <section>
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Tools" value={String(TOOLS.length)} />
          <Stat
            label="Workspaces wired"
            value={`${TOOLS.length - missingWorkspaces.length}/${TOOLS.length}`}
            tone={missingWorkspaces.length === 0 ? "success" : "brand"}
          />
          <Stat
            label="Registry problems"
            value={String(problems.length)}
            tone={problems.length === 0 ? "success" : "brand"}
          />
          <Stat label="Curated popular" value={String(TOOLS.filter((t) => t.popular).length)} />
        </dl>
      </section>

      {missingWorkspaces.length > 0 ? (
        <Notice tone="warning" title={`${missingWorkspaces.length} tool(s) have no workspace component.`}>
          These tools render a "workspace not registered" panel. Add a line to{" "}
          <code className="font-mono text-[12px]">components/tools/workspaces/registry.tsx</code>:{" "}
          {missingWorkspaces.slice(0, 6).map((tool) => tool.id).join(", ")}
          {missingWorkspaces.length > 6 ? "…" : ""}
        </Notice>
      ) : (
        <Notice tone="success">
          Every registered tool has a workspace component and a lazily loaded chunk.
        </Notice>
      )}

      {problems.length > 0 ? (
        <Notice tone="warning" title="Registry invariants">
          <ul className="mt-1 grid gap-0.5">
            {problems.map((problem, index) => (
              <li key={index} className="font-mono text-[12px]">
                {problem.kind}: {problem.detail}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {byCategory.map(({ category, tools }) => (
        <section key={category.slug}>
          <h2 className="text-sm font-semibold text-[var(--text-ink)]">
            {category.name}{" "}
            <span className="font-mono text-[12px] font-normal text-[var(--text-muted)]">
              {tools.length}
            </span>
          </h2>

          <div className="mt-3 overflow-x-auto rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--surface-line)]">
                  <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Tool</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Mode</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Added</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium text-[var(--text-muted)]">Workspace</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => {
                  const status = resolveToolStatus(tool);
                  const wired = tool.id in WORKSPACES;
                  return (
                    <tr
                      key={tool.id}
                      className="border-b border-[var(--surface-line)] last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <a
                          href={tool.route}
                          className="group flex items-center gap-2 hover:underline"
                        >
                          <ToolIcon name={tool.icon} size={14} />
                          <span className="text-[var(--text-ink)]">{tool.name}</span>
                          {tool.popular ? (
                            <Badge tone="brand">Popular</Badge>
                          ) : null}
                        </a>
                        <span className="mt-0.5 block pl-6 font-mono text-[11px] text-[var(--text-muted)]">
                          {tool.id}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            status === "stable"
                              ? "text-emerald-500"
                              : status === "beta"
                                ? "text-amber-500"
                                : "text-brand-500"
                          }
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
                        {tool.processing}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                        {tool.addedOn}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={wired ? "text-emerald-500" : "text-brand-500"}
                        >
                          {wired ? "wired" : "missing"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
