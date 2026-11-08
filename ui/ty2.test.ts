// TY-2: the first hour line and which events count as overlapping.
import { describe, expect, it } from "vitest";
import type { PlacedEvent } from "../week/types.ts";
import { hourMarks, overlappingIds } from "./layout.ts";

const at = (t: string) => `2026-11-02T${t}:00-05:00`;
const placed = (id: string, a: string, b: string, event: object = {}) => ({ event: { id, ...event }, clipStart: at(a), clipEnd: at(b) }) as unknown as PlacedEvent;

describe("hourMarks", () => {
  const tz = "America/Chicago";
  it("names the first line only when asked (Week's cards don't)", () => {
    expect(hourMarks(`2026-11-02T09:00:00-06:00`, `2026-11-02T11:00:00-06:00`, tz).map((m) => m.label)).toEqual(["10 AM"]);
    expect(hourMarks(`2026-11-02T09:00:00-06:00`, `2026-11-02T11:00:00-06:00`, tz, true).map((m) => [m.label, m.at])).toEqual([["9 AM", 0], ["10 AM", 0.5]]);
  });
  it("a block that starts between hours starts at its first full hour either way", () => {
    expect(hourMarks(`2026-11-02T12:30:00-06:00`, `2026-11-02T14:30:00-06:00`, tz, true).map((m) => m.label)).toEqual(["1 PM", "2 PM"]);
  });
});

describe("overlappingIds", () => {
  it("marks both of two events that share time, and nothing back to back", () => {
    expect([...overlappingIds([placed("a", "13:00", "14:00"), placed("b", "13:30", "14:30"), placed("c", "14:30", "15:00")])].sort()).toEqual(["a", "b"]);
  });
  it("a free event or unavailable time neither gets it nor gives it", () => {
    expect(overlappingIds([placed("a", "13:00", "14:00"), placed("f", "13:00", "14:00", { showAs: "free" }), placed("u", "13:00", "14:00", { unavailable: true })]).size).toBe(0);
  });
});
