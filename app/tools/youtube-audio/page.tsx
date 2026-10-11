import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import YoutubeAudioWorkspace from "@/components/tools/YoutubeAudioWorkspace";
import { clampDescription } from "@/lib/seo";

/**
 * A standalone page rather than a registry tool.
 *
 * Every other tool is `/tools/[category]/[slug]` and is generated from
 * `lib/tools/definitions/`. This one is deliberately not: it is not a
 * single-purpose converter, it carries an explicit rights position that would
 * sit awkwardly in the tool registry's feature lists, and the brief asked for
 * this exact path. A static segment also takes precedence over the dynamic
 * `/tools/[category]` route, so it cannot collide with a category slug.
 */
export const metadata: Metadata = {
  title: "YouTube Audio & MP3 Converter",
  description: clampDescription(
    "Check a YouTube link and open the official page, and convert audio or video files you own to MP3 locally in your browser with FFmpeg.wasm. Nothing is uploaded.",
  ),
  alternates: { canonical: "/tools/youtube-audio" },
};

export default function YoutubeAudioPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <Breadcrumb
        className="mb-6"
        items={[{ label: "Home", href: "/" }, { label: "All Tools", href: "/tools" }, { label: "YouTube Audio" }]}
      />

      <header className="mb-8 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-3xl">
          YouTube Audio &amp; MP3 Converter
        </h1>
        <p className="max-w-3xl text-[15px] leading-relaxed text-[var(--text-muted)]">
          This page does two separate things, and it is worth being clear about which is which. It
          validates YouTube links and sends you to the official page — it does not download anything
          from YouTube. And it converts files you already have, entirely inside your browser, with
          no server involved.
        </p>
        <Link
          href="/tools"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-ink)]"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All tools
        </Link>
      </header>

      <YoutubeAudioWorkspace />

      <section className="mt-14 max-w-3xl">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--text-ink)]">
          About downloading from YouTube
        </h2>
        <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
          <p>
            Extracting audio from YouTube is something we do not do, and this page is built so that
            it cannot be done here even accidentally. There is no scraper, no signature bypass, no
            third-party download service and no hidden network call. The link field only recognises
            a URL and hands you back YouTube&rsquo;s own watch page.
          </p>
          <p>
            That is not only a policy preference. Downloading a video you do not own is generally
            against YouTube&rsquo;s Terms of Service, and in many jurisdictions it is unlawful. If you
            want the audio from a video, the legitimate routes are YouTube Premium&rsquo;s offline
            download, an official download button the uploader has enabled, a Creative Commons or
            public-domain licence, or permission from the copyright holder.
          </p>
          <p>
            If you have already obtained a file you are entitled to use — your own recording, a file
            from a licensed library, a friend&rsquo;s video with their permission — drop it into the
            converter above. It runs FFmpeg compiled to WebAssembly in this tab, so the file is
            never uploaded and works the same on a phone as on a desktop.
          </p>
        </div>
      </section>
    </div>
  );
}