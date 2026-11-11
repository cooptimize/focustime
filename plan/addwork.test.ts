// WD-1: the Add work panel's pure rules: which block it opens on, the room line, the week's tag and its button, the
// notice line's counts, Thursday's next-week line, where a row is already placed, the remove rule, the client chips
// and the panel's sections (one client's rows never under another's heading).
import { describe, expect, it } from "vitest";
import { blockWord, defaultAddBlock, nextWeekEmpty, panelModel, placedWhere, removeRule, roomWords, storiesUnder, toPlaceCount, toPlaceLine, toPlaceShort, type BlockAt } from "./addwork.ts";
import type { WorkItem } from "../week/types.ts";

const blocks: BlockAt[] = [
  { date: "2026-11-02", half: "AM", end: "2026-11-02T17:00:00Z", plannable: true },
  { date: "2026-11-02", half: "PM", end: "2026-11-02T22:00:00Z", plannable: true },
  { date: "2026-11-03", half: "AM", end: "2026-11-03T17:00:00Z", plannable: false },
  { date: "2026-11-03", half: "PM", end: "2026-11-03T22:00:00Z", plannable: true },
];

const item = (id: number, over: Partial<WorkItem> = {}): WorkItem => ({ id, title: `Item ${id}`, type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: id, parentId: null, changedAt: "2026-11-01T00:00:00Z", url: `https://dev.azure.com/contoso/p/_workitems/edit/${id}`, ...over }) as WorkItem;

describe("the block the panel opens on", () => {
  it("the one asked for; a day alone is its first block that can take work", () => {
    expect(defaultAddBlock(blocks, "2026-11-02T15:00:00Z", { date: "2026-11-02", half: "PM" })).toEqual({ date: "2026-11-02", half: "PM" });
    expect(defaultAddBlock(blocks, "2026-11-02T15:00:00Z", { date: "2026-11-03", half: null })).toEqual({ date: "2026-11-03", half: "PM" });
  });
  it("nothing asked: the block under way, else the next one not over", () => {
    expect(defaultAddBlock(blocks, "2026-11-02T15:00:00Z", null)).toEqual({ date: "2026-11-02", half: "AM" });
    expect(defaultAddBlock(blocks, "2026-11-02T18:00:00Z", { date: null, half: null })).toEqual({ date: "2026-11-02", half: "PM" });
    // Past the week: its first block that can take work.
    expect(defaultAddBlock(blocks, "2026-11-09T18:00:00Z", null)).toEqual({ date: "2026-11-02", half: "AM" });
    expect(defaultAddBlock([], "2026-11-02T18:00:00Z", null)).toBeNull();
  });
  it("review fix: a block or day that can't take work (past, PTO) isn't opened on: the next block that can", () => {
    expect(defaultAddBlock(blocks, "2026-11-02T15:00:00Z", { date: "2026-11-03", half: "AM" })).toEqual({ date: "2026-11-03", half: "PM" });
    const past = blocks.map((b) => (b.date === "2026-11-02" ? { ...b, plannable: false } : b));
    expect(defaultAddBlock(past, "2026-11-03T15:00:00Z", { date: "2026-11-02", half: null })).toEqual({ date: "2026-11-03", half: "PM" });
  });
});

describe("the room line", () => {
  it("QT-1: the free time left, else No free time; never Full or over", () => {
    expect(roomWords(180, 75)).toEqual({ text: "1h 45m free", over: false });
    expect(roomWords(120, 120)).toEqual({ text: "No free time", over: false });
    expect(roomWords(0, 0)).toEqual({ text: "No free time", over: false });
    expect(roomWords(120, 160)).toEqual({ text: "No free time", over: false });
    expect(roomWords(120, 600)).toEqual({ text: "No free time", over: false });
  });
});

describe("the notice line", () => {
  it("counts what waits and names each part; nothing waiting is no line", () => {
    expect(toPlaceLine({ unfinished: 1, lastWeek: 2, sent: 0 })).toBe("3 to place · 1 unfinished, 2 from last week");
    expect(toPlaceLine({ unfinished: 0, lastWeek: 0, sent: 1 })).toBe("1 to place · 1 sent to you");
    expect(toPlaceLine({ unfinished: 0, lastWeek: 0, sent: 0 })).toBeNull();
    expect([toPlaceShort({ unfinished: 2, lastWeek: 3, sent: 2 }), toPlaceShort({ unfinished: 0, lastWeek: 0, sent: 0 })]).toEqual(["7 to place", null]);
    expect(toPlaceCount({ unfinished: 2, lastWeek: 1, sent: 1 })).toBe(4);
  });
  it("Next week is empty only on Thursday and Friday of this week, with nothing placed next week", () => {
    const base = { thisWeek: "2026-11-02", shownWeek: "2026-11-02", nextWeekPicks: 0, nextWeekFeatures: 0 };
    expect(nextWeekEmpty({ ...base, today: "2026-11-05" })).toBe(true);
    expect(nextWeekEmpty({ ...base, today: "2026-11-06" })).toBe(true);
    expect(nextWeekEmpty({ ...base, today: "2026-11-04" })).toBe(false);
    expect(nextWeekEmpty({ ...base, today: "2026-11-05", nextWeekFeatures: 1 })).toBe(false);
    expect(nextWeekEmpty({ ...base, today: "2026-11-05", shownWeek: "2026-11-09" })).toBe(false);
  });
});

