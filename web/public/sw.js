// SeaSensei service worker. Three rules, chosen so a deploy can never wedge the app (CLAUDE.md, 2026-09-29):
//  1. /assets/* and /maplibre/* are content-hashed or versioned, and served immutable: cache-first. Only real,
//     same-origin, non-HTML 200s are stored, so HTML can never be served for a .js URL.
//  2. Loads of the app's own pages (no file extension, not /api/): the network first, but after 3 s the cached app
//     shell; offline, the shell. Any other page load (/feed.xml, an /api/ URL opened in a tab) just goes to the network,
//     so a slow one is never answered with the app.
//  3. Everything else (the API, weather and tiles, icons) is left alone: straight to the network.
// It also shows the morning briefing (Web Push, server/briefing.mjs) and opens the app where a tap on it points.
const SHELL = "seasensei-shell-v4";
const ASSETS = "seasensei-assets-v4";
const KEEP = [SHELL, ASSETS];
const NAV_TIMEOUT = 3000;
const MAX_ASSETS = 120; // a few deploys' worth; older hashed files are dropped first

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => fetch("/", { cache: "reload" }).then((r) => (shellable(r) ? c.put("/", r) : undefined)))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/maplibre/")) {
    e.respondWith(cacheFirst(e));
  } else if (req.mode === "navigate" && isAppRoute(url)) {
    const net = fetch(req);
    // Refresh the shell from every good page load (clone before the page starts reading the body).
    e.waitUntil(net.then((r) => {
      if (!shellable(r)) return;
      const copy = r.clone();
      return caches.open(SHELL).then((c) => c.put("/", copy));
    }).catch(() => {}));
    e.respondWith(navigate(net));
  }
});

/** A page of the app itself ("/", "/?spot=…"): not a file (no extension in the last segment), not the API. */
const isAppRoute = (url) => !url.pathname.startsWith("/api/") && !/\.[a-z0-9]+$/i.test(url.pathname.split("/").pop() || "");
const isHtml = (r) => (r.headers.get("content-type") || "").includes("text/html");
/** A response we may keep for a hashed asset: a plain 200 from us, and never an HTML page. */
const storable = (r) => r.status === 200 && r.type === "basic" && !isHtml(r);
/** A response we may keep as the app shell: the real index page, not a redirect or an error. */
const shellable = (r) => r.status === 200 && r.type === "basic" && !r.redirected && isHtml(r);

async function cacheFirst(e) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(e.request);
  if (hit) return hit;
  const r = await fetch(e.request);
  if (storable(r)) {
    const copy = r.clone();
    e.waitUntil(cache.put(e.request, copy).then(() => trim(cache)).catch(() => {}));
  }
  return r;
}

async function trim(cache) {
  const keys = await cache.keys(); // insertion order: oldest first
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
}

async function navigate(net) {
  const cache = await caches.open(SHELL);
  const late = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT, null));
  try {
    const first = await Promise.race([net, late]);
    if (first && first.status < 500) return first;
    // Slow (or a 5xx mid-deploy): the cached shell now, since the app fetches its own data; without one, the network.
    return (await cache.match("/")) || first || (await net);
  } catch {
    return (await cache.match("/")) || Response.error();
  }
}

/* ---------- The morning briefing ---------- */

self.addEventListener("push", (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { body: e.data ? e.data.text() : "" }; }
  const url = typeof msg.url === "string" && msg.url.startsWith("/") ? msg.url : "/";
  e.waitUntil(self.registration.showNotification(msg.title || "SeaSensei", {
    body: msg.body || "", icon: "/icon-192.png", badge: "/icon-192.png",
    tag: msg.tag || "morning-briefing", renotify: false, data: { url },
  }));
});

// Focus an open SeaSensei tab and take it to the spot (or the board); with none open, open one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", location.origin).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === location.origin);
    if (tab) {
      await tab.focus().catch(() => {});
      try { return await tab.navigate(url); } catch { return self.clients.openWindow(url); } // navigate needs a tab this worker controls
    }
    return self.clients.openWindow(url);
  })());
});
