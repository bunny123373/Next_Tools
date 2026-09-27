"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Search, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { Button } from "@/components/ui/button";
import { ToolEmptyState } from "@/components/tools/states";
import { ConfirmDialog } from "@/components/ui/modal";
import { formatDateTime } from "@/lib/utils/format";
import type { ToolRequestRecord } from "@/lib/storage";

type Status = ToolRequestRecord["status"];

const STATUS_META: Record<Status, { label: string; icon: React.ReactNode; className: string }> = {
  pending: {
    label: "Pending",
    icon: <Clock className="size-3" aria-hidden="true" />,
    className: "text-amber-500 border-amber-500/30 bg-amber-500/10",
  },
  planned: {
    label: "Planned",
    icon: <Sparkles className="size-3" aria-hidden="true" />,
    className: "text-sky-500 border-sky-500/30 bg-sky-500/10",
  },
  completed: {
    label: "Completed",
    icon: <Check className="size-3" aria-hidden="true" />,
    className: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  },
};

const STATUSES: Status[] = ["pending", "planned", "completed"];

export function AdminRequestsClient({ initial }: { initial: ToolRequestRecord[] }) {
  const router = useRouter();
  const [requests, setRequests] = React.useState(initial);
  const [filter, setFilter] = React.useState<Status | "all">("all");
  const [query, setQuery] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ToolRequestRecord | null>(null);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((request) => {
      if (filter !== "all" && request.status !== filter) return false;
      if (!q) return true;
      return `${request.toolName} ${request.category} ${request.description} ${request.reason ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [requests, filter, query]);

  const counts = React.useMemo(() => {
    const map: Record<string, number> = { all: requests.length };
    for (const status of STATUSES) {
      map[status] = requests.filter((request) => request.status === status).length;
    }
    return map;
  }, [requests]);

  const setStatus = async (id: string, status: Status) => {
    setBusyId(id);
    try {
      const response = await fetch(`/api/requests?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        request?: ToolRequestRecord;
        error?: { message: string };
      };
      if (!response.ok || !payload.ok || !payload.request) {
        throw new Error(payload.error?.message ?? "Could not update that request.");
      }
      setRequests((current) =>
        current.map((request) => (request.id === id ? payload.request! : request)),
      );
      toast.success(`Marked ${status}`, payload.request.toolName);
      router.refresh();
    } catch (error) {
      toast.error("Update failed", (error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (request: ToolRequestRecord) => {
    setBusyId(request.id);
    try {
      const response = await fetch(`/api/requests?id=${encodeURIComponent(request.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Could not delete that request.");
      }
      setRequests((current) => current.filter((item) => item.id !== request.id));
      toast.info("Request deleted", request.toolName);
      router.refresh();
    } catch (error) {
      toast.error("Delete failed", (error as Error).message);
    } finally {
      setBusyId(null);
      setPendingDelete(null);
    }
  };

  if (requests.length === 0) {
    return (
      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
        <ToolEmptyState
          title="No tool requests"
          description="Submissions from the request form will appear here, newest first."
          icon={<Sparkles className="size-5" />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <FilterPill
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="All"
            count={counts.all ?? 0}
          />
          {STATUSES.map((status) => (
            <FilterPill
              key={status}
              active={filter === status}
              onClick={() => setFilter(status)}
              label={STATUS_META[status].label}
              count={counts[status] ?? 0}
            />
          ))}
        </div>

        <div className="relative sm:max-w-xs sm:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <label htmlFor="requests-search" className="sr-only">
            Search requests
          </label>
          <input
            id="requests-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search requests…"
            className="h-9 w-full rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] pl-9 pr-3 text-[13px] text-[var(--text-ink)] placeholder:text-[var(--text-muted)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <ToolEmptyState
            title="Nothing matches"
            description="Try a different filter or search term."
            icon={<Search className="size-5" />}
          />
        </div>
      ) : (
        <ul className="grid gap-2">
          {visible.map((request) => {
            const busy = busyId === request.id;
            return (
              <li
                key={request.id}
                className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-[var(--text-ink)]">
                        {request.toolName}
                      </h3>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                          STATUS_META[request.status].className,
                        )}
                      >
                        {STATUS_META[request.status].icon}
                        {STATUS_META[request.status].label}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {request.category}
                      </span>
                    </div>

                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {request.description}
                    </p>

                    {request.reason ? (
                      <p className="mt-2 border-l-2 border-[var(--surface-line-strong)] pl-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
                        {request.reason}
                      </p>
                    ) : null}

                    <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                      <time dateTime={request.createdAt}>{formatDateTime(request.createdAt)}</time>
                      {request.email ? (
                        <a
                          href={`mailto:${request.email}`}
                          className="text-brand-500 hover:underline"
                        >
                          {request.email}
                        </a>
                      ) : (
                        <span>no email</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--surface-line)] pt-3">
                  <span className="text-[11px] text-[var(--text-muted)]">Mark as</span>
                  {STATUSES.map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={request.status === status ? "primary" : "ghost"}
                      disabled={busy || request.status === status}
                      onClick={() => setStatus(request.id, status)}
                    >
                      {STATUS_META[status].label}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setPendingDelete(request)}
                    aria-label={`Delete request for ${request.toolName}`}
                    className="ml-auto"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove(pendingDelete)}
        title="Delete this request?"
        message={
          pendingDelete
            ? `"${pendingDelete.toolName}" will be permanently removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        loading={busyId === pendingDelete?.id}
      />
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
          : "border-[var(--surface-line)] bg-[var(--surface-card)] text-[var(--text-muted)] hover:border-[var(--surface-line-strong)] hover:text-[var(--text-ink)]",
      )}
    >
      {label}
      <span className="font-mono tabular-nums opacity-60">{count}</span>
    </button>
  );
}
