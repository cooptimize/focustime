// IB-4: the slim Inbox's rules on the page: promise order, due words, the actions of a promise (never read-only) and
// the keys, the same for the buttons, the key help and the command menu. Fictional data.
import { describe, expect, it } from "vitest";
import type { InboxItemView } from "../../plan/inbox-items.ts";
import type { PromiseCard } from "../../plan/conversation-views.ts";
import type { FollowUpView } from "../../actions/types.ts";
import { actsFor, ITEM_KEYS, type ActEnv } from "./ItemActions.tsx";
import { promiseOrder } from "./InboxPage.tsx";
import { chipHint, chipName, dueWords, lateText, needCounts, needNoClient, NO_CLIENT } from "./model.ts";
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

describe("UC-1: a chip's number", () => {
  const r = (clientKey: string | null, ...views: string[]) => ({ clientKey, views });
  it("counts what the tab counts, by client, and adds up to the tab's number", () => {
    const items = [r("contoso", "needs_you"), r("contoso", "needs_you", "promises"), r("fabrikam", "needs_you"), r("fabrikam", "promises"), r("adatum", "captures")];
    const n = needCounts(items);
    expect([...n]).toEqual([["contoso", 2], ["fabrikam", 1]]);
    expect([...n.values()].reduce((a, b) => a + b, 0)).toBe(items.filter((i) => i.views.includes("needs_you")).length);
  });
  it("a client with nothing that needs me has no number", () => {
    expect(needCounts([r("adatum", "captures"), r("adatum", "promises")]).has("adatum")).toBe(false);
    expect(needCounts([r(null, "needs_you")]).size).toBe(0);
  });
  it("the number is part of the chip's name", () => {
    expect(chipName("Contoso", 0)).toBe("Contoso");
    expect(chipName("Contoso", 1)).toBe("Contoso, 1 needs you");
    expect(chipName("All clients", 5)).toBe("All clients, 5 need you");
    expect(chipHint("Contoso", 0)).toBeNull();
    expect(chipHint("Contoso", 1)).toBe("1 needs you in Contoso: suggestions from chats, and promises late or due today. The same count as the Inbox tab's");
    expect(chipHint(null, 5)).toMatch(/^5 need you: /);
  });
});

describe("UC-2: the No client chip", () => {
  const r = (clientKey: string | null, ...views: string[]) => ({ clientKey, views });
  it("counts only what the tab counts that has no client, so the chips add up to the tab", () => {
    const items = [r("adatum", "needs_you"), r(null, "needs_you", "promises"), r(null, "captures"), r(null, "promises")];
    expect(needNoClient(items)).toBe(1);
    const perClient = [...needCounts(items).values()].reduce((a, n) => a + n, 0);
    expect(perClient + needNoClient(items)).toBe(items.filter((x) => x.views.includes("needs_you")).length);
    expect(needNoClient([r("adatum", "needs_you")])).toBe(0);
  });
  it("says what it counts", () => {
    expect(chipName(NO_CLIENT, 2)).toBe("No client, 2 need you");
    expect(chipHint(NO_CLIENT, 1)).toMatch(/^1 needs you with no client: suggestions from chats/);
  });
});
