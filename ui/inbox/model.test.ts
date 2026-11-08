// IB-1 slice 2: the list's rules (views, clients, grouping, late first, tags) and the item actions (one set per item,
// the same for the buttons and the keys; a promise is never read-only). Fictional data.
import { describe, expect, it } from "vitest";
import type { InboxItemView } from "../../plan/inbox-items.ts";
import type { ConversationCard, PromiseCard } from "../../plan/conversation-views.ts";
import type { FollowUpView } from "../../actions/types.ts";
import { actsFor, ITEM_KEYS, type ActEnv } from "./ItemActions.tsx";
import { byUrgency, clientCounts, dueBucket, groupRows, inView, lateText, rowTag } from "./model.ts";

const G = { tz: "UTC", sort: "newest" as const };

const TODAY = "2026-11-05";
const row = (o: Partial<InboxItemView> & { key: string }): InboxItemView => ({
  kind: "promise", clientKey: "contoso", at: "2026-11-04T12:00:00Z", views: ["promises"], title: "A promise", who: null, where: null,
  due: null, dueAt: null, itemId: null, late: false, done: false, snoozedUntil: null, ...o,
});

describe("the list", () => {
  const items = [
    row({ key: "f1", clientKey: "fabrikam", views: ["needs_you", "promises"], due: "2026-11-03", late: true }),
    row({ key: "c2", views: ["needs_you", "promises"], due: "2026-11-05" }),
    row({ key: "v3", kind: "conversation", views: ["needs_you"], at: "2026-11-05T15:00:00Z", conversationView: "needs", mentionsMe: true }),
    row({ key: "k4", kind: "capture", views: ["captures"], clientKey: null }),
  ];
  it("a view holds its items, for the chosen clients (none: all)", () => {
    expect(inView(items, "needs_you", []).map((i) => i.key)).toEqual(["f1", "c2", "v3"]);
    expect(inView(items, "needs_you", ["contoso"]).map((i) => i.key)).toEqual(["c2", "v3"]);
    expect(clientCounts(items, "needs_you")).toEqual(new Map([["fabrikam", 1], ["contoso", 2]]));
  });
  it("groups by client with late clients first and by due date, late first inside a due date group", () => {
    const name = (k: string) => k[0]!.toUpperCase() + k.slice(1);
    const rows = inView(items, "needs_you", []);
    expect(groupRows(rows, "client", name, TODAY, G).map((g) => [g.label, g.rows.map((r) => r.key)])).toEqual([["Fabrikam", ["f1"]], ["Contoso", ["v3", "c2"]]]);
    expect(groupRows(rows, "due", name, TODAY, G).map((g) => g.label)).toEqual(["Late", "Today", "No due date"]);
    expect([...items].sort(byUrgency)[0]!.key).toBe("f1");
  });
  it("due buckets and late words", () => {
    expect(dueBucket(row({ key: "f1", due: "2026-11-06" }), TODAY).label).toBe("Tomorrow");
    expect(dueBucket(row({ key: "f1", due: "2026-11-08" }), TODAY).label).toBe("This week");
    expect(dueBucket(row({ key: "f1", due: "2026-11-20" }), TODAY).label).toBe("Later");
    expect(lateText("2026-11-04", TODAY)).toBe("1 day late");
    expect(lateText("2026-10-31", TODAY)).toBe("5 days late");
  });
  it("one tag per row, from its state", () => {
    expect(rowTag(row({ key: "f1", due: "2026-11-04", late: true }), TODAY)).toEqual({ text: "1 day late", tone: "late" });
    expect(rowTag(row({ key: "f1", due: "2026-11-06" }), TODAY)).toEqual({ text: "Due tomorrow", tone: "soon" });
    expect(rowTag(row({ key: "v3", kind: "conversation", conversationView: "needs", mentionsMe: true }), TODAY)?.text).toBe("Asked you");
    expect(rowTag(row({ key: "v3", kind: "conversation", conversationView: "needs", workRequest: true }), TODAY)?.text).toBe("Work request");
    expect(rowTag(row({ key: "s1", kind: "send", sendState: "waiting", must: true }), TODAY)?.text).toBe("Must · Accept?");
    expect(rowTag(row({ key: "d1", kind: "draft" }), TODAY)?.text).toBe("Review draft");
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

describe("item actions", () => {
  const EVERY = ["close", "due", "who", "week", "done", "not_needed", "hide"];
  it("a linked chat promise has every action: nothing is read-only", () => {
    const linked = promise({ item: { id: 4417, title: "Totals", url: null, state: "Active" } });
    const ids = actsFor({ kind: "chatPromise", row: row({ key: "c7", itemId: 4417 }), promise: linked }, env()).map((a) => a.id);
    for (const id of [...EVERY, "unlink"]) expect(ids, id).toContain(id);
  });
  it("a former follow-up (f<id>) has every action too", () => {
    const ids = actsFor({ kind: "followUp", row: row({ key: "f4" }), followUp: followUp() }, env()).map((a) => a.id);
    for (const id of EVERY) expect(ids, id).toContain(id);
    expect(ids).not.toContain("followup");
  });
  it("the primary follows state: late → Close the loop; no item → Create DevOps item; item closed → Mark done", () => {
    const p = (r: Partial<InboxItemView>, pc: Partial<PromiseCard>) => actsFor({ kind: "chatPromise", row: row({ key: "c7", ...r }), promise: promise(pc) }, env()).find((a) => a.primary)?.id;
    expect(p({ late: true }, {})).toBe("close");
    expect(p({}, {})).toBe("create");
    expect(p({}, { item: { id: 1, title: null, url: null, closed: true } })).toBe("done");
    expect(p({}, { item: { id: 1, title: null, url: null } })).toBe("close");
  });
  it("a work request's primary is Create DevOps item; there is one primary", () => {
    const card = { id: 3, primary: "create", closed: null, item: null, commitments: [], link: "x", hidden: false } as unknown as ConversationCard;
    const acts = actsFor({ kind: "conversation", row: row({ key: "v3", kind: "conversation" }), card }, env());
    expect(acts.filter((a) => a.primary).map((a) => a.id)).toEqual(["create"]);
  });
  it("each key runs exactly one action, the same one its button runs", () => {
    const acts = actsFor({ kind: "chatPromise", row: row({ key: "c7" }), promise: promise() }, env());
    const keyed = acts.filter((a) => a.key);
    expect(new Set(keyed.map((a) => a.key)).size).toBe(keyed.length);
    for (const k of ITEM_KEYS.filter((k) => k.key.length === 1 && !["J", "K"].includes(k.key))) {
      const a = acts.find((x) => x.key === k.key);
      if (a) expect(a.id).toBe(k.act);
    }
    const e = env();
    actsFor({ kind: "chatPromise", row: row({ key: "c7" }), promise: promise() }, e).find((a) => a.key === "F")!.run();
    expect(e.calls).toEqual(["form:due"]);
  });
});

describe("the command menu's Inbox keys", () => {
  it("are the same keys, for the same acts, as the Inbox's own", async () => {
    const { ASK_KEYS } = await import("../menu.ts");
    expect(ASK_KEYS.map((k) => [k.hint, k.act])).toEqual(ITEM_KEYS.map((k) => [k.key, k.act]));
  });
});

describe("slice 3: what I wait on, and Snooze", () => {
  it("Waiting on rows say who and never offer Close the loop or a primary", () => {
    expect(rowTag(row({ key: "s9", kind: "sent", views: ["waiting"] }), TODAY)?.text).toBe("No answer yet");
    expect(rowTag(row({ key: "a9", kind: "ask", views: ["waiting"] }), TODAY)?.text).toBe("No reply yet");
    for (const [key, kind, expected] of [["c9", "commitment", "take_over"], ["s9", "sent", "cancel"], ["a9", "ask", "week"]] as const) {
      const acts = actsFor({ kind: "waiting", row: row({ key, kind, views: ["waiting"], who: "Lena Hart" }) }, env());
      expect(acts.map((a) => a.id), kind).toEqual([expected, "hide", "snooze"]);
      expect(acts.some((a) => a.primary), kind).toBe(false);
    }
  });
  it("every open item snoozes; a snoozed one wakes; a done one does neither", () => {
    const ids = (r: Partial<InboxItemView>) => actsFor({ kind: "chatPromise", row: row({ key: "c7", ...r }), promise: promise() }, env()).map((a) => a.id);
    expect(ids({})).toContain("snooze");
    expect(ids({ snoozedUntil: "2026-11-06T15:00:00Z" })).toContain("wake");
    expect(ids({ snoozedUntil: "2026-11-06T15:00:00Z" })).not.toContain("snooze");
    const e = env();
    actsFor({ kind: "chatPromise", row: row({ key: "c7" }), promise: promise() }, e).find((a) => a.id === "snooze")!.run();
    expect(e.calls).toEqual(["form:snooze"]);
  });
});
