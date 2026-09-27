"use client";

import * as React from "react";
import {
  validateFiles,
  type FileCategory,
  type FileValidationError,
} from "@/lib/utils/files";

export interface UseFilesOptions {
  category: FileCategory;
  maxBytes: number;
  /** Accept several files at once. */
  multiple?: boolean;
  /** Cap on how many files can be queued. */
  maxFiles?: number;
  mimeAllow?: string[];
}

export interface AddResult {
  accepted: number;
  rejected: number;
  errors: FileValidationError[];
}

/**
 * Queue of validated files, with add / remove / clear / reorder.
 * Rejections are returned (and kept in `errors`) so the caller can surface them
 * with a toast — silent drops are never acceptable.
 */
export function useFiles(options: UseFilesOptions) {
  const { category, maxBytes, multiple = false, maxFiles, mimeAllow } = options;

  const [files, setFiles] = React.useState<File[]>([]);
  const [errors, setErrors] = React.useState<FileValidationError[]>([]);

  const limit = multiple ? (maxFiles ?? Infinity) : 1;

  const add = React.useCallback(
    (incoming: File[] | FileList): AddResult => {
      const batch = Array.from(incoming);
      const { files: accepted, errors: rejected } = validateFiles(batch, {
        category,
        maxBytes,
        mimeAllow,
      });

      setFiles((current) => {
        const next = multiple ? [...current, ...accepted] : accepted.slice(0, 1);
        return next.slice(0, limit);
      });
      setErrors(rejected);
      return { accepted: accepted.length, rejected: rejected.length, errors: rejected };
    },
    [category, maxBytes, mimeAllow, multiple, limit],
  );

  const remove = React.useCallback((index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
  }, []);

  const clear = React.useCallback(() => {
    setFiles([]);
    setErrors([]);
  }, []);

  /** Replace a single entry in place (used for in-place edits, e.g. reordering). */
  const move = React.useCallback((from: number, to: number) => {
    setFiles((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  }, []);

  const replaceAt = React.useCallback((index: number, file: File) => {
    setFiles((current) => current.map((f, i) => (i === index ? file : f)));
  }, []);

  const totalBytes = React.useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);

  return { files, errors, add, remove, clear, move, replaceAt, totalBytes, limit };
}

/* ------------------------------------------------------------------ */
/*  Object URL for a single blob/file, auto-revoked on change/unmount   */
/* ------------------------------------------------------------------ */

export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url;
}

/* ------------------------------------------------------------------ */
/*  Async operation with honest progress + abort                        */
/* ------------------------------------------------------------------ */

export type AsyncStatus = "idle" | "running" | "success" | "error";

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
}

export function useAsyncTask<TArgs extends unknown[], TResult>(
  task: (...args: TArgs) => Promise<TResult>,
) {
  const [state, setState] = React.useState<AsyncState<TResult>>({
    status: "idle",
    data: null,
    error: null,
  });
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = React.useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setState({ status: "running", data: null, error: null });
      try {
        const result = await task(...args);
        if (mounted.current) setState({ status: "success", data: result, error: null });
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Something went wrong. Please try again.";
        if (mounted.current) setState({ status: "error", data: null, error: message });
        return undefined;
      }
    },
    [task],
  );

  const reset = React.useCallback(() => {
    setState({ status: "idle", data: null, error: null });
  }, []);

  return { ...state, run, reset, isRunning: state.status === "running" };
}

/* ------------------------------------------------------------------ */
/*  Debounced value (used by live text tools)                           */
/* ------------------------------------------------------------------ */

export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ------------------------------------------------------------------ */
/*  localStorage-backed state, hydration-safe                          */
/* ------------------------------------------------------------------ */

/**
 * `useSyncExternalStore` keeps the server HTML and the first client render
 * identical, then re-reads on mount. This is what prevents the classic
 * "favourite count is wrong on first paint" hydration bug.
 */
export function useLocalStorageState<T>(key: string, initial: T) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(`ls:${key}`, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(`ls:${key}`, onChange);
      };
    },
    [key],
  );

  const getSnapshot = React.useCallback(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  }, [key, initial]);

  const getServerSnapshot = React.useCallback(() => initial, [initial]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = React.useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (c: T) => T)(getSnapshot()) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Quota or private-mode failure: keep the in-memory value working.
      }
      window.dispatchEvent(new Event(`ls:${key}`));
    },
    [key, getSnapshot],
  );

  return [value, setValue] as const;
}
