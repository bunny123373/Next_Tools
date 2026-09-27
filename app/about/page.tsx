import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Prose, Callout, PageCta } from "@/components/layout/PageShell";
import { CATEGORIES, PLATFORM_STATS, TOOL_COUNT } from "@/lib/tools/registry";
import { SITE } from "@/lib/site";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "About",
  description: clampDescription(
    "Balu Tools is a free, privacy-first collection of browser-based utilities. Everything you need. One simple toolbox.",
  ),
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PageShell
      title="About Balu Tools"
      description="Everything you need. One simple toolbox."
      eyebrow="About"
    >
      <Prose>
        <p>
          Balu Tools is a collection of {TOOL_COUNT} small utilities across{" "}
          {CATEGORIES.length} categories — images, PDFs, video, audio, text, AI and developer tools.
          There is no account to create, no watermark to remove and no upgrade prompt to dodge.
          Every tool is free.
        </p>

        <h2>Why it exists</h2>
        <p>
          Most utility sites make you upload a file to do something a browser can already do. That
          costs you your privacy, adds an upload wait, breaks on large files, and quietly retains
          documents you would rather it did not.
        </p>
        <p>
          The browser is a capable runtime. It can decode and re-encode images, rewrite PDFs,
          synthesise audio, encode video and hash files without sending a single byte anywhere. The
          tools that do that should just do it.
        </p>

        <h2>What "browser-based" actually means here</h2>
        <p>
          Of the {TOOL_COUNT} tools, {PLATFORM_STATS.browserBased} process your files entirely on
          your own device using the Canvas, Web Audio, WebCodecs and Web Crypto APIs. Nothing is
          uploaded, there is no size ceiling beyond your own memory, and closing the tab discards
          everything.
        </p>
        <p>
          The other {PLATFORM_STATS.serverBacked} tools genuinely need a server or an AI provider —
          a model cannot run inside a web page. Rather than hide that, every one of those pages
          carries a clear notice above the workspace saying exactly what is sent where, and the
          product pages tell you before you type anything.
        </p>

        <Callout tone="success" title="Our rule about privacy claims">
          We only write &ldquo;processed locally in your browser&rdquo; on a tool that actually does
          it. A tool that uploads says so, even if that makes us look worse next to a competitor
          quietly doing the same thing.
        </Callout>

        <h2>How the tools are built</h2>
        <ul>
          <li>
            <strong>One shared UI kit.</strong> Every tool uses the same dropzone, progress, error
            and download components, so nothing surprises you when you move between them.
          </li>
          <li>
            <strong>Honest progress.</strong> When a tool can compute a real completion ratio it
            shows one. When it cannot — a model call, a real-time re-encode — it shows an
            indeterminate bar. No tool animates a fake percentage toward 100%.
          </li>
          <li>
            <strong>Nothing is claimed that does not work.</strong> A tool that needs a codec your
            browser lacks says which codecs you do have. A tool that needs an unconfigured API key
            shows a setup panel naming the exact environment variable.
          </li>
          <li>
            <strong>Small payloads.</strong> Heavy libraries are dynamically imported by the tool
            that needs them, so the homepage never downloads a PDF or video encoder.
          </li>
        </ul>

        <h2>Roadmap</h2>
        <p>
          There is an experimental <Link href="/tool-builder">tool builder</Link> that turns a
          plain-language description into a working tool configuration, and a subscription-ready
          architecture for teams who need higher limits. Both are clearly labelled experimental —
          and the builder never executes generated code, it only assembles known-safe components.
        </p>

        <h2>Get in touch</h2>
        <p>
          Found a bug, or need a tool that does not exist?{" "}
          <Link href="/request-tool">Request a tool</Link> or{" "}
          <Link href="/contact">get in touch</Link>. Bug reports are the most useful thing you can
          send us, and the fastest to fix.
        </p>
        <p className="text-[13px] text-[var(--text-ink-dim)]">
          {SITE.name} · {SITE.tagline}
        </p>
      </Prose>

      <PageCta />
    </PageShell>
  );
}
