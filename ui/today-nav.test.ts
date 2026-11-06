// QF-1 (part 1): Today on any day keeps its date in the address (#/today/<date>), so it can be linked and reopened;
// ‹ › and [ ] step weekdays.
import { describe, expect, it } from "vitest";
import { hashOf, navOf, parseHash, stepWeekday } from "./nav.ts";

describe("Today's day in the address", () => {
  it("#/today/<date> round-trips; bare #/today is today", () => {
    expect(hashOf({ nav: navOf.todayOn("2026-11-03"), overlay: null })).toBe("#/today/2026-11-03");
    expect(parseHash("#/today/2026-11-03")?.nav).toEqual(navOf.todayOn("2026-11-03"));
    expect(hashOf({ nav: navOf.todayOn(null), overlay: null })).toBe("#/today");
    expect(parseHash("#/today")?.nav).toEqual(navOf.today());
  });
  it("a bad date isn't a place; the flows keep their own addresses", () => {
    expect(parseHash("#/today/2026-13-40")).toBeNull();
    expect(hashOf({ nav: navOf.today("closeout", "2026-11-03"), overlay: null })).toBe("#/today/closeout/2026-11-03");
    expect(hashOf({ nav: navOf.today("checkin"), overlay: null })).toBe("#/today/checkin");
  });
  it("steps over the weekend both ways", () => {
    expect(stepWeekday("2026-11-06", 1)).toBe("2026-11-09");
    expect(stepWeekday("2026-11-09", -1)).toBe("2026-11-06");
    expect(stepWeekday("2026-11-03", 1)).toBe("2026-11-04");
  });
});
