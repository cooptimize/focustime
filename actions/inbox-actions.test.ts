// IB-1: the Inbox's one read model. Former follow-ups are Promises under their own ids (f<id>), chat promises keep
// theirs (c<id>), and the badge, the per-view counts and the Needs you header agree. The migration's data step marks
// everything open at release as seen, so nobody's Needs you fills up at once. Fictional names (test/conversations.ts).
import { describe, expect, it } from "vitest";
import { inboxMarks } from "../store/migrations/20261110T0900_inbox_marks.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { cfg, people } from "../test/conversation-people.ts";
import { CHAT, SAM, world, ZONE } from "../test/conversations.ts";
import { inboxFacts } from "./conversation-actions.ts";
import { inboxAction, type InboxAction, type InboxListData } from "./inbox-actions.ts";
import type { InboxFacts } from "../plan/inbox-items.ts";

async function setup(o: { sends?: InboxFacts[] } = {}) {
  const w = world({ allowed: [] });
  const { as } = await people(w);
  const sam = as(SAM);
  const plan = planStoreOn(w.conn, { now: () => Temporal.Instant.from(w.now()).toZonedDateTimeISO(ZONE), userId: SAM.userId! });
  const run = async <T>(action: InboxAction, input: unknown = {}): Promise<T> => {
    const r = await inboxAction({ plan, config: async () => cfg, now: w.now, conversations: (c) => inboxFacts(sam.ctx, c), sends: async () => o.sends ?? [] }, action, input);
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  return { w, sam, plan, run };
}

describe("Promises over both stores", () => {
  it("every open follow-up is a Promise under f<id>, with its due; closed ones show in Done; nothing is moved", async () => {
    const { plan, run } = await setup();
    const a = await plan.addFollowUp({ who: "Lena", what: "Send the mapping notes", due: "2026-11-02", clientKey: "contoso" });
    const b = await plan.addFollowUp({ who: null, what: "Check the export", due: "2026-11-20", clientKey: "contoso" });
    const c = await plan.addFollowUp({ who: null, what: "Already told them", due: null, clientKey: "contoso" });
    await plan.closeFollowUp(c.id, "Told on Teams", "me", { how: "teams" });
    const list = await run<InboxListData>("inbox.list");
    const byKey = new Map(list.items.map((i) => [i.key, i]));
    expect(byKey.get(`f${a.id}`)).toMatchObject({ kind: "promise", clientKey: "contoso", views: ["needs_you", "promises"] });
    expect(byKey.get(`f${b.id}`)?.views).toEqual(["promises"]);
    expect(byKey.get(`f${c.id}`)?.views).toEqual(["done"]);
    // The rows themselves are unchanged: the follow-up actions still work on them by their own id.
    expect((await plan.openFollowUps()).map((f) => f.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("a promise found in a chat is c<id> and new until seen; inbox.seen takes only my own keys", async () => {
    const { w, run } = await setup();
    const m = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll send the totals next week");
    await w.run(CHAT, [m]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    let list = await run<InboxListData>("inbox.list");
    expect(list.items.find((i) => i.key === `c${k.id}`)?.views).toContain("needs_you");
    expect(await run("inbox.seen", { keys: [`c${k.id}`, "c999999", "f999999"] })).toEqual({ seen: 1 });
    list = await run<InboxListData>("inbox.list");
    expect(list.items.find((i) => i.key === `c${k.id}`)?.views).not.toContain("needs_you");
  });
});

describe("one count", () => {
  it("the badge, the Needs you view's count and the list's own number are the same", async () => {
    const { w, plan, run } = await setup({ sends: [{ key: "s1", kind: "send", clientKey: "contoso", at: "2026-11-04T20:00:00Z", done: false, sendState: "waiting" }] });
    await plan.addFollowUp({ who: null, what: "Overdue one", due: "2026-11-01", clientKey: "contoso" });
    await plan.addFollowUp({ who: null, what: "Later one", due: "2026-12-01", clientKey: "contoso" });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll check the October filter tomorrow")]);
    const list = await run<InboxListData>("inbox.list");
    const badge = await run<{ needsYou: number }>("inbox.count");
    expect(badge.needsYou).toBeGreaterThanOrEqual(3);
    expect(badge.needsYou).toBe(list.counts.needs_you);
    expect(list.needsYou).toBe(list.items.filter((i) => i.views.includes("needs_you")).length);
    expect(list.needsYou).toBe(badge.needsYou);
  });
});

describe("the migration's data step", () => {
  it("marks every open follow-up and my open chat promises seen, and no one else's", async () => {
    const { w, plan } = await setup();
    const open = await plan.addFollowUp({ who: null, what: "Open at release", due: "2026-12-01", clientKey: "contoso" });
    const closed = await plan.addFollowUp({ who: null, what: "Closed before", due: null, clientKey: "contoso" });
    await plan.closeFollowUp(closed.id, null);
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll send the totals next week")]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    // Run the data step again on a store as it was at release (the table empty).
    await w.conn.run("DELETE FROM inbox_marks");
    const inserts = inboxMarks.sqlite.split(";").filter((s) => /INSERT INTO inbox_marks/.test(s));
    for (const s of inserts) await w.conn.run(s);
    const marks = await plan.inboxMarks();
    expect([...marks.keys()].sort()).toEqual([`c${k.id}`, `f${open.id}`].sort());
    expect(marks.get(`f${open.id}`)?.seenAt).toBeTruthy();
  });
});
