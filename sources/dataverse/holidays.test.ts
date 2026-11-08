// SR-3: the observed holidays reader (AS-3's rule): Holiday Observed = Yes only, on exactly the table's date, named
// "<Holiday Name> (observed)" or "Holiday", read-only, and a refusal says so without throwing.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSnapshotStore } from "../../host/local/snapshots.ts";
import { holidayDays, holidayLabel } from "./holidays.ts";
import { createDataverseSource } from "./source.ts";
import { dvConfig, FAKE_SECRET, FAKE_TOKEN, fakeFetch } from "./test-fakes.ts";

function setup(holidays: "ok" | "forbidden") {
  const f = fakeFetch("ok", { holidays });
  const source = createDataverseSource({ config: dvConfig, timeZone: "America/New_York", getSecret: async () => FAKE_SECRET, fetch: f.fetch, snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "c-hol-"))), log: () => {}, now: () => Temporal.Instant.from("2026-11-20T13:00:00Z") });
  return { source, calls: f.calls };
}

describe("observed holidays from the Working Days Calendar (SR-3)", () => {
  it("asks only for observed days in the range, with three columns, by GET", async () => {
    const t = setup("ok");
    const r = await t.source.holidays("2026-11-23", "2026-12-31");
    expect(r).toEqual({ ok: true, days: [{ date: "2026-11-26", name: "Thanksgiving Day" }, { date: "2026-11-27", name: "Day after Thanksgiving" }, { date: "2026-12-07", name: null }, { date: "2026-12-24", name: "Christmas Day" }] });
    const url = decodeURIComponent(t.calls.find((c) => c.url.includes("coop_workingdayscalendars"))!.url);
    expect(url).toContain("$select=coop_date,coop_holidayname,coop_observedholidayflag&");
    expect(url).toContain("coop_observedholidayflag eq true and coop_date ge 2026-11-23 and coop_date le 2026-12-31");
    expect(t.calls.every((c) => c.method === "GET" || c.url.includes("/oauth2/"))).toBe(true);
  });
  it("a refused read (the reader role can't read the rows yet) answers ok: false with no secret in it", async () => {
    const t = setup("forbidden");
    const r = await t.source.holidays("2026-11-23", "2026-12-06");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(r)).not.toContain(FAKE_SECRET);
  });
});

describe("holidayDays and the label", () => {
  const rows = [
    { coop_date: "2026-11-11", coop_holidayname: "Veterans Day", coop_observedholidayflag: false },
    { coop_date: "2026-12-24T00:00:00Z", coop_holidayname: "Christmas Day", coop_observedholidayflag: true },
    { coop_date: "2026-12-07", coop_holidayname: "  ", coop_observedholidayflag: true },
    { coop_date: "2026-11-11", coop_holidayname: "Veterans Day", coop_observedholidayflag: "Yes" },
  ];
  it("Holiday Observed = No (or anything but true) is ignored", () => {
    expect(holidayDays(rows, "2026-11-01", "2026-12-31").map((d) => d.date)).not.toContain("2026-11-11");
  });
  it("an observed date other than the traditional one is kept as it is", () => {
    expect(holidayDays(rows, "2026-12-01", "2026-12-31")).toContainEqual({ date: "2026-12-24", name: "Christmas Day" });
  });
  it("an unnamed holiday reads Holiday; a named one '<name> (observed)'", () => {
    const [unnamed, christmas] = holidayDays(rows, "2026-12-01", "2026-12-31");
    expect(holidayLabel(unnamed!)).toBe("Holiday");
    expect(holidayLabel(christmas!)).toBe("Christmas Day (observed)");
  });
  it("outside the range is left out", () => {
    expect(holidayDays(rows, "2026-12-08", "2026-12-20")).toEqual([]);
  });
});
