"use client";

import * as React from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * Visitors see a plain apology and a retry button. The real error is logged to
 * the console for the operator — a stack trace is never rendered into the page,
 * because it routinely leaks file paths, library versions and internal hostnames.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] uncaught error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-500"
      >
        <TriangleAlert className="size-5" />
      </span>

      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-[var(--text-ink)]">
        Something went wrong
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
        This page hit an unexpected error. Trying again usually fixes it. If it keeps happening, let
        us know and include the reference below.
      </p>

      {error.digest ? (
        <p className="mt-4 font-mono text-[12px] text-[var(--text-muted)]">
          Reference: <span className="text-[var(--text-ink)]">{error.digest}</span>
        </p>
      ) : null}

      <div className="mt-7 flex flex-col items-stretch gap-2 sm:flex-row">
        <Button variant="primary" onClick={reset}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
        <Button variant="secondary" href="/">
          Go home
        </Button>
      </div>
    </div>
  );
}
