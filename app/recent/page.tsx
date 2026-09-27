import type { Metadata } from "next";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { RecentClient } from "@/components/user/RecentClient";
import { PrivacyNote } from "@/components/tools/ToolShell";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Recently used tools",
  description: clampDescription(
    "The last 20 Balu Tools you opened, with the time you last used each one. Stored in your browser.",
  ),
  alternates: { canonical: "/recent" },
  robots: { index: false, follow: true },
};

export default function RecentPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <Breadcrumb className="mb-6" items={[{ label: "Home", href: "/" }, { label: "Recently used" }]} />

      <header className="mb-6 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-3xl">
          Recently used
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
          The last {20} tools you opened, newest first. We keep the most recent entries only — this
          list never grows without bound.
        </p>
      </header>

      <div className="mb-6 max-w-2xl">
        <PrivacyNote mode="local" />
      </div>

      <RecentClient />
    </div>
  );
}
