import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { createDataverseSource } from "./source.ts";
import { dvConfig, FAKE_SECRET, FAKE_TOKEN, fakeFetch, ME } from "./test-fakes.ts";

const WEEK = "2026-11-02";
function setup(pto: "ok" | "none" | "forbidden", cacheDir = mkdtempSync(join(tmpdir(), "c-pto-"))) {
  const logs: LogRecord[] = [];
  const f = fakeFetch("ok", { pto });
  const source = createDataverseSource({ config: dvConfig, timeZone: "America/New_York", getSecret: async () => FAKE_SECRET, fetch: f.fetch, cacheDir, log: (r) => logs.push(r), now: () => Temporal.Instant.from("2026-11-02T13:00:00Z") });
  return { source, calls: f.calls, logs, cacheDir };
}

describe("PTO from Dataverse (step 6)", () => {
  it("reads only my rows, only the fields used, and never the out-of-office message or accrual balances", async () => {
    const t = setup("ok");
    const r = await t.source.pto(WEEK, 480);
    expect(r).toMatchObject({ source: "pto", status: "ok", fromCache: false });
    expect(r.items.map((e) => [e.date, e.minutes, e.title])).toEqual([
      ["2026-11-05", 480, "Watch Kids"],
      ["2026-11-03", 240, "Dentist"],
    ]);
    const urls = t.calls.filter((c) => c.url.includes("/api/data/")).map((c) => decodeURIComponent(c.url));
    const trackers = urls.find((u) => u.includes("coop_timeofftrackers?"))!;
    expect(trackers).toContain(`_coop_employee_value eq ${ME}`);
    expect(trackers).toContain("$select=coop_timeofftrackerid,coop_timeoffstartdate,coop_enddate,coop_timeoffhours,coop_title&");
    expect(urls.find((u) => u.includes("coop_timeofftrackerdetails?"))).toContain("$select=_coop_timeofftracker_value,coop_date,coop_hours&");
    for (const u of urls) {
      expect(u).not.toMatch(/outofofficemessage/i);
      expect(u).not.toMatch(/coop_timeofffact/i);
    }
    expect(t.calls.every((c) => c.method === "GET" || c.url.includes("/oauth2/"))).toBe(true);
  });

  it("no rows is fine, and no detail query is made", async () => {
    const t = setup("none");
    expect(await t.source.pto(WEEK, 480)).toMatchObject({ status: "ok", items: [] });
    expect(t.calls.some((c) => c.url.includes("coop_timeofftrackerdetails"))).toBe(false);
  });

  it("a failure falls back to the last good PTO with a plain message, and never leaks the token", async () => {
    const good = setup("ok");
    await good.source.pto(WEEK, 480);
    const bad = setup("forbidden", good.cacheDir);
    const r = await bad.source.pto(WEEK, 480);
    expect(r).toMatchObject({ source: "pto", status: "auth_required", fromCache: true });
    expect(r.items).toHaveLength(2);
    expect(r.message).toMatch(/^PTO not readable: check the Coopilot role in Dataverse\. Showing PTO from /);
    expect(JSON.stringify([r, bad.logs])).not.toContain(FAKE_TOKEN);
    const none = setup("forbidden");
    expect(await none.source.pto(WEEK, 480)).toMatchObject({ items: [], fromCache: false, message: "PTO not readable: check the Coopilot role in Dataverse. No cached PTO yet" });
  });
});
