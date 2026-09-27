"use client";

/**
 * Client-side product state: favourites, recently used tools, processing
 * history and local usage counters.
 *
 * Privacy rules baked in here:
 *  - Only *metadata* is persisted. File contents, file bytes and the text a
 *    visitor typed into a tool are never written to storage.
 *  - Nothing is transmitted. `flushUsage` only fires when the operator has
 *    explicitly configured an analytics endpoint, and it sends counters, not
 *    file or tool input.
 *  - When a signed-in user exists, `flushUsage` is the hook point for writing
 *    to the database instead. The local mirror keeps the UI instant.
 */

import type { ProcessingMode, ToolCategory } from "@/lib/tools/types";

const VERSION = "v1";
export const STORAGE_KEYS = {
  favorites: `balu:favorites:${VERSION}`,
  recent: `balu:recent:${VERSION}`,
  history: `balu:history:${VERSION}`,
  usage: `balu:usage:${VERSION}`,
} as const;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FavoriteEntry {
  toolId: string;
  addedAt: number;
}

export interface RecentEntry {
  toolId: string;
  lastUsedAt: number;
  /** How many times this visitor opened the tool. */
  openCount: number;
}

export interface HistoryEntry {
  id: string;
  toolId: string;
  /** Metadata only — never the file itself. */
  fileName?: string;
  fileCount: number;
  inputBytes?: number;
  outputBytes?: number;
  outputName?: string;
  createdAt: number;
  status: "success" | "error";
  errorMessage?: string;
  processing: ProcessingMode;
  category: ToolCategory;
}

/** toolId → number of opens, for this browser only. */
export type UsageCounts = Record<string, number>;

const MAX_RECENT = 20;
const MAX_HISTORY = 100;

/* ------------------------------------------------------------------ */
/*  Store plumbing                                                     */
/* ------------------------------------------------------------------ */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const cache = new Map<string, unknown>();
/** Memoised selector results, keyed by name. */
const derived = new Map<string, { input: unknown; value: unknown }>();

function emit(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  if (cache.has(key)) return cache.get(key) as T;
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? fallback : (JSON.parse(raw) as T);
    cache.set(key, value);
    return value;
  } catch {
    // Corrupt entry or storage blocked: fall back rather than crash.
    cache.set(key, fallback);
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  cache.set(key, value);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private mode: the in-memory value still works.
  }
  emit(key);
  // Same-tab listeners are handled above; this covers other tabs.
  window.dispatchEvent(new Event(`balu:${key}`));
}

export function subscribeStore(key: string, listener: Listener): () => void {
  const set = listeners.get(key) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(key, set);

  const onStorage = () => {
    cache.delete(key);
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(`balu:${key}`, onStorage);

  return () => {
    set.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(`balu:${key}`, onStorage);
  };
}

export function readStore<T>(key: string, fallback: T): T {
  return read(key, fallback);
}

export function writeStore<T>(key: string, value: T): void {
  write(key, value);
}

export function clearStore(key: string): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(key);
  cache.delete(key);
  derived.delete(key);
  emit(key);
  window.dispatchEvent(new Event(`balu:${key}`));
}

/**
 * Memoises a derived value against the identity of its raw input.
 *
 * `useSyncExternalStore` requires `getSnapshot` to return a referentially
 * stable value while the data is unchanged — otherwise React loops forever.
 * Every selector below therefore routes through this.
 */
function select<T>(key: string, input: unknown, compute: () => T): T {
  const hit = derived.get(key);
  if (hit && hit.input === input) return hit.value as T;
  const value = compute();
  derived.set(key, { input, value });
  return value;
}

/* ------------------------------------------------------------------ */
/*  Favourites                                                         */
/* ------------------------------------------------------------------ */

const EMPTY_FAVORITES: FavoriteEntry[] = [];
const EMPTY_RECENT: RecentEntry[] = [];
const EMPTY_HISTORY: HistoryEntry[] = [];

/** Re-exported so hooks can return a stable empty reference. */
export { EMPTY_FAVORITES, EMPTY_RECENT, EMPTY_HISTORY };

function validFavorites(raw: FavoriteEntry[]): FavoriteEntry[] {
  return raw.filter((entry) => typeof entry?.toolId === "string");
}

export function getFavorites(): FavoriteEntry[] {
  const raw = read<FavoriteEntry[]>(STORAGE_KEYS.favorites, EMPTY_FAVORITES);
  return select("favorites", raw, () => {
    const value = validFavorites(raw);
    return value.length === 0 ? EMPTY_FAVORITES : value;
  });
}

export function isFavorite(toolId: string): boolean {
  return getFavorites().some((entry) => entry.toolId === toolId);
}

export function toggleFavorite(toolId: string): boolean {
  const current = getFavorites();
  const exists = current.some((entry) => entry.toolId === toolId);
  const next = exists
    ? current.filter((entry) => entry.toolId !== toolId)
    : [{ toolId, addedAt: Date.now() }, ...current];

  write(STORAGE_KEYS.favorites, next);
  return !exists;
}

export function setFavorites(entries: FavoriteEntry[]): void {
  write(STORAGE_KEYS.favorites, entries);
}

/* ------------------------------------------------------------------ */
/*  Recently used                                                      */
/* ------------------------------------------------------------------ */

