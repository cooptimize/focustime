import { describe, expect, it } from "vitest";
import { parseHours, ptoByDate, ptoEntries, ptoSplit, type PtoDetailRow, type PtoTrackerRow } from "./pto.ts";

const DAY = 480; // 9:00 to 17:00
const tracker = (id: string, start: string, end: string | null, hours: number | null, title: string | null = "Trip"): PtoTrackerRow => ({ coop_timeofftrackerid: id, coop_timeoffstartdate: start, coop_enddate: end, coop_timeoffhours: hours, coop_title: title });
const detail = (id: string, date: string, hours: string | null): PtoDetailRow => ({ _coop_timeofftracker_value: id, coop_date: date, coop_hours: hours });
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const days = (t: PtoTrackerRow[], d: PtoDetailRow[]) => ptoByDate(ptoEntries(t, d, DAY).entries, WEEK, DAY);

describe("parseHours (coop_hours is text)", () => {
  it("reads the usual ways hours are typed", () => {
    expect(["8", "4.5", "4,5", "4:30", "2h", " 3 hours ", "0.25"].map(parseHours)).toEqual([480, 270, 270, 270, 120, 180, 15]);
    expect(parseHours(8)).toBe(480);
  });
  it("rejects anything else", () => {
    expect(["", "eight", "25", "-2", "4:75", null, "8.123"].map((v) => parseHours(v as string | null))).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("PTO per day", () => {
  it("a full day from its detail row (the real Nov 5 shape)", () => {
    const r = days([tracker("A", "2026-11-05", "2026-11-05", 8, "Watch Kids")], [detail("A", "2026-11-05", "8")]);
    expect(r).toEqual({ "2026-11-05": { date: "2026-11-05", minutes: 480, full: true, titles: ["Watch Kids"] } });
  });

  it("partial hours reduce the day and are not full", () => {
    const r = days([tracker("A", "2026-11-03", "2026-11-03", 4)], [detail("A", "2026-11-03", "4")]);
    expect(r["2026-11-03"]).toMatchObject({ minutes: 240, full: false });
  });

  it("a multi-day range uses its detail rows per day, not the range", () => {
    // Real shape: Wed 9/2 to Sun 9/6, 16 hours, details on Wed and Thu only.
    const r = ptoByDate(ptoEntries([tracker("B", "2026-09-02", "2026-09-06", 16)], [detail("B", "2026-09-02", "8"), detail("B", "2026-09-03", "8")], DAY).entries, ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"], DAY);
    expect(Object.keys(r)).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("missing detail rows: weekdays from the start filled until the hours run out, weekends skipped", () => {
    // Thu to Mon, 16 h: Thu and Fri full, nothing on the weekend or Monday.
    const e = ptoEntries([tracker("C", "2026-11-05", "2026-11-09", 16)], [], DAY).entries;
    expect(e.map((x) => [x.date, x.minutes])).toEqual([["2026-11-05", 480], ["2026-11-06", 480]]);
    // 12 h over two days: a full day then 4 h.
    expect(ptoEntries([tracker("D", "2026-11-02", "2026-11-03", 12)], [], DAY).entries.map((x) => x.minutes)).toEqual([480, 240]);
    // No hours at all: every weekday in range is full.
    expect(ptoEntries([tracker("E", "2026-11-02", "2026-11-04", null)], [], DAY).entries.length).toBe(3);
    // No end date: just the start day.
    expect(ptoEntries([tracker("F", "2026-11-04", null, 8)], [], DAY).entries.map((x) => x.date)).toEqual(["2026-11-04"]);
  });

  it("a duplicate detail row for one day counts once (seen in real data on Mar 5)", () => {
    const r = days([tracker("A", "2026-11-04", "2026-11-04", 8)], [detail("A", "2026-11-04", "8"), detail("A", "2026-11-04", "8")]);
    expect(r["2026-11-04"]!.minutes).toBe(480);
  });

  it("two trackers on one day add up, capped at the working day; titles kept", () => {
    const r = days([tracker("A", "2026-11-04", null, 4, "Dentist"), tracker("B", "2026-11-04", null, 6, "School")], [detail("A", "2026-11-04", "4"), detail("B", "2026-11-04", "6")]);
    expect(r["2026-11-04"]).toEqual({ date: "2026-11-04", minutes: 480, full: true, titles: ["Dentist", "School"] });
  });

  it("bad rows are skipped and counted, never guessed", () => {
    const r = ptoEntries([tracker("A", "2026-11-04", null, 8), tracker("", "2026-11-04", null, 8), tracker("G", "not a date", null, 8), tracker("H", "2026-11-05", "2026-11-01", 8)], [detail("A", "2026-11-04", "eight")], DAY);
    expect(r).toEqual({ entries: [], skipped: 4 });
  });

  it("partial PTO comes off the afternoon first; full takes both halves", () => {
    expect(ptoSplit({ date: "x", minutes: 240, full: false, titles: [] }, 210, 270)).toEqual({ am: 0, pm: 240 });
    expect(ptoSplit({ date: "x", minutes: 360, full: false, titles: [] }, 210, 270)).toEqual({ am: 90, pm: 270 });
    expect(ptoSplit({ date: "x", minutes: 480, full: true, titles: [] }, 210, 270)).toEqual({ am: 210, pm: 270 });
    expect(ptoSplit(undefined, 210, 270)).toEqual({ am: 0, pm: 0 });
  });
});
