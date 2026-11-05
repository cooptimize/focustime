// DM-1: the no-outbound helper catches every way out, and puts them back.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { noOutbound } from "./no-outbound.ts";

describe("noOutbound", () => {
  it("fails fetch, http(s) requests and sockets, records them, and restores them", async () => {
    const before = { fetch: globalThis.fetch, request: https.request, connect: net.connect };
    const n = noOutbound();
    await expect(fetch("https://dev.azure.com/contoso/_apis/x?y=1")).rejects.toThrow(/Outbound fetch/);
    expect(() => https.request("https://graph.microsoft.com/v1.0/me")).toThrow(/Outbound https/);
    expect(() => http.get({ host: "example.com", path: "/" })).toThrow(/Outbound http/);
    expect(() => net.connect(443, "example.com")).toThrow(/Outbound socket/);
    expect(n.tried.map((t) => t.via)).toEqual(["fetch", "https", "http", "socket"]);
    expect(n.tried[0]!.target).toBe("https://dev.azure.com/contoso/_apis/x"); // no query string kept
    expect(() => n.expectNone()).toThrow();
    n.restore();
    expect({ fetch: globalThis.fetch, request: https.request, connect: net.connect }).toEqual(before);
  });
  it("lets loopback through only when asked", () => {
    const n = noOutbound({ allowLocal: true });
    try {
      const s = net.connect(1, "127.0.0.1");
      s.on("error", () => {});
      s.destroy();
      expect(n.tried).toEqual([]);
    } finally {
      n.restore();
    }
  });
});
