import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell, Prose, Callout } from "@/components/layout/PageShell";
import { RequestToolForm, StorageWarning } from "@/components/forms/RequestToolForm";
import { describeStore } from "@/lib/storage";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Request a tool",
  description: clampDescription(
    "Tell us what utility tool you need. Every request is read by a human and directly shapes what gets built next.",
  ),
  alternates: { canonical: "/request-tool" },
};

export default function RequestToolPage() {
  const store = describeStore();

  return (
    <PageShell
      title="Request a tool"
      description="Tell us what you were trying to do. If it doesn't exist, it might be the next thing we build."
      eyebrow="Contribute"
    >
      <Suspense
        fallback={
          <div
            className="h-96 animate-pulse rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]"
            aria-hidden="true"
          />
        }
      >
        <StorageWarning persistent={store.persistent} />

        <div className="mt-5 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5 sm:p-6">
          <RequestToolForm />
        </div>
      </Suspense>

      <Prose>
        <h2>What makes a request useful</h2>
        <p>
          The best requests describe a <em>situation</em>, not just a tool name. &ldquo;Something
          that converts HEIC&rdquo; is a wish. &ldquo;I photograph documents on my phone and have to
          convert every one before a job portal accepts them, five minutes a time&rdquo; tells us
          what to build and who for.
        </p>

        <Callout tone="info" title="Something not working as expected?">
          Bug reports are far more valuable than feature requests. Send those to{" "}
          <a href="/contact">the contact page</a> and include your browser, the tool, the options
          you chose, and what you expected to happen.
        </Callout>

        <h2>What we won&apos;t build</h2>
        <ul>
          <li>
            <strong>Anything that needs a file to leave your device unnecessarily.</strong> If a
            browser can do it, a browser will do it here.
          </li>
          <li>
            <strong>Tools that exist and work well elsewhere.</strong> We would rather send you
            there than rebuild it worse.
          </li>
          <li>
            <strong>Anything with no working reference.</strong> We can only judge a new tool
            against a real example of the output you want.
          </li>
        </ul>

        <h2>How requests are handled</h2>
        <ol>
          <li>Each request is read and categorised as pending.</li>
          <li>If we are building it, it moves to planned and appears on the site when it ships.</li>
          <li>Once it is live, the request moves to completed.</li>
        </ol>
        <p>
          We do not publish a roadmap or a delivery date, because we would break both. What we can
          promise is that requests are read.
        </p>
      </Prose>
    </PageShell>
  );
}
