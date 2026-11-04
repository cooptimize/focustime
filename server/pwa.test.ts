// P1: the service worker caches the app shell only. Its real source (server/sw.js, as server/pwa.ts serves it) runs in
// a sandbox with fake caches, fetch and events: no /api or /auth response is ever answered from or put in a cache, the
// cache is named by the build's sha and a new build drops the old one, a page load offline gets the cached shell, and
// sign-out's message clears every FocusTime cache.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { serviceWorkerSource, shellPaths } from "./pwa.ts";

const ORIGIN = "https://focustime.example";
const SHELL = ["/", "/assets/main-abc.js", "/assets/main-abc.css", "/icons/focustime-192.png", "/manifest.webmanifest"];

/** The worker in a sandbox: its listeners, a fake Cache Storage (with every put recorded) and a fake network. */
function worker(sha = "abc1234def", online = true) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, Map<string, string>>([["focustime-shell-0000000", new Map()], ["someone-elses", new Map()]]);
  const puts: string[] = [];
  const network: string[] = [];
  const respond = (body: string) => ({ body, ok: true });
  const fetch = async (r: { url: string } | string) => {
    const url = typeof r === "string" ? r : r.url;
    network.push(url);
    if (!online) throw new TypeError("offline");
    return respond(`network:${new URL(url, ORIGIN).pathname}`);
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const c = stores.get(name)!;
      return {
        addAll: async (reqs: { url: string }[]) => {
          for (const r of reqs) {
            const path = new URL(r.url, ORIGIN).pathname;
            puts.push(path);
            c.set(path, `cached:${path}`);
          }
        },
        put: async (r: { url: string }) => void puts.push(new URL(r.url, ORIGIN).pathname),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (url: string, o?: { cacheName?: string }) => {
      const hit = stores.get(o?.cacheName ?? "")?.get(new URL(url, ORIGIN).pathname);
      return hit === undefined ? undefined : respond(hit);
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: { showNotification: async () => {} },
  };
  class Request {
    url: string;
    constructor(u: string) {
      this.url = new URL(u, ORIGIN).toString();
    }
  }
  runInNewContext(serviceWorkerSource(sha, SHELL), { self, caches, fetch, Request, URL, Response: { error: () => ({ body: "error", ok: false }) }, Promise, Set, JSON });
  /** Fires an event and waits for what it handed to waitUntil or respondWith. */
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const got: { waited?: Promise<unknown>; answer?: Promise<{ body: string }> } = {};
    listeners[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => void (got.waited = p), respondWith: (p: Promise<{ body: string }>) => void (got.answer = p) });
    await got.waited;
    return got.answer ? (await got.answer).body : null;
  };
  const get = (path: string, mode = "cors") => fire("fetch", { request: { url: new URL(path, ORIGIN).toString(), method: "GET", mode } });
  return { fire, get, stores, puts, network, setOnline: (on: boolean) => void (online = on) };
}

describe("the service worker (P1)", () => {
  it("names its cache by the build's sha and caches exactly the shell", async () => {
    const w = worker();
    await w.fire("install");
    expect([...w.stores.keys()]).toContain("focustime-shell-abc1234");
    expect(w.puts.sort()).toEqual([...SHELL].sort());
  });

  it("never answers /api or /auth from a cache and never caches a response", async () => {
    const w = worker();
    await w.fire("install");
    const before = w.puts.length;
    for (const path of ["/api/action", "/api/open-request", "/auth/microsoft/login", "/version", "/photo/x.jpg", "/assets/not-in-the-shell.js"]) {
      expect(await w.get(path), path).toBeNull(); // not intercepted: the browser fetches it as usual
    }
    // Even a POST or another origin is left alone.
    expect(await w.fire("fetch", { request: { url: `${ORIGIN}/api/action`, method: "POST", mode: "cors" } })).toBeNull();
    expect(await w.get("https://login.microsoftonline.com/x")).toBeNull();
    // A page load under /auth/ goes to the network untouched too (sign-in redirects).
    expect(await w.get("/auth/microsoft/callback?code=x", "navigate")).toBeNull();
    // Shell files come from the cache; the fetch handler never puts anything.
    expect(await w.get("/assets/main-abc.js")).toBe("cached:/assets/main-abc.js");
    expect(w.puts.length).toBe(before);
  });

  it("loads the page from the network, and the cached shell only when offline", async () => {
    const w = worker();
    await w.fire("install");
    expect(await w.get("/?route=today", "navigate")).toBe("network:/");
    w.setOnline(false);
    expect(await w.get("/#/today", "navigate")).toBe("cached:/");
  });

  it("a new build drops the old shell cache (not other caches); sign-out clears every FocusTime cache", async () => {
    const w = worker();
    await w.fire("install");
    await w.fire("activate");
    expect([...w.stores.keys()].sort()).toEqual(["focustime-shell-abc1234", "someone-elses"]);
    await w.fire("message", { data: { type: "clear-caches" } });
    expect([...w.stores.keys()]).toEqual(["someone-elses"]);
  });
});

describe("the shell list", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  it("is every built file, with index.html as /, and a local build's cache name follows its files", () => {
    const d = mkdtempSync(join(tmpdir(), "focustime-dist-"));
    dirs.push(d);
    mkdirSync(join(d, "assets"));
    mkdirSync(join(d, "icons"));
    for (const f of ["index.html", "assets/main-1.js", "assets/main-1.js.map", "icons/focustime-192.png", "manifest.webmanifest"]) writeFileSync(join(d, f), "x");
    expect(shellPaths(d)).toEqual(["/", "/assets/main-1.js", "/icons/focustime-192.png", "/manifest.webmanifest"]);
    const a = serviceWorkerSource("unknown", ["/", "/assets/main-1.js"]);
    const b = serviceWorkerSource("unknown", ["/", "/assets/main-2.js"]);
    const name = (s: string) => /const VERSION = "([^"]+)"/.exec(s)![1];
    expect(name(a)).toMatch(/^local-/);
    expect(name(a)).not.toBe(name(b));
    expect(name(serviceWorkerSource("abc1234def", []))).toBe("abc1234");
  });
});
