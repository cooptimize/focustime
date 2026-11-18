import { describe, expect, it } from "vitest";
import { isAboveStory, isFeatureTier, isStoryLevel } from "./needed.ts";

// RQ-1: the three questions show at story level only, and Create and break down at the feature tier, by the client's
// process levels (their kinds), never by a type's or a level's name.
describe("RQ-1: story level and feature tier come from the process levels", () => {
  const agile = [
    { kind: "portfolio", types: ["Epic"] },
    { kind: "portfolio", types: ["Feature"] },
    { kind: "requirement", types: ["User Story", "Bug"] },
  ];
  // A client whose levels and types are named differently (a custom process).
  const custom = [
    { kind: "portfolio", types: ["Initiative"] },
    { kind: "portfolio", types: ["Capability"] },
    { kind: "portfolio", types: ["Deliverable"] },
    { kind: "requirement", types: ["Work Package"] },
  ];

  it("Agile: User Story and Bug are story level; Feature is the feature tier, Epic isn't", () => {
    expect(isStoryLevel(agile, "User Story")).toBe(true);
    expect(isStoryLevel(agile, "Bug")).toBe(true);
    expect(isStoryLevel(agile, "Feature")).toBe(false);
    expect(isFeatureTier(agile, "Feature")).toBe(true);
    expect(isFeatureTier(agile, "Epic")).toBe(false);
    expect(isFeatureTier(agile, "User Story")).toBe(false);
  });

  it("a custom process: the lowest portfolio level is the feature tier, its requirement level is story level", () => {
    expect(isStoryLevel(custom, "Work Package")).toBe(true);
    expect(isStoryLevel(custom, "User Story")).toBe(false);
    expect(isFeatureTier(custom, "Deliverable")).toBe(true);
    expect(isFeatureTier(custom, "Capability")).toBe(false);
    expect(isFeatureTier(custom, "Feature")).toBe(false);
  });

  it("no levels known (not loaded yet): neither, so nothing is shown that might not apply", () => {
    expect(isStoryLevel(undefined, "User Story")).toBe(false);
    expect(isFeatureTier(undefined, "Feature")).toBe(false);
    expect(isStoryLevel(agile, "")).toBe(false);
    // The questions hide only for a type known to sit above story level; before a client or type is chosen they show.
    expect(isAboveStory(undefined, "Feature")).toBe(false);
    expect(isAboveStory(agile, "")).toBe(false);
    expect(isAboveStory(agile, "Feature")).toBe(true);
    expect(isAboveStory(custom, "Deliverable")).toBe(true);
    expect(isAboveStory(custom, "Work Package")).toBe(false);
  });
});
