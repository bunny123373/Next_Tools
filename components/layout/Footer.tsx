import Link from "next/link";
import { GitHubIcon, InstagramIcon, YouTubeIcon } from "@/components/ui/BrandIcons";
import { CATEGORIES } from "@/lib/tools/categories";
import { SITE } from "@/lib/site";

const COLUMNS = [
  {
    title: "Tools",
    links: CATEGORIES.slice(0, 4).map((c) => ({ label: c.name, href: c.route })),
  },
  {
    title: "More tools",
    links: CATEGORIES.slice(4).map((c) => ({ label: c.name, href: c.route })),
  },
  {
    title: "Resources",
    links: [
      { label: "About", href: "/about" },
      { label: "FAQ", href: "/faq" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
  {
    title: "Developer",
    links: [
      { label: "GitHub", href: SITE.social.github, external: true },
      { label: "API", href: "/api-docs" },
      { label: "Request a tool", href: "/request-tool" },
      { label: "All tools", href: "/tools" },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="mt-20 border-t border-[var(--surface-line)] bg-[var(--surface-card)]">
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Link href="/" className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-md bg-brand-500 text-[13px] font-bold text-white"
              >
                B
              </span>
              <span className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-ink)]">
                Balu Tools
              </span>
            </Link>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
              {SITE.pitch}
            </p>

            <div className="mt-5 flex items-center gap-1">
              <a
                href={SITE.social.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Balu Tools on GitHub"
                className="grid size-9 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
              >
                <GitHubIcon className="size-4" />
              </a>
              <a
                href={SITE.social.youtube}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Balu Tools on YouTube"
                className="grid size-9 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
              >
                <YouTubeIcon className="size-4" />
              </a>
              <a
                href={SITE.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Balu Tools on Instagram"
                className="grid size-9 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
              >
                <InstagramIcon className="size-4" />
              </a>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {column.title}
              </h2>
              <ul className="mt-3 grid gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-ink)]"
                      >
                        {link.label}
                        <span aria-hidden="true" className="text-[10px]">
                          ↗
                        </span>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-ink)]"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-[var(--surface-line)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-[var(--text-muted)]">
            © {SITE.copyrightYear} Balu Tools. All rights reserved.
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">
            {SITE.tagline}
          </p>
        </div>
      </div>
    </footer>
  );
}
