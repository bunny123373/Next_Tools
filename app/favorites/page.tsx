import type { Metadata } from "next";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { FavoritesClient } from "@/components/user/FavoritesClient";
import { RecentClient } from "@/components/user/RecentClient";
import { PrivacyNote } from "@/components/tools/ToolShell";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Your favourites",
  description: clampDescription(
    "The Balu Tools you have saved. Stored in your own browser, never on a server.",
  ),
  alternates: { canonical: "/favorites" },
  robots: { index: false, follow: true },
};

export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <Breadcrumb className="mb-6" items={[{ label: "Home", href: "/" }, { label: "Favourites" }]} />

      <header className="mb-6 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-3xl">
          Favourites
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
          The tools you pinned. Your list is kept in this browser&apos;s local storage, so it works
          with no account and is never transmitted to us.
        </p>
      </header>

      <div className="mb-6 max-w-2xl">
        <PrivacyNote mode="local" />
      </div>

      <FavoritesClient />
    </div>
  );
}
