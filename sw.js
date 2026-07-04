// App-shell cache: network-first with cache fallback, so deploys reach the device on the
// next load while the app still opens offline. Data (GitHub API, Anthropic API, data/*.json)
// is never cached here.
const CACHE_NAME = "ai-trainer-shell-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// The page tells a waiting worker to activate immediately after a new version installs.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin GET requests for the app shell; let everything else
  // (GitHub API, Anthropic API) go straight to the network. Never cache data/.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/data/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
