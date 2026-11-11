// WD-2: Day's own rules: the header's words, today's next to-do, and which card shows above the blocks.
import { describe, expect, it } from "vitest";
import { aboveBlocks, dayHeadline, nextTodo } from "./dayview.ts";

describe("Day's header", () => {
  it("names the date; a day that isn't today says past or ahead", () => {
    expect(dayHeadline("2026-11-11", "2026-11-11")).toEqual({ date: "Wed, Nov 11", when: "" });
    expect(dayHeadline("2026-11-10", "2026-11-11")).toEqual({ date: "Tue, Nov 10", when: "past" });
    expect(dayHeadline("2026-11-12", "2026-11-11")).toEqual({ date: "Thu, Nov 12", when: "ahead" });
  });
});

describe("today's next to-do", () => {
  const p = (id: number, half: "AM" | "PM", status = "planned", position = id) => ({ id, half, status, position });
  const blocks = [{ half: "AM" as const, ended: false }, { half: "PM" as const, ended: false }];
  it("the first planned one, in its block's order, in the first block that hasn't ended", () => {
    expect(nextTodo(blocks, [p(2, "AM", "planned", 2), p(1, "AM", "planned", 1), p(3, "PM")], null)?.id).toBe(1);
    expect(nextTodo(blocks, [p(1, "AM", "done"), p(3, "PM")], null)?.id).toBe(3);
    expect(nextTodo([{ half: "AM", ended: true }, { half: "PM", ended: false }], [p(1, "AM"), p(3, "PM")], null)?.id).toBe(3);
  });
  it("the one being timed comes first while it is still planned", () => {
    expect(nextTodo(blocks, [p(1, "AM"), p(3, "PM")], 3)?.id).toBe(3);
    expect(nextTodo(blocks, [p(1, "AM"), p(3, "PM", "done")], 3)?.id).toBe(1);
  });
  it("none when nothing is left in a block still open", () => {
    expect(nextTodo(blocks, [], null)).toBeNull();
    expect(nextTodo([{ half: "AM", ended: true }, { half: "PM", ended: true }], [p(1, "AM")], null)).toBeNull();
  });
});

describe("above Day's blocks", () => {
  const moment = { kind: "plan" };
  it("the urgent strip, one line of chips, then the card for the moment, in that order and nothing else", () => {
    expect(aboveBlocks({ mode: "now", today: true, urgent: 2, chips: true, moment })).toEqual(["urgent", "chips", "moment"]);
    expect(aboveBlocks({ mode: "now", today: true, urgent: 0, chips: false, moment })).toEqual(["moment"]);
    expect(aboveBlocks({ mode: "now", today: true, urgent: 1, chips: false, moment: null })).toEqual(["urgent"]);
    expect(aboveBlocks({ mode: "now", today: true, urgent: 0, chips: false, moment: null })).toEqual([]);
  });
  it("which card: the one that is current (nothing on today yet, check in or close out), one at a time", () => {
    for (const kind of ["plan", "checkin", "closeout"]) expect(aboveBlocks({ mode: "now", today: true, urgent: 0, chips: false, moment: { kind } })).toEqual(["moment"]);
  });
  it("nothing on another day, and nothing during the check-in or Close out", () => {
    expect(aboveBlocks({ mode: "now", today: false, urgent: 3, chips: true, moment })).toEqual([]);
    expect(aboveBlocks({ mode: "checkin", today: true, urgent: 3, chips: true, moment })).toEqual([]);
    expect(aboveBlocks({ mode: "closeout", today: true, urgent: 3, chips: true, moment })).toEqual([]);
  });
});
