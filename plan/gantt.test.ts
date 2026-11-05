import { describe, expect, it } from "vitest";
import { dragHalves, fromHalfIndex, ganttBar, halfAt, halfIndex, halfX, halvesMoved, receive, release, shownOrder } from "./gantt.ts";
import { aheadColumns, aheadWeeks, timelineScale } from "./ahead.ts";

const scale = timelineScale(aheadColumns(aheadWeeks("2026-11-02")), { week: 140, month: 200 });

describe("half-day snap (D659)", () => {
  it("counts two halves a day", () => {
    const a = { date: "2026-11-02", half: "AM" as const };
    expect(halfIndex({ date: "2026-11-02", half: "PM" }) - halfIndex(a)).toBe(1);
    expect(fromHalfIndex(halfIndex(a) + 3)).toEqual({ date: "2026-11-03", half: "PM" });
  });
  it("a PM starts halfway through its day; the pointer snaps to the half under it", () => {
    const am = halfX(scale, { date: "2026-11-03", half: "AM" });
    const pm = halfX(scale, { date: "2026-11-03", half: "PM" });
    expect(pm - am).toBeCloseTo(10, 5); // 140 px a week: 20 px a day
    expect(halfAt(scale, am + 4)).toEqual({ date: "2026-11-03", half: "AM" });
    expect(halfAt(scale, am + 14)).toEqual({ date: "2026-11-03", half: "PM" });
    expect(halvesMoved(scale, am + 1, am + 31)).toBe(3);
  });
  it("drags the body by whole halves and an edge never past the other", () => {
    const b = { start: { date: "2026-11-02", half: "AM" as const }, end: { date: "2026-11-06", half: "PM" as const } };
    expect(dragHalves(b, "move", 3)).toEqual({ start: { date: "2026-11-03", half: "PM" }, end: { date: "2026-11-08", half: "AM" } });
    expect(dragHalves(b, "end", -100)).toEqual({ start: b.start, end: b.start });
    expect(dragHalves(b, "start", 1).start).toEqual({ date: "2026-11-02", half: "PM" });
  });
});

describe("bars with a missing date", () => {
  it("a missing start is a dashed edge from the estimate (or two weeks before the target)", () => {
    const b = ganttBar({ start: null, target: "2026-11-20", estimate: null })!;
    expect(b).toMatchObject({ dashedStart: true, dashedEnd: false, start: { date: "2026-11-07", half: "AM" }, end: { date: "2026-11-20", half: "PM" } });
    expect(ganttBar({ start: null, target: "2026-11-20", estimate: { start: "2026-11-09", end: "2026-11-13" } })!.start.date).toBe("2026-11-09");
  });
  it("no dates: no bar", () => {
    expect(ganttBar({ start: null, target: null, estimate: { start: "2026-11-09", end: "2026-11-13" } })).toBeNull();
  });
  it("keeps the half I chose for display", () => {
    expect(ganttBar({ start: "2026-11-09", target: "2026-11-13", startHalf: "PM", targetHalf: "AM", estimate: null })).toMatchObject({ start: { half: "PM" }, end: { half: "AM" } });
  });
});

describe("the drag bug (D655): order frozen during a drag, one reflow on drop", () => {
  it("keeps the order a drag began with, whatever arrives", () => {
    const frozen = ["a", "b", "c"];
    expect(shownOrder(frozen, ["b", "a", "c"])).toEqual(["a", "b", "c"]);
    expect(shownOrder(frozen, ["c", "d", "a"])).toEqual(["a", "c", "d"]);
    expect(shownOrder(null, ["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });
  it("holds data that lands mid-drag and shows it once on drop", () => {
    let h = { shown: 1, pending: null as number | null };
    h = receive(h, 2, true);
    h = receive(h, 3, true);
    expect(h).toEqual({ shown: 1, pending: 3 });
    h = release(h);
    expect(h).toEqual({ shown: 3, pending: null });
    expect(receive(h, 4, false)).toEqual({ shown: 4, pending: null });
  });
});
