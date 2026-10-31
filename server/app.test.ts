import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, ENV, FAKE_SECRET, FAKE_TOKEN, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { createApp } from "./app.ts";

const TOKEN = "launch-token-for-tests";
const logs: LogRecord[] = [];
let port = 0;
let close: () => void;

beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Coopilot</title>");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
  const text = STARTER_TOML.replace("https://cooptimize.crm.dynamics.com", ENV)
    .replace('my_email = ""', 'my_email = "me@example.com"')
    .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`);
  const f = fakeFetch("ok");
  // Port must be known before the guard is built, so listen on 0 then rebuild with the port.
  const probe = createApp({ port: 1, token: TOKEN, log: () => {}, distDir: dist, ctx: {} as never });
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const server = createApp({
    port,
    token: TOKEN,
    log: (r) => logs.push(r),
    distDir: dist,
    ctx: {
      loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
      makeDataverse: (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: f.fetch, cacheDir: mkdtempSync(join(tmpdir(), "c-")), log: (r) => logs.push(r) }),
      makeOutlook: () => { throw new Error("not configured"); },
      makeGoogle: () => { throw new Error("not configured"); },
      makeDevOps: () => ({ load: async () => [], lookup: () => null, orgOf: () => null }),
      saveSystemUserId: async () => {},
      now: () => "2026-11-03T15:00:00Z",
    },
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  close = () => server.close();
});
afterAll(() => close());

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
function send(path: string, headers: Record<string, string> = {}, method = "GET", body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const cookie = () => `coopilot_${port}=${TOKEN}`;
const api = (input: unknown, headers: Record<string, string> = {}) =>
  send("/api/action", { cookie: cookie(), origin: `http://127.0.0.1:${port}`, "content-type": "application/json", ...headers }, "POST", JSON.stringify({ action: "week.load", input }));

describe("local server", () => {
  it("refuses every path without the launch token", async () => {
    expect((await send("/")).status).toBe(401);
    expect((await send("/assets/app.js")).status).toBe(401);
    expect((await api({}, { cookie: "" })).status).toBe(401);
  });

  it("swaps the launch token for a cookie and serves the app with it", async () => {
    const r = await send(`/?token=${TOKEN}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("/");
    expect(String(r.headers["set-cookie"])).toContain("HttpOnly; SameSite=Strict");
    const page = await send("/", { cookie: cookie() });
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("refuses a foreign Host even with the token (DNS rebinding)", async () => {
    expect((await send("/", { cookie: cookie(), host: "evil.example" })).status).toBe(403);
  });

  it("refuses API calls from another origin or without an Origin", async () => {
    expect((await api({}, { origin: "http://127.0.0.1:8080" })).status).toBe(403);
    expect((await send("/api/action", { cookie: cookie(), "content-type": "application/json" }, "POST", "{}")).status).toBe(403);
  });

  it("serves week.load with real focus blocks, and nothing secret goes over the wire or into logs", async () => {
    const r = await api({ weekStart: "2026-11-02" });
    expect(r.status).toBe(200);
    const data = JSON.parse(r.body).data;
    expect(data.week.days[0].am.focus[0].clientName).toBe("Quiddity");
    expect(r.body).not.toContain(FAKE_SECRET);
    expect(r.body).not.toContain(FAKE_TOKEN);
    const logged = JSON.stringify(logs);
    for (const s of [FAKE_SECRET, FAKE_TOKEN, TOKEN]) expect(logged).not.toContain(s);
  });

  it("rejects unknown actions", async () => {
    const r = await send("/api/action", { cookie: cookie(), origin: `http://127.0.0.1:${port}`, "content-type": "application/json" }, "POST", JSON.stringify({ action: "dataverse.write", input: {} }));
    expect(r.status).toBe(400);
  });
});
