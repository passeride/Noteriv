// Noteriv service worker: keeps the app shell available so the installed app opens without a network.
//
// - Build assets (/_next/static, icons, the PDF.js files) never change under the same URL: cache first.
// - Pages: network first; offline, the last copy of that same page, otherwise offline.html. (A page of another
//   vault is not a stand-in: the HTML carries its route parameters.)
// - Never cached: the API (/api/*, which carries the user's data and auth), anything that is not a GET, other origins.
//   Notes, the file tree and edits made offline live in the app's own IndexedDB store (web/src/lib/offline-store.ts),
//   written by the app after a successful request — never cached API responses, which could hold a stale or 401 answer.
//
// Bump VERSION when the caching rules change; activate drops every cache of an older version.

const VERSION = "v1";
const STATIC_CACHE = `noteriv-static-${VERSION}`;
const PAGE_CACHE = `noteriv-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("noteriv-") && k !== STATIC_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /^\/pdf(\.worker)?\.min\.mjs$/.test(url.pathname);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function page(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    // Only plain successful pages are kept; redirects (e.g. to /login) and errors are not.
    if (response.ok && response.type === "basic" && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(page(request));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});

// The app asks for this on sign-out so no page of the account stays in the cache.
self.addEventListener("message", (event) => {
  if (event.data !== "clear-pages") return;
  event.waitUntil(
    caches.open(PAGE_CACHE).then(async (cache) => {
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname !== OFFLINE_URL) await cache.delete(request);
      }
    })
  );
});
