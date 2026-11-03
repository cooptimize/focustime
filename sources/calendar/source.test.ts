import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { FAKE_ACCESS, FAKE_AUTH_CODE, FAKE_CLIENT_SECRET, FAKE_REFRESH, memoryKeyring } from "../oauth/test-fakes.ts";
import { createGoogleSource } from "../google/source.ts";
import { createOutlookSource } from "../graph/source.ts";
import { fakeApis, TENANT, type ApiScenario } from "./test-fakes.ts";

const WEEK = "2026-11-02";
const NY = "America/New_York";
const NOW = Temporal.Instant.from("2026-11-02T13:02:00Z"); // 8:02 AM New York

type Kind = "outlook" | "google";

function setup(kind: Kind, scenario: ApiScenario, opts: { connected?: boolean; calendars?: string[]; cacheDir?: string; locked?: boolean } = {}) {
  const cacheDir = opts.cacheDir ?? mkdtempSync(join(tmpdir(), "focustime-cal-"));
  const logs: LogRecord[] = [];
  const api = fakeApis(scenario);
  const keyring = memoryKeyring({
    "google-client-secret": FAKE_CLIENT_SECRET,
    ...(opts.connected === false ? {} : { "outlook-refresh-token": FAKE_REFRESH, "google-refresh-token": FAKE_REFRESH }),
  }, { locked: !!opts.locked });
  const common = { fetch: api.fetch, keyring, openBrowser: async () => {}, cacheDir, log: (r: LogRecord) => logs.push(r), timeZone: NY, now: () => NOW };
  const source =
    kind === "outlook"
      ? createOutlookSource({ ...common, config: { tenantId: TENANT, clientId: "44444444-4444-4444-8444-444444444444" } })
      : createGoogleSource({ ...common, config: { clientId: "123-abc.apps.googleusercontent.com", calendars: opts.calendars ?? ["primary"] } });
  return { source, cacheDir, logs, calls: api.calls, keyring };
}

function seedCache(cacheDir: string, kind: Kind) {
  mkdirSync(join(cacheDir, kind), { recursive: true });
  writeFileSync(
    join(cacheDir, kind, `${WEEK}.json`),
    JSON.stringify({ fetchedAt: "2026-11-02T08:02:00-05:00", items: [{ id: `${kind}:cached`, source: kind, title: "Cached", start: "2026-11-02T10:00:00-05:00", end: "2026-11-02T10:30:00-05:00", allDay: false, isPersonal: kind === "google" }] }),
  );
}

const label = { outlook: "Outlook", google: "Google" } as const;
const connect = { outlook: "connect_microsoft", google: "connect_google" } as const;

describe("Outlook source requests", () => {
  it("asks calendarView for the whole week, only the fields used, in the configured time zone", async () => {
    const { source, calls } = setup("outlook", "ok");
    const r = await source.load(WEEK);
    expect(r.status).toBe("ok");
    const first = calls.find((c) => c.url.includes("calendarView"))!;
    const u = new URL(first.url);
    expect(u.searchParams.get("startDateTime")).toBe("2026-11-02T00:00:00-05:00");
    expect(u.searchParams.get("endDateTime")).toBe("2026-11-09T00:00:00-05:00");
    expect(u.searchParams.get("$select")).toBe("subject,start,end,isAllDay,showAs,responseStatus,isCancelled");
    expect(first.headers.prefer).toBe('outlook.timezone="America/New_York", IdType="ImmutableId"');
    expect(first.headers.authorization).toBe(`Bearer ${FAKE_ACCESS}`);
    for (const c of calls) expect(c.url).not.toMatch(/body|attendees/i);
  });

  it("follows nextLink and returns both pages without declined or cancelled events", async () => {
    const { source } = setup("outlook", "ok");
    const titles = (await source.load(WEEK)).items.map((e) => e.title);
    expect(titles).toContain("Out of office");
    expect(titles).toContain("Proseware stakeholder sync");
    expect(titles).not.toContain("Vendor webinar");
    expect(titles).not.toContain("Canceled: Adatum sync");
  });
});