describe("where a row is placed", () => {
  const picks = [
    { id: 1, date: "2026-11-03", half: "PM" as const, clientKey: "contoso", itemId: 11, draftId: null, followUpId: null, status: "planned" },
    { id: 2, date: "2026-11-04", half: "AM" as const, clientKey: "contoso", itemId: 12, draftId: null, followUpId: null, status: "dropped" },
    { id: 3, date: "2026-11-07", half: "AM" as const, clientKey: "contoso", itemId: null, draftId: 5, followUpId: null, status: "planned" },
  ];
  const days = [{ date: "2026-11-03", whole: false }, { date: "2026-11-07", whole: true }];
  it("On this block, another block's name, a weekend day's name; dropped ones aren't placed", () => {
    expect(placedWhere({ clientKey: "contoso", itemId: 11 }, picks, { date: "2026-11-03", half: "PM" }, days)).toBe("On this block");
    expect(placedWhere({ clientKey: "contoso", itemId: 11 }, picks, { date: "2026-11-02", half: "AM" }, days)).toBe("Tue PM");
    expect(placedWhere({ clientKey: "contoso", itemId: 12 }, picks, { date: "2026-11-02", half: "AM" }, days)).toBeNull();
    expect(placedWhere({ clientKey: "contoso", draftId: 5 }, picks, { date: "2026-11-02", half: "AM" }, days)).toBe("Sat");
    // Same id, another client: not this row.
    expect(placedWhere({ clientKey: "fabrikam", itemId: 11 }, picks, { date: "2026-11-02", half: "AM" }, days)).toBeNull();
    expect(blockWord("2026-11-03", "EVE")).toBe("Tue Evening");
    // Review fix: Evening comes after PM on the same day.
    const two = [{ id: 7, date: "2026-11-03", half: "EVE" as const, clientKey: "contoso", itemId: 40, draftId: null, followUpId: null, status: "planned" }, { id: 8, date: "2026-11-03", half: "PM" as const, clientKey: "contoso", itemId: 40, draftId: null, followUpId: null, status: "planned" }];
    expect(placedWhere({ clientKey: "contoso", itemId: 40 }, two, { date: "2026-11-02", half: "AM" }, days)).toBe("Tue PM");
  });
  it("Remove from this week only while none of the feature's stories is placed; otherwise where", () => {
    const f = { clientKey: "contoso", itemId: 10, slots: [] };
    expect(removeRule(f, new Set([11]), picks)).toEqual({ ok: false, where: ["Tue PM"] });
    expect(removeRule(f, new Set([12]), picks)).toEqual({ ok: true });
    expect(removeRule(f, new Set(), picks, [{ id: 5, parentItemId: 10 }])).toEqual({ ok: false, where: ["Sat AM"] });
    expect(removeRule({ ...f, slots: [{ date: "2026-11-02", half: "AM" }] }, new Set(), [])).toEqual({ ok: false, where: ["Mon AM"] });
  });
});

describe("the panel's sections", () => {
  const work = (k: string) => ({
    contoso: { items: [item(10, { level: "portfolio", tier: "feature", type: "Feature" }), item(30)], children: [item(11, { parentId: 10 }), item(12, { parentId: 10 })] },
    fabrikam: { items: [item(20, { level: "portfolio", tier: "feature", type: "Feature" })], children: [item(21, { parentId: 20 })] },
  })[k];
  const week = [
    { clientKey: "contoso", itemId: 10, title: "Contoso feature", url: null, slots: [], level: "feature" as const },
    { clientKey: "fabrikam", itemId: 20, title: "Fabrikam feature", url: null, slots: [], level: "feature" as const },
  ];
  const input = { date: "2026-11-03", half: "AM" as const, clients: ["contoso", "fabrikam"], workOf: work, week, followUps: [{ id: 1, clientKey: "contoso", due: null, openedAt: "2026-11-01T00:00:00Z" }, { id: 2, clientKey: "fabrikam", due: null, openedAt: "2026-11-01T00:00:00Z" }], drafts: [], picked: new Set<string>(), here: new Set<string>() };
  it("the block's client first; each client's stories only under its own heading; promises and More from DevOps only the block's client's", () => {
    const m = panelModel({ ...input, clientKey: "fabrikam" });
    expect(m.features.map((g) => [g.clientKey, g.selected])).toEqual([["fabrikam", true], ["contoso", false]]);
    for (const g of m.features) for (const r of g.rows) expect(r.ref.clientKey).toBe(g.clientKey);
    expect(m.features[1]!.rows[0]!.stories.map((s) => s.id)).toEqual([11, 12]);
    expect(m.promises.map((f) => f.id)).toEqual([2]);
    expect(m.more.every((r) => r.item.id !== 30)).toBe(true);
  });
  it("no client chosen yet (an Open half-day): features listed, no promises or DevOps rows", () => {
    const m = panelModel({ ...input, clientKey: null });
    expect(m.features.map((g) => g.clientKey)).toEqual(["contoso", "fabrikam"]);
    expect([m.promises, m.more, m.loose]).toEqual([[], [], []]);
  });
});

describe("the stories under a feature", () => {
  it("mine (items) and others' (children), once each; nothing without a read", () => {
    const work = { items: [{ id: 11, parentId: 10 }, { id: 30, parentId: null }], children: [{ id: 11, parentId: 10 }, { id: 12, parentId: 10 }, { id: 21, parentId: 20 }] };
    expect(storiesUnder(work, 10).sort()).toEqual([11, 12]);
    expect(storiesUnder(work, 99)).toEqual([]);
    expect(storiesUnder(null, 10)).toEqual([]);
  });
});

