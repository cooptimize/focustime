// WD-2: the block panel's model: what a block can take, whose work it lists, what's on it, the Add list's order, the
// search with its two "New" rows, where the panel opens, and what Take off the plan does to each kind of to-do.
import { describe, expect, it } from "vitest";
import { assignedList, draftParents, hoverWords, looseDrafts, moreCount, moreList, riskLine, meetingsWords, moveHighlight, onBlock, sizeHover, panelBlock, panelClient, panelMode, panelTitle, panelWhen, placedMap, RESULT_LIMIT, searchPanel, takeOffRule, takenOffWords, todoSort } from "./blockpanel.ts";
import type { BlockAt } from "./addwork.ts";
import type { DraftStory, Pick } from "./types.ts";
import type { WorkItem } from "../week/types.ts";

const item = (id: number, over: Partial<WorkItem> = {}): WorkItem => ({ id, title: `Item ${id}`, type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: id, parentId: null, changedAt: "2026-11-01T00:00:00Z", url: `https://dev.azure.com/contoso/p/_workitems/edit/${id}`, ...over }) as WorkItem;
const feature = (id: number, over: Partial<WorkItem> = {}) => item(id, { type: "Feature", level: "portfolio", title: `Feature ${id}`, ...over });
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
    expect(panelWhen("8:00–12:30", "add", 240, 180)).toEqual({ text: "8:00–12:30 · 1h free" });
    expect(panelWhen("8:00–12:30", "add", 120, 150)).toEqual({ text: "8:00–12:30 · No free time" });
    expect(panelWhen("8:00–12:30", "add", 120, 900)).toEqual({ text: "8:00–12:30 · No free time" });
    expect(panelWhen("8:00–12:30", "past", 240, 0)).toEqual({ text: "8:00–12:30 · past" });
    expect(panelWhen("8:00–12:30", "off", 0, 0)).toEqual({ text: "8:00–12:30" });
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

