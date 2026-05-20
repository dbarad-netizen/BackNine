/* BackNine service worker — installability + a light offline shell.
 *
 * Deliberately conservative for a data-driven app:
 *   • Cross-origin requests (the API on Render, Google fonts) are NOT touched.
 *   • Page navigations are network-first, so online users always get fresh data;
 *     offline falls back to a cached page or the offline screen.
 *   • Static assets (/_next/*, images, fonts) are stale-while-revalidate — they're
 *     content-hashed by Next so this is safe.
 * Bump CACHE to invalidate on a breaking change.
 */
const CACHE = "backnine-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Let cross-origin (API, fonts, etc.) pass straight through — never cache data.
  if (url.origin !== self.location.origin) return;

  // Page loads: always try the network first; fall back to cache/offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((r) => r || caches.match(OFFLINE_URL))
      )
    );
    return;
  }

  // Static assets: serve cached immediately, refresh in the background.
  const isStatic =
    url.pathname.startsWith("/_next/") ||
    /\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|ttf|css|js)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
