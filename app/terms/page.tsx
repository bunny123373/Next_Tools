import type { Metadata } from "next";
import { PageShell, Prose, Callout, PageCta } from "@/components/layout/PageShell";
import { PLATFORM_STATS, TOOL_COUNT } from "@/lib/tools/registry";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Terms of use",
  description: clampDescription(
    "The terms that apply when you use Balu Tools, including acceptable use, no warranty, and your responsibilities.",
  ),
  alternates: { canonical: "/terms" },
};

const LAST_UPDATED = "2026-01-15";

export default function TermsPage() {
  return (
    <PageShell
      title="Terms of use"
      description="The agreement between you and Balu Tools."
      eyebrow="Legal"
    >
      <Prose>
        <p className="text-[13px] text-[var(--text-ink-dim)]">Last updated: {LAST_UPDATED}</p>

        <h2>1. Agreement</h2>
        <p>
          By using Balu Tools you agree to these terms. If you do not agree, please do not use the
          site. These terms are written to be read; where a clause is unusual we have said why
          rather than burying it.
        </p>

        <h2>2. The service</h2>
        <p>
          Balu Tools provides {TOOL_COUNT} browser-based utilities across {PLATFORM_STATS.serverBacked > 0 ? "several" : "all"}{" "}
          categories. Tools marked as running in your browser execute entirely on your device.
          Tools that require a server or an AI provider are identified as such on their own page
          before you use them.
        </p>
        <p>
          We may add, change, deprecate or remove any tool. We aim not to break existing behaviour
          without notice, but a utility tool carries no service-level commitment.
        </p>

        <h2>3. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            use the site to process content you do not have the right to process — copyrighted
            material, confidential documents, or anything you are contractually forbidden from
            sharing;
          </li>
          <li>
            use server-backed or AI tools to produce unlawful content, to impersonate others, or to
            generate material designed to deceive about its nature;
          </li>
          <li>
            attempt to disrupt the service, including by automating requests beyond reasonable use,
            probing for vulnerabilities without disclosure, or circumventing rate limits;
          </li>
          <li>
            attempt to inject code, or to submit files crafted to execute code in our infrastructure.
            Uploaded files are never executed, and we treat any such attempt as a serious violation;
          </li>
          <li>
            resell, rebrand or misrepresent the service, or present it as your own product.
          </li>
        </ul>

        <h2>4. Your content</h2>
        <p>
          You keep all rights to everything you process. We claim no licence over your files, your
          prompts, or the output produced from them.
        </p>
        <Callout title="Who is responsible for output?">
          You are. Check anything important before relying on it — in particular, AI output can be
          confidently wrong, and lossy compression and conversion genuinely discard information.
        </Callout>

        <h2>5. No warranty</h2>
        <p>
          Balu Tools is provided{" "}
          <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>, without warranties of
          any kind, express or implied, including fitness for a particular purpose. We do not
          warrant that the site will be uninterrupted, error-free, or that output will meet any
          particular standard.
        </p>
        <p>
          Some tools are labelled <strong>beta</strong>. That label is a statement about reliability,
          not a formality. Test on a copy, not on the only version of your file.
        </p>

        <h2>6. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Balu Tools and its contributors are not liable for
          any indirect, incidental, special, consequential or punitive damages, nor for any loss of
          data, files, revenue or profits arising from your use of the service — even if we were
          advised such damage was possible.
        </p>

        <h2>7. Third-party services</h2>
        <p>
          AI tools send your input to a third-party model provider under that provider&apos;s own
          terms and privacy policy, which we do not control. Review them before sending anything
          sensitive.
        </p>

        <h2>8. Intellectual property</h2>
        <p>
          Balu Tools is open source under the MIT License. You may use, modify and redistribute
          it, including commercially, under that License&apos;s terms. The Balu Tools name and
          design are owned by their respective owners. Open-source components remain under their
          own licences.
        </p>

        <h2>9. Termination</h2>
        <p>
          You may stop using Balu Tools at any time. We may suspend access for anyone who breaches
          these terms, particularly the acceptable-use section.
        </p>

        <h2>10. Changes</h2>
        <p>
          We may update these terms. The date at the top always reflects the current version.
          Continued use after a change constitutes acceptance.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions about these terms? <a href="/contact">Get in touch</a> and we will respond.
        </p>
      </Prose>

      <PageCta title="Need a tool that does not exist?" body="Tell us — requests are read by a human." />
    </PageShell>
  );
}
