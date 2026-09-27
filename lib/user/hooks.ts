"use client";

import * as React from "react";
import { toast } from "@/lib/utils/toast";
import {
  EMPTY_FAVORITES,
  STORAGE_KEYS,
  clearAll,
  clearHistory,
  clearRecent,
  getFavorites,
  getHistory,
  getLocalStats,
  getRecent,
  removeHistory,
  setFavorites,
  subscribeStore,
  toggleFavorite as toggleInStore,
  usageSampleSize,
  type FavoriteEntry,
  type HistoryEntry,
  type LocalStats,
  type RecentEntry,
} from "./store";

/**
 * React bindings over the local store.
 *
 * `useSyncExternalStore` keeps the server HTML and the first client render
 * identical, which is what stops a favourite button from flashing or
 * mismatching during hydration. The store's selectors are memoised, so the
 * snapshot identity only changes when the data actually changes.
 */
function useStoreValue<T>(key: string, select: () => T): T {
  const subscribe = React.useCallback(
    (onChange: () => void) => subscribeStore(key, onChange),
    [key],
  );
  return React.useSyncExternalStore(subscribe, select, select);
}

/* ------------------------------------------------------------------ */

export function useFavorites() {
  const favorites = useStoreValue(STORAGE_KEYS.favorites, getFavorites);

  const isFavorite = React.useCallback(
    (toolId: string) => favorites.some((entry) => entry.toolId === toolId),
    [favorites],
  );

  const toggle = React.useCallback((toolId: string, name?: string) => {
    const nowFavorite = toggleInStore(toolId);
    if (nowFavorite) {
      toast.success("Added to favourites", name ? `${name} is in your favourites.` : undefined);
    } else {
      toast.info("Removed from favourites", name ? `${name} was removed.` : undefined);
    }
    return nowFavorite;
  }, []);

  const remove = React.useCallback((toolId: string) => {
    setFavorites(getFavorites().filter((entry) => entry.toolId !== toolId));
  }, []);

  const clear = React.useCallback(() => setFavorites(EMPTY_FAVORITES), []);

  return {
    favorites,
    ids: React.useMemo(() => favorites.map((entry) => entry.toolId), [favorites]),
    isFavorite,
    toggle,
    remove,
    clear,
    count: favorites.length,
  };
}

export function useRecent() {
  const recent = useStoreValue(STORAGE_KEYS.recent, getRecent);
  const [sample, setSample] = React.useState(0);

  // Recompute the sample size whenever the list changes.
  React.useEffect(() => setSample(usageSampleSize()), [recent]);

  return {
    recent,
    count: recent.length,
    clear: clearRecent,
    /** Enough real local data to rank tools by. */
    hasSignal: sample >= 2,
  };
}

export function useHistory() {
  const history = useStoreValue(STORAGE_KEYS.history, getHistory);
  return {
    history,
    count: history.length,
    remove: removeHistory,
    clear: clearHistory,
  };
}

export function useLocalStats() {
  return useStoreValue(STORAGE_KEYS.usage, getLocalStats);
}

export { clearAll };
export type { FavoriteEntry, HistoryEntry, LocalStats, RecentEntry };
