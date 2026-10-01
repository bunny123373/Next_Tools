/**
 * Site-wide configuration. Everything that is deployment-specific lives here so
 * there is exactly one place to change a URL, a name, or a social handle.
 */

function requiredUrl(value: string | undefined, fallback: string): string {
  if (value) {
    try {
      return new URL(value).origin;
    } catch {
      // Ignore a malformed override rather than crashing the whole app.
    }
  }
  return fallback;
}

/** Canonical origin, used for metadata, sitemap, robots and share links. */
export const SITE_URL = requiredUrl(
  process.env.NEXT_PUBLIC_SITE_URL,
  "https://balu.tools",
);

export const SITE = {
  name: "Balu Tools",
  tagline: "Simple tools. Powerful results.",
  /** Used in the footer, hero and structured data. */
  pitch: "Everything you need. One simple toolbox.",
  description:
    "Fast, private, browser-based tools for images, PDFs, video, audio, text, AI and developers. No sign-up required.",
  url: SITE_URL,
  locale: "en",
  /** Shown in the footer. */
  copyrightYear: new Date().getFullYear(),
  contactEmail:
    process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "steveharringtone999@gmail.com",
  /** Placeholders are intentional — replace with real profiles before launch. */
  social: {
    github: process.env.NEXT_PUBLIC_SOCIAL_GITHUB ?? "https://github.com/balu-tools",
    youtube: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE ?? "https://youtube.com/@balutools",
    instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM ?? "https://instagram.com/balutools",
    x: process.env.NEXT_PUBLIC_SOCIAL_X ?? "https://x.com/balutools",
  },
  /** Max byte ceiling shown in the dropzones of local file tools. */
  limits: {
    image: 50 * 1024 * 1024,
    pdf: 100 * 1024 * 1024,
    video: 500 * 1024 * 1024,
    audio: 100 * 1024 * 1024,
    text: 10 * 1024 * 1024,
  },
} as const;

/** Absolute URL helper for canonical tags, OG images and share links. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}
