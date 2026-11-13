// IB-4: the slim Inbox's rules on the page: promise order, due words, the actions of a promise (never read-only) and
// the keys, the same for the buttons, the key help and the command menu. Fictional data.
import { describe, expect, it } from "vitest";
import type { InboxItemView } from "../../plan/inbox-items.ts";
import type { PromiseCard } from "../../plan/conversation-views.ts";
import type { FollowUpView } from "../../actions/types.ts";
import { actsFor, ITEM_KEYS, type ActEnv } from "./ItemActions.tsx";
import { promiseOrder } from "./InboxPage.tsx";
import { dueWords, lateText } from "./model.ts";
import { suggestionActs } from "./Suggestion.tsx";

const TODAY = "2026-11-05";
const row = (o: Partial<InboxItemView> & { key: string }): InboxItemView => ({
  kind: "promise", clientKey: "contoso", at: "2026-11-04T12:00:00Z", views: ["promises"], title: "A promise", who: null, where: null,
  due: null, dueAt: null, itemId: null, late: false, done: false, snoozedUntil: null, ...o,
});

describe("Promises' order", () => {
  it("late first, then by due (a time before the end of its day), then no date, newest first", () => {
    const rows = [
      row({ key: "c1", at: "2026-11-01T12:00:00Z" }),
      row({ key: "c2", due: "2026-11-07" }),
      row({ key: "c3", due: "2026-11-03", late: true }),
      row({ key: "c4", due: "2026-11-05" }),
      row({ key: "c5", dueAt: "2026-11-05T14:00:00Z", due: "2026-11-05" }),
      row({ key: "c6", at: "2026-11-04T18:00:00Z" }),
    ];
    expect([...rows].sort(promiseOrder).map((r) => r.key)).toEqual(["c3", "c5", "c4", "c2", "c6", "c1"]);
  });
  it("says late and due in words", () => {
    expect(lateText("2026-11-04", TODAY)).toBe("1 day late");
    expect(lateText("2026-10-31", TODAY)).toBe("5 days late");
    expect(dueWords("2026-11-05", TODAY)).toBe("Due today");
    expect(dueWords("2026-11-06", TODAY)).toBe("Due tomorrow");
    expect(dueWords("2026-11-09", TODAY)).toBe("Due Mon");
    expect(dueWords("2026-11-20", TODAY)).toBe("Due Nov 20");
  });
});

const env = (): ActEnv & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, run: async (a) => void calls.push(a), form: (f) => void calls.push(`form:${f}`), createDraft: () => void calls.push("createDraft"), editDraft: () => void calls.push("editDraft"), planWeek: () => void calls.push("planWeek"), today: TODAY };
};
const promise = (o: Partial<PromiseCard> = {}): PromiseCard => ({
  id: 7, conversationId: 3, toRef: null, conversationTitle: "Totals", clientKey: "contoso", clientName: "Contoso", chatName: "Contoso chat", what: "Send the totals", toName: "Lena Hart",
  dueAt: null, dueDate: "2026-11-06", overdue: false, state: "open", onToday: null, followUpId: null, item: null, needsItem: false, draft: null, likely: null, suggestions: [],
  waitingDays: null, reason: null, messages: [], link: "https://teams.example/x", createdAt: "2026-11-04T12:00:00Z", ...o,
});
const followUp = (o: Partial<FollowUpView> = {}): FollowUpView => ({
  id: 4, kind: "manual", clientKey: "contoso", who: "Lena", whoRef: null, what: "Send notes", channel: null, due: "2026-11-04", itemId: null, itemUrl: null, draft: null, openedAt: "2026-11-01T12:00:00Z",
  isNew: false, closedAt: null, closeNote: null, closedBy: null, session: null, outcome: null, closeHow: null, snoozedUntil: null, origin: null, byHand: true, ...o,
} as FollowUpView);

describe("a promise's actions", () => {
  const EVERY = ["close", "due", "who", "week", "done", "not_needed"];
  it("a linked chat promise has every action: nothing is read-only", () => {
    const linked = promise({ item: { id: 4417, title: "Totals", url: null, state: "Active" } });
    const ids = actsFor({ kind: "chatPromise", row: row({ key: "c7", itemId: 4417 }), promise: linked }, env()).map((a) => a.id);
    for (const id of [...EVERY, "unlink"]) expect(ids, id).toContain(id);
  });
  it("one I added has every action too", () => {
    const ids = actsFor({ kind: "followUp", row: row({ key: "f4" }), followUp: followUp() }, env()).map((a) => a.id);
    for (const id of EVERY) expect(ids, id).toContain(id);
  });
  it("the primary follows state: late → Close the loop; no item → Create DevOps item; item closed → Mark done", () => {
    const p = (r: Partial<InboxItemView>, pc: Partial<PromiseCard>) => actsFor({ kind: "chatPromise", row: row({ key: "c7", ...r }), promise: promise(pc) }, env()).find((a) => a.primary)?.id;
    expect(p({ late: true }, {})).toBe("close");
    expect(p({}, {})).toBe("create");
    expect(p({}, { item: { id: 1, title: null, url: null, closed: true } })).toBe("done");
    expect(p({}, { item: { id: 1, title: null, url: null } })).toBe("close");
  });
  it("no more Hide or Snooze: a promise clears itself instead", () => {
    const ids = actsFor({ kind: "chatPromise", row: row({ key: "c7" }), promise: promise() }, env()).map((a) => a.id as string);
    expect(ids).not.toContain("hide");
    expect(ids).not.toContain("snooze");
  });
  it("Add to my week puts a chat promise on today", () => {
    const e = env();
    actsFor({ kind: "chatPromise", row: row({ key: "c7" }), promise: promise() }, e).find((a) => a.id === "week")!.run();
    expect(e.calls).toEqual(["my_promises.today"]);
  });
});

describe("the keys", () => {
  it("D is Done on a promise; C, L and X are a suggestion's three actions", () => {
    const acts = actsFor({ kind: "chatPromise", row: row({ key: "c7" }), promise: promise() }, env());
    expect(acts.find((a) => a.key === "D")?.id).toBe("done");
    const s = suggestionActs({ link: "https://teams.example/x" } as Parameters<typeof suggestionActs>[0], { form: () => {}, dismiss: () => {}, promise: () => {}, notWork: () => {} });
    expect(s.filter((a) => "key" in a).map((a) => [a.key, a.id])).toEqual([["C", "create"], ["L", "link"], ["X", "dismiss"]]);
  });
  it("the command menu offers the same keys as the key help", async () => {
    const { ASK_KEYS } = await import("../menu.ts");
    expect(ASK_KEYS.map((k) => k.hint)).toEqual(ITEM_KEYS.map((k) => k.key));
  });
});
