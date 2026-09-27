"use client";

import { toast as sonnerToast } from "sonner";
import { formatBytes, percentSaved } from "@/lib/utils/format";
import { downloadBlob } from "@/lib/utils/files";

/**
 * Thin, typed wrapper over sonner so every tool toasts the same way and we
 * never sprinkle raw sonner imports across tool workspaces.
 */
export const toast = {
  success(message: string, description?: string) {
    return sonnerToast.success(message, { description });
  },
  error(message: string, description?: string) {
    return sonnerToast.error(message, { description });
  },
  warning(message: string, description?: string) {
    return sonnerToast.warning(message, { description });
  },
  info(message: string, description?: string) {
    return sonnerToast.info(message, { description });
  },

  /** "Copied" feedback, shown on every copy action in the product. */
  copied(what = "Copied to clipboard") {
    return sonnerToast.success(what, { description: undefined });
  },

  /** Fires immediately before a download starts, so the click feels connected. */
  downloadReady(filename: string, sizeBytes?: number) {
    return sonnerToast.success("Download ready", {
      description: sizeBytes ? `${filename} · ${formatBytes(sizeBytes)}` : filename,
      duration: 5000,
    });
  },

  processingComplete(message = "Processing complete", description?: string) {
    return sonnerToast.success(message, { description, duration: 5000 });
  },

  /** Fired when a new file lands in a dropzone. */
  fileAdded(count: number, name?: string) {
    return sonnerToast.success(
      count === 1 ? `${name ?? "File"} added` : `${count} files added`,
      { description: undefined },
    );
  },

  /** Surfaces file-validation rejections. */
  rejected(message: string) {
    return sonnerToast.error("File rejected", { description: message, duration: 6000 });
  },

  /** Copy-then-toast helper used by every text tool. */
  async copy(text: string, what = "Copied to clipboard") {
    try {
      await navigator.clipboard.writeText(text);
      toast.copied(what);
      return true;
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access.");
      return false;
    }
  },

  /** Download-then-toast helper used by every file tool. */
  download(blob: Blob, filename: string) {
    downloadBlob(blob, filename);
    toast.downloadReady(filename, blob.size);
  },

  /** "Saved 42.8%" style summary for compression tools. */
  saved(before: number, after: number) {
    return sonnerToast.success("Compressed", {
      description: `${formatBytes(before)} → ${formatBytes(after)} (${percentSaved(before, after).toFixed(1)}% smaller)`,
      duration: 5000,
    });
  },
};
