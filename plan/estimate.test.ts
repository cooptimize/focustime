import { describe, expect, it } from "vitest";
import { blocksNumber, blocksWord, budgetWords, estimate, fillWords, looseQuarters, migrateBlocks, overLine, plannedQuarters, progressWords, quartersOf, tierOf, upToHalf, validHalfBlocks, type EstItem } from "./estimate.ts";

const f = (itemId: number, blocks: number | null, o: Partial<EstItem> = {}): EstItem => ({ clientKey: "T&W", itemId, level: "feature", tier: "must", blocks, ...o });
const s = (itemId: number, size: "S" | "M" | "L" | null, parentId: number | null, o: Partial<EstItem> = {}): EstItem => ({ clientKey: "T&W", itemId, level: "story", tier: "must", blocks: null, size, parentId, ...o });
const load = (items: EstItem[]) => estimate(items).envelopes[0]!;

describe("quarters inside, half blocks shown (E1)", () => {
  it("an estimate is ½ to 20 in half-block steps; whole blocks from before stay valid", () => {
    expect([0.5, 1, 1.5, 2, 20].every(validHalfBlocks)).toBe(true);
    expect([0, 0.25, 0.75, 1.25, 20.5, 21, NaN, "2"].some(validHalfBlocks)).toBe(false);
  });
  it("blocks to quarters and up to the next half block", () => {
    expect(quartersOf(1.5)).toBe(6);
    expect([0, 1, 2, 3, 5, 6].map(upToHalf)).toEqual([0, 2, 2, 4, 6, 6]);
  });
  it("words: ½ block, 1 block, 1½ blocks, 2 blocks; no decimals and never a quarter", () => {
    expect([1, 2, 3, 4, 5, 6, 8, 10, 48].map(blocksWord)).toEqual(["½ block", "½ block", "1 block", "1 block", "1½ blocks", "1½ blocks", "2 blocks", "2½ blocks", "12 blocks"]);
    expect([0, 2, 4, 6].map(blocksNumber)).toEqual(["0", "½", "1", "1½"]);
    for (let q = 0; q <= 80; q++) expect(`${blocksWord(q)} ${blocksNumber(q)}`).not.toMatch(/[.,]\d|¼|¾/);
  });
});

