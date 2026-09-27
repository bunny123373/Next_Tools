import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Prose, FaqList, faqPageJsonLd, PageCta } from "@/components/layout/PageShell";
import { PLATFORM_STATS, TOOL_COUNT } from "@/lib/tools/registry";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: clampDescription(
    "Answers about how Balu Tools handles your files, what runs in your browser, limits, privacy and offline support.",
  ),
  alternates: { canonical: "/faq" },
};

const FAQ = [
  {
    question: "Do my files get uploaded to your servers?",
    answer: `For ${PLATFORM_STATS.browserBased} of the ${TOOL_COUNT} tools, no — they run entirely in your browser and there is no upload code path at all. The remaining ${PLATFORM_STATS.serverBacked} tools do send data somewhere, and each one displays exactly where, in a notice directly above the workspace, before you use it. Nothing is mislabelled.`,
  },
  {
    question: "Do you store my files?",
    answer:
      "No. Browser tools never transmit files. Server-backed tools delete their temporary copy as soon as the request finishes, including when it fails. Tool output files are never written to our storage at all.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No, and you will not be asked for one. Favourites, your recently used list, your processing history and your settings all live in your own browser's local storage. That is also why clearing your browser data clears them — there is nothing on our side to restore from.",
  },
  {
    question: "Why does a tool say 'Setup required'?",
    answer:
      "Because it genuinely cannot run yet. Those tools depend on a server-side provider — an AI model, a PDF encryption service, a speech-to-text API — that the operator of this deployment has not configured. Rather than show you a button that silently fails, the tool tells you which environment variable is missing and what implementing it would involve.",
  },
  {
    question: "Why does a tool say 'Beta'?",
    answer:
      "It works, but something about it varies. Usually it is codec availability: your browser can only encode the video formats it has encoders for, and that differs between Chrome, Firefox, Safari and Edge. A beta tool tells you what it can and cannot do on your specific browser.",
  },
  {
    question: "Why are my progress bars sometimes indeterminate?",
    answer:
      "Because we genuinely cannot compute a completion ratio. A model call has no progress meter, and a real-time video re-encode only knows how far through the clip it is. In those cases an indeterminate bar is the honest option. Tools that can compute a real ratio — a batch of 20 files, say — show it, and we never animate a fabricated percentage toward 100%.",
  },
  {
    question: "What are the file size limits?",
    answer:
      "They come from your browser's available memory rather than from us, because nothing is uploaded. Practical limits are roughly 50 MB for images, 100 MB for PDFs and audio, and 500 MB for video. If a file is too large to process, the tool says so instead of failing silently or freezing the tab.",
  },
  {
    question: "Does it work offline?",
    answer:
      "The interface does. Once Balu Tools has been visited, a service worker caches the app shell so pages you have already opened keep loading without a connection. Tools that run in your browser keep working offline too, since all the work is local. Tools that need a server or an AI provider do not work offline, and each one says so on its own page — we do not claim offline support we do not have.",
  },
  {
    question: "Can I install it like an app?",
    answer:
      "Yes, if your browser supports progressive web apps. Chrome and Edge show an install prompt; on iOS, use Share → Add to Home Screen. The installed app is a shortcut with an offline shell, not a native binary.",
  },
  {
    question: "Is there a paid plan?",
    answer:
      "Every tool is currently free, and nothing is behind a paywall. The architecture supports plans for higher limits and batch processing, but we will not ship a plan that you have to pay for before we have built what it promises. See the Terms for details.",
  },
  {
    question: "Do you use cookies or track me?",
    answer:
      "No cookies are set, and there is no advertising or analytics script. If the operator enables anonymous usage counters, they consist of tool-open counts with no identifiers — and even that is off by default and toggleable from Dashboard → Settings.",
  },
  {
    question: "A tool produced the wrong result. What should I do?",
    answer:
      "Tell us — a bug report is the most useful thing you can send, and usually the fastest to fix. Include which browser you are on, roughly which tool and which options you chose, and what you expected. If a tool is subtly wrong rather than obviously broken, please still report it: silent wrongness is worse than a crash.",
  },
  {
    question: "Can I use Balu Tools for commercial work?",
    answer:
      "Yes. There is no personal-use restriction. You are responsible for having the rights to the content you process, and for checking the output before relying on it.",
  },
  {
    question: "Something is missing.",
    answer: `Requests are the single most effective way to improve this site. Tell us what you were trying to do and we will either point you at an existing tool or queue it for building.`,
  },
] as const;

export default function FaqPage() {
  return (
    <PageShell
      title="Frequently asked questions"
      description="The questions we get most, answered honestly."
      eyebrow="Help"
      jsonLd={faqPageJsonLd([...FAQ], "/faq")}
    >
      <FaqList items={[...FAQ]} />

      <Prose>
        <h2>Still stuck?</h2>
        <p>
          Browse every tool on the <Link href="/tools">all tools page</Link>, or check a specific
          tool&apos;s own FAQ — each tool page has one written for that tool rather than a generic
          copy. If the answer is not there, <Link href="/contact">contact us</Link>.
        </p>
      </Prose>

      <PageCta />
    </PageShell>
  );
}
