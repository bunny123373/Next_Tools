import type { Metadata } from "next";
import { PageShell, Prose, Callout } from "@/components/layout/PageShell";
import { ContactForm } from "@/components/forms/ContactForm";
import { SITE } from "@/lib/site";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Contact",
  description: clampDescription(
    "Get in touch with Balu Tools. Report a bug, request a tool, or tell us what would make the site more useful.",
  ),
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <PageShell
      title="Contact"
      description="Bug reports are the most useful thing you can send us, and usually the fastest to fix."
      eyebrow="Contact"
    >
      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5 sm:p-6">
        <ContactForm />
      </div>

      <Callout tone="info" title="No mail provider is configured on some deployments">
        If your message comes back saying it was only held in memory, that means this deployment
        has not been set up with a mail endpoint yet. Please email{" "}
        <a href={`mailto:${SITE.contactEmail}`} className="underline underline-offset-2">
          {SITE.contactEmail}
        </a>{" "}
        directly so it is not lost.
      </Callout>

      <Prose>
        <h2>Email</h2>
        <p>
          <a href={`mailto:${SITE.contactEmail}`} className="font-mono text-[13px]">
            {SITE.contactEmail}
          </a>
        </p>

        <h2>Reporting a bug</h2>
        <p>To get a fix quickly, include:</p>
        <ul>
          <li>the tool, as a link if you can;</li>
          <li>your browser and version (the about page will tell you);</li>
          <li>the file type and roughly its size, if a file was involved;</li>
          <li>the options you chose;</li>
          <li>what you expected, and what happened instead.</li>
        </ul>
        <p>
          Screenshots or a screen recording help enormously for visual issues. Please do not send
          confidential files — a description of the problem is usually enough to reproduce it.
        </p>

        <h2>Requesting a tool</h2>
        <p>
          The <a href="/request-tool">tool request form</a> captures more context and feeds the
          build queue, so use that rather than email for anything feature-shaped.
        </p>

        <h2>Security reports</h2>
        <p>
          If you think you have found a security issue, please email{" "}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> with{" "}
          <code className="font-mono text-[12px]">[security]</code> in the subject. We will
          acknowledge it and keep you updated while we fix it.
        </p>

        <h2>Response time</h2>
        <p>
          This is a small project, run in someone&apos;s spare time. Expect a few days for a normal
          message and longer for anything requiring investigation. We would rather reply slowly and
          accurately than quickly and wrongly.
        </p>
      </Prose>
    </PageShell>
  );
}
