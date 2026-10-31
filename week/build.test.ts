import { describe, expect, it } from "vitest";
import { buildWeek } from "./build.ts";
import { allDayPersonal, config, meeting, noStanding, pattern, personal } from "./test-helpers.ts";
import type { Day, Slot } from "./types.ts";

const WEEK = "2026-11-02"; // Mon Nov 2, 2026, first week after DST ends (EST, -05:00)

function slot(days: Day[], i: number, half: "AM" | "PM"): Slot {
  const d = days[i]!;
  return half === "AM" ? d.am : d.pm;
}
const titles = (s: { event: { title: string } }[]) => s.map((p) => p.event.title);

describe("focus blocks per half-day", () => {
  it("adds the standing Monday AM Internal block when Dataverse has nothing there", () => {
    const w = buildWeek({ weekStart: WEEK, patterns: [], events: [], config });
    const mon = slot(w.days, 0, "AM");
    expect(mon.focus).toHaveLength(1);
    expect(mon.focus[0]).toMatchObject({ clientName: "Internal", source: "config" });
    expect(mon.open).toBe(false);
    expect(mon.risks).toEqual([]);
  });

  it("lets a Dataverse client block win over the standing block and flags it double-booked", () => {
    const w = buildWeek({
      weekStart: WEEK,
      patterns: [pattern({ clientKey: "quiddity", clientName: "Quiddity", days: { Mon: "AM" } })],
      events: [],
      config,
    });
    const mon = slot(w.days, 0, "AM");
    expect(mon.focus.map((f) => [f.clientName, f.source])).toEqual([
      ["Quiddity", "dataverse"],
      ["Internal", "config"],
    ]);
    const risk = mon.risks.find((r) => r.rule === "double_booked_block");
    expect(risk?.severity).toBe("at_risk");
    expect(risk?.reason).toContain("Quiddity");
    expect(risk?.reason).toContain("Internal");
  });

  it("does not flag a Dataverse Internal block that matches the standing Internal block", () => {
    const w = buildWeek({
      weekStart: WEEK,
      patterns: [pattern({ clientKey: "internal", clientName: "Internal", days: { Mon: "AM" } })],
      events: [],
      config,
    });
    const mon = slot(w.days, 0, "AM");
    expect(mon.focus).toHaveLength(1);
    expect(mon.focus[0]?.source).toBe("dataverse");
    expect(mon.risks).toEqual([]);
  });

  it("flags two different Dataverse clients in the same half-day", () => {
    const w = buildWeek({
      weekStart: WEEK,
      patterns: [
        pattern({ id: "a", clientKey: "csc", clientName: "CSC", days: { Tue: "AM" } }),
        pattern({ id: "b", clientKey: "wc", clientName: "Woodard & Curran", days: { Tue: "AllDay" } }),
      ],
      events: [],
      config: noStanding,
    });
    expect(slot(w.days, 1, "AM").risks.map((r) => r.rule)).toEqual(["double_booked_block"]);
    expect(slot(w.days, 1, "PM").risks).toEqual([]);
  });

  it("marks empty Mon to Thu half-days Open and never marks Friday Open", () => {
    const w = buildWeek({ weekStart: WEEK, patterns: [pattern({ days: { Tue: "AM" } })], events: [], config });
    const open = w.days.flatMap((d) => [d.am, d.pm]).filter((s) => s.open).map((s) => `${s.date} ${s.half}`);
    expect(open).toEqual([
      "2026-11-02 PM",
      "2026-11-03 PM",
      "2026-11-04 AM",
      "2026-11-04 PM",
      "2026-11-05 AM",
      "2026-11-05 PM",
    ]);
    const fri = w.days[4]!;
    expect(fri.kind).toBe("overflow");
    expect(fri.am.focus).toEqual([]);
    expect(fri.am.open).toBe(false);
  });

  it("does not raise risks on Open half-days, even with heavy meetings", () => {
    const w = buildWeek({
      weekStart: WEEK,
      patterns: [],
      events: [meeting("2026-11-04T09:00", "2026-11-04T12:30")],
      config: noStanding,
    });
    expect(slot(w.days, 2, "AM").open).toBe(true);
    expect(slot(w.days, 2, "AM").risks).toEqual([]);
  });
});

describe("slot boundaries from the day shape", () => {
  it("uses 09:00, 12:30 and 17:00 New York time with the right offset either side of fall back", () => {
    const before = buildWeek({ weekStart: "2026-10-26", patterns: [], events: [], config });
    const after = buildWeek({ weekStart: WEEK, patterns: [], events: [], config });
    expect(before.days[0]!.am.start).toBe("2026-10-26T09:00:00-04:00");
    expect(after.days[0]!.am.start).toBe("2026-11-02T09:00:00-05:00");
    expect(after.days[0]!.am.end).toBe("2026-11-02T12:30:00-05:00");
    expect(after.days[0]!.pm.end).toBe("2026-11-02T17:00:00-05:00");
  });

  it("uses EDT after spring forward", () => {
    const w = buildWeek({ weekStart: "2027-03-15", patterns: [], events: [], config });
    expect(w.days[0]!.am.start).toBe("2027-03-15T09:00:00-04:00");
  });
});