describe("Assigned to you", () => {
  // Feature 1 is mine (stories 11, 12 mine; 13 a teammate's; 14 mine but resolved). Feature 2 is Dana's, with one
  // story of mine (21). Feature 3 is mine with no stories. Story 31 is mine with no feature. Feature 4 is mine, closed.
  const mineWork = {
    items: [
      feature(1, { assignedToMe: true, order: 30, targetDate: "2026-12-01" }),
      item(11, { parentId: 1, assignedToMe: true, order: 31 }),
      item(12, { parentId: 1, assignedToMe: true, order: 32 }),
      item(14, { parentId: 1, assignedToMe: true, order: 33, stateCategory: "Resolved" }),
      item(21, { parentId: 2, assignedToMe: true, order: 10, targetDate: "2026-11-20" }),
      feature(3, { assignedToMe: true, order: 50 }),
      item(31, { assignedToMe: true, order: 5 }),
      feature(4, { assignedToMe: true, order: 1, stateCategory: "Completed" }),
    ],
    children: [item(13, { parentId: 1, assignedToMe: false, assignedTo: "Dana Morales", order: 34 })],
    parents: [feature(2, { assignedToMe: false, assignedTo: "Dana Morales", order: 90, targetDate: "2026-11-15" })],
  };
  const base = { clientKey: "contoso", work: mineWork, drafts: [draft(1, { parentItemId: 1 }), draft(2), draft(3, { clientKey: "fabrikam", parentItemId: 1 })], weekPicks: [pick(1, { itemId: 11 })] };
  const ids = (gs: ReturnType<typeof assignedList>) => gs.map((g) => [g.feature?.id ?? null, g.stories.map((x) => x.id)]);
  it("my features and my stories, grouped by feature, in backlog order; a feature I don't own sits where my first story under it falls; No feature last", () => {
    // Dana's feature 2 (order 90) sits at 10, where my story 21 falls: before my feature 1 (30) and 3 (50).
    expect(ids(assignedList(base))).toEqual([[2, [21]], [1, [11, 12]], [3, []], [null, [31]]]);
  });
  it("a story of mine under someone else's feature shows under that feature, which says it isn't mine", () => {
    const g = assignedList(base).find((x) => x.feature?.id === 2)!;
    expect(g).toMatchObject({ mine: false, breakDown: false });
    expect(g.feature).toMatchObject({ title: "Feature 2", assignedTo: "Dana Morales" });
  });
  it("a feature's other open stories fold behind it; its drafts are this client's only", () => {
    const g = assignedList(base).find((x) => x.feature?.id === 1)!;
    expect(g.others.map((x) => x.id)).toEqual([13]);
    expect(g.drafts.map((d) => d.id)).toEqual([1]);
    // 11 is on a block this week: 1 of the 4 (two of mine, a teammate's, a draft).
    expect(g).toMatchObject({ mine: true, on: 1, total: 4, label: "1 of 4 on" });
  });
  it("a feature with nothing on this week has no count, unless it is on the week's list", () => {
    expect(assignedList({ ...base, weekPicks: [] }).find((x) => x.feature?.id === 1)!.label).toBeNull();
    expect(assignedList({ ...base, weekPicks: [], onWeek: new Set([1]) }).find((x) => x.feature?.id === 1)!.label).toBe("0 of 4 on");
  });
  it("a feature of mine with no stories asks to be broken down; one that isn't mine never does", () => {
    expect(assignedList(base).find((x) => x.feature?.id === 3)).toMatchObject({ mine: true, breakDown: true, total: 0, label: null });
  });
  it("done, resolved and closed items are left out, and epics are never groups", () => {
    const all = assignedList(base);
    expect(all.some((g) => g.feature?.id === 4)).toBe(false);
    expect(all.flatMap((g) => g.stories.map((x) => x.id))).not.toContain(14);
    const epic = assignedList({ ...base, work: { ...mineWork, items: [...mineWork.items, feature(9, { assignedToMe: true, tier: "epic", order: 0 })] } });
    expect(epic.some((g) => g.feature?.id === 9)).toBe(false);
  });
  it("sorted by target date: the earliest first, none last; a feature I don't own by my first story's date", () => {
    // Story 21 targets Nov 20 (Dana's feature 2), my feature 1 Dec 1, feature 3 has none.
    expect(ids(assignedList({ ...base, sort: "target" })).map(([f]) => f)).toEqual([2, 1, 3, null]);
    const flipped = { ...mineWork, items: mineWork.items.map((x) => (x.id === 3 ? { ...x, targetDate: "2026-11-05" } : x)) };
    expect(ids(assignedList({ ...base, work: flipped, sort: "target" })).map(([f]) => f)).toEqual([3, 2, 1, null]);
    expect(ids(assignedList({ ...base, work: flipped, sort: "backlog" })).map(([f]) => f)).toEqual([2, 1, 3, null]);
  });
  it("a feature on my week is listed even when it isn't mine and holds no story of mine, and says whose it is", () => {
    // Feature 6 is Dana's with only her story 61; feature 7 is Dana's with nothing of mine either.
    const theirs = [feature(6, { assignedTo: "Dana Morales", order: 40 }), item(61, { parentId: 6, assignedTo: "Dana Morales", order: 41 }), feature(7, { assignedTo: "Dana Morales", order: 45 })];
    const w = { ...mineWork, items: [...mineWork.items, ...theirs] };
    const has = (x: Partial<Parameters<typeof assignedList>[0]>, id: number) => assignedList({ ...base, work: w, ...x }).find((g) => g.feature?.id === id);
    // Not on my week: neither is listed.
    expect(has({}, 6)).toBeUndefined();
    // On the week's list.
    const listed = has({ onWeek: new Set([6]) }, 6)!;
    expect([listed.mine, listed.feature?.assignedTo, listed.stories, listed.others.map((x) => x.id)]).toEqual([false, "Dana Morales", [], [61]]);
    // Placed as a placeholder, and something of it placed (her story on one of my blocks).
    expect(has({ weekPicks: [pick(1, { itemId: 7 })] }, 7)?.mine).toBe(false);
    expect(has({ weekPicks: [pick(1, { itemId: 61 })] }, 6)?.label).toBe("1 of 1 on");
    expect(has({ weekPicks: [pick(1, { itemId: 61, status: "dropped" })] }, 6)).toBeUndefined();
    // Another client's to-do with the same number doesn't count; nor does a closed feature on the list.
    expect(has({ weekPicks: [pick(1, { itemId: 7, clientKey: "fabrikam" })] }, 7)).toBeUndefined();
    expect(assignedList({ ...base, onWeek: new Set([4]) }).some((g) => g.feature?.id === 4)).toBe(false);
    // In backlog order it sits where the feature itself falls (order 40: after feature 1, before feature 3).
    expect(ids(assignedList({ ...base, work: w, onWeek: new Set([6]) })).map(([f]) => f)).toEqual([2, 1, 6, 3, null]);
  });
  it("by target date, a story with none uses its feature's date; items with neither go last, in backlog order", () => {
    // Under my feature 1 (Dec 1): 11 has no date, 12 targets Nov 25. No feature: 31 (none), 32 (Nov 12), 33 (none).
    const w = { ...mineWork, items: [...mineWork.items.map((x) => (x.id === 12 ? { ...x, targetDate: "2026-11-25" } : x)), item(32, { assignedToMe: true, order: 9, targetDate: "2026-11-12" }), item(33, { assignedToMe: true, order: 2 })] };
    const out = ids(assignedList({ ...base, work: w, sort: "target" }));
    expect(out.find(([f]) => f === 1)?.[1]).toEqual([12, 11]);
    expect(out.find(([f]) => f === null)?.[1]).toEqual([32, 33, 31]);
    // A feature I don't own sorts by my first story under it, which takes the feature's date when it has none.
    const dated = { ...mineWork, items: mineWork.items.map((x) => (x.id === 21 ? { ...x, targetDate: null } : x)), parents: [feature(2, { assignedTo: "Dana Morales", order: 90, targetDate: "2026-12-20" })] };
    expect(ids(assignedList({ ...base, work: dated, sort: "target" })).map(([f]) => f)).toEqual([1, 2, 3, null]);
    // More in the client: the same rule.
    const all = [feature(8, { order: 1, targetDate: "2026-11-30" }), item(81, { parentId: 8, order: 2 }), item(82, { parentId: 8, order: 3, targetDate: "2026-11-15" }), item(91, { order: 4 }), item(92, { order: 5, targetDate: "2026-12-05" })];
    expect(moreList(all, new Set(), "target").map((g) => g.stories.map((x) => x.id))).toEqual([[82, 81], [92, 91]]);
  });
  it("no DevOps read is an empty list; a new draft story goes under a feature shown, or none yet", () => {
    expect(assignedList({ ...base, work: undefined })).toEqual([]);
    expect(draftParents(assignedList(base)).map((p) => p.id)).toEqual([2, 1, 3, null]);
    expect(draftParents([]).map((p) => p.title)).toEqual(["No feature yet"]);
  });
  it("a draft with no feature that isn't on a block waits under To place (this client's only)", () => {
    expect(looseDrafts("contoso", base.drafts, []).map((d) => d.id)).toEqual([2]);
    expect(looseDrafts("contoso", base.drafts, [pick(9, { kind: "draft", itemId: null, draftId: 2 })])).toEqual([]);
  });
  it("says where each thing is: on this block first, else its earliest block this week", () => {
    const weekPicks = [pick(1, { itemId: 11 }), pick(2, { itemId: 12, date: "2026-11-12", half: "PM" }), pick(3, { itemId: 99, status: "dropped" })];
    const m = placedMap([...weekPicks, pick(7, { itemId: 12, date: "2026-11-11", half: "AM" })], AT);
    expect(m.get("icontoso:11")).toMatchObject({ here: true, pickId: 1 });
    expect(m.get("icontoso:12")).toMatchObject({ here: true, pickId: 7 });
    expect(placedMap(weekPicks, AT).get("icontoso:12")).toMatchObject({ here: false, date: "2026-11-12", half: "PM", pickId: 2 });
    expect(m.has("icontoso:99")).toBe(false);
    // Done on another block: named, and marked done (the row shows a check, not a + that would try to move it).
    expect(placedMap([pick(8, { itemId: 13, date: "2026-11-10", status: "done" })], AT).get("icontoso:13")).toMatchObject({ here: false, done: true });
    expect(m.get("icontoso:11")).toMatchObject({ done: false });
  });
});

