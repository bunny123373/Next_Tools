/* eslint-disable no-restricted-globals */
/**
 * Balu Tools service worker — OFFLINE SHELL ONLY.
 *
 * Honest scope, stated up front:
 *   ✔ Works offline: the app shell (HTML/CSS/JS/fonts/icons) and any tool page
 *     you have already visited, so you can browse and open tools with no network.
 *   ✘ Does NOT work offline: anything that needs a server or an AI provider.
 *     Those tools detect the failure and tell you. We never claim they work.
 *
 * Strategy:
 *   - Navigations: network-first with a cache fallback, so a fresh deploy is
 *     picked up immediately but the site still opens on a dead connection.
 *   - Static build assets (`/_next/static/...`): cache-first, they are
 *     content-hashed and therefore immutable.
 *   - Everything else (API calls, AI routes, uploads): NEVER cached. We do not
 *     want a stale or private API response sitting in a cache.
 */

const VERSION = "balu-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const PAGE_CACHE = `${VERSION}-pages`;

const SHELL_URLS = ["/", "/tools", "/offline", "/manifest.webmanifest"];

/** Same-origin requests we must never intercept or cache. */
function isExcluded(url) {
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/admin")) return true;
  // Never cache a user's own data pages.
  return ["/dashboard", "/favorites", "/recent"].includes(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one 404 cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("balu-") && ![SHELL_CACHE, ASSET_CACHE, PAGE_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  // The dashboard's "clear local data" action asks us to drop the caches.
  // localStorage is owned by the UI; we only clear what we control.
  if (event.data === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET is cacheable. POST/PUT/DELETE must always hit the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isExcluded(url)) return;

  // Content-hashed Next.js build output: safe to serve from cache forever.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match("/");
          if (shell) return shell;
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
              "<body style='background:#050505;color:#fff;font-family:system-ui;padding:3rem'>" +
              "<h1>You are offline</h1>" +
              "<p style='color:#8a8a8a'>The Balu Tools shell is not cached yet. Reconnect once and it will work offline from then on.</p>",
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
  }
});
