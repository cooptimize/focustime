import { describe, expect, it } from "vitest";
import { finishChoices, leftHours, parseLeftText, progressState, withOutcome, wrapSummary } from "./wrapup.ts";

const agile = [
  { name: "New", category: "Proposed" },
  { name: "Active", category: "InProgress" },
  { name: "Resolved", category: "Resolved" },
  { name: "Closed", category: "Completed" },
  { name: "Removed", category: "Removed" },
];

describe("finishChoices", () => {
  it("offers the Completed states first, then Resolved, from the process model", () => {
    expect(finishChoices(agile)).toEqual({ choices: ["Closed", "Resolved"], chosen: "Closed" });
  });
  it("never hard-codes Closed: a custom completed state is chosen", () => {
    const custom = [{ name: "To do", category: "Proposed" }, { name: "Shipped", category: "Completed" }];
    expect(finishChoices(custom)).toEqual({ choices: ["Shipped"], chosen: "Shipped" });
  });
  it("with several completed states, the one this person used most on the client wins", () => {
    const two = [...agile, { name: "Accepted", category: "Completed" }];
    expect(finishChoices(two, {}).chosen).toBe("Closed");
    expect(finishChoices(two, { Accepted: 3, Closed: 1 }).chosen).toBe("Accepted");
  });
  it("a type with neither gives nothing to propose", () => {
    expect(finishChoices([{ name: "Open", category: "InProgress" }])).toEqual({ choices: [], chosen: null });
  });
});

describe("progressState", () => {
  it("moves a New item to the first In Progress state", () => expect(progressState(agile, "New")).toBe("Active"));
  it("keeps any other state", () => {
    expect(progressState(agile, "Active")).toBeNull();
    expect(progressState(agile, "Resolved")).toBeNull();
  });
});

describe("withOutcome", () => {
  it("adds the outcome word when the person didn't write one", () => {
    expect(withOutcome("finished", "Mapped the last two fields")).toBe("Done: Mapped the last two fields");
    expect(withOutcome("progress", "Mapping done. Next: tests")).toBe("Progress: Mapping done. Next: tests");
  });
  it("keeps the person's own outcome word", () => {
    expect(withOutcome("finished", "Done: shipped")).toBe("Done: shipped");
    expect(withOutcome("progress", "progress - half way")).toBe("progress - half way");
    expect(withOutcome("finished", "Completed the import")).toBe("Completed the import");
  });
  it("an empty comment stays empty (no comment is posted)", () => expect(withOutcome("finished", "  ")).toBe(""));
});

describe("wrapSummary", () => {
  it("names every write, item by item", () => {
    expect(wrapSummary([{ itemId: 504, kind: "state", before: "Active", after: "Closed", comment: true }, { itemId: 504, kind: "remaining_work", after: "0" }])).toBe("#504: state Active → Closed · add comment · Remaining Work 0");
    expect(wrapSummary([{ itemId: 504, kind: "comment" }, { itemId: 500, kind: "comment" }])).toBe("#504: add comment · #500: add comment");
  });
});

describe("time left", () => {
  it("reads typed times", () => {
    expect(parseLeftText("45m")).toBe(45);
    expect(parseLeftText("2.5h")).toBe(150);
    expect(parseLeftText("2h 30m")).toBe(150);
    expect(parseLeftText("90")).toBe(90);
    expect(parseLeftText("soon")).toBeNull();
    expect(parseLeftText("0")).toBeNull();
  });
  it("Remaining Work is in half hours", () => {
    expect(leftHours(90)).toBe(1.5);
    expect(leftHours(100)).toBe(1.5);
    expect(leftHours(0)).toBe(0);
  });
});
