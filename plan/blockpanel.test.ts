// WD-2: the block panel's model: what a block can take, whose work it lists, what's on it, the Add list's order, the
// search with its two "New" rows, where the panel opens, and what Take off the plan does to each kind of to-do.
import { describe, expect, it } from "vitest";
import { addList, draftParents, meetingsWords, moveHighlight, onBlock, panelBlock, panelClient, panelMode, panelTitle, panelWhen, placedMap, RESULT_LIMIT, searchPanel, takeOffRule, takenOffWords, todoSort } from "./blockpanel.ts";
import type { BlockAt } from "./addwork.ts";
import type { DraftStory, Pick } from "./types.ts";
import type { WorkItem } from "../week/types.ts";

const item = (id: number, over: Partial<WorkItem> = {}): WorkItem => ({ id, title: `Item ${id}`, type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: id, parentId: null, changedAt: "2026-11-01T00:00:00Z", url: `https://dev.azure.com/contoso/p/_workitems/edit/${id}`, ...over }) as WorkItem;
const feature = (id: number, over: Partial<WorkItem> = {}) => item(id, { type: "Feature", level: "portfolio", title: `Feature ${id}`, ...over });
const ref = (itemId: number, clientKey = "contoso", over: Record<string, unknown> = {}) => ({ clientKey, itemId, title: `Feature ${itemId}`, url: null, slots: [], level: "feature" as const, ...over });
const pick = (id: number, over: Partial<Pick> = {}): Pick => ({ id, date: "2026-11-11", half: "AM", clientKey: "contoso", kind: "item", itemId: 100 + id, draftId: null, title: `To-do ${id}`, itemType: "User Story", itemUrl: null, size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, followUpId: null, position: id, createdAt: "", updatedAt: "", ...over });
const draft = (id: number, over: Partial<DraftStory> = {}): DraftStory => ({ id, clientKey: "contoso", parentItemId: null, title: `Draft ${id}`, size: "M", level: "story", createdAt: "", ...over });
const promise = (id: number, clientKey: string | null = "contoso", what = `Promise ${id}`) => ({ id, clientKey, due: null, openedAt: "2026-11-01T00:00:00Z", what, who: "Dana", hasWho: true });

const work = {
  items: [item(11, { parentId: 1 }), item(12, { parentId: 1 }), item(21, { parentId: 2 }), item(31)],
  children: [item(13, { parentId: 1 }), item(14, { parentId: 1, stateCategory: "Resolved" })],
  committed: [feature(1), feature(2), feature(3)],
};
const AT = { date: "2026-11-11", half: "AM" as const };

describe("what the panel offers on a block", () => {
  const today = "2026-11-11";
  it("today and later with working time: add; a past day: tick and move only; PTO or no hours: read only", () => {
    expect(panelMode({ date: today, today, pto: false, off: false })).toBe("add");
    expect(panelMode({ date: "2026-11-13", today, pto: false, off: false })).toBe("add");
    expect(panelMode({ date: "2026-11-10", today, pto: false, off: false })).toBe("past");
    expect(panelMode({ date: "2026-11-10", today, pto: true, off: false })).toBe("past");
    expect(panelMode({ date: "2026-11-12", today, pto: true, off: false })).toBe("off");
    expect(panelMode({ date: "2026-11-12", today, pto: false, off: true })).toBe("off");
  });
  it("the header: the client and the block, then its hours and room; no room on a past day or a day off", () => {
    expect(panelTitle("Contoso", "2026-11-11", "AM")).toBe("Contoso · Wed AM");
    expect(panelTitle(null, "2026-11-11", "PM")).toBe("Open · Wed PM");
    expect(panelTitle(null, "2026-11-13", "AM", { wholeDay: true, open: "Catch-up" })).toBe("Catch-up · Fri");
    expect(panelWhen("8:00–12:30", "add", 240, 180)).toEqual({ text: "8:00 to 12:30 · 1h free", over: false });
    expect(panelWhen("8:00–12:30", "add", 120, 150)).toEqual({ text: "8:00 to 12:30 · a little over", over: true });
    expect(panelWhen("8:00–12:30", "past", 240, 0)).toEqual({ text: "8:00 to 12:30 · past", over: false });
    expect(panelWhen("8:00–12:30", "off", 0, 0)).toEqual({ text: "8:00 to 12:30", over: false });
  });
  it("the meetings line counts meetings and their time; events shown as free don't count", () => {
    expect(meetingsWords([{ minutes: 30, free: false }, { minutes: 45, free: false }])).toBe("2 meetings · 1h 15m");
    expect(meetingsWords([{ minutes: 30, free: false }, { minutes: 60, free: true }])).toBe("1 meeting · 30m");
    expect(meetingsWords([{ minutes: 60, free: true }])).toBeNull();
    expect(meetingsWords([])).toBeNull();
  });
});

