import { describe, expect, it } from "vitest";
import { weekConfig } from "../config/defaults.ts";
import { buildWeek } from "../week/build.ts";
import { SAMPLE_WEEK, sampleGoogle, sampleOutlook, samplePatterns } from "./sample-week.ts";

// Guards the fixture's purpose: it must keep demonstrating each state the grid shows.
describe("sample week fixture", () => {
  const week = buildWeek({ weekStart: SAMPLE_WEEK, patterns: samplePatterns, events: [...sampleOutlook, ...sampleGoogle], config: weekConfig });
  const slots = week.days.flatMap((d) => [d.am, d.pm]);
  const rules = (date: string, half: "AM" | "PM") =>
    slots.find((s) => s.date === date && s.half === half)!.risks.map((r) => `${r.rule}:${r.severity}`);

  it("has the four ongoing patterns in their half-days, Thu PM Open", () => {
    const shown = slots.filter((s) => s.focus.length).map((s) => `${s.date.slice(8)} ${s.half} ${s.focus[0]!.clientName}`);
    expect(shown).toEqual([
      "02 AM Quiddity", "02 PM CSC", "03 AM Internal", "03 PM CSC",
      "04 AM Woodard & Curran", "04 PM Woodard & Curran", "05 AM Woodard & Curran",
    ]);
    expect(slots.filter((s) => s.open).map((s) => `${s.date} ${s.half}`)).toEqual(["2026-11-05 PM"]);
  });

  it("shows a double-booked Monday AM and an at-risk Tuesday PM", () => {
    expect(rules("2026-11-02", "AM")).toContain("double_booked_block:at_risk");
    expect(rules("2026-11-03", "PM")).toEqual(["meeting_load:at_risk", "no_focus_window:at_risk"]);
    expect(rules("2026-11-04", "PM")).toContain("personal_conflict:at_risk");
  });

  it("keeps the evening event visible and drops the declined webinar", () => {
    expect(week.days[3]!.evening.map((p) => p.event.title)).toEqual(["School open house"]);
    const fri = week.days[4]!;
    expect([...fri.am.events, ...fri.pm.events].map((p) => p.event.title)).not.toContain("Vendor webinar");
  });
});
