// DV-1: the pacing rules on their own (the poller's tests run them against a fake DevOps).
import { describe, expect, it } from "vitest";
import { CALM, NORMAL, intervalMinutes, isDue, nextPace, readRate, sinceOf, worse } from "./devops-pace.ts";

const T = Temporal.Instant.from("2026-11-05T15:00:00Z");
const h = (o: Record<string, string>) => new Headers(o);

describe("DevOps pace", () => {
  it("reads the rate-limit headers, and honors Retry-After even on a 200", () => {
    const r = readRate(200, h({ "retry-after": "30", "x-ratelimit-remaining": "150", "x-ratelimit-limit": "200", "x-ratelimit-cost": "0.25" }));
    expect(r).toEqual({ status: 200, retryAfterS: 30, delayS: null, limit: 200, remaining: 150, cost: 0.25 });
    expect(worse(CALM, r)).toEqual({ refused: false, retryAfterS: 30, delayed: false, low: false });
    expect(worse(CALM, readRate(429, h({})))).toMatchObject({ refused: true, retryAfterS: 60 });
  });

  it("doubles on trouble, keeps a pending Retry-After through calm checks, and steps back after five calm ones", () => {
    let p = nextPace(NORMAL, { ...CALM, refused: true, retryAfterS: 120 }, T);
    expect(p).toMatchObject({ slow: 2, retryAt: "2026-11-05T15:02:00Z", reason: "DevOps asked FocusTime to wait" });
    p = nextPace(p, CALM, T.add({ seconds: 30 }));
    expect(p.retryAt).toBe("2026-11-05T15:02:00Z");
    for (let i = 0; i < 3; i++) p = nextPace(p, CALM, T.add({ minutes: 5 }));
    expect(p.slow).toBe(2);
    p = nextPace(p, CALM, T.add({ minutes: 5 }));
    expect(p).toEqual(NORMAL);
  });

  it("works out the interval: the Rule in hours, 10 outside, doubled up to 15, 30 for a bad token", () => {
    expect(intervalMinutes({ ruleMinutes: 1, inHours: true, pace: NORMAL })).toBe(1);
    expect(intervalMinutes({ ruleMinutes: 1, inHours: false, pace: NORMAL })).toBe(10);
    expect(intervalMinutes({ ruleMinutes: 1, inHours: true, pace: { ...NORMAL, slow: 16 } })).toBe(15);
    expect(intervalMinutes({ ruleMinutes: 20, inHours: true, pace: { ...NORMAL, slow: 2 } })).toBe(20);
    expect(intervalMinutes({ ruleMinutes: 1, inHours: true, pace: NORMAL, badToken: true })).toBe(30);
  });

  it("is due after the interval, never before a Retry-After, and starts the overlap two minutes back", () => {
    expect(isDue({ checkedAt: null, minutes: 1, retryAt: null }, T)).toBe(true);
    expect(isDue({ checkedAt: "2026-11-05T14:59:30Z", minutes: 1, retryAt: null }, T)).toBe(false);
    expect(isDue({ checkedAt: "2026-11-05T14:59:30Z", minutes: 1, retryAt: null, force: true }, T)).toBe(true);
    expect(isDue({ checkedAt: null, minutes: 1, retryAt: "2026-11-05T15:01:00Z", force: true }, T)).toBe(false);
    expect(sinceOf("2026-11-05T15:00:00.123Z")).toBe("2026-11-05T14:58:00Z");
  });
});