describe("event placement", () => {
  const build = (events: Parameters<typeof buildWeek>[0]["events"]) =>
    buildWeek({ weekStart: WEEK, patterns: [], events, config: noStanding });

  it("places morning and afternoon meetings in AM and PM", () => {
    const w = build([
      meeting("2026-11-03T10:00", "2026-11-03T11:00", { title: "Standup" }),
      meeting("2026-11-03T14:00", "2026-11-03T15:00", { title: "Review" }),
    ]);
    expect(titles(w.days[1]!.am.events)).toEqual(["Standup"]);
    expect(titles(w.days[1]!.pm.events)).toEqual(["Review"]);
  });

  it("splits an event across the 12:30 boundary into both halves with clipped minutes", () => {
    const w = build([meeting("2026-11-03T12:00", "2026-11-03T13:00", { title: "Lunch and learn" })]);
    const am = w.days[1]!.am.events[0]!;
    const pm = w.days[1]!.pm.events[0]!;
    expect([am.minutesInside, am.continuesAfter]).toEqual([30, true]);
    expect([pm.minutesInside, pm.continuesBefore]).toEqual([30, true]);
    expect(pm.clipStart).toBe("2026-11-03T12:30:00-05:00");
  });

  it("treats an event ending exactly at 12:30 as AM only and one starting at 12:30 as PM only", () => {
    const w = build([
      meeting("2026-11-03T12:00", "2026-11-03T12:30", { title: "Ends at split" }),
      meeting("2026-11-03T12:30", "2026-11-03T13:00", { title: "Starts at split" }),
    ]);
    expect(titles(w.days[1]!.am.events)).toEqual(["Ends at split"]);
    expect(titles(w.days[1]!.pm.events)).toEqual(["Starts at split"]);
  });

  it("keeps early and evening events visible outside the half-days", () => {
    const w = build([
      personal("2026-11-03T08:30", "2026-11-03T09:00", { title: "Preschool drop-off" }),
      personal("2026-11-05T18:30", "2026-11-05T20:00", { title: "Parent night" }),
    ]);
    expect(titles(w.days[1]!.early)).toEqual(["Preschool drop-off"]);
    expect(w.days[1]!.am.events).toEqual([]);
    expect(titles(w.days[3]!.evening)).toEqual(["Parent night"]);
  });

  it("shows an event running past 17:00 in both PM and evening", () => {
    const w = build([meeting("2026-11-03T16:30", "2026-11-03T17:30", { title: "Runs late" })]);
    expect(w.days[1]!.pm.events[0]!.minutesInside).toBe(30);
    expect(w.days[1]!.evening[0]!.minutesInside).toBe(30);
  });

  it("converts other offsets and UTC into New York time", () => {
    const w = build([
      // 10:00 Pacific is 13:00 Eastern.
      meeting("2026-11-03T10:00:00-08:00", "2026-11-03T10:30:00-08:00", { title: "West coast" }),
      // 14:00 UTC is 09:00 EST after fall back...
      meeting("2026-11-02T14:00:00Z", "2026-11-02T14:30:00Z", { title: "UTC Monday" }),
    ]);
    expect(titles(w.days[1]!.pm.events)).toEqual(["West coast"]);
    expect(titles(w.days[0]!.am.events)).toEqual(["UTC Monday"]);
  });

  it("puts the same UTC time in a different place the week before fall back", () => {
    // ...but 13:00 UTC on Oct 26 is 09:00 EDT and on Nov 2 is 08:00 EST.
    const before = buildWeek({ weekStart: "2026-10-26", patterns: [], events: [meeting("2026-10-26T13:00:00Z", "2026-10-26T13:30:00Z")], config: noStanding });
    const after = build([meeting("2026-11-02T13:00:00Z", "2026-11-02T13:30:00Z")]);
    expect(before.days[0]!.am.events).toHaveLength(1);
    expect(after.days[0]!.am.events).toHaveLength(0);
    expect(after.days[0]!.early).toHaveLength(1);
  });

  it("places all-day events on each covered day using an exclusive end date", () => {
    const w = build([allDayPersonal("2026-11-03", "2026-11-05", "Grandparents visiting")]);
    expect(w.days.map((d) => d.allDay.length)).toEqual([0, 1, 1, 0, 0]);
  });

  it("places a late-night event in that evening and the next morning", () => {
    const w = build([personal("2026-11-03T22:00", "2026-11-04T01:00", { title: "Late flight" })]);
    expect(titles(w.days[1]!.evening)).toEqual(["Late flight"]);
    expect(titles(w.days[2]!.early)).toEqual(["Late flight"]);
  });

  it("includes Friday events and drops weekend and other-week events", () => {
    const w = build([
      meeting("2026-11-06T11:00", "2026-11-06T11:30", { title: "All hands" }),
      meeting("2026-11-07T11:00", "2026-11-07T11:30", { title: "Saturday" }),
      meeting("2026-11-10T11:00", "2026-11-10T11:30", { title: "Next week" }),
    ]);
    expect(titles(w.days[4]!.am.events)).toEqual(["All hands"]);
    const all = w.days.flatMap((d) => [...d.early, ...d.am.events, ...d.pm.events, ...d.evening]);
    expect(titles(all)).toEqual(["All hands"]);
  });

  it("excludes declined Outlook events", () => {
    const w = build([meeting("2026-11-03T10:00", "2026-11-03T11:00", { responseStatus: "declined" })]);
    expect(w.days[1]!.am.events).toEqual([]);
  });

  it("orders events in a half-day by start time", () => {
    const w = build([
      meeting("2026-11-03T11:00", "2026-11-03T11:30", { title: "Second" }),
      meeting("2026-11-03T09:30", "2026-11-03T10:00", { title: "First" }),
    ]);
    expect(titles(w.days[1]!.am.events)).toEqual(["First", "Second"]);
  });
});
