// CF-1 (D1): which weeks an action changed, so they're published for teammates and the status report at once.
import { describe, expect, it } from "vitest";
import { WEEK_CHANGES, weeksTouched } from "./dispatch.ts";

describe("weeksTouched", () => {
  it("names the Monday of the input's week or date and of the answer's to-do, row or day", () => {
    expect(weeksTouched({ weekStart: "2026-11-09" }, {})).toEqual(["2026-11-09"]);
    expect(weeksTouched({ date: "2026-11-04", half: "AM" }, {})).toEqual(["2026-11-02"]);
    // A move: the input names the new day, the answer the day it left.
    expect(weeksTouched({ date: "2026-11-10" }, { state: { date: "2026-11-06" } }).sort()).toEqual(["2026-11-02", "2026-11-09"]);
    expect(weeksTouched({ id: 3 }, { item: { weekStart: "2026-11-16" } })).toEqual(["2026-11-16"]);
  });
  it("names nothing for input with no dates", () => {
    expect(weeksTouched({ id: 3 }, null)).toEqual([]);
    expect(weeksTouched("x", "y")).toEqual([]);
  });
  it("CF-1 review: Ahead's hours on a feature (set_feature) and the actions that place or take off work publish", () => {
    for (const a of ["weekplan.set_feature", "weekplan.add", "weekplan.remove", "weekplan.place", "pick.add", "pick.move", "pick.remove", "send.accept"]) expect(WEEK_CHANGES.has(a), a).toBe(true);
  });
});
