import { describe, expect, it } from "vitest";
import { blocksFor, budgetWords, estimate, fillWords, migrateBlocks, plannedBlocks, progressWords, tierOf, validWholeBlocks, type EstItem } from "./estimate.ts";

const f = (itemId: number, blocks: number | null, o: Partial<EstItem> = {}): EstItem => ({ clientKey: "W&C", itemId, level: "feature", tier: "must", blocks, ...o });
const s = (itemId: number, size: "S" | "M" | "L", parentId: number | null, o: Partial<EstItem> = {}): EstItem => ({ clientKey: "W&C", itemId, level: "story", tier: "must", blocks: null, size, parentId, ...o });

describe("two units, whole numbers", () => {
  it("blocks are whole numbers 1 to 20", () => {
    expect([1, 2, 20].every(validWholeBlocks)).toBe(true);
    expect([0, 0.5, 1.5, 21, NaN, "2"].some(validWholeBlocks)).toBe(false);
  });
  it("stories add up to whole blocks, rounded up: four S, two M or one L to a block", () => {
    expect(blocksFor(["S", "S", "S", "S"])).toBe(1);
    expect(blocksFor(["M", "M"])).toBe(1);
    expect(blocksFor(["L"])).toBe(1);
    expect(blocksFor(["M", "M", "S"])).toBe(2);
    expect(blocksFor([])).toBe(0);
  });
});

describe("features as envelopes", () => {
  it("a story whose feature is on the list nests under it; others stay loose", () => {
    const items = [f(10, 2), s(11, "M", 10), s(12, "L", 99), s(13, "S", null)];
    const e = estimate(items);
    expect(e.envelopes[0]!.stories.map((x) => x.itemId)).toEqual([11]);
    expect(e.loose.map((x) => x.itemId)).toEqual([12, 13]);
  });
  it("adding the feature later moves its existing stories under it", () => {
    const before = estimate([s(11, "M", 10), s(12, "M", 10)]);
    expect(before.loose).toHaveLength(2);
    const after = estimate([s(11, "M", 10), s(12, "M", 10), f(10, null)]);
    expect(after.loose).toHaveLength(0);
    expect(after.envelopes[0]!.stories).toHaveLength(2);
  });
  it("only nests within the same client", () => {
    expect(estimate([f(10, 1), s(11, "M", 10, { clientKey: "Other" })]).loose).toHaveLength(1);
  });
  it("stories that don't fill the blocks need more stories; filled says nothing", () => {
    const short = estimate([f(10, 2), s(11, "M", 10)]).envelopes[0]!;
    expect(short.fill).toBe("needs_stories");
    expect(fillWords(short)).toBe("needs more stories");
    const full = estimate([f(10, 1), s(11, "M", 10), s(12, "M", 10)]).envelopes[0]!;
    expect(full.fill).toBe("filled");
    expect(fillWords(full)).toBeNull();
  });
  it("stories over the blocks ask once to raise, with the whole number they need", () => {
    const over = estimate([f(10, 2), s(11, "L", 10), s(12, "L", 10), s(13, "S", 10)]).envelopes[0]!;
    expect(over.fill).toBe("over");
    expect(over.raiseTo).toBe(3);
    expect(fillWords(over)).toBe("Stories need more than 2 blocks. Raise to 3?");
  });
  it("a feature with no count takes what its stories add up to, rounded up (at least 1)", () => {
    expect(estimate([f(10, null), s(11, "L", 10), s(12, "S", 10)]).envelopes[0]).toMatchObject({ blocks: 2, auto: true, fill: "filled" });
    expect(estimate([f(10, null)]).envelopes[0]).toMatchObject({ blocks: 1, fill: "needs_stories" });
  });
  it("nested stories never add to the client's total; loose ones do, rounded up together", () => {
    const e = estimate([f(10, 2), s(11, "L", 10), s(12, "L", 10), s(20, "M", 99), s(21, "S", null)]);
    expect(plannedBlocks(e, "W&C", "must")).toBe(3);
    expect(plannedBlocks(estimate([f(10, 2), s(11, "L", 10), s(12, "L", 10), s(13, "L", 10)]), "W&C", "must")).toBe(2);
  });
  it("stories take their feature's tier; loose ones keep their own", () => {
    const items = [f(10, 1, { tier: "nice" }), s(11, "M", 10, { tier: "must" }), s(12, "M", null, { tier: "must" })];
    const e = estimate(items);
    expect(tierOf(e, items[1]!)).toBe("nice");
    expect(tierOf(e, items[2]!)).toBe("must");
    expect(plannedBlocks(e, "W&C", "must")).toBe(1);
    expect(plannedBlocks(e, "W&C", "nice")).toBe(1);
  });
  it("done stories count toward their feature's progress in whole blocks", () => {
    const e = estimate([f(10, 2), s(11, "M", 10, { done: "devops" }), s(12, "M", 10, { done: "local" }), s(13, "L", 10)]).envelopes[0]!;
    expect(progressWords(e)).toBe("1 of 2 blocks done");
    expect(progressWords(estimate([f(10, 2), s(11, "M", 10, { done: true })]).envelopes[0]!)).toBe("0 of 2 blocks done");
    expect(progressWords(estimate([f(10, 3, { done: "devops" })]).envelopes[0]!)).toBe("3 of 3 blocks done");
  });
});

describe("the client's status against its budget", () => {
  it("in plain whole numbers", () => {
    expect(budgetWords(3, 3)).toEqual({ kind: "all", text: "All 3 planned" });
    expect(budgetWords(3, 2).text).toBe("1 block free");
    expect(budgetWords(3, 0).text).toBe("3 blocks free");
    expect(budgetWords(3, 4)).toEqual({ kind: "over", text: "4 planned, 3 available" });
    expect(budgetWords(0, 0).text).toBe("No blocks this week");
  });
});

describe("migrating half-block week plans", () => {
  it("features round up to whole blocks; stories become M or L", () => {
    expect(migrateBlocks("feature", 0.5)).toEqual({ blocks: 1, size: null });
    expect(migrateBlocks("feature", 1.5)).toEqual({ blocks: 2, size: null });
    expect(migrateBlocks("feature", 3)).toEqual({ blocks: 3, size: null });
    expect(migrateBlocks("story", 0.5)).toEqual({ blocks: 1, size: "M" });
    expect(migrateBlocks("story", 1.5)).toEqual({ blocks: 2, size: "L" });
  });
});
