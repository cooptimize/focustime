import { createSnapshotStore } from "../host/local/snapshots.ts";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, ENV, FAKE_SECRET, FAKE_TOKEN, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { SESSION_IDLE_MS } from "../store/accounts.ts";
import { SESSION_COOKIE, CSRF_COOKIE } from "./auth/cookies.ts";
import { startTestApp } from "./test-app.ts";

const logs: LogRecord[] = [];
let app: Awaited<ReturnType<typeof startTestApp>>;
let openRequest: string | null = "capture";
let reopened = 0;
let now = Temporal.Instant.from("2026-11-03T15:00:00Z");

function liveCtx(): ActionContext {
  const text = STARTER_TOML.replace("https://cooptimize.crm.dynamics.com", ENV)
    .replace('my_email = ""', 'my_email = "me@example.com"')
    .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`);
  const f = fakeFetch("ok");
  return {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse: (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: f.fetch, snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "c-"))), log: (r) => logs.push(r) }),
    makeOutlook: () => { throw new Error("not configured"); },
    makeGoogle: () => { throw new Error("not configured"); },
    makeDevOps: () => ({ load: async () => [], lookup: () => null, orgOf: () => null, last: () => null, portfolio: async () => [], description: async () => null, forget: () => undefined }),
    saveSystemUserId: async () => {},
    now: () => "2026-11-03T15:00:00Z",
  } as ActionContext;
}

beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>FocusTime</title>");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
  const ctx = liveCtx();
  app = await startTestApp({
    ctx: () => ctx,
    log: (r) => logs.push(r),
    distDir: dist,
    now: () => now,
    extra: {
      reopen: async () => {
        reopened++;
        return true;
      },
      takeOpenRequest: async () => {
        const v = openRequest;
        openRequest = null;
        return v;
      },
    },
  });
});
afterAll(() => app.close());

describe("server", () => {
  it("serves the page without a session (the page shows sign-in), with security headers", async () => {
    const page = await app.browser().send("/");
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(page.headers["x-frame-options"]).toBe("DENY");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect((await app.browser().send("/assets/app.js")).status).toBe(200);
  });

  it("refuses an API call without a session, as JSON with code signed_out", async () => {
    const r = await app.browser().action("week.load", {});
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toMatchObject({ ok: false, code: "signed_out" });
  });

  it("refuses a state change without the session's CSRF token", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    expect((await b.action("week.load", { weekStart: "2026-11-02" }, { "x-csrf": "" })).status).toBe(403);
    expect((await b.action("week.load", { weekStart: "2026-11-02" }, { "x-csrf": "wrong" })).status).toBe(403);
    const other = app.browser();
    await other.signIn("user-a");
    // Another session's token doesn't do.
    expect((await b.action("week.load", { weekStart: "2026-11-02" }, { "x-csrf": other.jar.get(CSRF_COOKIE)! })).status).toBe(403);
  });

  it("refuses a foreign Host even with a session (DNS rebinding)", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    expect((await b.send("/", { host: "evil.example" })).status).toBe(403);
  });

  it("refuses API calls from another origin or without an Origin", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    expect((await b.action("week.load", {}, { origin: `http://localhost:${app.port + 1}` })).status).toBe(403);
    expect((await b.send("/api/action", { "content-type": "application/json" }, "POST", "{}")).status).toBe(403);
  });

  it("serves week.load with real focus blocks, and nothing secret goes over the wire or into logs", async () => {
    const b = app.browser();
    const s = (await b.signIn("user-a"));
    const r = await b.action("week.load", { weekStart: "2026-11-02" });
    expect(r.status).toBe(200);
    const data = JSON.parse(r.body).data;
    expect(data.week.days[0].am.focus[0].clientName).toBe("Proseware");
    expect(r.body).not.toContain(FAKE_SECRET);
    expect(r.body).not.toContain(FAKE_TOKEN);
    const logged = JSON.stringify(logs);
    for (const v of [FAKE_SECRET, FAKE_TOKEN, s.cookie, s.csrf]) expect(logged).not.toContain(v);
  });

  it("ends a session after the idle timeout, and the next call is signed out", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    expect((await b.action("week.load", { weekStart: "2026-11-02" })).status).toBe(200);
    now = now.add({ milliseconds: SESSION_IDLE_MS + 1000 });
    const r = await b.action("week.load", { weekStart: "2026-11-02" });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).code).toBe("signed_out");
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("hands the launcher's open request to the window once, guarded like actions and POST only (step 9)", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    expect((await app.browser().post("/api/open-request", {})).status).toBe(401);
    expect((await b.post("/api/open-request", {}, { origin: "http://evil.example" })).status).toBe(403);
    expect((await b.send("/api/open-request", { origin: app.publicUrl })).status).toBe(405);
    expect(JSON.parse((await b.post("/api/open-request", {})).body)).toEqual({ view: "capture" });
    expect(JSON.parse((await b.post("/api/open-request", {})).body)).toEqual({ view: null });
  });

  it("rejects unknown actions", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    expect((await b.action("dataverse.write", {})).status).toBe(400);
  });

  it("signs out: the session ends at the server and its cookies are cleared", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    const before = b.jar.get(SESSION_COOKIE)!;
    expect((await b.post("/auth/logout", {}, { "x-csrf": "wrong" })).status).toBe(403);
    expect((await app.accounts.sessions.resolve(before))).not.toBeNull();
    const r = await b.post("/auth/logout", {});
    expect(r.status).toBe(200);
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
    expect((await app.accounts.sessions.resolve(before))).toBeNull();
  });

  it("brings the window up for the developer loop: same origin only, POST only, once per 5 seconds; no session needed", async () => {
    const b = app.browser();
    expect((await b.post("/api/reopen", {}, { origin: "http://evil.example" })).status).toBe(403);
    expect((await b.post("/api/reopen", {}, { host: "evil.example" })).status).toBe(403);
    expect((await b.send("/api/reopen", { "content-type": "application/json" }, "POST", "{}")).status).toBe(403);
    expect(reopened).toBe(0);
    const first = await b.post("/api/reopen", {});
    expect(first.status).toBe(202);
    expect(JSON.parse(first.body)).toEqual({ opened: true });
    expect(reopened).toBe(1);
    expect((await b.post("/api/reopen", {})).status).toBe(503);
    expect(reopened).toBe(1);
  });
});

describe("the database's state for a waiting page (A3)", () => {
  it("answers from memory, with no session, same origin only, and says only ok, waking or unavailable", async () => {
    let state: "ok" | "waking" | "unavailable" = "waking";
    const t = await startTestApp({ ctx: {} as ActionContext, extra: { dbStatus: () => state } });
    try {
      const b = t.browser();
      const r = await b.post("/api/db-status", {});
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ status: "waking" });
      state = "ok";
      expect(JSON.parse((await b.post("/api/db-status", {})).body)).toEqual({ status: "ok" });
      expect((await b.send("/api/db-status")).status).toBe(403);
      expect((await b.post("/api/db-status", {}, { origin: "http://evil.example" })).status).toBe(403);
    } finally {
      await t.close();
    }
  });
});
