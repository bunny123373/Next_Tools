import type { Metadata } from "next";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DashboardTabs } from "@/components/user/DashboardTabs";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Your dashboard",
  description: clampDescription(
    "Your Balu Tools activity: overview, favourites, processing history, profile and settings. All stored in your own browser.",
  ),
  alternates: { canonical: "/dashboard" },
  // Per-user page: keep it out of the index.
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <Breadcrumb className="mb-6" items={[{ label: "Home", href: "/" }, { label: "Dashboard" }]} />

      <header className="mb-7 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)] sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
          Everything you have done on Balu Tools, read from this browser. No account is required and
          nothing is sent to a server.
        </p>
      </header>

      <DashboardTabs />
    </div>
  );
}
