"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import {
  PROCESSING_STAGE_LABEL,
  StagedProgress,
  StageSteps,
  type ProcessingStage,
} from "@/components/ui/progress";

export type { ProcessingStage };
export { PROCESSING_STAGE_LABEL };

export interface ProgressBarProps {
  stage: ProcessingStage;
  /** 0–100. Pass `null`/omit when the real ratio is unknown — we then render an
   *  indeterminate bar rather than inventing a number. */
  percent?: number | null;
  /** Batch detail, e.g. "3 / 10 files completed". */
  detail?: React.ReactNode;
  /** Current item being worked on. */
  caption?: React.ReactNode;
  /** Show the full stage sequence above the bar. */
  showSteps?: boolean;
  className?: string;
}

/** Every tool's progress UI. One component, so progress looks the same everywhere. */
export function ProgressBar({
  stage,
  percent,
  detail,
  caption,
  showSteps = true,
  className,
}: ProgressBarProps) {
  return (
    <div className={cn("w-full", className)}>
      {showSteps ? <StageSteps stage={stage} className="mb-3" /> : null}
      <StagedProgress stage={stage} percent={percent} detail={detail} caption={caption} />
    </div>
  );
}

/** Convenience wrapper for "N of M" batch counters. */
export function batchDetail(done: number, total: number): string {
  return `${done} / ${total} ${total === 1 ? "file" : "files"} completed`;
}
