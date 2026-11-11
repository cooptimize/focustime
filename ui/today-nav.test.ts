// QF-1 (part 1): Today (Day since WD-1) on any day keeps its date in the address (#/day/<date>; #/today/<date> still lands), so it can be linked and reopened;
// ‹ › and [ ] step weekdays.
import { describe, expect, it } from "vitest";
import { hashOf, navOf, parseHash, stepWeekday } from "./nav.ts";

describe("Today's day in the address", () => {
  it("#/day/<date> round-trips; bare #/day is today; the #/today addresses still land", () => {
    expect(hashOf({ nav: navOf.todayOn("2026-11-03"), overlay: null })).toBe("#/day/2026-11-03");
    expect(parseHash("#/day/2026-11-03")?.nav).toEqual(navOf.todayOn("2026-11-03"));
    expect(parseHash("#/today/2026-11-03")?.nav).toEqual(navOf.todayOn("2026-11-03"));
    expect(hashOf({ nav: navOf.todayOn(null), overlay: null })).toBe("#/day");
    expect(parseHash("#/day")?.nav).toEqual(navOf.today());
    expect(parseHash("#/today")?.nav).toEqual(navOf.today());
  });
  it("a bad date isn't a place; the flows keep their own addresses", () => {
    expect(parseHash("#/today/2026-13-40")).toBeNull();
    expect(hashOf({ nav: navOf.today("closeout", "2026-11-03"), overlay: null })).toBe("#/day/closeout/2026-11-03");
    expect(hashOf({ nav: navOf.today("checkin"), overlay: null })).toBe("#/day/checkin");
  });
  it("steps over the weekend both ways", () => {
    expect(stepWeekday("2026-11-06", 1)).toBe("2026-11-09");
    expect(stepWeekday("2026-11-09", -1)).toBe("2026-11-06");
    expect(stepWeekday("2026-11-03", 1)).toBe("2026-11-04");
  });
});