describe("whose work the block takes", () => {
  it("a focus block is its client's; an Open half-day asks, then takes the chosen one, else the client of what's on it", () => {
    expect(panelClient("contoso", "fabrikam", [])).toEqual({ clientKey: "contoso", choose: false });
    expect(panelClient(null, null, [])).toEqual({ clientKey: null, choose: true });
    expect(panelClient(null, "fabrikam", [pick(1)])).toEqual({ clientKey: "fabrikam", choose: true });
    expect(panelClient(null, null, [pick(1)])).toEqual({ clientKey: "contoso", choose: true });
  });
});

describe("on this block", () => {
  it("lists the block's planned and done to-dos in their order; moved and dropped ones aren't on it", () => {
    const picks = [pick(3, { position: 3 }), pick(1, { position: 1, status: "done" }), pick(2, { half: "PM" }), pick(4, { status: "dropped" }), pick(5, { status: "moved" }), pick(6, { date: "2026-11-12" })];
    expect(onBlock(picks, AT).map((p) => p.id)).toEqual([1, 3]);
    expect(onBlock([], AT)).toEqual([]);
  });
});

describe("the Add list before typing", () => {
  const week = [ref(2), ref(1), ref(3), ref(9, "fabrikam")];
  const weekPicks = [pick(1, { itemId: 11 }), pick(2, { itemId: 12, date: "2026-11-12", half: "PM" }), pick(3, { itemId: 99, status: "dropped" })];
  const list = addList({ clientKey: "contoso", date: AT.date, half: AT.half, work, week, followUps: [promise(1), promise(2, "fabrikam")], drafts: [draft(1, { parentItemId: 1 }), draft(2), draft(3, { clientKey: "fabrikam" })], weekPicks });
  it("this week's features first, in the week list's order, each with its stories and how many are on", () => {
    expect(list.features.map((f) => f.row.ref.itemId)).toEqual([2, 1, 3]);
    const f1 = list.features.find((f) => f.row.ref.itemId === 1)!;
    // Stories 11, 12, 13 (14 is resolved) and one draft: 11 and 12 are on a block this week.
    expect(f1.row.stories.map((x) => x.id)).toEqual([11, 12, 13]);
    expect(f1.label).toBe("2 of 4 on");
    expect(list.features.find((f) => f.row.ref.itemId === 2)!.label).toBe("0 of 1 on");
    // A feature with no stories asks to be broken down and has no count.
    expect(list.features.find((f) => f.row.ref.itemId === 3)!.row.breakDown).toBe(true);
    expect(list.features.find((f) => f.row.ref.itemId === 3)!.label).toBeNull();
  });
  it("then my promises for this client, then the other work assigned to me (collapsed, with a count)", () => {
    expect(list.promises.map((f) => f.id)).toEqual([1]);
    expect(list.other.map((r) => r.item.id)).toEqual([31]);
    expect(list.otherCount).toBe(1);
  });
  it("another client's features, promises and drafts never show (GD-2)", () => {
    expect(list.features.some((f) => f.row.ref.clientKey !== "contoso")).toBe(false);
    expect(list.promises.some((f) => f.clientKey !== "contoso")).toBe(false);
    expect(list.loose.map((d) => d.id)).toEqual([2]);
  });
  it("a draft with no feature that is on a block isn't under To place", () => {
    const placed = addList({ clientKey: "contoso", date: AT.date, half: AT.half, work, week, followUps: [], drafts: [draft(2)], weekPicks: [pick(9, { kind: "draft", itemId: null, draftId: 2 })] });
    expect(placed.loose).toEqual([]);
  });
  it("a new draft story goes under one of this week's features, or none yet", () => {
    expect(draftParents(list.features).map((p) => p.id)).toEqual([2, 1, 3, null]);
    expect(draftParents([]).map((p) => p.title)).toEqual(["No feature yet"]);
  });
  it("says where each thing is: on this block first, else its earliest block this week", () => {
    const m = placedMap([...weekPicks, pick(7, { itemId: 12, date: "2026-11-11", half: "AM" })], AT);
    expect(m.get("icontoso:11")).toMatchObject({ here: true, pickId: 1 });
    expect(m.get("icontoso:12")).toMatchObject({ here: true, pickId: 7 });
    expect(placedMap(weekPicks, AT).get("icontoso:12")).toMatchObject({ here: false, date: "2026-11-12", half: "PM", pickId: 2 });
    expect(m.has("icontoso:99")).toBe(false);
  });
});