describe("Google source requests", () => {
  it("lists single events on the primary calendar for the week with a narrow field list", async () => {
    const { source, calls } = setup("google", "ok");
    const r = await source.load(WEEK);
    expect(r.status).toBe("ok");
    const first = calls.find((c) => c.url.includes("/calendar/v3/"))!;
    const u = new URL(first.url);
    expect(u.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(u.searchParams.get("singleEvents")).toBe("true");
    expect(u.searchParams.get("orderBy")).toBe("startTime");
    expect(u.searchParams.get("timeMin")).toBe("2026-11-02T00:00:00-05:00");
    expect(u.searchParams.get("timeMax")).toBe("2026-11-09T00:00:00-05:00");
    expect(u.searchParams.get("fields")).toBe("nextPageToken,items(id,status,summary,transparency,start,end,attendees(self,responseStatus))");
    expect(first.headers.authorization).toBe(`Bearer ${FAKE_ACCESS}`);
  });

  it("follows pageToken and returns both pages", async () => {
    const { source } = setup("google", "ok");
    const titles = (await source.load(WEEK)).items.map((e) => e.title);
    expect(titles).toContain("Early release day");
    expect(titles).toContain("Dentist (maybe)");
    expect(titles).not.toContain("Neighborhood meeting");
  });

  it("reads every configured calendar", async () => {
    const { source, calls } = setup("google", "ok", { calendars: ["primary", "family@group.calendar.google.com"] });
    const r = await source.load(WEEK);
    expect(calls.some((c) => c.url.includes("/calendars/family%40group.calendar.google.com/events"))).toBe(true);
    expect(r.items.filter((e) => e.title === "Early release day")).toHaveLength(2);
  });

  it("reports an unknown calendar ID as a config problem", async () => {
    const r = await setup("google", "calendar_not_found").source.load(WEEK);
    expect(r.status).toBe("misconfigured");
    expect(r.message).toBe("Google calendar not found: check google.calendars in config. No cached data yet");
  });
});

describe.each<Kind>(["outlook", "google"])("%s source failure states", (kind) => {
  const L = label[kind];

  it("not connected yet: needs sign-in, offers Connect, uses no cache", async () => {
    const { source, cacheDir } = setup(kind, "ok", { connected: false });
    seedCache(cacheDir, kind);
    const r = await source.load(WEEK);
    expect(r).toMatchObject({ status: "auth_required", fixAction: connect[kind], items: [], fromCache: false, message: `${L} is not connected yet` });
  });

  it("expired or revoked refresh token: needs reconnecting, shows the snapshot", async () => {
    const { source, cacheDir } = setup(kind, "refresh_expired");
    seedCache(cacheDir, kind);
    const r = await source.load(WEEK);
    expect(r).toMatchObject({ status: "auth_required", fixAction: connect[kind], fromCache: true, message: `${L} needs reconnecting. Showing data from 8:02 AM` });
    expect(r.items.map((e) => e.title)).toEqual(["Cached"]);
  });

  it.each<ApiScenario>(["token_offline", "api_offline"])("offline (%s): shows the snapshot with its time", async (scenario) => {
    const { source, cacheDir } = setup(kind, scenario);
    seedCache(cacheDir, kind);
    expect(await source.load(WEEK)).toMatchObject({ status: "unreachable", fromCache: true, message: "Offline, showing data from 8:02 AM" });
  });

  it("a forced refresh that fails after a live load keeps the same events", async () => {
    const live = setup(kind, "ok");
    const good = await live.source.load(WEEK);
    expect(good.status).toBe("ok");
    // Same cache folder, network now down: the forced refresh falls back to the snapshot of the live load.
    const { source } = setup(kind, "api_offline", { cacheDir: live.cacheDir });
    const r = await source.load(WEEK, { refresh: true });
    expect(r).toMatchObject({ status: "unreachable", fromCache: true });
    expect(r.items).toEqual(good.items);
  });

  it("offline with no snapshot says so", async () => {
    expect((await setup(kind, "api_offline").source.load(WEEK)).message).toBe(`${L} unreachable. No cached data yet`);
  });

  it("partial pages: uses none of them and keeps the old snapshot", async () => {
    const { source, cacheDir } = setup(kind, "page2_fails");
    seedCache(cacheDir, kind);
    const r = await source.load(WEEK);
    expect(r).toMatchObject({ status: "error", fromCache: true });
    expect(r.message).toBe(`${L} returned only part of the results, so none were used. Showing data from 8:02 AM`);
    expect(readFileSync(join(cacheDir, kind, `${WEEK}.json`), "utf8")).toContain("Cached");
  });

  it("retries once with a fresh token after a 401", async () => {
    const r = await setup(kind, "unauthorized_once").source.load(WEEK);
    expect(r.status).toBe("ok");
  });

  it("a 401 that persists means reconnect", async () => {
    const r = await setup(kind, "unauthorized_always").source.load(WEEK);
    expect(r).toMatchObject({ status: "auth_required", fixAction: connect[kind] });
  });

  it("a 403 is a permission problem", async () => {
    const r = await setup(kind, "forbidden").source.load(WEEK);
    expect(r.status).toBe("misconfigured");
  });

  it("a server error is an error", async () => {
    expect((await setup(kind, "server_error").source.load(WEEK)).message).toBe(`${L} error (HTTP 503). No cached data yet`);
  });

  it("caches the last good week with normalized fields only", async () => {
    const { source, cacheDir } = setup(kind, "ok");
    await source.load(WEEK);
    const file = readFileSync(join(cacheDir, kind, `${WEEK}.json`), "utf8");
    expect(JSON.parse(file).items.length).toBeGreaterThan(0);
    expect(file).not.toMatch(/@odata|etag|attendees|responseStatus":\{/);
  });

  it("disconnect removes only this source's refresh token and cache", async () => {
    const { source, cacheDir, keyring } = setup(kind, "ok");
    await source.load(WEEK);
    const other = kind === "outlook" ? "google" : "outlook";
    seedCache(cacheDir, other);
    await source.disconnect();
    expect(existsSync(join(cacheDir, kind))).toBe(false);
    expect(existsSync(join(cacheDir, other))).toBe(true);
    expect(keyring.store.has(`${kind}-refresh-token`)).toBe(false);
    expect(keyring.store.has(`${other}-refresh-token`)).toBe(true);
    expect(keyring.store.has("google-client-secret")).toBe(true);
    expect((await source.load(WEEK)).status).toBe("auth_required");
  });
});

describe("calendar sources never leak tokens or secrets", () => {
  const scenarios: ApiScenario[] = ["ok", "refresh_expired", "token_offline", "api_offline", "page2_fails", "foreign_next", "unauthorized_once", "unauthorized_always", "forbidden", "calendar_not_found", "server_error"];
  it.each(scenarios.flatMap((s) => [["outlook", s], ["google", s]] as [Kind, ApiScenario][]))("%s / %s", async (kind, scenario) => {
    const { source, cacheDir, logs } = setup(kind, scenario);
    seedCache(cacheDir, kind);
    const out: string[] = [];
    try {
      out.push(JSON.stringify(await source.load(WEEK)));
      out.push(JSON.stringify(await source.load(WEEK, { refresh: true })));
    } catch (e) {
      out.push(String(e), (e as Error).stack ?? "");
    }
    const cache = readdirSync(join(cacheDir, kind)).map((f) => readFileSync(join(cacheDir, kind, f), "utf8"));
    const all = [...out, ...cache, JSON.stringify(logs)].join("\n");
    for (const s of [FAKE_ACCESS, FAKE_REFRESH, FAKE_CLIENT_SECRET, FAKE_AUTH_CODE]) expect(all).not.toContain(s);
    expect(all).not.toMatch(/authorization|bearer/i);
  });

  it("foreign nextLink is not followed with the token", async () => {
    const { source, calls } = setup("outlook", "foreign_next");
    const r = await source.load(WEEK);
    expect(r.status).toBe("error");
    expect(calls.some((c) => c.url.includes("attacker.example.com"))).toBe(false);
  });
});

describe("shared root causes (step 6.1)", () => {
  it.each(["outlook", "google"] as const)("%s: a locked keyring is reported as the keyring, with the cache kept", async (kind) => {
    const { source, cacheDir } = setup(kind, "ok", { locked: true });
    seedCache(cacheDir, kind);
    const r = await source.load(WEEK);
    expect(r).toMatchObject({ status: "error", fromCache: true, cause: "keyring" });
    expect(r.fixAction).toBeUndefined();
  });
});
