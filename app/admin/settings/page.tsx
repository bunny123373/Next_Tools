import type { Metadata } from "next";
import { PLANS, getEntitlements } from "@/lib/billing/plans";
import { getPaymentProvider, isPaymentsConfigured } from "@/lib/billing/provider";
import { getEnvRequirements } from "@/lib/tools/runtime";
import { getAiPublicStatus, AI_SETUP_INSTRUCTIONS } from "@/lib/ai/config";
import { getAdminMode } from "@/lib/admin/auth";
import { describeStore } from "@/lib/storage";
import { Notice } from "@/components/tools/states";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  const provider = getPaymentProvider();
  const payments = isPaymentsConfigured();
  const ai = getAiPublicStatus();
  const store = describeStore();
  const env = getEnvRequirements();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Environment</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Presence only. No value is ever read into this page, and none is written to the client
          bundle. Copy a name from here into your deployment&apos;s environment.
        </p>

        <div className="mt-4 overflow-x-auto rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--surface-line)]">
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Variable</th>
                <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Purpose</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-[var(--text-muted)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {env.map((requirement) => (
                <tr
                  key={requirement.name}
                  className="border-b border-[var(--surface-line)] last:border-0"
                >
                  <td className="px-4 py-2.5 align-top font-mono text-[12px] text-[var(--text-ink)]">
                    {requirement.name}
                  </td>
                  <td className="px-4 py-2.5 align-top text-[12px] leading-relaxed text-[var(--text-muted)]">
                    {requirement.purpose}
                  </td>
                  <td className="px-4 py-2.5 text-right align-top">
                    {requirement.configured ? (
                      <Badge tone="success">set</Badge>
                    ) : (
                      <Badge tone="outline">not set</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">AI provider</h2>
        {ai.configured ? (
          <div className="mt-3">
            <Notice tone="success" title="Configured.">
              Provider <code className="font-mono text-[12px]">{ai.provider}</code>, model{" "}
              <code className="font-mono text-[12px]">{ai.model}</code>
              {ai.imageModel ? ", image model set" : ", no image model set"}
              {ai.baseUrlHost ? `, host ${ai.baseUrlHost}` : ""}. The credential is read on the
              server only.
            </Notice>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <Notice tone="warning" title="Not configured — the AI tools show a setup panel.">
              This is the correct behaviour for a deployment with no key. Nothing pretends to work.
            </Notice>
            <pre className="overflow-x-auto rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
              {AI_SETUP_INSTRUCTIONS}
            </pre>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Payments</h2>
        <div className="mt-3 flex flex-col gap-3">
          <Notice
            tone={payments ? "success" : "warning"}
            title={
              payments
                ? `Provider: ${provider.label}`
                : "No payment provider is attached."
            }
          >
            {payments
              ? "Checkout is wired up. Entitlements are only granted from a webhook the provider signed."
              : "Checkout refuses with a not_configured error. There is no demo mode and no path that can mark a plan as paid."}
          </Notice>

          <div className="overflow-hidden rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--surface-line)]">
                  <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Plan</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Price</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-[var(--text-muted)]">Limits</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium text-[var(--text-muted)]">Pending</th>
                </tr>
              </thead>
              <tbody>
                {PLANS.map((plan) => {
                  const entitlements = getEntitlements(plan.id);
                  return (
                    <tr
                      key={plan.id}
                      className="border-b border-[var(--surface-line)] last:border-0"
                    >
                      <td className="px-4 py-2.5 text-[var(--text-ink)]">{plan.name}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-muted)]">
                        {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly}/mo`}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--text-muted)]">
                        {Object.entries(entitlements.limits)
                          .map(([key, value]) => `${key}=${value}`)
                          .join("  ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[12px] text-[var(--text-muted)]">
                        {entitlements.pending.length === 0 ? "—" : entitlements.pending.join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Storage</h2>
        <div className="mt-3">
          <Notice tone={store.persistent ? "success" : "warning"} title={`Backend: ${store.kind}`}>
            {store.hint}
          </Notice>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Admin access</h2>
        <div className="mt-3">
          <Notice tone={getAdminMode() === "disabled" ? "warning" : "success"}>
            Mode: <code className="font-mono text-[12px]">{getAdminMode()}</code>.{" "}
            {getAdminMode() === "session"
              ? "Sessions are signed with AUTH_SECRET."
              : getAdminMode() === "token"
                ? "A bearer token or cookie must match ADMIN_SECRET."
                : "Set ADMIN_SECRET or AUTH_SECRET to enable /admin at all."}
          </Notice>
        </div>
      </section>
    </div>
  );
}
