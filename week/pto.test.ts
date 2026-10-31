import { describe, expect, it } from "vitest";
import { ptoByDate, ptoEntries, type PtoDetailRow, type PtoTrackerRow } from "./pto.ts";

const tracker = (id: string, start: string, end: string | null, title: string | null = "Trip"): PtoTrackerRow => ({ coop_timeofftrackerid: id, coop_timeoffstartdate: start, coop_enddate: end, coop_title: title });
const detail = (id: string, date: string | null): PtoDetailRow => ({ _coop_timeofftracker_value: id, coop_date: date });
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const days = (t: PtoTrackerRow[], d: PtoDetailRow[]) => ptoByDate(ptoEntries(t, d).entries, WEEK);

describe("PTO per day (every PTO day is a whole day off, D105)", () => {
  it("a day from its detail row (the real Nov 5 shape)", () => {
    const r = days([tracker("A", "2026-11-05", "2026-11-05", "Watch Kids")], [detail("A", "2026-11-05")]);
    expect(r).toEqual({ "2026-11-05": { date: "2026-11-05", titles: ["Watch Kids"] } });
  });

  it("a multi-day range uses its detail rows per day, not the range", () => {
    // Real shape: Wed 9/2 to Sun 9/6, details on Wed and Thu only.
    const r = ptoByDate(ptoEntries([tracker("B", "2026-09-02", "2026-09-06")], [detail("B", "2026-09-02"), detail("B", "2026-09-03")]).entries, ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(Object.keys(r)).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("no detail rows: every weekday from start to end is PTO, weekends skipped (D109)", () => {
    expect(ptoEntries([tracker("C", "2026-11-05", "2026-11-10")], []).entries.map((x) => x.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"]);
    // No end date: just the start day.
    expect(ptoEntries([tracker("F", "2026-11-04", null)], []).entries.map((x) => x.date)).toEqual(["2026-11-04"]);
  });

  it("a duplicate detail row for one day counts once (seen in real data on Mar 5)", () => {
    expect(ptoEntries([tracker("A", "2026-11-04", "2026-11-04")], [detail("A", "2026-11-04"), detail("A", "2026-11-04")]).entries).toHaveLength(1);
  });

  it("two trackers on one day keep both titles", () => {
    const r = days([tracker("A", "2026-11-04", null, "Dentist"), tracker("B", "2026-11-04", null, "School")], []);
    expect(r["2026-11-04"]).toEqual({ date: "2026-11-04", titles: ["Dentist", "School"] });
  });

  it("bad rows are skipped and counted, never guessed", () => {
    const r = ptoEntries([tracker("", "2026-11-04", null), tracker("G", "not a date", null), tracker("H", "2026-11-05", "2026-11-01"), tracker("I", "2026-11-02", null)], [detail("I", "11/2/2026")]);
    expect(r).toEqual({ entries: [], skipped: 4 });
  });
});
