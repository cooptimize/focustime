import { describe, expect, it } from "vitest";
import { dropCheck, type Dragged } from "./weekdrop.ts";
import { SIZE_MINUTES } from "./types.ts";
import { aMeeting, aPick, aPto, aWeek } from "../test/builders/index.ts";

// The target is Tue Nov 3 AM of the default week. The clock is Monday 8:00.
const NOW = "2026-11-02T13:00:00Z";
const story: Dragged = { clientKey: "adatum", itemId: 100, size: "M", title: "Story" };
const base = (o: Partial<Parameters<typeof dropCheck>[0]> = {}) => {
  const week = aWeek();
  return { slot: week.days[1]!.am, ptoDay: false, catchUp: false, now: NOW, today: "2026-11-02", picks: [], sizes: SIZE_MINUTES, dragged: story, ...o };
};

describe("dropCheck (PV-1)", () => {
  it("shows the story's hours against the block's free time left", () => {
    expect(dropCheck(base())).toEqual({ ok: true, text: "2h of 4h free", over: false, freeMinutes: 210 });
    // QT-1: a 2h meeting and 1h already planned leave 1h: the 2h story still drops, and the tip says only what's free.
    const week = aWeek({ events: [aMeeting({ start: "2026-11-03T09:00", end: "2026-11-03T11:00" })] });
    const picks = [aPick({ date: "2026-11-03", half: "AM", itemId: 7, size: "S" })];
    expect(dropCheck(base({ slot: week.days[1]!.am, picks }))).toMatchObject({ ok: true, text: "1h free", over: false });
    const full = [...picks, aPick({ id: 8, date: "2026-11-03", half: "AM", itemId: 8, size: "L" })];
    expect(dropCheck(base({ slot: week.days[1]!.am, picks: full }))).toMatchObject({ ok: true, text: "No free time left", over: false });
  });

  it("AS-2: a PTO day takes it with a note (supersedes PV-1's refusal)", () => {
    expect(dropCheck(base({ ptoDay: true }))).toEqual({ ok: true, text: "You're on PTO that day", over: false });
    const week = aWeek({ pto: [aPto({ date: "2026-11-03" })] });
    expect(dropCheck(base({ slot: week.days[1]!.am }))).toEqual({ ok: true, text: "You're on PTO that day", over: false });
  });

  it("refuses past days and a block that already has the story", () => {
    expect(dropCheck(base({ today: "2026-11-04" }))).toEqual({ ok: false, why: "Already over" });
    // QT-1: a block that ended earlier today takes work.
    expect(dropCheck(base({ today: "2026-11-03", now: "2026-11-03T20:00:00Z" }))).toMatchObject({ ok: true });
    const picks = [aPick({ id: 5, date: "2026-11-03", half: "AM", itemId: 100 })];
    expect(dropCheck(base({ picks }))).toEqual({ ok: false, why: "Already planned here" });
    expect(dropCheck(base({ picks, dragged: { ...story, pickId: 5 } }))).toEqual({ ok: false, why: "Planned here" });
    // Another client's block: refused by name; the story's own client's block takes it.
    const slot = { ...aWeek().days[1]!.am, focus: [{ clientKey: "fabrikam", clientName: "Fabrikam" }] };
    expect(dropCheck(base({ slot }))).toEqual({ ok: false, why: "Fabrikam's block" });
    expect(dropCheck(base({ slot: { ...slot, focus: [{ clientKey: "adatum", clientName: "Adatum" }] } })).ok).toBe(true);
  });

  it("takes catch-up work on a day with no hours, without a fit (AS-2: a note, never a refusal)", () => {
    const fri = aWeek().days[4]!;
    expect(dropCheck(base({ slot: fri.am, catchUp: true }))).toEqual({ ok: true, text: "Friday is your catch-up day", over: false });
    expect(dropCheck(base({ slot: fri.am }))).toEqual({ ok: true, text: "Friday is your catch-up day", over: false });
    const sat = { ...fri.am, date: "2026-11-07", start: "2026-11-07T14:00:00Z", end: "2026-11-07T17:00:00Z" };
    expect(dropCheck(base({ slot: sat, catchUp: true }))).toEqual({ ok: true, text: "Saturday isn't a working day: this is flex time", over: false });
    const wed = { ...aWeek().days[2]!.am, off: true };
    expect(dropCheck(base({ slot: wed }))).toEqual({ ok: true, text: "Wednesday has no working hours: this is flex time", over: false });
  });
});
