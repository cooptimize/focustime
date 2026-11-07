// IB-1 slice 4: Today's urgent strip and Week's rail read the Inbox's own rows (inbox.today). For the same data their
// items are the Inbox's items, each line is a Needs you item, and the number at the strip's foot is the badge's.
// Fictional names (test/conversations.ts).
import { describe, expect, it } from "vitest";
import { planStoreOn } from "../store/plan-store.ts";
import { cfg, people } from "../test/conversation-people.ts";
import { CHAT, LENA, SAM, world, ZONE } from "../test/conversations.ts";
import { HOME_TENANT } from "../test/builders/index.ts";
import { railItems, todayLines, type InboxFacts, type InboxListData, type InboxTodayData } from "../plan/inbox-items.ts";
import { inboxFacts } from "./conversation-actions.ts";
import { inboxAction, type InboxAction } from "./inbox-actions.ts";
import type { UrgentAsk } from "./types.ts";

const SENDS: InboxFacts[] = [
  { key: "s1", kind: "send", clientKey: "contoso", at: "2026-11-04T20:00:00Z", done: false, sendState: "waiting", title: "Order export", who: "Lee Park", must: true },
  { key: "s2", kind: "send", clientKey: "contoso", at: "2026-11-04T19:00:00Z", done: false, sendState: "accepted", title: "Already accepted" },
];

async function setup(urgent: (convId: number | null) => UrgentAsk[] = () => []) {
  const w = world({ allowed: [] });
  const { as } = await people(w);
  const sam = as(SAM);
  const plan = planStoreOn(w.conn, { now: () => Temporal.Instant.from(w.now()).toZonedDateTimeISO(ZONE), userId: SAM.userId! });
  let convId: number | null = null;
  const run = async <T>(action: InboxAction, input: unknown = {}): Promise<T> => {
    const r = await inboxAction({ plan, config: async () => cfg, now: w.now, conversations: (c) => inboxFacts(sam.ctx, c), sends: async () => SENDS, snoozeDay: async () => null, urgent: async () => urgent(convId) }, action, input);
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  return { w, plan, run, setConv: (id: number) => (convId = id) };
}

/** Today's working day ends in an hour, so an untimed promise due today joins the strip too. */
const dayEndSoon = (now: string) => new Date(Date.parse(now) + 3600_000).toISOString();

describe("Today and Week read the Inbox's items", () => {
  it("the strip's and the rail's items equal the Inbox's for the same data, and the count is the badge's", async () => {
    const { w, plan, run, setConv } = await setup((id) => (id ? [{ chatId: CHAT.chatId, messageId: "m-urgent", clientKey: "contoso", clientName: "Contoso", title: "Login is down", at: "2026-11-04T21:00:00Z", conversationId: id }] : []));
    const late = await plan.addFollowUp({ who: "Lena", what: "Send the mapping notes", due: "2026-11-02", clientKey: "contoso" });
    await plan.addFollowUp({ who: null, what: "Later one", due: "2026-12-01", clientKey: "contoso" });
    const snoozed = await plan.addFollowUp({ who: null, what: "Snoozed late one", due: "2026-11-01", clientKey: "contoso" });
    await plan.markInbox([`f${snoozed.id}`], { snoozedUntil: "2099-01-01T00:00:00Z" });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll check the October filter tomorrow")]);

    // A conversation that needs me, holding a request sorted as needed now.
    const m = await w.say(CHAT, LENA, "2026-11-04T21:00:00Z", "Login is down for the client, can someone look?");
    const c = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: CHAT.clientKey, title: "Login is down", summary: "Login fails for the client.", participants: [{ id: LENA.userId!, name: LENA.displayName!, external: LENA.tenantId !== HOME_TENANT }], firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt });
    await w.convs.place([{ chatId: CHAT.chatId, messageId: m.messageId, conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: m.createdAt }]);
    let list = await run<InboxListData>("inbox.list");
    const conv = list.items.find((i) => i.kind === "conversation" && i.views.includes("needs_you"));
    expect(conv).toBeDefined();
    setConv(Number(conv!.key.slice(1)));

    list = await run<InboxListData>("inbox.list");
    const today = await run<InboxTodayData>("inbox.today");
    const badge = await run<{ needsYou: number }>("inbox.count");
    const now = w.now();
    const o = { today: list.today, now, dayEnd: dayEndSoon(now) };

    // The same rows, the same lines.
    const byKey = new Map(list.items.map((i) => [i.key, i]));
    for (const r of today.items) expect(r).toEqual(byKey.get(r.key));
    expect(todayLines(today.items, o).map((r) => r.key)).toEqual(todayLines(list.items, o).map((r) => r.key));
    expect(railItems(today.items)).toEqual(railItems(list.items));
    // Every strip line is in Needs you; the late one and the waiting send are there; the snoozed, later and accepted ones aren't.
    const strip = todayLines(today.items, o).map((r) => r.key);
    for (const k of strip) expect(byKey.get(k)!.views).toContain("needs_you");
    expect(strip).toContain(`f${late.id}`);
    expect(strip).toContain("s1");
    expect(strip).not.toContain(`f${snoozed.id}`);
    expect(strip).not.toContain("s2");
    expect(strip[0]).toBe(conv!.key);
    expect(byKey.get(conv!.key)!.urgent).toMatchObject({ title: "Login is down" });
    // The rail has the late promise (carried to today), never the snoozed one.
    expect(railItems(today.items).map((r) => r.key)).toContain(`f${late.id}`);
    expect(railItems(today.items).map((r) => r.key)).not.toContain(`f${snoozed.id}`);
    // One number.
    expect(today.needsYou).toBe(badge.needsYou);
    expect(today.needsYou).toBe(list.counts.needs_you);
    expect(today.needsYou).toBe(today.items.filter((i) => i.views.includes("needs_you")).length);
  });

  it("an urgent request whose message isn't in a conversation I see marks nothing", async () => {
    const { run } = await setup(() => [{ chatId: CHAT.chatId, messageId: "m1", clientKey: "contoso", clientName: "Contoso", title: "Down", at: "2026-11-04T21:00:00Z", conversationId: null }]);
    const today = await run<InboxTodayData>("inbox.today");
    expect(today.items.some((i) => i.urgent)).toBe(false);
  });

  it("takes no input", async () => {
    const { run } = await setup();
    await expect(run("inbox.today", { x: 1 })).rejects.toThrow(/inbox.today takes/);
  });
});
