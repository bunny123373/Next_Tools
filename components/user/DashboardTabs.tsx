"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Eye,
  FileStack,
  Heart,
  Monitor,
  Moon,
  Search,
  Shield,
  Sun,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CATEGORY_MAP, TOOL_COUNT, getTool, type Tool } from "@/lib/tools/registry";
import { useFavorites, useHistory, useLocalStats, useRecent } from "@/lib/user/hooks";
import { clearAll } from "@/lib/user/store";
import { useTheme } from "@/components/layout/theme-provider";
import { useLocalStorageState } from "@/lib/hooks";
import { formatBytes, formatDateTime, formatNumber, formatRelativeTime } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Stat, Switch } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { ToolEmptyState, Notice } from "@/components/tools/states";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { ToolCard } from "@/components/tools/ToolCard";
import { toast } from "@/lib/utils/toast";

/* ------------------------------------------------------------------ */
/*  Shared row type                                                    */
/* ------------------------------------------------------------------ */

interface ResolvedRecent {
  tool: Tool;
  lastUsedAt: number;
  openCount: number;
}

function useResolvedRecent(): ResolvedRecent[] {
  const { recent } = useRecent();
  return React.useMemo(
    () =>
      recent
        .map((entry) => ({
          tool: getTool(entry.toolId),
          lastUsedAt: entry.lastUsedAt,
          openCount: entry.openCount,
        }))
        .filter((row): row is ResolvedRecent => row.tool !== undefined),
    [recent],
  );
}

/* ------------------------------------------------------------------ */
/*  Overview                                                           */
/* ------------------------------------------------------------------ */

