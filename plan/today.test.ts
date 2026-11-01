import { describe, expect, it } from "vitest";
import { focusPick, urgentLoops } from "./today.ts";
import type { Pick } from "./types.ts";

const pick = (id: number, half: Pick["half"], position: number, status: Pick["status"] = "planned") =>
  ({ id, half, position, status, date: "2026-11-02", clientKey: "W&C", kind: "intention", title: `p${id}`, size: "M" }) as Pick;

describe("Today", () => {
  it("Start focus takes the first planned pick of the half-day under way, then later ones, then any left", () => {
    const picks = [pick(1, "AM", 0, "done"), pick(2, "AM", 1), pick(3, "PM", 0), pick(4, "EVE", 0)];
    expect(focusPick(picks, "AM")?.id).toBe(2);
    expect(focusPick(picks, "PM")?.id).toBe(3);
    expect(focusPick([pick(2, "AM", 1)], "PM")?.id).toBe(2); // a morning pick left over in the afternoon
    expect(focusPick(picks, null)?.id).toBe(2);
    expect(focusPick([pick(1, "AM", 0, "done")], "AM")).toBeNull();
  });
  it("urgent loops: open and due today or earlier", () => {
    const loops = [{ id: 1, due: "2026-11-03" }, { id: 2, due: "2026-11-02" }, { id: 3, due: null }, { id: 4, due: "2026-10-30" }, { id: 5, due: "2026-11-01", closedAt: "x" }];
    expect(urgentLoops(loops, "2026-11-02").map((l) => l.id)).toEqual([4, 2]);
  });
});
