"use client";

import * as React from "react";
import { recordToolOpen, recordUsage } from "@/lib/user/store";

/**
 * Mounted on every tool page. Records the open in the recents rail and bumps
 * the local usage counter that "Trending" is ranked from.
 *
 * Rendered with `null` and no side effects beyond the two counters, both of
 * which are localStorage-only unless an analytics endpoint is configured.
 */
export function TrackToolView({ toolId }: { toolId: string }) {
  React.useEffect(() => {
    recordToolOpen(toolId);
    recordUsage(toolId);
  }, [toolId]);
  return null;
}