describe("More in the client", () => {
  const all = [
    feature(1, { assignedToMe: true }),
    feature(5, { order: 20, assignedTo: "Dana Morales" }),
    item(51, { parentId: 5, order: 22 }),
    item(52, { parentId: 5, order: 21 }),
    item(53, { parentId: 5, stateCategory: "Completed" }),
    feature(6, { order: 10 }),
    feature(7, { order: 1, tier: "epic" }),
    item(13, { parentId: 1, order: 3 }),
    item(61, { order: 99 }),
    item(11, { parentId: 1, assignedToMe: true }),
  ];
  it("everything else open, features in backlog order with their stories; what Assigned to you shows, mine and epics left out", () => {
    const g = moreList(all, new Set([1, 11, 13]));
    expect(g.map((x) => [x.feature?.id ?? null, x.stories.map((s) => s.id)])).toEqual([[6, []], [5, [52, 51]], [null, [61]]]);
    expect(moreCount(g)).toBe(5);
  });
  it("a teammate's story under a feature in Assigned to you stays there, not here; by target date when asked", () => {
    expect(moreList(all, new Set([1, 11])).flatMap((x) => x.stories.map((s) => s.id))).not.toContain(13);
    const dated = all.map((x) => (x.id === 5 ? { ...x, targetDate: "2026-11-12" } : x));
    expect(moreList(dated, new Set([1, 11, 13]), "target").map((x) => x.feature?.id ?? null)).toEqual([5, 6, null]);
  });
});

