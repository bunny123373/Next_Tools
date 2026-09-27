import type { Metadata } from "next";
import { getAdminMode, requireAdmin } from "@/lib/admin/auth";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminSignIn } from "@/components/admin/AdminSignIn";
import { getEnvRequirements } from "@/lib/tools/runtime";
import { describeStore } from "@/lib/storage";
import { getAiPublicStatus } from "@/lib/ai/config";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin | Balu Tools" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Gate for every /admin page.
 *
 * Three states, each explained in the UI rather than shown as a bare 404:
 *   1. no credential configured → show exactly which env var to set. A fresh
 *      clone has no admin panel at all, and there is nothing to brute-force.
 *   2. configured but not signed in → show a sign-in form.
 *   3. configured and signed in → render the admin UI.
 *
 * The gate lives in the layout on purpose: a new page added under /admin is
 * protected by default, without anyone remembering to add a check.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const mode = getAdminMode();

  if (mode === "disabled") {
    const requirements = getEnvRequirements().filter((r) =>
      ["ADMIN_SECRET", "AUTH_SECRET", "DATABASE_URL", "TOOL_REQUESTS_ENDPOINT"].includes(r.name),
    );

    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)]">
          Admin is disabled
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
          No admin credential is configured for this deployment, so <code>/admin</code> is closed.
          This is the default on purpose: a fresh clone cannot be brute-forced into an admin panel
          because there is no admin panel to brute-force.
        </p>

        <div className="mt-6 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
          <h2 className="text-sm font-semibold text-[var(--text-ink)]">Enable it</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
            Set one of these in your environment, then restart the server:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-ink)]">
            {`# Simple: a shared secret sent as a bearer token or cookie
ADMIN_SECRET=choose-a-long-random-string

# Or: session cookies signed with a secret (use this with a real auth provider)
AUTH_SECRET=another-long-random-string`}
          </pre>

          <ul className="mt-5 grid gap-1.5">
            {requirements.map((requirement) => (
              <li
                key={requirement.name}
                className="flex items-center justify-between gap-3 font-mono text-[12px]"
              >
                <span className="text-[var(--text-ink)]">{requirement.name}</span>
                <span
                  className={
                    requirement.configured ? "text-emerald-500" : "text-[var(--text-muted)]"
                  }
                >
                  {requirement.configured ? "configured" : "not set"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
          <h2 className="text-sm font-semibold text-[var(--text-ink)]">Current configuration</h2>
          <dl className="mt-3 grid gap-2 text-[13px]">
            <AdminRow label="Storage backend" value={describeStore().hint} />
            <AdminRow
              label="AI provider"
              value={
                getAiPublicStatus().configured
                  ? `${getAiPublicStatus().provider} · ${getAiPublicStatus().model}`
                  : "not configured"
              }
            />
            <AdminRow label="Admin mode" value="disabled" />
          </dl>
        </div>
      </div>
    );
  }

  const guard = await requireAdmin();

  if (!guard.ok) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)]">
          Admin sign in
        </h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--text-muted)]">
          This deployment requires an admin credential.
        </p>
        <div className="mt-6">
          <AdminSignIn />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <AdminNav />
      <div className="mt-7">{children}</div>
    </div>
  );
}

function AdminRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="text-right text-[var(--text-ink)]">{value}</dd>
    </div>
  );
}
