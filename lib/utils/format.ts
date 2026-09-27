/** Human-readable byte size. Uses binary units, matching OS file managers. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  const d = i === 0 ? 0 : decimals;
  return `${value.toFixed(d)} ${units[i]}`;
}

/** Bytes → megabytes, rounded, for limit copy. */
export function toMegabytes(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/** Fraction (0–1) removed → "42.8%" saved. */
export function percentSaved(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.max(0, Math.min(100, ((before - after) / before) * 100));
}

export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactFormatter.format(value);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en").format(value);
}

/** 3725 → "1:02:05", 125 → "2:05" */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Milliseconds → "4.2s" / "1m 12s" */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Timestamps are rendered in the visitor's locale. */
export function formatDateTime(input: number | string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(input: number | string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 1000],
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
    ["week", 604_800_000],
    ["month", 2_592_000_000],
    ["year", 31_536_000_000],
  ];

  for (let i = units.length - 1; i >= 0; i--) {
    const [unit, ms] = units[i];
    if (abs >= ms || unit === "second") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return "just now";
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** Clamp helper used by sliders and zoom controls. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
