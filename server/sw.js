// @ts-nocheck: a worker script served as written (no build step); server/pwa.test.ts runs it against fake events.
// P1: FocusTime's service worker (served at /sw.js by server/pwa.ts, which fills in the build and the shell list).
// It caches the app shell only: the page, its scripts, styles, fonts, icons and the manifest, as built. Never an API
// response, a sign-in, a photo or anything else with a session or a person's data: only the exact shell paths are
// answered from the cache, and every other request goes to the network untouched. One cache per build
// ("focustime-shell-<sha>"); a new build's worker deletes the old one. Offline, a page load gets the last shell, which
// says it's offline. Push shows what the server sent (generic unless the person turned details on); a tap opens
// FocusTime on that view. No tokens, cookies or user data are kept here.
/* global self, caches, clients */
const VERSION = "__FOCUSTIME_VERSION__";
const SHELL = __FOCUSTIME_SHELL__;
const PREFIX = "focustime-shell-";
const CACHE = PREFIX + VERSION;
const SHELL_SET = new Set(SHELL);
/** Paths that are never the shell, whatever the list says. */
const NEVER = /^\/(api|auth)\//;

/** What the worker does with a GET for this URL: "shell" (from the cache), "page" (network, else the cached shell) or "pass". */
function routeOf(url, mode, origin) {
  if (url.origin !== origin || NEVER.test(url.pathname)) return "pass";
  if (mode === "navigate") return "page";
  return SHELL_SET.has(url.pathname) ? "shell" : "pass";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: "reload", credentials: "omit" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const route = routeOf(new URL(req.url), req.mode, self.location.origin);
  if (route === "pass") return;
  if (route === "shell") {
    event.respondWith(caches.match(req.url, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  // A page load: always the network (sign-in redirects and fresh builds), the cached shell only when it fails.
  event.respondWith(fetch(req).catch(() => caches.match("/", { cacheName: CACHE }).then((hit) => hit || Response.error())));
});

// Sign-out (and "Clear"): the page asks, every FocusTime cache goes.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-caches") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((k) => caches.delete(k)))));
  }
});

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch (e) {
    p = {};
  }
  const title = typeof p.title === "string" && p.title ? p.title : "FocusTime";
  // A push always shows a notification (browsers require it), with the app's icon.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof p.body === "string" ? p.body : "",
      tag: typeof p.tag === "string" ? p.tag : "focustime",
      icon: "/icons/focustime-192.png",
      badge: "/icons/focustime-192.png",
      data: { route: typeof p.route === "string" ? p.route : "today" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || "today";
  const target = "/?route=" + encodeURIComponent(route);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        open.postMessage({ type: "open-route", route });
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

