import { describe, expect, it } from "vitest";
import { aboutLine } from "./About.tsx";

describe("the About line (S1)", () => {
  it("dev: env, PR, sha and the build time in the person's zone", () => {
    expect(aboutLine({ env: "dev", pr: "8", sha: "abc1234", builtAt: "2026-11-03T17:05:00Z" }, "America/Chicago")).toBe("FocusTime · dev · #8 · abc1234 · built Nov 3, 11:05 AM");
  });
  it("no PR (a direct push): no #", () => {
    expect(aboutLine({ env: "prod", pr: "none", sha: "abc1234", builtAt: "2026-11-03T17:05:00Z" }, "America/New_York")).toBe("FocusTime · prod · abc1234 · built Nov 3, 12:05 PM");
  });
  it("a local build: local and the sha", () => {
    expect(aboutLine({ env: "local", pr: "none", sha: "a62fa66", builtAt: null }, "America/New_York")).toBe("FocusTime · local · a62fa66");
  });
});
