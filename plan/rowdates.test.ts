// D461: target dates on rows only when they matter this week; D460: other owners as an avatar stack.
import { describe, expect, it } from "vitest";
import { avatarStack, dateInWeekWords, otherOwners, rowDue } from "./rowdates.ts";

// Planning the week of Mon Nov 9, on Tue Nov 3.
const ctx = { weekStart: "2026-11-09", today: "2026-11-03" };

describe("rowDue (D461)", () => {
  it("in the week being planned: the weekday, not amber when nothing is planned after it", () => {
    expect(rowDue("2026-11-12", ctx)).toMatchObject({ text: "due Thu", late: false });
  });
  it("Friday is in the week", () => {
    expect(rowDue("2026-11-13", ctx)).toMatchObject({ text: "due Fri", late: false });
    expect(rowDue("2026-11-14", ctx)).toBeNull();
  });
  it("past: was due, amber, never red", () => {
    expect(rowDue("2026-11-02", ctx)).toEqual({ text: "was due Nov 2", late: true, title: "Target date Nov 2 has passed" });
  });
  it("before its pinned block: amber; on the pinned day or after it: not", () => {
    expect(rowDue("2026-11-10", { ...ctx, pinned: ["2026-11-12"] })).toMatchObject({ text: "due Tue", late: true });
    expect(rowDue("2026-11-12", { ...ctx, pinned: ["2026-11-12"] })).toMatchObject({ late: false });
    // The pin says when the work happens; the client's later blocks don't matter then.
    expect(rowDue("2026-11-12", { ...ctx, pinned: ["2026-11-10"], lastBlock: "2026-11-13" })).toMatchObject({ late: false });
  });
  it("unpinned, before its client's last block that week: amber", () => {
    expect(rowDue("2026-11-10", { ...ctx, lastBlock: "2026-11-12" })).toMatchObject({ text: "due Tue", late: true, title: "Target date Tue, Nov 10, before Thu, its client's last block this week" });
    expect(rowDue("2026-11-12", { ...ctx, lastBlock: "2026-11-12" })).toMatchObject({ late: false });
  });
  it("no date, or a date after the week or between today and the week: nothing", () => {
    expect(rowDue(null, ctx)).toBeNull();
    expect(rowDue(undefined, ctx)).toBeNull();
    expect(rowDue("2026-11-20", ctx)).toBeNull();
    expect(rowDue("2026-11-05", ctx)).toBeNull();
  });
});

describe("dateInWeekWords", () => {
  it("the weekday inside the week shown, else the date", () => {
    expect(dateInWeekWords("2026-11-13", "2026-11-09")).toBe("Fri");
    expect(dateInWeekWords("2026-11-20", "2026-11-09")).toBe("Nov 20");
  });
});

describe("other owners (D460)", () => {
  const kid = (id: number, assignedTo: string | null, x: { mine?: boolean; email?: string | null; open?: boolean } = {}) => ({ id, level: "story", open: x.open ?? true, mine: !!x.mine, assignedTo, assignedToEmail: x.email ?? null });
  it("only others' open stories not on the list, each person once; mine and unassigned left out", () => {
    const kids = [kid(1, "Dana Lee", { email: "dana@example.com" }), kid(2, "Dana Lee", { email: "Dana@example.com" }), kid(3, "Me", { mine: true }), kid(4, null), kid(5, "Sam Ortiz", { open: false }), kid(6, "Ext Person"), kid(7, "Jo Park", { email: "jo@example.com" })];
    expect(otherOwners(kids, new Set([7]))).toEqual([{ name: "Dana Lee", email: "dana@example.com" }, { name: "Ext Person", email: null }]);
    expect(otherOwners([kid(3, "Me", { mine: true })], new Set())).toEqual([]);
  });
  it("three avatars, then +N, with every name in the tooltip", () => {
    const o = ["A One", "B Two", "C Three", "D Four", "E Five"].map((name) => ({ name, email: null }));
    expect(avatarStack(o)).toEqual({ shown: o.slice(0, 3), more: 2, names: "A One, B Two, C Three, D Four, E Five" });
    expect(avatarStack(o.slice(0, 2))).toMatchObject({ more: 0 });
  });
});
