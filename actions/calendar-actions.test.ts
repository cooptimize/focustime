import { createSnapshotStore } from "../host/local/snapshots.ts";
import { createLoopback } from "../host/local/loopback.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { fakeApis, TENANT, type ApiScenario } from "../sources/calendar/test-fakes.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, FAKE_TOKEN, fakeFetch, type Scenario } from "../sources/dataverse/test-fakes.ts";
import { createGoogleSource } from "../sources/google/source.ts";
import { createOutlookSource } from "../sources/graph/source.ts";
import { FAKE_ACCESS, FAKE_CLIENT_SECRET, FAKE_REFRESH, memoryKeyring } from "../sources/oauth/test-fakes.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { WeekLoadData } from "./types.ts";

const base = STARTER_TOML.replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl)
  .replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace(`tenant_id = "abf29d42-2ea9-422b-b0af-ed7cb5595b7e"\nclient_id = ""\n\n# Google`, `tenant_id = "${TENANT}"\nclient_id = "44444444-4444-4444-8444-444444444444"\n\n# Google`)
  .replace('[google]\nclient_id = ""', '[google]\nclient_id = "123-abc.apps.googleusercontent.com"');

function ctx(opts: { dv?: Scenario; outlook?: ApiScenario; google?: ApiScenario; text?: string; connected?: { outlook?: boolean; google?: boolean } } = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), "c-"));
  const keyring = memoryKeyring({
    "google-client-secret": FAKE_CLIENT_SECRET,
    ...(opts.connected?.outlook === false ? {} : { "outlook-refresh-token": FAKE_REFRESH }),
    ...(opts.connected?.google === false ? {} : { "google-refresh-token": FAKE_REFRESH }),
  });
  const dvFetch = fakeFetch(opts.dv ?? "ok").fetch;
  const oFetch = fakeApis(opts.outlook ?? "ok").fetch;
  const gFetch = fakeApis(opts.google ?? "ok").fetch;
  const opened: string[] = [];
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(opts.text ?? base) }),
    makeDataverse: (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dvFetch, snapshots: createSnapshotStore(cacheDir), log: () => {} }),
    makeOutlook: (cfg, tz) => createOutlookSource({ config: cfg, timeZone: tz, fetch: oFetch, keyring, loopback: createLoopback(), openBrowser: async (u) => { opened.push(u); }, snapshots: createSnapshotStore(cacheDir), log: () => {}, signInTimeoutMs: 150 }),
    makeGoogle: (cfg, tz) => createGoogleSource({ config: cfg, timeZone: tz, fetch: gFetch, keyring, loopback: createLoopback(), openBrowser: async (u) => { opened.push(u); }, snapshots: createSnapshotStore(cacheDir), log: () => {} }),
    makeDevOps: () => ({ load: async () => [], lookup: () => null, orgOf: () => null, last: () => null, portfolio: async () => [], description: async () => null, forget: () => undefined, featureSignals: async () => ({ ok: false as const, message: "n/a" }), exemplarPool: async () => ({ ok: true as const, value: [] }), processModels: async () => [] }),
    saveSystemUserId: async () => {},
    now: () => "2026-11-03T15:00:00Z",
  };
  return { c, keyring, opened };
}

async function load(c: ActionContext) {
  const r = await dispatch(c, { action: "week.load", input: { weekStart: "2026-11-02" } });
  if (!r.ok) throw new Error(r.error);
  return r.data as WeekLoadData;
}
const titles = (d: WeekLoadData) => d.week.days.flatMap((day) => [...day.allDay.map((e) => e.title), ...[day.early, day.am.events, day.pm.events, day.evening].flat().map((p) => p.event.title)]);
const status = (d: WeekLoadData) => Object.fromEntries(d.sources.map((s) => [s.source, `${s.status}${s.sample ? ":sample" : ""}`]));

