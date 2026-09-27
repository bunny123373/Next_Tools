"use client";

import * as React from "react";

/**
 * Registers the service worker for the offline *shell* only.
 *
 * What this does and does not do, stated plainly:
 *  - It precaches the app shell (HTML/CSS/JS) so the site opens offline and
 *    navigation between visited pages works.
 *  - It does NOT make tools work offline. Tools that need a server or an AI
 *    provider will fail offline, and each of those tools says so in its own UI.
 *
 * No tool UI ever claims offline capability.
 */
export function ServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Offline support is a progressive enhancement; a failure is silent by design.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