describe("the search", () => {
  const base = { clientKey: "contoso", work, followUps: [promise(1, "contoso", "Send the export spec"), promise(2, "fabrikam", "Send the export spec")], drafts: [draft(2, { title: "Export button" }), draft(3, { clientKey: "fabrikam", title: "Export again" })] };
  it("empty text is no search (the Add list shows)", () => {
    expect(searchPanel(base, "")).toBeNull();
    expect(searchPanel(base, "   ")).toBeNull();
  });
  it("matches this client's stories by title or number, its drafts and my promises for it; never another client's", () => {
    const s = searchPanel(base, "export")!;
    expect(s.results.map((r) => r.key)).toEqual(["d2", "f1"]);
    const byId = searchPanel(base, "#12")!;
    expect(byId.results.map((r) => r.key)).toEqual(["icontoso:12"]);
    expect(byId.results[0]).toMatchObject({ kind: "story", under: "Feature 1" });
    // A resolved story and a feature aren't to-dos.
    expect(searchPanel(base, "Item 14")!.results).toEqual([]);
    expect(searchPanel(base, "Feature 1")!.results).toEqual([]);
  });
  it("always ends with New to-do and New draft story, carrying the text", () => {
    const s = searchPanel(base, "  Call the vendor ")!;
    expect(s.news.map((n) => n.label)).toEqual(["New to-do: Call the vendor", "New draft story: Call the vendor"]);
    expect(s.news.map((n) => n.kind)).toEqual(["todo", "draft"]);
  });
  it("with no match the highlight starts on New to-do; with matches, on the first", () => {
    const none = searchPanel(base, "zzz")!;
    expect(none.results).toEqual([]);
    expect([...none.results, ...none.news][none.start]).toMatchObject({ kind: "todo" });
    const some = searchPanel(base, "item 1")!;
    expect([...some.results, ...some.news][some.start]).toMatchObject({ kind: "story" });
  });
  it("200 matches show the first 30 and say how many more", () => {
    const many = { ...base, work: { items: Array.from({ length: 200 }, (_, i) => item(1000 + i, { title: `Story ${i}` })), children: [] } };
    const s = searchPanel(many, "story")!;
    expect(s.results).toHaveLength(RESULT_LIMIT);
    expect(s.more).toBe(170);
  });
  it("Up and Down move through the rows and stop at the ends", () => {
    expect(moveHighlight(0, 1, 4)).toBe(1);
    expect(moveHighlight(3, 1, 4)).toBe(3);
    expect(moveHighlight(0, -1, 4)).toBe(0);
  });
});