function OverviewTab() {
  const stats = useLocalStats();
  const { history } = useHistory();
  const { favorites } = useFavorites();
  const recentTools = useResolvedRecent();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Overview</h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Real numbers read from this browser. Nothing here is estimated or sampled.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Tools used" value={formatNumber(stats.toolsUsed)} hint={`of ${TOOL_COUNT}`} />
          <Stat label="Total opens" value={formatNumber(stats.totalOpens)} />
          <Stat label="Favourites" value={formatNumber(stats.favorites)} />
          <Stat
            label="Jobs completed"
            value={formatNumber(stats.jobsCompleted)}
            hint={stats.bytesProcessed > 0 ? `${formatBytes(stats.bytesProcessed)} output` : undefined}
            tone={stats.jobsCompleted > 0 ? "success" : "default"}
          />
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Recent tools</h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          {recentTools.length === 0
            ? "Nothing recorded yet"
            : `${recentTools.length} recorded, newest first`}
        </p>

        {recentTools.length === 0 ? (
          <div className="mt-3 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
            <ToolEmptyState
              title="No tools used yet"
              description="Open any tool and it will appear here with the time you last used it."
              icon={<Eye className="size-5" />}
            >
              <Button variant="secondary" size="sm" href="/tools" className="mt-1">
                Browse tools
              </Button>
            </ToolEmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2">
            {recentTools.slice(0, 5).map(({ tool, lastUsedAt, openCount }) => (
              <li key={tool.id}>
                <Link
                  href={tool.route}
                  className="group flex items-center gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-3.5 py-2.5 transition-colors hover:border-[var(--surface-line-strong)]"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]"
                  >
                    <ToolIcon name={tool.icon} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[var(--text-ink)]">
                      {tool.name}
                    </span>
                    <span className="block text-[11px] text-[var(--text-muted)]">
                      {CATEGORY_MAP[tool.category].name} · {formatRelativeTime(lastUsedAt)}
                      {openCount > 1 ? ` · opened ${openCount}×` : ""}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-ink)]">Favourites</h2>
        {favorites.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">
            You haven&apos;t saved any tools yet. Tap the heart on a tool card to pin it.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {favorites.slice(0, 12).map((entry) => {
              const tool = getTool(entry.toolId);
              if (!tool) return null;
              return (
                <Link
                  key={entry.toolId}
                  href={tool.route}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] px-2.5 py-1.5 text-[12px] text-[var(--text-muted)] transition-colors hover:border-[var(--surface-line-strong)] hover:text-[var(--text-ink)]"
                >
                  <Heart className="size-3 fill-brand-500 text-brand-500" aria-hidden="true" />
                  {tool.name}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {history.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
          No processing history yet. Run a tool and a metadata record appears in the History tab —
          the tool, the file name, the date, the status and the output size. Your file itself is
          never stored.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Favourites                                                         */
/* ------------------------------------------------------------------ */

function FavoritesTab() {
  const { favorites, clear, count } = useFavorites();
  const [query, setQuery] = React.useState("");
  const [confirmClear, setConfirmClear] = React.useState(false);

  const tools = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return favorites
      .map((entry) => getTool(entry.toolId))
      .filter((tool): tool is Tool => tool !== undefined)
      .filter((tool) => {
        if (!q) return true;
        return `${tool.name} ${tool.description} ${CATEGORY_MAP[tool.category].name}`
          .toLowerCase()
          .includes(q);
      });
  }, [favorites, query]);

  if (count === 0) {
    return (
      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
        <ToolEmptyState
          title="No favourites yet"
          description="Tap the heart on any tool to pin it here. Favourites are stored in this browser, so they work with no sign-in and are never transmitted to us."
          icon={<Heart className="size-5" />}
        >
          <Button variant="primary" size="sm" href="/tools" className="mt-1">
            Browse tools
          </Button>
        </ToolEmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <label htmlFor="dash-favorites-search" className="sr-only">
            Filter favourites
          </label>
          <input
            id="dash-favorites-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter your favourites…"
            className="h-10 w-full rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] pl-9 pr-3 text-sm text-[var(--text-ink)] placeholder:text-[var(--text-muted)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmClear(true)}
          className="self-start sm:self-auto"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Clear all
        </Button>
      </div>

      {tools.length === 0 ? (
        <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
          <ToolEmptyState
            title="Nothing matches that filter"
            description="Try a different word."
            icon={<Search className="size-5" />}
          />
        </div>
      ) : (
        <div className="grid-auto-fill-tools grid gap-3">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
          toast.info("Favourites cleared");
        }}
        title="Clear all favourites?"
        message={`This removes all ${count} saved tools from this browser. It cannot be undone.`}
        confirmLabel="Clear favourites"
        destructive
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

function HistoryTab() {
  const { history, remove, clear } = useHistory();
  const [confirmClear, setConfirmClear] = React.useState(false);

  if (history.length === 0) {
    return (
      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)]">
        <ToolEmptyState
          title="No processing history"
          description="When you run a tool, a metadata record appears here: the tool, the file name, the date, the status and the result size. File contents are never stored — ever."
          icon={<FileStack className="size-5" />}
        >
          <Button variant="secondary" size="sm" href="/tools" className="mt-1">
            Run a tool
          </Button>
        </ToolEmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--text-muted)]" role="status" aria-live="polite">
          <span className="font-mono tabular-nums text-[var(--text-ink)]">{history.length}</span>{" "}
          {history.length === 1 ? "record" : "records"} · newest first
        </p>
        <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          Clear all
        </Button>
      </div>

      <ul className="grid gap-2">
        {history.map((entry) => {
          const tool = getTool(entry.toolId);
          const success = entry.status === "success";
          return (
            <li
              key={entry.id}
              className="flex items-start gap-3 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-3.5 py-3"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border",
                  success
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
                    : "border-brand-500/25 bg-brand-500/10 text-brand-500",
                )}
              >
                {success ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <TriangleAlert className="size-4" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[13px] font-medium text-[var(--text-ink)]">
                    {tool?.name ?? entry.toolId}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {CATEGORY_MAP[entry.category]?.name ?? entry.category}
                  </span>
                </div>

                <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                  {entry.fileName ?? (entry.fileCount > 1 ? `${entry.fileCount} files` : "no file")}
                  {entry.outputName ? ` → ${entry.outputName}` : ""}
                </p>

                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                  <time dateTime={new Date(entry.createdAt).toISOString()}>
                    {formatDateTime(entry.createdAt)}
                  </time>
                  <span className={success ? "text-emerald-500" : "text-brand-500"}>
                    {success ? "Completed" : "Failed"}
                  </span>
                  {entry.inputBytes !== undefined ? (
                    <span className="font-mono tabular-nums">
                      {formatBytes(entry.inputBytes)}
                      {entry.outputBytes !== undefined ? ` → ${formatBytes(entry.outputBytes)}` : ""}
                    </span>
                  ) : null}
                  <span className={entry.processing === "local" ? "text-emerald-500/80" : "text-amber-500/80"}>
                    {entry.processing === "local" ? "Local" : "Server"}
                  </span>
                </p>

                {!success && entry.errorMessage ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-brand-500/90">
                    {entry.errorMessage}
                  </p>
                ) : null}
              </div>

              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete history record from ${formatDateTime(entry.createdAt)}`}
                onClick={() => {
                  remove(entry.id);
                  toast.info("Record deleted");
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>

      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
        This is metadata only: which tool ran, the file name, the sizes, the outcome and the
        timestamp. Never the file, and never the text you typed into a text tool.
      </p>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
          toast.info("History cleared");
        }}
        title="Clear all history?"
        message={`This permanently deletes all ${history.length} records from this browser.`}
        confirmLabel="Delete everything"
        destructive
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile                                                            */
/* ------------------------------------------------------------------ */

const PROFILE_ROWS = [
  { label: "Name", value: "Not set", hint: "Requires an account" },
  { label: "Email", value: "Not set", hint: "Requires an account" },
  { label: "Avatar", value: "None", hint: "Requires an account" },
  { label: "Plan", value: "Free", hint: "Every tool is available at no cost" },
] as const;

const ACCOUNT_BENEFITS = [
  "Favourites and history synced across your devices",
  "Cloud history that outlives your browser data",
  "Higher file limits and batch processing on paid plans",
  "Usage visibility so you can see what you have processed",
] as const;

function ProfileTab() {
  return (
    <div className="flex flex-col gap-6">
      <Notice tone="info" icon={<Shield className="size-3.5" />} title="No account yet.">
        Balu Tools works fully without signing in — favourites, recents and history all live in
        your browser. An account is only worth adding if you want your data to follow you across
        devices, which would mean storing it on a server.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2">
        {PROFILE_ROWS.map((row) => (
          <div
            key={row.label}
            className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-3.5"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
              {row.label}
            </p>
            <p className="mt-1 text-[14px] text-[var(--text-ink)]">{row.value}</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{row.hint}</p>
          </div>
        ))}
      </div>

      <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-5">
        <h3 className="text-[14px] font-semibold text-[var(--text-ink)]">What an account would add</h3>
        <ul className="mt-3 grid gap-2">
          {ACCOUNT_BENEFITS.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-[13px] leading-relaxed">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <span className="text-[var(--text-muted)]">{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-muted)]">
          We have deliberately not shipped sign-in yet. A password prompt is a security commitment,
          and a half-built one is worse than none. Until then, everything on this page is local and
          private by construction.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings                                                           */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = "balu:settings:v1";

interface Settings {
  reduceMotion: boolean;
  usageAnalytics: boolean;
  processingNotifications: boolean;
  productNotifications: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  reduceMotion: false,
  usageAnalytics: false,
  processingNotifications: true,
  productNotifications: false,
};

function SettingsRow({
  id,
  title,
  description,
  checked,
  onChange,
  icon,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] text-[var(--text-ink)]">
          {icon}
          {title}
        </p>
        <p className="mt-0.5 max-w-lg text-[12px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        label={title}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

function SettingsTab() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useLocalStorageState<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const [confirmWipe, setConfirmWipe] = React.useState(false);

  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-sm font-semibold text-[var(--text-ink)]">Theme</h3>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Dark is the default. Your choice is stored in this browser.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <ThemeOption
            active={theme === "dark"}
            onClick={() => setTheme("dark")}
            icon={<Moon className="size-4" />}
            label="Dark"
            description="Pure black, the intended look"
          />
          <ThemeOption
            active={theme === "light"}
            onClick={() => setTheme("light")}
            icon={<Sun className="size-4" />}
            label="Light"
            description="For bright rooms and high-glare screens"
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-[var(--text-ink)]">Privacy</h3>
        <div className="mt-3 grid gap-1 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-4">
          <SettingsRow
            id="setting-analytics"
            title="Send anonymous usage counters"
            description="Off by default. When on we send only how many times each tool was opened — no file names, no input, no identifiers. This only has any effect if the operator configured an analytics endpoint; otherwise nothing is transmitted."
            checked={settings.usageAnalytics}
            onChange={(value) => update({ usageAnalytics: value })}
            icon={<Shield className="size-3.5 text-[var(--text-muted)]" aria-hidden="true" />}
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-[var(--text-ink)]">Notifications</h3>
        <div className="mt-3 grid gap-1 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-4">
          <SettingsRow
            id="setting-processing-toasts"
            title="Processing notifications"
            description="Toasts when a job finishes, errors out, or a download is ready."
            checked={settings.processingNotifications}
            onChange={(value) => update({ processingNotifications: value })}
            icon={<Bell className="size-3.5 text-[var(--text-muted)]" aria-hidden="true" />}
          />
          <SettingsRow
            id="setting-product-toasts"
            title="Product updates"
            description="Occasional toasts when new tools ship. There is no mailing list."
            checked={settings.productNotifications}
            onChange={(value) => update({ productNotifications: value })}
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-[var(--text-ink)]">Interface</h3>
        <div className="mt-3 grid gap-1 rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] px-4 py-4">
          <SettingsRow
            id="setting-reduce-motion"
            title="Reduce motion"
            description="Minimise transitions and card lifts. Your operating system preference is respected automatically regardless of this switch."
            checked={settings.reduceMotion}
            onChange={(value) => update({ reduceMotion: value })}
            icon={<Monitor className="size-3.5 text-[var(--text-muted)]" aria-hidden="true" />}
          />
        </div>
      </section>

      <section className="rounded-[14px] border border-brand-500/25 bg-brand-500/[0.04] p-5">
        <h3 className="text-sm font-semibold text-[var(--text-ink)]">Your data</h3>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-[var(--text-muted)]">
          Favourites, recents, history and usage counters live in this browser&apos;s local storage.
          Deleting them here removes them permanently. Tool output files are never stored by us at
          all.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="danger" size="sm" onClick={() => setConfirmWipe(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            Delete all local data
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" });
              toast.success("Offline cache cleared");
            }}
          >
            Clear offline cache
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={() => {
          clearAll();
          setConfirmWipe(false);
          toast.info("Local data deleted", "Favourites, recents and history are gone.");
        }}
        title="Delete all local data?"
        message="This permanently removes your favourites, recently used list, processing history and usage counters from this browser. It cannot be undone."
        confirmLabel="Delete everything"
        destructive
      />
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  icon,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        active
          ? "border-brand-500/50 bg-brand-500/[0.07]"
          : "border-[var(--surface-line)] bg-[var(--surface-card)] hover:border-[var(--surface-line-strong)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mt-0.5 shrink-0", active ? "text-brand-500" : "text-[var(--text-muted)]")}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--text-ink)]">{label}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "favorites", label: "Favourites" },
  { value: "history", label: "History" },
  { value: "profile", label: "Profile" },
  { value: "settings", label: "Settings" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export function DashboardTabs() {
  const [tab, setTab] = React.useState<TabValue>("overview");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto border-b border-[var(--surface-line)] px-1"
      >
        {TABS.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`dash-panel-${item.value}`}
              id={`dash-tab-${item.value}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(item.value)}
              className={cn(
                "relative shrink-0 px-3 py-2.5 text-[13px] font-medium transition-colors",
                active
                  ? "text-[var(--text-ink)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-ink)]",
              )}
            >
              {item.label}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`dash-panel-${tab}`}
        aria-labelledby={`dash-tab-${tab}`}
        tabIndex={0}
        className="animate-fade-in py-7 focus-visible:outline-none"
      >
        {tab === "overview" ? <OverviewTab /> : null}
        {tab === "favorites" ? <FavoritesTab /> : null}
        {tab === "history" ? <HistoryTab /> : null}
        {tab === "profile" ? <ProfileTab /> : null}
        {tab === "settings" ? <SettingsTab /> : null}
      </div>
    </div>
  );
}
