import type { Metadata } from "next";
import { PageShell, Prose, Callout, PageCta } from "@/components/layout/PageShell";
import { PLATFORM_STATS, TOOL_COUNT } from "@/lib/tools/registry";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: clampDescription(
    "How Balu Tools handles your data: local browser processing, temporary server uploads, no file storage, and the small amount of data we do keep.",
  ),
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "2026-01-15";

export default function PrivacyPage() {
  return (
    <PageShell
      title="Privacy policy"
      description="What happens to your files, what we store, and what we don't."
      eyebrow="Legal"
    >
      <Prose>
        <p className="text-[13px] text-[var(--text-ink-dim)]">Last updated: {LAST_UPDATED}</p>

        <h2>The short version</h2>
        <ul>
          <li>
            <strong>{PLATFORM_STATS.browserBased} of our {TOOL_COUNT} tools never send your file
            anywhere.</strong> They run in your browser tab. This is not a marketing line — those
            tools have no upload code path at all.
          </li>
          <li>
            <strong>We do not store your files.</strong> Not the uploads, not the output, not a
            copy for &ldquo;convenience&rdquo;. There is no file database to breach.
          </li>
          <li>
            <strong>Your preferences live in your browser.</strong> Favourites, recently used tools,
            history and settings are in localStorage on your device.
          </li>
          <li>
            <strong>We do not run ads and we do not sell data.</strong> There is no third-party
            advertising or tracking script on this site.
          </li>
        </ul>

        <h2>Where your files actually go</h2>
        <p>
          Every tool declares a <strong>processing mode</strong>, and that declaration is displayed
          on the tool page and in the site footer. There are three:
        </p>

        <h3>1. Processed locally in your browser</h3>
        <p>
          The file is read with the browser&apos;s own APIs — <code>FileReader</code>,{" "}
          <code>createImageBitmap</code>, <code>AudioContext</code>, <code>crypto.subtle</code> — and
          the result is handed back to you as a download. It is never transmitted. Closing or
          refreshing the tab discards it.
        </p>

        <h3>2. Temporarily uploaded for processing</h3>
        <p>
          A few operations genuinely cannot run in a browser. These tools send the file to our
          processing API, do the work, stream the result back, and{" "}
          <strong>delete the temporary copy as soon as the request completes</strong> — including
          on the error path. Files are stored in a temporary location that is never served publicly
          and expires on a short timer as a second line of defence.
        </p>
        <Callout tone="warning" title="This mode means the file leaves your device">
          We are telling you this plainly because &ldquo;runs in your browser&rdquo; is a meaningful
          privacy property and we will not blur it. If a tool on this site says &ldquo;temporarily
          uploaded&rdquo;, your file is on our server for the duration of the request.
        </Callout>

        <h3>3. Sent to the AI provider</h3>
        <p>
          The AI tools forward your prompt to whichever model provider the operator of this
          deployment has configured. Your text or image goes to that provider, under their terms,
          for the length of the request. We do not store prompts, we do not use them for training,
          and we do not log their contents. API credentials are read on the server and are never
          sent to a browser.
        </p>

        <h2>What we store on your device</h2>
        <p>
          Balu Tools uses <code>localStorage</code> for the following. It never leaves your browser
          and is never sent to us:
        </p>
        <ul>
          <li>
            <strong>Favourites</strong> — the ids of tools you saved, with a timestamp.
          </li>
          <li>
            <strong>Recently used</strong> — the last 20 tools you opened, with timestamps and open
            counts.
          </li>
          <li>
            <strong>Processing history</strong> — up to 100 records containing the tool, the file{" "}
            <em>name</em>, the file count, input and output byte sizes, the outcome and the
            timestamp. <strong>Never the file contents</strong>, and never the text you typed into a
            text tool.
          </li>
          <li>
            <strong>Usage counters</strong> — how many times you opened each tool, used to rank
            your own &ldquo;trending&rdquo; list.
          </li>
          <li>
            <strong>Preferences</strong> — theme, notification settings.
          </li>
        </ul>
        <p>
          You can delete all of it at any time from{" "}
          <a href="/dashboard">Dashboard → Settings</a>, or by clearing site data in your browser.
        </p>

        <h2>What we collect server-side</h2>
        <p>
          Our servers keep short-lived request logs containing an IP address, a timestamp, the
          requested route and a status code. These are used for abuse prevention and to find broken
          tools. They are not joined to any account, because there are no accounts.
        </p>

        <h2>Analytics</h2>
        <p>
          Anonymous aggregated usage counters are{" "}
          <strong>off unless the operator of this deployment explicitly enables them</strong>. When
          enabled, we receive a single object mapping tool id to open count, with no identifiers,
          no file names, no input content and no cookies. If you would rather send nothing, leave
          the toggle off in{" "}
          <a href="/dashboard">Dashboard → Settings</a> — and note that a default installation
          sends nothing regardless.
        </p>

        <h2>Cookies</h2>
        <p>
          Balu Tools sets <strong>no cookies</strong>. No analytics cookies, no advertising cookies,
          no consent banner is needed because there is nothing to consent to. Your preferences are
          stored in <code>localStorage</code> instead, which you can inspect and delete at any time
          from your browser&apos;s developer tools.
        </p>

        <h2>Third parties</h2>
        <ul>
          <li>
            <strong>Your hosting provider</strong> — serves the site and its static assets, and
            necessarily sees the requests.
          </li>
          <li>
            <strong>Your AI provider</strong> — receives AI tool input, as described above. Which
            provider is in use is named on each AI tool page.
          </li>
          <li>
            <strong>Payment provider</strong> — only if you subscribe. Handled entirely by the
            provider&apos;s hosted checkout; card details never touch our servers.
          </li>
        </ul>
        <p>
          We use no advertising networks, no social pixels, no session-replay tools and no
          fingerprinting.
        </p>

        <h2>Children</h2>
        <p>
          Balu Tools is a general-audience utility site and collects no personal information from
          anyone, of any age.
        </p>

        <h2>Your rights</h2>
        <p>
          Because we hold almost nothing about you, there is very little to access, export or erase.
          If an account is enabled in a future deployment, you will be able to export and delete
          your data from the dashboard. For anything held server-side, contact us and we will
          respond within 30 days.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes materially we will update the date at the top of this page. We
          will not retroactively weaken a commitment made in a previous version.
        </p>
      </Prose>

      <PageCta title="Questions about privacy?" body="Send us a message and we will answer plainly." />
    </PageShell>
  );
}
