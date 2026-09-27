"use client";

import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/components/layout/theme-provider";

/**
 * Global toast host. Mounted once in the root layout.
 * Styling follows the same token set as the rest of the UI so light mode works.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme}
      position="bottom-right"
      // Clear of the iOS home indicator. The layout sets `viewport-fit=cover`,
      // so a flat offset would put the bottom toast half under the gesture
      // bar. `calc` keeps the normal gap where there is no inset.
      offset="max(16px, var(--safe-bottom))"
      gap={10}
      duration={4200}
      visibleToasts={4}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border !border-[var(--surface-line)] !bg-[var(--surface-card)] !text-[var(--text-ink)] !shadow-2xl !font-sans",
          title: "!text-[13px] !font-medium",
          description: "!text-xs !text-[var(--text-muted)]",
          closeButton: "!bg-[var(--surface-card-2)] !border-[var(--surface-line)] !text-[var(--text-muted)]",
          success: "!border-emerald-500/40",
          error: "!border-brand-500/50",
          warning: "!border-amber-500/40",
        },
      }}
    />
  );
}