export function getRecent(): RecentEntry[] {
  const raw = read<RecentEntry[]>(STORAGE_KEYS.recent, EMPTY_RECENT);
  return select("recent", raw, () => {
    const value = raw
      .filter((entry) => typeof entry?.toolId === "string")
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    return value.length === 0 ? EMPTY_RECENT : value;
  });
}

/** Records an open. Called from the tool page on mount. */
export function recordToolOpen(toolId: string): void {
  const current = getRecent();
  const existing = current.find((entry) => entry.toolId === toolId);
  const next: RecentEntry[] = [
    {
      toolId,
      lastUsedAt: Date.now(),
      openCount: (existing?.openCount ?? 0) + 1,
    },
    ...current.filter((entry) => entry.toolId !== toolId),
  ].slice(0, MAX_RECENT);

  write(STORAGE_KEYS.recent, next);
}

export function clearRecent(): void {
  write(STORAGE_KEYS.recent, []);
}

/* ------------------------------------------------------------------ */
/*  Processing history (metadata only)                                 */
/* ------------------------------------------------------------------ */

export function getHistory(): HistoryEntry[] {
  const raw = read<HistoryEntry[]>(STORAGE_KEYS.history, EMPTY_HISTORY);
  return select("history", raw, () => {
    const value = raw
      .filter((entry) => typeof entry?.id === "string")
      .sort((a, b) => b.createdAt - a.createdAt);
    return value.length === 0 ? EMPTY_HISTORY : value;
  });
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "createdAt">): HistoryEntry {
  const record: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  const next = [record, ...getHistory()].slice(0, MAX_HISTORY);
  write(STORAGE_KEYS.history, next);
  return record;
}

export function removeHistory(id: string): void {
  write(
    STORAGE_KEYS.history,
    getHistory().filter((entry) => entry.id !== id),
  );
}

export function clearHistory(): void {
  write(STORAGE_KEYS.history, []);
}

/* ------------------------------------------------------------------ */
/*  Usage counters (real, local, and the basis for "Trending")          */
/* ------------------------------------------------------------------ */

export function getUsage(): UsageCounts {
  return read<UsageCounts>(STORAGE_KEYS.usage, {});
}

function bumpUsage(toolId: string): number {
  const current = getUsage();
  const next = (current[toolId] ?? 0) + 1;
  write(STORAGE_KEYS.usage, { ...current, [toolId]: next });
  return next;
}

/** Called on every tool page mount. Cheap, synchronous, no network. */
export function recordUsage(toolId: string): void {
  bumpUsage(toolId);
  void flushUsage();
}

/**
 * How many distinct tools this visitor has opened. Used to decide whether a
 * "Trending" rail has enough real data to be worth showing at all.
 */
export function usageSampleSize(): number {
  const counts = getUsage();
  return Object.values(counts).filter((n) => n > 0).length;
}

/**
 * Optionally reports anonymous counters to the operator's own endpoint.
 * No-ops unless `analyticsEndpoint` is configured, so a default deployment
 * sends nothing anywhere.
 */
let flushInFlight = false;
export async function flushUsage(): Promise<void> {
  const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
  if (!endpoint || flushInFlight || typeof window === "undefined") return;
  flushInFlight = true;
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ counts: getUsage(), at: Date.now() }),
      keepalive: true,
    });
  } catch {
    // Analytics must never surface an error to the visitor.
  } finally {
    flushInFlight = false;
  }
}

/** Ranks tool ids by real local usage. Returns [] when there is no data. */
export function localTrending(limit = 6): string[] {
  const counts = getUsage();
  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([toolId]) => toolId);
}

/* ------------------------------------------------------------------ */
/*  Aggregate (for the dashboard / admin "my activity" views)          */
/* ------------------------------------------------------------------ */

export interface LocalStats {
  toolsUsed: number;
  totalOpens: number;
  favorites: number;
  jobsCompleted: number;
  filesProcessed: number;
  bytesProcessed: number;
  lastActivityAt: number | null;
}

const EMPTY_LOCAL_STATS: LocalStats = {
  toolsUsed: 0,
  totalOpens: 0,
  favorites: 0,
  jobsCompleted: 0,
  filesProcessed: 0,
  bytesProcessed: 0,
  lastActivityAt: null,
};

export function getLocalStats(): LocalStats {
  const usage = getUsage();
  const favorites = getFavorites();
  const history = getHistory();
  return select("stats", `${usage}:${favorites.length}:${history.length}`, () => {
    const values = Object.values(usage);
    const successes = history.filter((entry) => entry.status === "success");
    const stats: LocalStats = {
      toolsUsed: values.filter((n) => n > 0).length,
      totalOpens: values.reduce((sum, n) => sum + n, 0),
      favorites: favorites.length,
      jobsCompleted: successes.length,
      filesProcessed: successes.reduce((sum, entry) => sum + (entry.fileCount ?? 0), 0),
      bytesProcessed: successes.reduce((sum, entry) => sum + (entry.outputBytes ?? 0), 0),
      lastActivityAt: history[0]?.createdAt ?? null,
    };
    return stats.totalOpens === 0 ? EMPTY_LOCAL_STATS : stats;
  });
}

/** Wipes every Balu Tools key from localStorage. */
export function clearAll(): void {
  for (const key of Object.values(STORAGE_KEYS)) clearStore(key);
}
