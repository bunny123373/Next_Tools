import type { Metadata } from "next";
import Link from "next/link";

import { PageShell, Prose, Callout } from "@/components/layout/PageShell";
import { SupportForm } from "@/components/billing/SupportForm";
import { SITE } from "@/lib/site";
import { TOOL_COUNT } from "@/lib/tools/registry";
import { clampDescription } from "@/lib/seo";
import { isDonationsConfigured } from "@/lib/billing/donations";

export const metadata: Metadata = {
  title: "Support Balu Tools",
  description: clampDescription(
    "Every tool on Balu Tools stays free. If it saved you time, you can chip in towards the hosting costs — no account, no subscription, nothing unlocks.",
  ),
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  /**
   * Server-side so the page renders an honest "not switched on" panel on a
   * deployment with no Stripe key, rather than a button that fails on click.
   * Reports presence only — the key itself never reaches this component.
   */
  const configured = isDonationsConfigured();

  return (
    <PageShell
      title="Support Balu Tools"
      eyebrow="Support"
      description="Everything here stays free — every tool, every feature, with no account and no limits we invented to sell you something. This page is only here in case you would like to chip in."
    >
      <div className="mb-8">
        <SupportForm configured={configured} />
      </div>

      <Prose>
        <h2>What a contribution does and does not do</h2>
        <p>
          It pays for hosting, the domain, and the small amount of time that goes
          into keeping {TOOL_COUNT} tools working. That is the entire use of it.
        </p>
        <p>
          <strong className="text-[var(--text-ink)]">It unlocks nothing.</strong>{" "}
          There is no Pro tier hiding behind it, no file-size limit waiting to be
          raised, and nothing that stops working if you never pay. If the tools
          were ever behind a paywall, this site would be a different site, and
          you would have been told.
        </p>

        <h2>How the payment works</h2>
        <ul>
          <li>
            You choose an amount, then pay on Stripe&rsquo;s own checkout page. Card
            details go straight to Stripe and never touch this site.
          </li>
          <li>
            It is one payment, not a subscription. There is no recurring charge, no
            trial, and nothing to cancel.
          </li>
          <li>
            Stripe emails a receipt. We keep no card details and no card data is
            stored here at all.
          </li>
        </ul>

        <Callout tone="info" title="Why there is no account">
          An account system would mean storing something about you to attach a
          payment to. For a donation that unlocks nothing, that would be a poor
          trade — so this is deliberately anonymous and stateless.
        </Callout>

        <h2>If something goes wrong</h2>
        <p>
          If you were charged but did not see a receipt, or a payment looks wrong
          on your statement, email{" "}
          <a href={`mailto:${SITE.contactEmail}`} className="underline underline-offset-2">
            {SITE.contactEmail}
          </a>{" "}
          and it will be looked at properly. Refunds are handled case by case, and
          a mistake on our side is refunded without argument.
        </p>

        <h2>Or just use the tools</h2>
        <p>
          Honestly, that is the ideal outcome. Everything is free and complete —{" "}
          <Link href="/tools" className="underline underline-offset-2">
            all {TOOL_COUNT} tools
          </Link>
          , no sign-up. If it saved you an afternoon, that is what we wanted.
        </p>
      </Prose>
    </PageShell>
  );
}