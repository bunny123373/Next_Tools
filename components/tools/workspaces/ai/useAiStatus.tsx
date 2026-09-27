"use client";

/**
 * The setup gate every AI workspace renders first.
 *
 * The workspaces must not show a form that pretends to work. So on mount they
 * ask `GET /api/ai/status` once, and:
 *
 *  - `checking`    → a neutral "checking…" panel, never a form;
 *  - `ready`       → the real interface;
 *  - `unavailable` → `<SetupRequired tool={tool} />`, so the page explains which
 *                    environment variables are missing instead of failing at the
 *                    click.
 *
 * A fetch failure lands in `unavailable` with a network-flavoured reason, which
 * is the honest state: we genuinely do not know whether a provider is set up.
 */

import * as React from "react";
import { Loader2, PlugZap } from "lucide-react";
import { fetchAiStatus, type AiAvailability } from "./ai-client";
import { SetupRequired } from "@/components/tools/ToolShell";
import type { Tool } from "@/lib/tools/types";

/** Runs the status probe once per mount. */
export function useAiStatus(): AiAvailability {
  const [state, setState] = React.useState<AiAvailability>({ state: "checking" });

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetchAiStatus(controller.signal).then((result) => {
      if (active) setState(result);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return state;
}

/** The neutral panel shown while the probe is in flight. */
export function AiCheckingState() {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3 text-[13px] text-[var(--text-muted)]"
      aria-live="polite"
    >
      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      Checking whether an AI provider is configured…
    </div>
  );
}

/**
 * The setup panel, with a reason line when the probe failed for a reason other
 * than "not configured" (offline, a server down, a proxy in the way).
 */
export function AiSetupState({ tool, reason }: { tool: Tool; reason?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {reason ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--text-muted)]"
        >
          <PlugZap aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{reason}</span>
        </div>
      ) : null}
      <SetupRequired tool={tool} />
    </div>
  );
}