describe("where the panel opens", () => {
  const blocks: BlockAt[] = [
    { date: "2026-11-10", half: "AM", end: "2026-11-10T17:00:00Z", plannable: false },
    { date: "2026-11-10", half: "PM", end: "2026-11-10T22:00:00Z", plannable: false },
    { date: "2026-11-11", half: "AM", end: "2026-11-11T17:00:00Z", plannable: true },
    { date: "2026-11-11", half: "PM", end: "2026-11-11T22:00:00Z", plannable: true },
    { date: "2026-11-12", half: "AM", end: "2026-11-12T17:00:00Z", plannable: false },
  ];
  const now = "2026-11-11T18:00:00Z";
  it("a block asked for with its half opens, whatever it can take (a past or PTO block too)", () => {
    expect(panelBlock(blocks, now, { date: "2026-11-10", half: "PM" })).toEqual({ date: "2026-11-10", half: "PM" });
    expect(panelBlock(blocks, now, { date: "2026-11-12", half: "AM" })).toEqual({ date: "2026-11-12", half: "AM" });
  });
  it("a day alone: its block that can take work and isn't over, else its first", () => {
    expect(panelBlock(blocks, now, { date: "2026-11-11", half: null })).toEqual({ date: "2026-11-11", half: "PM" });
    expect(panelBlock(blocks, now, { date: "2026-11-10", half: null })).toEqual({ date: "2026-11-10", half: "AM" });
  });
  it("nothing asked: the block under way or the next that can take work; none in a past week", () => {
    expect(panelBlock(blocks, now, null)).toEqual({ date: "2026-11-11", half: "PM" });
    expect(panelBlock(blocks.slice(0, 2), now, null)).toBeNull();
    expect(panelBlock(blocks, now, { date: "2026-11-20", half: "AM" })).toEqual({ date: "2026-11-11", half: "PM" });
  });
});

describe("Take off the plan, for each kind of to-do", () => {
  const today = "2026-11-11";
  it("tells the kinds apart", () => {
    expect(todoSort(pick(1))).toBe("item");
    expect(todoSort(pick(1, { kind: "draft", itemId: null, draftId: 4 }))).toBe("draft");
    expect(todoSort(pick(1, { kind: "intention", itemId: null, followUpId: 3 }))).toBe("promise");
    expect(todoSort(pick(1, { kind: "intention", itemId: null }))).toBe("plain");
    expect(todoSort(pick(1, { kind: "intention", itemId: null, todoKind: "deployment" }))).toBe("deployment");
  });
  it("a story goes back to its feature's list, a draft stays a draft, a promise stays in Promises, a plain to-do is kept under To place", () => {
    expect(takeOffRule(pick(1), today)).toEqual({ ok: true, then: "Back in its feature's list, not placed" });
    expect(takeOffRule(pick(1, { kind: "draft", itemId: null, draftId: 4 }), today)).toEqual({ ok: true, then: "Still a draft, not placed" });
    expect(takeOffRule(pick(1, { kind: "intention", itemId: null, followUpId: 3 }), today)).toEqual({ ok: true, then: "Still in Promises, not placed" });
    expect(takeOffRule(pick(1, { kind: "intention", itemId: null }), today)).toEqual({ ok: true, then: "Kept under To place" });
  });
  it("a done to-do, a past day and a deployment can't be taken off, each with its reason", () => {
    expect(takeOffRule(pick(1, { status: "done" }), today)).toEqual({ ok: false, why: "A done to-do stays on its day" });
    expect(takeOffRule(pick(1, { status: "dropped" }), today)).toMatchObject({ ok: false });
    expect(takeOffRule(pick(1, { date: "2026-11-10" }), today)).toMatchObject({ ok: false, why: expect.stringMatching(/past day keeps its record/) });
    expect(takeOffRule(pick(1, { kind: "intention", itemId: null, todoKind: "deployment" }), today)).toMatchObject({ ok: false, why: expect.stringMatching(/deployment/) });
  });
  it("says what happened", () => {
    expect(takenOffWords("Export orders", "2026-11-11", "AM", { kind: "item" })).toBe("Taken off Wed AM: Export orders");
    expect(takenOffWords("Call the vendor", "2026-11-11", "PM", { kind: "plain", timeboxes: 1 })).toBe("Taken off Wed PM: Call the vendor · kept under To place · its timebox is gone");
  });
});
