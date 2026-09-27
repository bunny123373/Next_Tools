import type { ToolCategory, ToolIconName } from "./types";

export interface Category {
  slug: ToolCategory;
  name: string;
  /** Used in nav, cards, and breadcrumbs. */
  navLabel: string;
  icon: ToolIconName;
  /** One-line positioning copy for the category hero. */
  tagline: string;
  description: string;
  /** Longer copy for the category landing page. */
  blurb: string;
  /** Search/SEO terms for the category landing page. */
  keywords: readonly string[];
  /** Route of the category landing page. */
  route: string;
}

export const CATEGORIES: readonly Category[] = [
  {
    slug: "image",
    name: "Image Tools",
    navLabel: "Image",
    icon: "Image",
    tagline: "Compress, resize, convert and edit images.",
    description: "Compress, resize, convert and edit images.",
    blurb:
      "Every image tool here runs on your own device using the Canvas and WebGL APIs. Your photos are decoded, edited and re-encoded without ever leaving the tab — which also means no upload limits and nothing to wait for.",
    keywords: [
      "image tools",
      "compress image",
      "resize image",
      "convert image",
      "image editor online",
      "crop image",
      "webp converter",
      "no upload image tools",
    ],
    route: "/tools/image",
  },
  {
    slug: "pdf",
    name: "PDF Tools",
    navLabel: "PDF",
    icon: "FileText",
    tagline: "Merge, split, compress and convert PDFs.",
    description: "Merge, split, compress and convert PDFs.",
    blurb:
      "Create, split, rotate and shrink PDFs without a round trip to a server. Text layers and images are preserved, and the working copy of your document is discarded when you close the tab.",
    keywords: [
      "pdf tools",
      "merge pdf",
      "split pdf",
      "compress pdf",
      "jpg to pdf",
      "pdf to jpg",
      "rotate pdf",
      "pdf editor online",
    ],
    route: "/tools/pdf",
  },
  {
    slug: "video",
    name: "Video Tools",
    navLabel: "Video",
    icon: "Video",
    tagline: "Convert, compress and trim videos.",
    description: "Convert, compress and trim videos.",
    blurb:
      "Trim, crop, resize, re-encode and turn clips into GIFs using the browser's own media pipeline. Long operations run in real time so you always see honest progress, and codecs available to you are the ones Chrome or Firefox exposes.",
    keywords: [
      "video tools",
      "compress video",
      "convert video",
      "trim video",
      "video to gif",
      "resize video",
      "crop video",
      "video editor online",
    ],
    route: "/tools/video",
  },
  {
    slug: "audio",
    name: "Audio Tools",
    navLabel: "Audio",
    icon: "Music",
    tagline: "Convert, trim and merge audio files.",
    description: "Convert, trim and merge audio files.",
    blurb:
      "Trim, merge, boost, normalise and convert audio using the Web Audio API and an MP3 encoder that runs locally. Waveform previews let you cut precisely before you export.",
    keywords: [
      "audio tools",
      "mp3 converter",
      "wav converter",
      "trim audio",
      "merge audio",
      "volume booster",
      "audio normalizer",
      "remove silence",
    ],
    route: "/tools/audio",
  },
  {
    slug: "text",
    name: "Text Tools",
    navLabel: "Text",
    icon: "Type",
    tagline: "Useful tools for everyday text processing.",
    description: "Useful tools for everyday text processing.",
    blurb:
      "Count, clean, convert and reshape text instantly as you type. Nothing is debounced behind a network call — every keystroke is handled locally, so the counters stay in lockstep with the editor.",
    keywords: [
      "text tools",
      "word counter",
      "character counter",
      "case converter",
      "text cleaner",
      "slug generator",
      "lorem ipsum generator",
      "markdown editor",
    ],
    route: "/tools/text",
  },
  {
    slug: "ai",
    name: "AI Tools",
    navLabel: "AI",
    icon: "Sparkles",
    tagline: "AI-powered creative utilities.",
    description: "AI-powered creative utilities.",
    blurb:
      "Write, rewrite, summarise and translate with a model of your choice. Requests are proxied through a server route so provider credentials never reach the browser, and nothing you type is written to our database.",
    keywords: [
      "ai tools",
      "ai text generator",
      "ai summarizer",
      "ai rewriter",
      "ai translator",
      "ai image generator",
      "chat with pdf",
      "no api key in browser",
    ],
    route: "/tools/ai",
  },
  {
    slug: "developer",
    name: "Developer Tools",
    navLabel: "Developer",
    icon: "Code",
    tagline: "Fast utilities for developers.",
    description: "Fast utilities for developers.",
    blurb:
      "Formatters, encoders, validators and generators that run entirely in the tab. They are the tools you would otherwise keep in a scratch file, packaged so you can open one and it just works.",
    keywords: [
      "developer tools",
      "json formatter",
      "base64 encode",
      "uuid generator",
      "qr code generator",
      "jwt decoder",
      "regex tester",
      "hash generator",
      "cron generator",
    ],
    route: "/tools/developer",
  },
] as const;

export const CATEGORY_MAP: Readonly<Record<ToolCategory, Category>> = Object.freeze(
  Object.fromEntries(CATEGORIES.map((c) => [c.slug, c])) as Record<ToolCategory, Category>,
);

/** Category order used in the nav, homepage grid and /tools filters. */
export const CATEGORY_ORDER = CATEGORIES.map((c) => c.slug);

export function isToolCategory(value: string): value is ToolCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, value);
}
