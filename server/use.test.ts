import { describe, expect, it } from "vitest";
import { createUseSignal } from "./use.ts";

describe("the use signal (HK-3)", () => {
  it("is idle until someone uses FocusTime, active for N minutes after, then idle again", () => {
    let t = 1_000_000;
    const u = createUseSignal({ now: () => t, idleMinutes: () => 10 });
    expect(u.active()).toBe(false);
    u.used();
    t += 9 * 60_000;
    expect(u.active()).toBe(true);
    t += 61_000;
    expect(u.active()).toBe(false);
  });
  it("follows the Rule's minutes as they change", () => {
    let t = 0;
    let m = 10;
    const u = createUseSignal({ now: () => t, idleMinutes: () => m });
    u.used();
    t = 20 * 60_000;
    expect(u.active()).toBe(false);
    m = 30;
    expect(u.active()).toBe(true);
    expect(u.minutes()).toBe(30);
  });
});
