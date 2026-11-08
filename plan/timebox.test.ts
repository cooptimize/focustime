import { describe, expect, it } from "vitest";
import { outlookFields, ownEventIds, plannedWithTimeboxes, syncNeed, timeboxProblem, undoOf, withoutOwn, type OwnEvent } from "./timebox.ts";

const SLOT = { start: "2026-11-03T08:00:00-06:00", end: "2026-11-03T12:00:00-06:00" };
const SIZES = { S: 60, M: 120, L: 180, unsized: 60 };
const tb = (start: string, end: string, pickId: number | null = null, removedAt: string | null = null) => ({ pickId, start: `2026-11-03T${start}:00-06:00`, end: `2026-11-03T${end}:00-06:00`, removedAt });

describe("timebox validation", () => {
  it.each([
    ["2026-11-03T09:00:00-06:00", "2026-11-03T10:30:00-06:00", null],
    ["2026-11-03T10:00:00-06:00", "2026-11-03T09:00:00-06:00", "A timebox ends after it starts"],
    ["2026-11-03T09:00:00-06:00", "2026-11-03T09:10:00-06:00", "A timebox is at least 15 minutes"],
    ["2026-11-03T09:00:00-06:00", "2026-11-03T17:30:00-06:00", "A timebox is at most 8 hours"],
    ["2026-11-03T09:02:00-06:00", "2026-11-03T10:02:00-06:00", "Timebox times are in 5 minute steps"],
    ["2026-11-04T09:00:00-06:00", "2026-11-04T10:00:00-06:00", "A timebox starts on its own day"],
    ["nonsense", "2026-11-03T10:00:00-06:00", "Times aren't valid"],
  ])("%s to %s → %s", (s, e, want) => expect(timeboxProblem("2026-11-03", s, e)).toBe(want));
});

describe("timebox capacity math", () => {
  const picks = [
    { id: 1, status: "planned", size: "M" },
    { id: 2, status: "planned", size: "S" },
    { id: 3, status: "done", size: "L" },
  ];
  it("no timeboxes: sizes, as before", () => expect(plannedWithTimeboxes(picks, SIZES, [], SLOT)).toBe(180));
  it("a pick's timebox replaces its size", () => expect(plannedWithTimeboxes(picks, SIZES, [tb("09:00", "09:45", 1)], SLOT)).toBe(45 + 60));
  it("two timeboxes for one pick add up", () => expect(plannedWithTimeboxes(picks, SIZES, [tb("08:00", "08:30", 1), tb("10:00", "11:00", 1)], SLOT)).toBe(90 + 60));
  it("a timebox with no pick adds its time", () => expect(plannedWithTimeboxes(picks, SIZES, [tb("11:00", "11:30")], SLOT)).toBe(180 + 30));
  it("a timebox is clipped to the half-day", () => expect(plannedWithTimeboxes([], SIZES, [tb("11:30", "13:00")], SLOT)).toBe(30));
  it("a done pick's timebox doesn't count", () => expect(plannedWithTimeboxes(picks, SIZES, [tb("09:00", "10:00", 3)], SLOT)).toBe(180));
  it("a removed timebox doesn't count, and the pick's size is back", () => expect(plannedWithTimeboxes(picks, SIZES, [tb("09:00", "09:45", 1, "2026-11-02T10:00:00-06:00")], SLOT)).toBe(180));
  it("a pick boxed in the afternoon counts nothing in the morning (its time is in the PM)", () => expect(plannedWithTimeboxes(picks, SIZES, [tb("13:00", "14:00", 1)], SLOT)).toBe(60));
});

const fields = outlookFields({ title: "#4512 Import mapping", url: "https://dev.azure.com/adatum/p/_workitems/edit/4512", start: "2026-11-03T09:00:00-06:00", end: "2026-11-03T10:30:00-06:00" }, "Adatum");
describe("Outlook fields", () => {
  it("Busy, no reminder, '<client>: <title>', the DevOps link in the body, UTC times", () => {
    expect(fields).toEqual({ subject: "Adatum: #4512 Import mapping", body: "https://dev.azure.com/adatum/p/_workitems/edit/4512\n\nTimebox planned in FocusTime.", start: "2026-11-03T15:00:00Z", end: "2026-11-03T16:30:00Z", showAs: "busy", reminder: false });
  });
});

describe("sync need", () => {
  const own: OwnEvent = { uid: "u", timeboxId: 1, eventId: "E1", fields, deletedAt: null };
  it.each<[string, Parameters<typeof syncNeed>, string | null]>([
    ["on, nothing written", [{ outlook: true, removedAt: null }, null, fields], "create"],
    ["on, in step", [{ outlook: true, removedAt: null }, own, fields], null],
    ["on, moved", [{ outlook: true, removedAt: null }, own, { ...fields, start: "2026-11-03T15:30:00Z" }], "update"],
    ["toggled off", [{ outlook: false, removedAt: null }, own, fields], "delete"],
    ["removed", [{ outlook: true, removedAt: "x" }, own, fields], "delete"],
    ["timebox gone entirely", [null, own, null], "delete"],
    ["off, never written", [{ outlook: false, removedAt: null }, null, fields], null],
    ["on, event deleted earlier", [{ outlook: true, removedAt: null }, { ...own, deletedAt: "x" }, fields], "create"],
    // R1: an event written before the rename carries the old body line; that alone never rewrites it.
    ["on, written before the rename", [{ outlook: true, removedAt: null }, { ...own, fields: { ...fields, body: fields.body.replace("FocusTime.", "Coopilot.") } }, fields], null],
  ])("%s → %s", (_l, args, want) => expect(syncNeed(...args)).toBe(want));
});

describe("de-duplication of FocusTime events in the week view", () => {
  it("drops FocusTime's own events by recorded id and keeps everything else", () => {
    const ids = ownEventIds([{ uid: "u", timeboxId: 1, eventId: "E1", fields, deletedAt: null }, { uid: "v", timeboxId: 2, eventId: "E2", fields, deletedAt: "x" }]);
    const events = [{ id: "outlook:E1" }, { id: "outlook:E2" }, { id: "outlook:E3" }, { id: "google:E1" }];
    expect(withoutOwn(events, ids).map((e) => e.id)).toEqual(["outlook:E2", "outlook:E3", "google:E1"]);
  });
});

describe("undo", () => {
  const local = { start: "a", end: "b", outlook: false, removedAt: null };
  it("a create is undone by deleting the event", () => expect(undoOf({ op: "create", uid: "u", eventId: "E1", before: null, after: fields, localBefore: local })).toMatchObject({ op: "delete", eventId: "E1", local }));
  it("an update is undone by putting the prior values back", () => expect(undoOf({ op: "update", uid: "u", eventId: "E1", before: fields, after: { ...fields, start: "x" }, localBefore: local })).toMatchObject({ op: "update", eventId: "E1", fields }));
  it("a delete is undone by recreating the event with the same marker", () => expect(undoOf({ op: "delete", uid: "u", eventId: "E1", before: fields, after: null, localBefore: local })).toMatchObject({ op: "create", uid: "u", fields }));
});
