import { describe, expect, it } from "vitest";
import { buildInfo, prFromMessage } from "./buildinfo.ts";

describe("the PR number from the merge message", () => {
  it("a merge commit: Merge pull request #N", () => {
    expect(prFromMessage("Merge pull request #7 from cooptimize/feat/estimates-in-hours\n\nE2: estimates in hours")).toBe("7");
  });
  it("a squash merge: (#N) at the end of the first line", () => {
    expect(prFromMessage("S1: first-run setup (#12)\n\n* S1 tests")).toBe("12");
  });
  it("none: a direct push, or a number elsewhere in the message", () => {
    expect(prFromMessage("E2 docs: D446 to D450")).toBeNull();
    expect(prFromMessage("Fix the thing\n\nSee (#3) for why")).toBeNull();
    expect(prFromMessage("Mention #4 in passing")).toBeNull();
  });
});

describe("the running build", () => {
  it("baked values and the env label from runtime config", () => {
    expect(buildInfo({ FOCUSTIME_ENV: "dev", FOCUSTIME_BUILD_SHA: "8f6d963aa8006de473947480d96eb7b24ba5c5e7", FOCUSTIME_BUILD_PR: "7", FOCUSTIME_BUILD_TIME: "2026-11-03T17:05:00Z" })).toEqual({
      env: "dev",
      pr: "7",
      sha: "8f6d963",
      builtAt: "2026-11-03T17:05:00Z",
    });
  });
  it("a local build: local, the tree's sha, no PR", () => {
    expect(buildInfo({}, () => "a62fa66\n")).toEqual({ env: "local", pr: "none", sha: "a62fa66", builtAt: null });
  });
  it("anything unexpected is dropped, never passed through", () => {
    expect(buildInfo({ FOCUSTIME_ENV: "staging.contoso.example", FOCUSTIME_BUILD_SHA: "not-a-sha", FOCUSTIME_BUILD_PR: "7; rm", FOCUSTIME_BUILD_TIME: "yesterday" })).toEqual({ env: "local", pr: "none", sha: "unknown", builtAt: null });
  });
});
