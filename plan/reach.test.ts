import { describe, expect, it } from "vitest";
import { freeBefore, reach } from "./reach.ts";

const base = { today: "2026-11-02", me: "me@example.com", weeks: [{ weekStart: "2026-11-02", freeMinutes: 420 }, { weekStart: "2026-11-09", freeMinutes: 420 }], months: [] };
const mine = (minutes: number | null) => ({ assigneeEmail: "me@example.com", assigneeName: "Me", minutes });

describe("can't reach target (D659)", () => {
  it("prorates the week the target falls in, by weekdays", () => {
    expect(freeBefore(base, "2026-11-08")).toBe(420);
    expect(freeBefore(base, "2026-11-12")).toBe(420 + 336);
    expect(freeBefore(base, "2026-11-06")).toBe(420);
  });
  it("amber when my open stories need more than my free time before the target; unsized count 2h", () => {
    expect(reach({ ...base, target: "2026-11-06", stories: [mine(240), mine(null), mine(120)] })).toEqual({ kind: "short", needMinutes: 480, freeMinutes: 420 });
    expect(reach({ ...base, target: "2026-11-13", stories: [mine(240)] }).kind).toBe("ok");
  });
  it("says so instead of guessing when someone else's blocks would count", () => {
    expect(reach({ ...base, target: "2026-11-13", stories: [mine(60), { assigneeEmail: "sam@example.com", assigneeName: "Sam Lee", minutes: 60 }] })).toEqual({ kind: "unknown", text: "Can't check: Sam Lee's blocks aren't known" });
    expect(reach({ ...base, target: "2026-11-13", stories: [{ assigneeEmail: null, assigneeName: null, minutes: 60 }] })).toEqual({ kind: "unknown", text: "Can't check: 1 story isn't assigned" });
    expect(reach({ ...base, target: null, stories: [mine(60)] }).kind).toBe("none");
  });
});