describe("a row's hover and the header's status line", () => {
  it("the hover has the type and number, state, target date and size", () => {
    expect(hoverWords(item(11, { targetDate: "2026-11-20", size: 3 }), "M · 2h")).toBe("User Story 11 · Active · target Nov 20 · M · 2h");
    expect(hoverWords(item(12))).toBe("User Story 12 · Active · no target date");
  });
  it("the size is FocusTime's: the letter and its hours, never the DevOps field's value", () => {
    const scale = { XS: 30, S: 60, M: 120, L: 240, unsized: 120 };
    const o = { clientKey: "contoso", scale, weekPicks: [pick(1, { itemId: 11, size: "L" }), pick(2, { itemId: 12, size: "S", status: "dropped" })], weekFeatures: [{ clientKey: "contoso", itemId: 12, estimate: null, size: "S" as const }, { clientKey: "contoso", itemId: 1, estimate: 360 }, { clientKey: "fabrikam", itemId: 2, estimate: 360 }] };
    // Its to-do's size, else the week list's, else the assumption; the raw 8 points never shows.
    expect(sizeHover(item(11, { size: 8 }), o)).toBe("L · 4h");
    expect(sizeHover(item(12, { size: 8 }), o)).toBe("S · 1h");
    expect(sizeHover(item(13, { size: 8 }), o)).toBe("Size? · 2h");
    // A feature: its estimate when it is on the week's list with one (this client's), else nothing.
    expect(sizeHover(feature(1), o)).toBe("about 6h");
    expect(sizeHover(feature(2), o)).toBeNull();
  });
  it("one status line, only when the calendar puts the block at risk (QT-1); Watch reasons ride along", () => {
    expect(riskLine([])).toBeNull();
    expect(riskLine([{ severity: "watch", reason: "1h 30m of meetings" }])).toBeNull();
    expect(riskLine([{ severity: "watch", reason: "b" }, { severity: "at_risk", reason: "a" }])).toEqual({ severity: "at_risk", text: "At risk · 2 reasons", reasons: ["a", "b"] });
  });
});

describe("the search", () => {
  const base = { clientKey: "contoso", work, followUps: [promise(1, "contoso", "Send the export spec"), promise(2, "fabrikam", "Send the export spec")], drafts: [draft(2, { title: "Export button" }), draft(3, { clientKey: "fabrikam", title: "Export again" })] };
  it("empty text is no search (the Add list shows)", () => {
    expect(searchPanel(base, "")).toBeNull();
    expect(searchPanel(base, "   ")).toBeNull();
  });
  it("covers Assigned to you and More in the client, each item once", () => {
    const more = [item(77, { title: "Export the ledger" }), item(11, { title: "Item 11", parentId: 1 })];
    const r = searchPanel({ ...base, more }, "ledger")!;
    expect(r.results.map((x) => x.key)).toEqual(["icontoso:77"]);
    expect(searchPanel({ ...base, more }, "Item 11")!.results.map((x) => x.key)).toEqual(["icontoso:11"]);
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
  it("\"#\" is a number search: alone it matches nothing (never every draft and promise); special characters are plain text", () => {
    expect(searchPanel(base, "#")!.results).toEqual([]);
    expect(searchPanel(base, "#1")!.results.every((r) => r.kind === "story")).toBe(true);
    expect(searchPanel(base, "(.*)")!.results).toEqual([]);
    expect(searchPanel(base, "(.*)")!.news[0]!.label).toBe("New to-do: (.*)");
  });
  it("always ends with New to-do and New draft story, carrying the text", () => {
    const s = searchPanel(base, "  Call the vendor ")!;
    expect(s.news.map((n) => n.label)).toEqual(["New to-do: Call the vendor", "New draft story: Call the vendor"]);
    expect(s.news.map((n) => n.kind)).toEqual(["todo", "draft"]);
  });
  it("QC-1: adds New <feature type> in the process's own word when the New form is offered", () => {
    const s = searchPanel(base, "Billing export", "Capability")!;
    expect(s.news.map((n) => n.label)).toEqual(["New to-do: Billing export", "New draft story: Billing export", "New capability: Billing export"]);
    expect(s.news[2]).toMatchObject({ kind: "feature", key: "new-feature", text: "Billing export" });
    expect(searchPanel(base, "Billing export", null)!.news).toHaveLength(2);
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
