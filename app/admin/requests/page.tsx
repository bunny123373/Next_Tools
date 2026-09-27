import type { Metadata } from "next";
import { AdminRequestsClient } from "@/components/admin/AdminRequestsClient";
import { getStore, describeStore } from "@/lib/storage";
import { Notice } from "@/components/tools/states";

export const metadata: Metadata = { title: "Tool requests" };
export const dynamic = "force-dynamic";

export default async function AdminRequestsPage() {
  const requests = await getStore().listToolRequests();
  const store = describeStore();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Tool requests</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Submissions from the public request form. Mark them pending, planned or completed as you
          work through them.
        </p>
      </div>

      {!store.persistent ? (
        <Notice tone="warning" title="This list is held in memory.">
          {store.hint} Requests will disappear when the process restarts. Set{" "}
          <code className="font-mono text-[12px]">TOOL_REQUESTS_ENDPOINT</code> to persist them.
        </Notice>
      ) : null}

      <AdminRequestsClient initial={requests} />
    </div>
  );
}
