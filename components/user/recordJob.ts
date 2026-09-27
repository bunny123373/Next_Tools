"use client";

import { addHistory, type HistoryEntry } from "@/lib/user/store";
import type { ProcessingMode, Tool } from "@/lib/tools/types";

/**
 * Records a completed (or failed) job to the local processing history.
 *
 * Privacy: only metadata is stored — the tool id, file *name*, counts and byte
 * sizes. File contents and any text the visitor typed are never persisted, and
 * nothing is uploaded. This is the "browser tools store metadata only" rule
 * from the product spec, enforced in one place.
 */
export function recordJob(
  tool: Pick<Tool, "id" | "category" | "processing">,
  input: {
    status: HistoryEntry["status"];
    fileName?: string;
    fileCount?: number;
    inputBytes?: number;
    outputBytes?: number;
    outputName?: string;
    errorMessage?: string;
  },
): void {
  if (typeof window === "undefined") return;
  try {
    addHistory({
      toolId: tool.id,
      category: tool.category,
      processing: tool.processing as ProcessingMode,
      fileName: input.fileName,
      fileCount: input.fileCount ?? 1,
      inputBytes: input.inputBytes,
      outputBytes: input.outputBytes,
      outputName: input.outputName,
      status: input.status,
      errorMessage: input.errorMessage,
    });
  } catch {
    // A full quota must never break the tool that just succeeded.
  }
}
