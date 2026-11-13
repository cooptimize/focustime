// RS-2 part C: what the screen says while a week or day is being read, and which day Day draws meanwhile.
import { describe, expect, it } from "vitest";
import { dayDrawn, failedWords, weekRead } from "./weekread.ts";

describe("weekRead", () => {
  it("nothing to say once the asked week is on screen", () => {
    expect(weekRead({ asked: "2026-11-09", shown: "2026-11-09", failed: null })).toBeNull();
    expect(weekRead({ asked: null, shown: "2026-11-02", failed: null })).toBeNull();
  });
  it("loading while another week is asked for; failed when that week's read failed", () => {
    expect(weekRead({ asked: "2026-11-09", shown: "2026-11-02", failed: null })).toBe("loading");
    expect(weekRead({ asked: "2026-11-09", shown: "2026-11-02", failed: "2026-11-09" })).toBe("failed");
    // A failure of an earlier ask doesn't mark the one asked now.
    expect(weekRead({ asked: "2026-11-16", shown: "2026-11-02", failed: "2026-11-09" })).toBe("loading");
  });
  it("the failed lines", () => {
    expect(failedWords("week")).toBe("This week didn't load");
    expect(failedWords("day")).toBe("This day didn't load");
  });
});

describe("dayDrawn", () => {
  const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  it("the asked day when its week is here", () => expect(dayDrawn("2026-11-04", week, "2026-11-02")).toBe("2026-11-04"));
  it("the last day drawn, dimmed, while the asked day's week is read", () => expect(dayDrawn("2026-11-09", week, "2026-11-06")).toBe("2026-11-06"));
  it("the asked day (Opening…) when the last one isn't on screen either", () => expect(dayDrawn("2026-11-09", week, "2026-10-30")).toBe("2026-11-09"));
});
