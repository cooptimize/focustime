import { describe, expect, it } from "vitest";
import { buildWeek } from "./build.ts";
import { hidePersonal, personalCount } from "./personal.ts";
import { allDayPersonal, config, meeting, pattern, personal } from "./test-helpers.ts";

const WEEK = "2026-11-02";

describe("the Personal events switch (U5.1)", () => {
  const w = buildWeek({
    weekStart: WEEK,
    patterns: [pattern({ clientKey: "proseware", clientName: "Proseware", days: { Mon: "AM" } })],
    events: [meeting("2026-11-02T09:00:00-05:00", "2026-11-02T09:30:00-05:00", { title: "Standup" }), personal("2026-11-02T10:00:00-05:00", "2026-11-02T11:00:00-05:00", { title: "Dentist" }), allDayPersonal("2026-11-03", "2026-11-04", "School holiday")],
    config,
  });
  const hidden = hidePersonal(w);
  const mon = (x: typeof w) => x.days[0]!.am;

  it("hides personal events from what is drawn and keeps meetings", () => {
    expect(mon(hidden).events.map((p) => p.event.title)).toEqual(["Standup"]);
    expect(hidden.days[1]!.allDay).toEqual([]);
  });

  it("keeps the risk that names the hidden event, the free gaps and the longest free stretch", () => {
    expect(mon(hidden).risks).toEqual(mon(w).risks);
    expect(mon(hidden).risks.some((r) => r.reason.includes("Dentist"))).toBe(true);
    expect(mon(hidden).freeGaps).toEqual(mon(w).freeGaps);
    expect(mon(hidden).longestFreeMinutes).toBe(mon(w).longestFreeMinutes);
  });

  it("counts each personal event once, timed and all-day", () => {
    expect(personalCount(w.days)).toBe(2);
    expect(personalCount(w.days.slice(0, 1))).toBe(1);
  });
});
