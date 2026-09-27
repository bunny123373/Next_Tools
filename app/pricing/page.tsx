import type { Metadata } from "next";
import Link from "next/link";
import { Check, Clock } from "lucide-react";import { PageShell, Prose, Callout } from "@/components/layout/PageShell";
import { PLANS, getEntitlements, type Plan } from "@/lib/billing/plans";
import { isPaymentsConfigured } from "@/lib/billing/provider";
import { PLATFORM_STATS, TOOL_COUNT } from "@/lib/tools/registry";
import { cn } from "@/lib/utils/cn";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Pricing",
  description: clampDescription(
    "Every Balu Tools utility is free and needs no account. Plans for higher limits and batch processing are described but not yet for sale.",
  ),
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  const paymentsLive = isPaymentsConfigured();

  return (
    <PageShell
      title="Pricing"
      description="Everything on Balu Tools is free right now, and nothing is behind a paywall."
      eyebrow="Plans"
      className="max-w-[1400px]"
    >
      {!paymentsLive ? (
        <Callout tone="warning" title="No plan is for sale yet.">
          The three plans below describe what a subscription{" "}
          <em>would</em> unlock. Payments are not wired up, so there is deliberately no checkout
          button and no way to pay. We are not going to take money for a promise before the thing
          exists. Every one of the {TOOL_COUNT} tools is free and unlimited for the features marked
          &ldquo;included&rdquo;.
        </Callout>
      ) : null}

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} highlighted={plan.id === "pro"} live={paymentsLive} />
        ))}
      </div>

      <Prose>
        <h2>What is genuinely free today</h2>
        <p>
          All {TOOL_COUNT} tools, across all {PLATFORM_STATS.categories} categories. No account, no
          trial countdown, no export watermark. {PLATFORM_STATS.browserBased} of them also never
          touch a server, so there is no file size limit imposed by us at all — the ceiling is your
          device&apos;s memory.
        </p>

        <h2>Why describe plans that don&apos;t exist yet</h2>
        <p>
          Because usage limits need somewhere to go eventually, and retrofitting a quota system
          later is how you end up with a mess. The plan definitions and the entitlement checks are
          built and documented; what is missing is a payment provider and the higher-limit
          infrastructure behind the Pro and Business numbers.
        </p>
        <p>
          Items marked{" "}
          <span className="inline-flex items-center gap-1 font-mono text-[12px] text-amber-500">
            <Clock className="size-3" aria-hidden="true" />planned
          </span>{" "}
          are not built. The entitlement layer refuses them, so they cannot be switched on by
          accident.
        </p>

        <h2>What we will not do</h2>
        <ul>
          <li>Charge for a tool that already works for everyone.</li>
          <li>Show a fake checkout that pretends a payment succeeded.</li>
          <li>Take payment for a feature that is on the roadmap but not shipped.</li>
          <li>Make browser processing paywalled. If it runs on your device, you pay nothing.</li>
        </ul>

        <h2>For teams and automation</h2>
        <p>
          The Business plan describes API access and team seats. Neither exists yet, and the
          <Link href="/request-tool"> tool request form</Link> is the fastest way to tell us what
          you actually need — a working integration request is more useful to us than a plan tier
          nobody asked for.
        </p>
      </Prose>
    </PageShell>
  );
}

function PlanCard({ plan, highlighted, live }: { plan: Plan; highlighted: boolean; live: boolean }) {
  const entitlements = getEntitlements(plan.id);

  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border p-5",
        highlighted
          ? "border-brand-500/40 bg-[var(--surface-card)]"
          : "border-[var(--surface-line)] bg-[var(--surface-card)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-[var(--text-ink)]">{plan.name}</h2>
        {highlighted ? (
          <span className="rounded-md border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-500">
            Most useful
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">{plan.tagline}</p>

      <p className="mt-5 flex items-baseline gap-1">
        <span className="font-mono text-3xl font-semibold tabular-nums text-[var(--text-ink)]">
          {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly}`}
        </span>
        {plan.priceMonthly > 0 ? (
          <span className="text-[13px] text-[var(--text-muted)]">/month</span>
        ) : null}
      </p>

      {live ? (
        <button
          type="button"
          disabled={plan.id === "free"}
          className="mt-5 h-10 w-full rounded-[10px] border border-[var(--surface-line-strong)] text-sm font-medium text-[var(--text-ink)] transition-colors hover:bg-[var(--surface-card-2)] disabled:opacity-50"
        >
          {plan.id === "free" ? "Current plan" : "Choose plan"}
        </button>
      ) : (
        <p className="mt-5 rounded-[10px] border border-dashed border-[var(--surface-line-strong)] px-3 py-2.5 text-center text-[12px] text-[var(--text-muted)]">
          Not for sale
        </p>
      )}

      <ul className="mt-5 flex flex-col gap-2">
        {plan.features.map((feature) => (
          <li key={feature.key} className="flex items-start gap-2 text-[13px] leading-relaxed">
            {feature.implemented ? (
              <Check
                aria-hidden="true"
                className={cn("mt-0.5 size-4 shrink-0", highlighted ? "text-brand-500" : "text-emerald-500")}
              />
            ) : (
              <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-500" />
            )}
            <span className={feature.implemented ? "text-[var(--text-muted)]" : "text-[var(--text-muted)]"}>
              {feature.label}
              {!feature.implemented ? (
                <span className="ml-1.5 font-mono text-[11px] text-amber-500">planned</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {entitlements.pending.length > 0 ? (
        <p className="mt-4 border-t border-[var(--surface-line)] pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Includes {entitlements.pending.length} feature{entitlements.pending.length === 1 ? "" : "s"}{" "}
          that {entitlements.pending.length === 1 ? "is" : "are"} not built yet.
        </p>
      ) : null}
    </div>
  );
}