describe("week.load with real calendar sources", () => {
  it("uses real Outlook and Google events and no sample meetings once both are configured", async () => {
    const d = await load(ctx().c);
    expect(status(d)).toEqual({ dataverse: "ok", pto: "ok", outlook: "ok", google: "ok" });
    expect(titles(d)).toContain("WC weekly status");
    expect(titles(d)).toContain("Call with Grandma");
    expect(titles(d)).not.toContain("Cooptimize weekly standup"); // sample fixture
  });

  it("a source that isn't set up says so with where to set it up, and nothing in its place (no-demo-leak: never sample meetings)", async () => {
    const d = await load(ctx({ text: base.replace('client_id = "123-abc.apps.googleusercontent.com"', 'client_id = ""') }).c);
    expect(status(d)).toEqual({ dataverse: "ok", pto: "ok", outlook: "ok", google: "misconfigured" });
    expect(d.sources.find((s) => s.source === "google")).toMatchObject({ fixAction: "open_settings", itemCount: 0, message: "Google Calendar isn't set up yet. Set it up in Settings › Accounts and calendars" });
    expect(titles(d)).toContain("WC weekly status"); // Outlook's own
    expect(titles(d)).not.toContain("School pickup"); // the old sample Google
    expect(titles(d)).not.toContain("Preschool drop-off");
  });

  it("isolates failures: each source reports its own state and the others still show", async () => {
    const d = await load(ctx({ dv: "dv_503", outlook: "ok", google: "refresh_expired" }).c);
    expect(status(d)).toEqual({ dataverse: "error", pto: "error", outlook: "ok", google: "auth_required" });
    expect(titles(d)).toContain("WC weekly status");
    expect(d.sources.find((s) => s.source === "google")).toMatchObject({ fixAction: "connect_google" });
  });

  it("shows Outlook as not connected with nothing in its place", async () => {
    const d = await load(ctx({ connected: { outlook: false } }).c);
    expect(d.sources.find((s) => s.source === "outlook")).toMatchObject({ status: "auth_required", fixAction: "connect_microsoft", itemCount: 0, message: "Outlook is not connected yet" });
    expect(titles(d)).not.toContain("WC weekly status");
  });

  it("the UI response never carries any token or secret", async () => {
    for (const scenario of ["ok", "refresh_expired", "page2_fails", "unauthorized_always"] as ApiScenario[]) {
      const body = JSON.stringify(await load(ctx({ outlook: scenario, google: scenario }).c));
      for (const s of [FAKE_ACCESS, FAKE_REFRESH, FAKE_CLIENT_SECRET, FAKE_SECRET, FAKE_TOKEN]) expect(body).not.toContain(s);
    }
  });
});

describe("auth actions", () => {
  it("auth.connect_microsoft opens the system browser at the Microsoft sign-in page", async () => {
    const { c, opened } = ctx();
    // The fake browser never comes back, so the short sign-in timeout ends it.
    const r = await dispatch(c, { action: "auth.connect_microsoft", input: {} });
    expect(opened[0]).toMatch(/^https:\/\/login\.microsoftonline\.com\/.+\/oauth2\/v2\.0\/authorize\?/);
    expect(r).toEqual({ ok: true, data: { status: "cancelled", message: "Sign-in timed out" } });
  });

  it("refuses to connect a source that has no client ID in config", async () => {
    const { c } = ctx({ text: base.replace('client_id = "123-abc.apps.googleusercontent.com"', 'client_id = ""') });
    expect(await dispatch(c, { action: "auth.connect_google", input: {} })).toEqual({ ok: true, data: { status: "failed", message: "Add google.client_id to config first" } });
  });

  it("auth.disconnect removes only that source's refresh token", async () => {
    const { c, keyring } = ctx();
    expect(await dispatch(c, { action: "auth.disconnect", input: { source: "google" } })).toEqual({ ok: true, data: { status: "disconnected" } });
    expect(keyring.store.has("google-refresh-token")).toBe(false);
    expect(keyring.store.has("outlook-refresh-token")).toBe(true);
    expect(keyring.store.has("google-client-secret")).toBe(true);
  });

  it("auth.disconnect rejects Dataverse and unknown sources", async () => {
    const { c } = ctx();
    expect(await dispatch(c, { action: "auth.disconnect", input: { source: "dataverse" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(c, { action: "auth.disconnect", input: { source: "gmail" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(c, { action: "auth.disconnect", input: {} })).toMatchObject({ ok: false, status: 400 });
  });
});
