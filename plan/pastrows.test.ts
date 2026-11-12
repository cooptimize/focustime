// WK-5: a past block's rows (done, unfinished, moved, more than six, none).
import { describe, expect, it } from "vitest";
import { movedTo, PAST_ROWS, pastRows } from "./pastrows.ts";

const p = (id: number, status: string, carriedTo: { date: string; half: "AM" | "PM" } | null = null) => ({ id, status, carriedTo });

describe("pastRows", () => {
  it("lists unfinished, then done, then moved on", () => {
    const r = pastRows([p(1, "done"), p(2, "moved", { date: "2026-11-12", half: "AM" }), p(3, "planned")]);
    expect(r.rows.map((x) => x.id)).toEqual([3, 1, 2]);
    expect(r.more).toBe(0);
    expect(r.empty).toBe(false);
  });
  it("shows six at most, then a count", () => {
    const r = pastRows(Array.from({ length: 9 }, (_, i) => p(i + 1, i < 3 ? "done" : "planned")));
    expect(r.rows).toHaveLength(PAST_ROWS);
    expect(r.more).toBe(3);
    expect(r.rows.slice(0, 6).every((x) => x.status === "planned")).toBe(true);
  });
  it("leaves out dropped to-dos and a moved one with nowhere it went", () => {
    const r = pastRows([p(1, "dropped"), p(2, "moved", null), p(3, "removed")]);
    expect(r.empty).toBe(true);
    expect(r.rows).toEqual([]);
  });
  it("is empty with nothing planned", () => {
    expect(pastRows([]).empty).toBe(true);
  });
});

describe("movedTo", () => {
  it("names the day in the same week, and the date in another", () => {
    expect(movedTo({ date: "2026-11-12" }, "2026-11-09")).toBe("→ Thu");
    expect(movedTo({ date: "2026-11-16" }, "2026-11-09")).toBe("→ Mon 16");
  });
});
