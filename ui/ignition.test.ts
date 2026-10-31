import { describe, expect, it } from "vitest";
import { autoOpenDue, dayRolledOver } from "./ignition.ts";

const at = (s: string) => Temporal.ZonedDateTime.from(`${s}[America/New_York]`);
const ig = (over: Partial<{ date: string; workday: boolean; committed: boolean; available: boolean }> = {}) => ({ date: "2026-11-03", workday: true, committed: false, available: true, ...over });

describe("automatic ignition", () => {
  it("is due on a workday from 05:00 when today isn't committed", () => {
    expect(autoOpenDue(at("2026-11-03T04:59:00-05:00"), ig())).toBe(false);
    expect(autoOpenDue(at("2026-11-03T05:00:00-05:00"), ig())).toBe(true);
    expect(autoOpenDue(at("2026-11-03T15:00:00-05:00"), ig())).toBe(true);
  });
  it("not on Friday or weekends, not once committed, not without the plan store", () => {
    expect(autoOpenDue(at("2026-11-03T08:00:00-05:00"), ig({ workday: false }))).toBe(false);
    expect(autoOpenDue(at("2026-11-03T08:00:00-05:00"), ig({ committed: true }))).toBe(false);
    expect(autoOpenDue(at("2026-11-03T08:00:00-05:00"), ig({ available: false }))).toBe(false);
  });
  it("not when the loaded data is from yesterday (reload first)", () => {
    expect(autoOpenDue(at("2026-11-04T08:00:00-05:00"), ig())).toBe(false);
  });
});

describe("day rollover while running", () => {
  it("notices midnight, and a whole weekend", () => {
    expect(dayRolledOver(at("2026-11-03T23:59:00-05:00"), "2026-11-03")).toBe(false);
    expect(dayRolledOver(at("2026-11-04T00:00:30-05:00"), "2026-11-03")).toBe(true);
    expect(dayRolledOver(at("2026-11-09T07:00:00-05:00"), "2026-11-06")).toBe(true);
  });
});
