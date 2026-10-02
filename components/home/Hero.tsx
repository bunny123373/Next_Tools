import Image from "next/image";
import Link from "next/link";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { PLATFORM_STATS } from "@/lib/tools/registry";
import { SearchBox } from "./SearchBox";

const HERO_STATS = [
  { value: `${PLATFORM_STATS.tools}+`, label: "Tools" },
  { value: `${PLATFORM_STATS.categories}`, label: "Categories" },
  { value: `${PLATFORM_STATS.browserBased}`, label: "Browser based" },
  { value: "Free", label: "To use" },
] as const;

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--surface-line)]">
      {/* A single soft radial wash. Kept subtle on purpose — no gradients on
          the cards, and nothing that costs a paint on scroll. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] opacity-[0.07]"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, #FF3B30 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-[1400px] px-4 pb-14 pt-16 sm:px-6 sm:pb-16 sm:pt-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          {/*
            The Balu Tools mark, as a banner above the headline.

            Served through next/image, and deliberately not a plain <img>: the
            source is a 1.1 MB 2172x724 PNG, and the optimiser sends a
            right-sized, compressed variant instead. A 336px-wide slot does not
            justify a 2.6-megapixel download.

            width/height declare the real 3:1 ratio so the browser reserves the
            correct box before the bytes arrive — without that the headline below
            jumps as the image lands. `h-*` with `w-auto` scales it from the
            intrinsic ratio rather than distorting it.

            `priority` because this sits above the fold and is the largest paint
            on the page; deferring it would trade a visible delay for a
            bandwidth saving that does not matter for one image.

            Alt text is empty: the headline and the <title> already name the
            site, so a second copy would be read out twice for no gain.
          */}
          <Image
            src="/hearder.png"
            alt=""
            width={336}
            height={112}
            priority
            className="mx-auto mb-8 h-20 w-auto sm:mb-10 sm:h-28 lg:h-36"
          />

          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-line)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-500" />
            Free online tools
          </span>

          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-ink)] sm:text-5xl lg:text-6xl">
            Simple tools.
            <br />
            <span className="text-brand-500">Powerful results.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[var(--text-muted)] sm:text-lg">
            Fast, private and easy-to-use online tools for images, PDFs, videos, audio, text, AI
            and developers.
          </p>

          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              href="/tools"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              Explore Tools
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="#categories"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--surface-line-strong)] px-6 text-sm font-medium text-[var(--text-ink)] transition-colors hover:bg-[var(--surface-card-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
              View Categories
            </Link>
          </div>

          <div className="mx-auto mt-10 max-w-2xl">
            <SearchBox />
          </div>
        </div>

        <dl className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-line)] sm:grid-cols-4">
          {HERO_STATS.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-0.5 bg-[var(--surface-card)] px-4 py-4"
            >
              <dt className="sr-only">{stat.label}</dt>
              <dd className="font-mono text-xl font-semibold tabular-nums text-[var(--text-ink)] sm:text-2xl">
                {stat.value}
              </dd>
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {stat.label}
              </p>
            </div>
          ))}
        </dl>

        {/*
          Honest framing: most tools run in the browser, but the AI tools and a
          few server-backed tools genuinely do not. We state the real split
          rather than claiming 100% offline.
        */}
        <p className="mx-auto mt-6 max-w-2xl text-center text-[12px] leading-relaxed text-[var(--text-muted)]">
          {PLATFORM_STATS.browserBased} of {PLATFORM_STATS.tools} tools process your files entirely
          on your own device. The remaining {PLATFORM_STATS.serverBacked} send data to a server or
          an AI provider, and each of those pages says so before you use it.
        </p>
      </div>
    </section>
  );
}
