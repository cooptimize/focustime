import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { createDataverseSource } from "./source.ts";
import { dvConfig, FAKE_SECRET, FAKE_TOKEN, fakeFetch, ME } from "./test-fakes.ts";

const WEEK = "2026-11-02";
const FRI = "2026-11-06";
function setup(pto: "ok" | "none" | "forbidden", cacheDir = mkdtempSync(join(tmpdir(), "c-pto-")), missing?: string) {
  const logs: LogRecord[] = [];
  const f = fakeFetch("ok", missing ? { pto, missing } : { pto });
  const source = createDataverseSource({ config: dvConfig, timeZone: "America/New_York", getSecret: async () => FAKE_SECRET, fetch: f.fetch, cacheDir, log: (r) => logs.push(r), now: () => Temporal.Instant.from("2026-11-02T13:00:00Z") });
  return { source, calls: f.calls, logs, cacheDir };
}

describe("PTO from Dataverse (step 6)", () => {
  it("reads only my rows, only the fields used, and never the out-of-office message or accrual balances", async () => {
    const t = setup("ok");
    const r = await t.source.pto(WEEK, FRI);
    expect(r).toMatchObject({ source: "pto", status: "ok", fromCache: false });
    expect(r.items.map((e) => [e.date, e.title])).toEqual([["2026-11-05", "Watch Kids"]]);
    const urls = t.calls.filter((c) => c.url.includes("/api/data/")).map((c) => decodeURIComponent(c.url));
    const trackers = urls.find((u) => u.includes("coop_timeofftrackers?"))!;
    expect(trackers).toContain(`_coop_employee_value eq ${ME}`);
    expect(trackers).toContain("$select=coop_timeofftrackerid,coop_timeoffstartdate,coop_enddate,coop_title&");
    expect(urls.find((u) => u.includes("coop_timeofftrackerdetails?"))).toContain("$select=_coop_timeofftracker_value,coop_date&");
    for (const u of urls) {
      expect(u).not.toMatch(/outofofficemessage/i);
      expect(u).not.toMatch(/coop_timeofffact/i);
      expect(u).not.toMatch(/hours/i); // every PTO day is a whole day (D105)
    }
    expect(t.calls.every((c) => c.method === "GET" || c.url.includes("/oauth2/"))).toBe(true);
  });

  it("no rows is fine, and no detail query is made", async () => {
    const t = setup("none");
    expect(await t.source.pto(WEEK, FRI)).toMatchObject({ status: "ok", items: [] });
    expect(t.calls.some((c) => c.url.includes("coop_timeofftrackerdetails"))).toBe(false);
  });

  it("a failure falls back to the last good PTO with a plain message, and never leaks the token", async () => {
    const good = setup("ok");
    await good.source.pto(WEEK, FRI);
    const bad = setup("forbidden", good.cacheDir);
    const r = await bad.source.pto(WEEK, FRI);
    expect(r).toMatchObject({ source: "pto", status: "auth_required", fromCache: true });
    expect(r.items).toHaveLength(1);
    expect(r.message).toMatch(/^PTO not readable: check the FocusTime role in Dataverse\. Showing PTO from /);
    expect(JSON.stringify([r, bad.logs])).not.toContain(FAKE_TOKEN);
    const none = setup("forbidden");
    expect(await none.source.pto(WEEK, FRI)).toMatchObject({ items: [], fromCache: false, message: "PTO not readable: check the FocusTime role in Dataverse. No cached PTO yet" });
  });

  it("a range covers trackers with no detail rows on every weekday (D109)", async () => {
    const r = await setup("ok").source.pto("2026-11-09", "2026-11-20");
    expect(r.items.map((e) => e.date)).toEqual(["2026-11-16", "2026-11-17"]);
  });

  it.each([
    ["coop_title", "PTO column coop_title not found in coop_timeofftrackers (renamed or removed?)"],
    ["coop_timeoffstartdate", "PTO column coop_timeoffstartdate not found in coop_timeofftrackers (renamed or removed?)"],
    ["_coop_employee_value", "PTO column _coop_employee_value not found in coop_timeofftrackers (renamed or removed?)"],
    ["coop_date", "PTO column coop_date not found in coop_timeofftrackerdetails (renamed or removed?)"],
  ])("a renamed column (%s) is named in the status, never a silent blank (D108)", async (column, message) => {
    const t = setup("ok", undefined, column);
    const r = await t.source.pto(WEEK, FRI);
    expect(r).toMatchObject({ source: "pto", status: "misconfigured", items: [], message: `${message}. No cached PTO yet` });
    // Probes stay on my own rows (or my own tracker's details) and never select anything sensitive.
    const probes = t.calls.filter((c) => c.url.includes("%24top=1") || c.url.includes("$top=1")).map((c) => decodeURIComponent(c.url));
    expect(probes.length).toBeGreaterThan(0);
    for (const u of probes) expect(u).toMatch(new RegExp(`_coop_employee_value eq ${ME}|_coop_timeofftracker_value eq aaaaaaaa`));
    expect(JSON.stringify([r, t.logs])).not.toContain(FAKE_TOKEN);
  });
});
