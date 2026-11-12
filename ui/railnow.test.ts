// NL-1 review: the rail's dimming (NowPast, the strip's past) is apart from the now mark. A block whose hours are over is
// all past even when its rail runs on (a lunch, the 24-hour range); a block not yet over dims the rail's time gone by.
import { describe, expect, it } from "vitest";
import { aWeek, aWeekConfig } from "../test/builders/index.ts";
import { nowSpot } from "../plan/nowline.ts";
import { railNowOf } from "./Timeline.tsx";

const NY = "America/New_York";
const at = (t: string) => Temporal.PlainDateTime.from(t).toZonedDateTime(NY).toInstant().toString();
const tueOf = (w: ReturnType<typeof aWeek>) => w.days.find((d) => d.date === "2026-11-03")!;
const rail = (d: ReturnType<typeof tueOf>, half: "AM" | "PM", now: string) => railNowOf(d, half, nowSpot(d, now, NY, false), now, "x", () => {})!;

describe("the rail's past (NL-1)", () => {
  it("24-hour range, 10:03 PM: no mark anywhere, both blocks read as past", () => {
    const d = tueOf(aWeek({ viewRange: "24h" }));
    for (const h of ["AM", "PM"] as const) expect(rail(d, h, at("2026-11-03T22:03"))).toMatchObject({ at: null, past: 1 });
  });

  it("a lunch gap: the morning is all past once its hours end, though its rail runs to the afternoon", () => {
    const d = tueOf(aWeek({ config: aWeekConfig({ hours: { ...aWeekConfig().hours, lunch: { start: "12:00", end: "13:00" } } }) }));
    expect(rail(d, "AM", at("2026-11-03T12:30"))).toMatchObject({ at: null, past: 1 });
    expect(rail(d, "PM", at("2026-11-03T12:30"))).toMatchObject({ at: null, past: 0 });
    const mid = rail(d, "AM", at("2026-11-03T11:00"));
    expect(mid.at).not.toBeNull();
    expect(mid.past).toBe(mid.at);
  });

  it("before the day (24-hour range): no mark; the rail's time gone by is dimmed", () => {
    const d = tueOf(aWeek({ viewRange: "24h" }));
    const r = rail(d, "AM", at("2026-11-03T06:30"));
    expect(r.at).toBeNull();
    expect(r.past).toBeGreaterThan(0);
    expect(r.past).toBeLessThan(1);
  });
});
