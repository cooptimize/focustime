import { describe, expect, it } from "vitest";
import { dayRolledOver } from "./planday.ts";

const at = (s: string) => Temporal.ZonedDateTime.from(`${s}[America/New_York]`);
describe("day rollover while running", () => {
  it("notices midnight, and a whole weekend", () => {
    expect(dayRolledOver(at("2026-11-03T23:59:00-05:00"), "2026-11-03")).toBe(false);
    expect(dayRolledOver(at("2026-11-04T00:00:30-05:00"), "2026-11-03")).toBe(true);
    expect(dayRolledOver(at("2026-11-09T07:00:00-05:00"), "2026-11-06")).toBe(true);
  });
});
