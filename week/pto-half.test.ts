// S1 (D453): one PTO answer per half, shared by Week, Plan the week and Plan the day. Built on the shared builders.
import { DEFAULT_SIZE_SCALE } from "../plan/estimate.ts";
import { describe, expect, it } from "vitest";
import { aClient, aFocusBlock, anOutOfOffice, aPto, aWeek } from "../test/builders/index.ts";
import { NO_TIME, pinnedToPto, weekBudget } from "../plan/weekplan.ts";
import { countedLines, weekLines } from "../plan/weekclients.ts";
import { freeMinutes } from "./free.ts";

const THU = "2026-11-05";
const adatum = aClient({ name: "Adatum" });
const northwind = aClient({ name: "Northwind" });
const thu = (w: ReturnType<typeof aWeek>) => w.days.find((d) => d.date === THU)!;
const blocks = [aFocusBlock({ client: adatum, days: { Thu: "AM", Mon: "PM" } }), aFocusBlock({ client: northwind, days: { Thu: "PM" } })];

describe("PTO per half (Week, Plan the week and Plan the day read the same slots)", () => {
  it("a full PTO day: both halves PTO, one whole-day PTO, no free time, no Open half", () => {
    const d = thu(aWeek({ patterns: blocks, pto: [aPto({ date: THU, titles: ["Watch Kids"] })] }));
    expect(d.pto?.titles).toEqual(["Watch Kids"]);
    expect(d.ptoHalf).toBeNull();
    expect([d.am.pto, d.pm.pto, d.am.open, d.pm.open]).toEqual([true, true, false, false]);
    expect([freeMinutes(d.am), freeMinutes(d.pm)]).toEqual([0, 0]);
    expect([...d.am.risks, ...d.pm.risks]).toEqual([]);
  });

  it("morning only: out of office over the morning's working hours makes the morning PTO, not the afternoon", () => {
    const d = thu(aWeek({ patterns: blocks, events: [anOutOfOffice()] }));
    expect(d.pto).toBeNull();
    expect(d.ptoHalf).toMatchObject({ half: "AM", titles: ["Out of office"] });
    expect([d.am.pto, d.pm.pto]).toEqual([true, false]);
    expect(freeMinutes(d.am)).toBe(0);
    expect(freeMinutes(d.pm)).toBeGreaterThan(0);
    // The focus block stays in the data (read only); it just can't be planned.
    expect(d.am.focus[0]?.clientKey).toBe("adatum");
  });

  it("afternoon only, and a PM-only Dataverse half", () => {
    const pm = thu(aWeek({ patterns: blocks, events: [anOutOfOffice({ start: `${THU}T12:30`, end: `${THU}T17:00` })] }));
    expect([pm.am.pto, pm.pm.pto, pm.ptoHalf?.half]).toEqual([false, true, "PM"]);
    const listed = thu(aWeek({ patterns: blocks, pto: [aPto({ date: THU, half: "PM" })] }));
    expect([listed.am.pto, listed.pm.pto, listed.ptoHalf?.half, listed.pto]).toEqual([false, true, "PM", null]);
  });

  it("out of office all day, or over both halves, is the whole day", () => {
    const allDay = thu(aWeek({ events: [anOutOfOffice({ allDay: true, start: THU, end: "2026-11-06" })] }));
    expect([allDay.am.pto, allDay.pm.pto, !!allDay.pto]).toEqual([true, true, true]);
    const both = thu(aWeek({ events: [anOutOfOffice({ start: `${THU}T08:00`, end: `${THU}T18:00` })] }));
    expect(both.pto?.titles).toEqual(["Out of office"]);
  });

  it("an hour out of office is not PTO (the half keeps its time, less that hour)", () => {
    const d = thu(aWeek({ patterns: blocks, events: [anOutOfOffice({ start: `${THU}T07:30`, end: `${THU}T09:30` })] }));
    expect([d.am.pto, d.pm.pto, d.pto, d.ptoHalf]).toEqual([false, false, null, null]);
    // Personal out of office isn't read as PTO either.
    expect(thu(aWeek({ events: [anOutOfOffice({ isPersonal: true })] })).am.pto).toBe(false);
  });
});

describe("PTO in Plan the week's budget", () => {
  const item = (clientKey: string, itemId: number, slots: { date: string; half: "AM" | "PM" }[] = []) => ({ clientKey, itemId, title: `Feature ${itemId}`, tier: "must" as const, level: "feature" as const, estimate: 240, parentId: null, slots });

  it("PTO adds no free hours and is left out of the client's blocks", () => {
    const plain = weekBudget(aWeek({ patterns: blocks }), [], { sizes: DEFAULT_SIZE_SCALE, borrowedMinutes: {} }).find((b) => b.clientKey === "adatum")!;
    const off = weekBudget(aWeek({ patterns: blocks, events: [anOutOfOffice()] }), [], { sizes: DEFAULT_SIZE_SCALE, borrowedMinutes: {} }).find((b) => b.clientKey === "adatum")!;
    expect(plain.blocks).toHaveLength(2);
    expect(off.blocks.map((b) => b.date)).toEqual(["2026-11-02"]);
    expect(off.ptoBlocks).toEqual([{ date: THU, half: "AM" }]);
    expect(off.freeMinutes).toBe(plain.freeMinutes - plain.blocks.find((b) => b.date === THU)!.freeMinutes);
  });

  it("a client with only PTO that week: No time this week, a line kept, not in the header count", () => {
    const week = aWeek({ patterns: blocks, events: [anOutOfOffice({ start: `${THU}T12:30`, end: `${THU}T17:00` })] });
    const fits = weekBudget(week, [item("northwind", 7)], { sizes: DEFAULT_SIZE_SCALE, borrowedMinutes: {} });
    const nw = fits.find((b) => b.clientKey === "northwind")!;
    expect([nw.free, nw.freeMinutes, nw.blocks.length]).toEqual([NO_TIME, 0, 0]);
    expect(nw.text).toBe("No time this week · 4h planned");
    const lines = weekLines({ fits, items: [item("northwind", 7)], days: week.days, needs: () => false });
    expect(lines.map((l) => l.clientKey)).toEqual(["adatum", "northwind"]);
    expect(countedLines(lines).map((l) => l.clientKey)).toEqual(["adatum"]);
  });

  it("a must already pinned to PTO is flagged, not moved or unpinned", () => {
    const week = aWeek({ patterns: blocks, pto: [aPto({ date: THU })] });
    const pinned = item("adatum", 9, [{ date: THU, half: "AM" }]);
    expect(pinnedToPto(week, pinned.slots)).toEqual([{ date: THU, half: "AM" }]);
    weekBudget(week, [pinned], { sizes: DEFAULT_SIZE_SCALE, borrowedMinutes: {} });
    expect(pinned.slots).toEqual([{ date: THU, half: "AM" }]);
    expect(pinnedToPto(aWeek({ patterns: blocks }), pinned.slots)).toEqual([]);
  });
});
