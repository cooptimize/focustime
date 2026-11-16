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
function worker(sha = "abc1234def", online: boolean | "hang" = true, /** PF-1: another build's files, and the browser's Cache Storage shared with an earlier worker. */ shell: readonly string[] = SHELL, shared?: Map<string, Map<string, string>>, /** A file the install can't fetch. */ missing: string | null = null) {
  const timers: (() => void)[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const stores = shared ?? new Map<string, Map<string, string>>([["focustime-shell-0000000", new Map()], ["someone-elses", new Map()]]);
  const puts: string[] = [];
  const network: string[] = [];
  const respond = (body: string) => ({ body, ok: true });
  const fetch = async (r: { url: string } | string) => {
    const url = typeof r === "string" ? r : r.url;
    network.push(url);
    if (online === "hang") return new Promise<never>(() => {});
    if (!online) throw new TypeError("offline");
    return respond(`network:${new URL(url, ORIGIN).pathname}`);
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const c = stores.get(name)!;
      return {
        addAll: async (reqs: { url: string }[]) => {
          // All or nothing, as the browser's addAll is.
          if (missing && reqs.some((r) => new URL(r.url, ORIGIN).pathname === missing)) throw new TypeError("Request failed");
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
  runInNewContext(serviceWorkerSource(sha, shell), { self, caches, fetch, Request, URL, Response: { error: () => ({ body: "error", ok: false }) }, Promise, Set, JSON, setTimeout: (fn: () => void) => void timers.push(fn) });
  /** Fires an event and waits for what it handed to waitUntil or respondWith. */
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const got: { waited?: Promise<unknown>; answer?: Promise<{ body: string }> } = {};
    listeners[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => void (got.waited = p), respondWith: (p: Promise<{ body: string }>) => void (got.answer = p) });
    await got.waited;
    return got.answer ? (await got.answer).body : null;
  };
  const get = (path: string, mode = "cors") => fire("fetch", { request: { url: new URL(path, ORIGIN).toString(), method: "GET", mode } });
  /** The worker's timers (its 3 s wait for a slow page load) fire now. */
  const elapse = () => timers.splice(0).forEach((f) => f());
  return { fire, get, stores, puts, network, elapse, setOnline: (on: boolean | "hang") => void (online = on) };
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

  it("a server that hasn't answered in 3 seconds (waking up) gets the cached shell, not a white page", async () => {
    const w = worker();
    await w.fire("install");
    w.setOnline("hang");
    const answer = w.get("/", "navigate"); // the network never answers
    w.elapse(); // 3 seconds pass
    expect(await answer).toBe("cached:/");
  });

  it("a page that answers in time comes from the network, even after the wait", async () => {
    const w = worker();
    await w.fire("install");
    const answer = w.get("/", "navigate");
    expect(await answer).toBe("network:/");
    w.elapse();
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

describe("the service worker across a release, with the app split by screen (PF-1)", () => {
  const OLD = ["/", "/assets/main-old.js", "/assets/Ahead-old.js", "/assets/Status-same.js", "/assets/shared-old.js", "/assets/main-old.css"];
  const NEW = ["/", "/assets/main-new.js", "/assets/Ahead-new.js", "/assets/Status-same.js", "/assets/shared-new.js", "/assets/main-new.css"];

  it("keeps every split file of its build, and after a release answers only from the new build's cache", async () => {
    const stores = new Map<string, Map<string, string>>();
    const old = worker("1111111aaa", true, OLD, stores);
    await old.fire("install");
    await old.fire("activate");
    expect([...stores.get("focustime-shell-1111111")!.keys()].sort()).toEqual([...OLD].sort());
    // A screen's file is answered from the cache: it opens offline, whether or not it was opened before.
    old.setOnline(false);
    expect(await old.get("/assets/Ahead-old.js")).toBe("cached:/assets/Ahead-old.js");

    // The release: the new build's worker installs (every file, or none) and takes over.
    const next = worker("2222222bbb", true, NEW, stores);
    await next.fire("install");
    await next.fire("activate");
    expect([...stores.keys()]).toEqual(["focustime-shell-2222222"]);
    expect([...stores.get("focustime-shell-2222222")!.keys()].sort()).toEqual([...NEW].sort());
    // A page still open from the old build asks for its own screen's file: not answered from any cache (the old one is
    // gone, the new build has no such file), so the browser asks the server, and the app reloads onto the release.
    expect(await next.get("/assets/Ahead-old.js")).toBeNull();
    expect(await next.get("/assets/shared-old.js")).toBeNull();
    // The new build's files, and a file whose name (so its content) is the same in both, come from the new cache.
    expect(await next.get("/assets/Ahead-new.js")).toBe("cached:/assets/Ahead-new.js");
    expect(await next.get("/assets/Status-same.js")).toBe("cached:/assets/Status-same.js");
  });

  it("a release whose files can't all be fetched changes nothing: the old build's cache stays whole and in charge", async () => {
    const stores = new Map<string, Map<string, string>>();
    const old = worker("1111111aaa", true, OLD, stores);
    await old.fire("install");
    await old.fire("activate");
    const next = worker("2222222bbb", true, NEW, stores, "/assets/Ahead-new.js");
    await expect(next.fire("install")).rejects.toThrow();
    // The new worker never activates; nothing of the new build is kept beside the old.
    expect([...(stores.get("focustime-shell-2222222")?.keys() ?? [])]).toEqual([]);
    expect([...stores.get("focustime-shell-1111111")!.keys()].sort()).toEqual([...OLD].sort());
    expect(await old.get("/assets/Ahead-old.js")).toBe("cached:/assets/Ahead-old.js");
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
