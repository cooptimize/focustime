import { describe, expect, it } from "vitest";
import { CARD_CHIPS, chipFold, foldDone, HEAVY } from "./cardfold.ts";

const picks = (done: number, open: number) => [...Array.from({ length: done }, (_, i) => ({ id: i, status: "done" })), ...Array.from({ length: open }, (_, i) => ({ id: 100 + i, status: "planned" }))];

describe("folding done to-dos on a card (PS-1)", () => {
  it("other days always fold done to-dos", () => {
    const r = foldDone(picks(1, 2), { isToday: false });
    expect(r.done.map((p) => p.id)).toEqual([0]);
    expect(r.shown.map((p) => p.id)).toEqual([100, 101]);
  });
  it("today keeps them in place on a light block", () => {
    const r = foldDone(picks(2, HEAVY - 3), { isToday: true });
    expect(r.done).toEqual([]);
    expect(r.shown).toHaveLength(HEAVY - 1);
  });
  it("today folds them on a heavy block", () => {
    const r = foldDone(picks(3, HEAVY), { isToday: true });
    expect(r.done).toHaveLength(3);
    expect(r.shown.every((p) => p.status !== "done")).toBe(true);
  });
  it("nothing done, nothing folded", () => {
    expect(foldDone(picks(0, 9), { isToday: true }).done).toEqual([]);
  });
});

describe("chips on a card (PS-1)", () => {
  it("up to three show; a fourth folds two of them into +N, so the line is never more than three", () => {
    expect(chipFold([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(chipFold([1, 2, 3, 4])).toEqual({ shown: [1, 2], more: 2 });
    expect(chipFold([1, 2, 3, 4, 5, 6])).toEqual({ shown: [1, 2], more: 4 });
    expect(chipFold([])).toEqual({ shown: [], more: 0 });
    expect(CARD_CHIPS).toBe(3);
  });
});