describe("a feature's load", () => {
  it("derived from its sized stories, rounded up to a half block", () => {
    expect(load([f(10, null), s(11, "M", 10), s(12, "M", 10)])).toMatchObject({ quarters: 4, derived: true });
    expect(load([f(10, null), s(11, "S", 10)])).toMatchObject({ quarters: 2, derived: true });
    expect(load([f(10, null), s(11, "S", 10), s(12, "S", 10), s(13, "S", 10)])).toMatchObject({ quarters: 4, derived: true });
    expect(load([f(10, null), s(11, "S", 10), s(12, "M", 10), s(13, "L", 10)])).toMatchObject({ quarters: 8, derived: true });
    expect(blocksWord(load([f(10, null), s(11, "S", 10), s(12, "M", 10), s(13, "L", 10)]).quarters)).toBe("2 blocks");
  });
  it("its estimate is ignored once a sized story is planned under it", () => {
    expect(load([f(10, 5), s(11, "M", 10)])).toMatchObject({ quarters: 2, derived: true });
  });
  it("an unsized story falls back to the estimate (and says to size it)", () => {
    const e = load([f(10, 1.5), s(11, null, 10)]);
    expect(e).toMatchObject({ quarters: 6, derived: false, unsized: true });
    expect(fillWords(e)).toBe("size its stories to plan from them");
    expect(load([f(10, null), s(11, null, 10), s(12, "S", 10)])).toMatchObject({ quarters: 2, derived: true, unsized: false });
  });
  it("no stories: the estimate in half blocks, 1 block when none was set", () => {
    expect(load([f(10, 0.5)])).toMatchObject({ quarters: 2, derived: false, unsized: false });
    expect(load([f(10, null)])).toMatchObject({ quarters: 4, derived: false });
    expect(fillWords(load([f(10, 2)]))).toBeNull();
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
  it("loose stories count their own size, each rounded up to a half block (unsized as M)", () => {
    expect(looseQuarters(["S"])).toBe(2);
    expect(looseQuarters(["S", "S", "L", null])).toBe(10);
  });
  it("nested stories never add to the client's total beyond their feature's load; loose ones do", () => {
    const e = estimate([f(10, 2), s(11, "L", 10), s(12, "L", 10), s(20, "M", 99), s(21, "S", null)]);
    expect(plannedQuarters(e, "T&W", "must")).toBe(8 + 2 + 2);
  });
  it("stories take their feature's tier; loose ones keep their own", () => {
    const items = [f(10, 1, { tier: "nice" }), s(11, "M", 10, { tier: "must" }), s(12, "M", null, { tier: "must" })];
    const e = estimate(items);
    expect(tierOf(e, items[1]!)).toBe("nice");
    expect(tierOf(e, items[2]!)).toBe("must");
    expect(plannedQuarters(e, "T&W", "must")).toBe(2);
    expect(plannedQuarters(e, "T&W", "nice")).toBe(2);
  });
  it("done stories count toward their feature's progress in half blocks", () => {
    const e = load([f(10, null), s(11, "M", 10, { done: "devops" }), s(12, "M", 10, { done: "local" }), s(13, "L", 10)]);
    expect(progressWords(e)).toBe("1 of 2 blocks done");
    expect(progressWords(load([f(10, null), s(11, "S", 10, { done: true }), s(12, "M", 10)]))).toBe("0 of 1 block done");
    expect(progressWords(load([f(10, 2), s(11, null, 10, { done: true }), s(12, null, 10)]))).toBe("1 of 2 blocks done");
    expect(progressWords(load([f(10, 1.5, { done: "devops" })]))).toBe("1½ of 1½ blocks done");
  });
});

describe("the client's status against its budget, in quarters", () => {
  it("in half blocks, never a decimal", () => {
    expect(budgetWords(12, 12)).toEqual({ kind: "all", text: "All 3 planned" });
    expect(budgetWords(12, 8).text).toBe("1 block free");
    expect(budgetWords(12, 10).text).toBe("half a block free");
    expect(budgetWords(12, 6).text).toBe("1½ blocks free");
    expect(budgetWords(12, 0).text).toBe("3 blocks free");
    expect(budgetWords(8, 10)).toEqual({ kind: "over", text: "2½ planned, 2 available" });
    expect(budgetWords(6, 6).text).toBe("All 1½ planned");
    expect(budgetWords(0, 0).text).toBe("No blocks this week");
    for (const [b, p] of [[12, 3], [10, 1], [6, 9], [2, 0], [40, 22]] as const) expect(budgetWords(b, p).text).not.toMatch(/[.,]\d|¼|¾/);
  });
});

describe("migrating half-block week plans (before step 16.4)", () => {
  it("features round up to whole blocks; stories become M or L", () => {
    expect(migrateBlocks("feature", 0.5)).toEqual({ blocks: 1, size: null });
    expect(migrateBlocks("feature", 1.5)).toEqual({ blocks: 2, size: null });
    expect(migrateBlocks("feature", 3)).toEqual({ blocks: 3, size: null });
    expect(migrateBlocks("story", 0.5)).toEqual({ blocks: 1, size: "M" });
    expect(migrateBlocks("story", 1.5)).toEqual({ blocks: 2, size: "L" });
  });
});

describe("overLine (U4): one amber line when musts need more blocks than the client has", () => {
  it("says the numbers and the two ways out; Friday only when there is one", () => {
    expect(overLine(4, 8, true)).toBe("2 blocks of musts, 1 block free. Move one to nice to have, or borrow Friday.");
    expect(overLine(0, 4, false)).toBe("1 block of musts, no blocks free. Move one to nice to have.");
    expect(overLine(2, 6, false)).toBe("1½ blocks of musts, half a block free. Move one to nice to have.");
    expect(overLine(8, 8, true)).toBeNull();
    expect(overLine(12, 4, true)).toBeNull();
  });
});
