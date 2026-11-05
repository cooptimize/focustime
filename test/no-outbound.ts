// DM-1: a test that something sends nothing out of FocusTime. `noOutbound()` replaces the process's ways out (fetch,
// node:http and node:https requests, raw sockets) with ones that record the attempt and fail, so the code under test
// sees a network error and the test sees what was tried. Use it in any write test:
//
//   const net = useNoOutbound();            // in a describe: installed before each test, removed after
//   ...
//   net.expectNone();                        // nothing tried to leave
//
// or by hand: `const net = noOutbound(); try { ... } finally { net.restore(); }`. A test that runs a server of its
// own on localhost passes `allowLocal: true` (loopback connections are then let through and not counted).
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { afterEach, beforeEach, expect } from "vitest";

export type Outbound = { via: "fetch" | "http" | "https" | "socket"; target: string };
export type NoOutbound = { tried: Outbound[]; expectNone: () => void; restore: () => void };

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i;

export function noOutbound(o: { allowLocal?: boolean } = {}): NoOutbound {
  const tried: Outbound[] = [];
  const saved = { fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get, connect: net.connect, createConnection: net.createConnection };
  const local = (host: string | undefined) => !!o.allowLocal && LOCAL.test(host ?? "");
  const hostOf = (a: unknown): string | undefined => {
    if (typeof a === "string") return safeUrl(a)?.hostname;
    if (a instanceof URL) return a.hostname;
    const x = a as { host?: string; hostname?: string } | undefined;
    return x?.hostname ?? x?.host ?? undefined;
  };
  const refuse = (via: Outbound["via"], target: string) => {
    tried.push({ via, target });
    return new Error(`Outbound ${via} to ${target} in a no-outbound test`);
  };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (local(safeUrl(url)?.hostname)) return saved.fetch(input, init);
    throw new TypeError(refuse("fetch", url.split("?")[0]!).message);
  }) as typeof fetch;
  const wrap = (via: "http" | "https", orig: typeof http.request) =>
    ((...args: unknown[]) => {
      if (local(hostOf(args[0]))) return (orig as (...a: unknown[]) => unknown)(...args);
      throw refuse(via, String(hostOf(args[0]) ?? "unknown"));
    }) as typeof http.request;
  http.request = wrap("http", saved.httpRequest);
  http.get = wrap("http", saved.httpGet as typeof http.request) as typeof http.get;
  https.request = wrap("https", saved.httpsRequest);
  https.get = wrap("https", saved.httpsGet as typeof http.request) as typeof https.get;
  const sock = (orig: typeof net.connect) =>
    ((...args: unknown[]) => {
      const a = args[0];
      const host = typeof a === "number" ? (typeof args[1] === "string" ? args[1] : "localhost") : hostOf(a);
      if (local(host) || (typeof a === "object" && a && "path" in a)) return (orig as (...x: unknown[]) => unknown)(...args);
      throw refuse("socket", String(host ?? "unknown"));
    }) as typeof net.connect;
  net.connect = sock(saved.connect);
  net.createConnection = sock(saved.createConnection);

  return {
    tried,
    expectNone: () => expect(tried, "something tried to leave FocusTime").toEqual([]),
    restore: () => {
      globalThis.fetch = saved.fetch;
      http.request = saved.httpRequest;
      http.get = saved.httpGet;
      https.request = saved.httpsRequest;
      https.get = saved.httpsGet;
      net.connect = saved.connect;
      net.createConnection = saved.createConnection;
    },
  };
}

/** In a describe: no outbound before each test, put back after; `expectNone()` is also checked after each test. */
export function useNoOutbound(o: { allowLocal?: boolean } = {}): NoOutbound {
  let cur: NoOutbound | null = null;
  const handle: NoOutbound = {
    get tried() {
      return cur?.tried ?? [];
    },
    expectNone: () => cur?.expectNone(),
    restore: () => cur?.restore(),
  };
  beforeEach(() => {
    cur = noOutbound(o);
  });
  afterEach(() => {
    const c = cur;
    cur = null;
    c?.restore();
    c?.expectNone();
  });
  return handle;
}

function safeUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}
