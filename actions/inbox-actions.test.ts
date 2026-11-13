// IB-1: the Inbox's one read model. Former follow-ups are Promises under their own ids (f<id>), chat promises keep
// theirs (c<id>), and the badge, the per-view counts and the Needs you header agree. The migration's data step marks
// everything open at release as seen, so nobody's Needs you fills up at once. Fictional names (test/conversations.ts).
import { describe, expect, it } from "vitest";
import { inboxMarks } from "../store/migrations/20261110T0900_inbox_marks.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { cfg, people } from "../test/conversation-people.ts";
import { CHAT, LENA, SAM, world, ZONE } from "../test/conversations.ts";
import { snoozeDayOf } from "../plan/inbox-items.ts";
import type { TimeModel } from "../week/hours.ts";
import { inboxFacts } from "./conversation-actions.ts";
import { inboxAction, type InboxAction, type InboxListData } from "./inbox-actions.ts";
import type { InboxFacts, SnoozeDay } from "../plan/inbox-items.ts";

async function setup(o: { sends?: InboxFacts[]; day?: SnoozeDay } = {}) {
  const w = world({ allowed: [] });
  const { as } = await people(w);
  const sam = as(SAM);
  const plan = planStoreOn(w.conn, { now: () => Temporal.Instant.from(w.now()).toZonedDateTimeISO(ZONE), userId: SAM.userId! });
  const run = async <T>(action: InboxAction, input: unknown = {}): Promise<T> => {
    const r = await inboxAction({ plan, config: async () => cfg, now: w.now, conversations: (c) => inboxFacts(sam.ctx, c), sends: async () => o.sends ?? [], snoozeDay: async () => o.day ?? null }, action, input);
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

  it("a promise found in a chat is c<id> in Promises; inbox.seen takes only my own keys", async () => {
    const { w, run } = await setup();
    const m = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll send the totals next week");
    await w.run(CHAT, [m]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    // IB-4: new isn't a reason to count; only late or due today is.
    const list = await run<InboxListData>("inbox.list");
    expect(list.items.find((i) => i.key === `c${k.id}`)?.views).toEqual(["promises"]);
    expect(await run("inbox.seen", { keys: [`c${k.id}`, "c999999", "f999999"] })).toEqual({ seen: 1 });
  });
});

describe("one count", () => {
  it("IB-4: the badge counts late or due-today promises (and suggestions), never later ones or sends; every number agrees", async () => {
    const { w, plan, run } = await setup({ sends: [{ key: "s1", kind: "send", clientKey: "contoso", at: "2026-11-04T20:00:00Z", done: false, sendState: "waiting" }] });
    await plan.addFollowUp({ who: null, what: "Overdue one", due: "2026-11-01", clientKey: "contoso" });
    await plan.addFollowUp({ who: null, what: "Later one", due: "2026-12-01", clientKey: "contoso" });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll check the October filter tomorrow")]);
    const list = await run<InboxListData>("inbox.list");
    const badge = await run<{ needsYou: number }>("inbox.count");
    expect(badge.needsYou).toBe(1);
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

describe("slice 2: rows, Hide for me, and promises never read-only", () => {
  it("each row carries what the list shows: title, who, where, due and late; never message text", async () => {
    const { w, plan, run } = await setup();
    const f = await plan.addFollowUp({ who: "Lena", what: "Send the mapping notes", due: "2026-11-01", clientKey: "contoso" });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll send the totals next week")]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    const list = await run<InboxListData>("inbox.list");
    expect(list.items.find((i) => i.key === `f${f.id}`)).toMatchObject({ title: "Send the mapping notes", who: "Lena", due: "2026-11-01", late: true, done: false });
    const c = list.items.find((i) => i.key === `c${k.id}`)!;
    expect(c).toMatchObject({ kind: "promise", title: k.what, where: CHAT.displayName, late: false });
    // Only what a row shows: no summary, messages or anyone's email.
    const allowed = new Set(["key", "kind", "clientKey", "at", "views", "title", "who", "where", "due", "dueAt", "itemId", "late", "done", "sendState", "conversationView", "mentionsMe", "workRequest", "must", "weekStart", "snoozedUntil", "reason"]);
    for (const i of list.items) for (const k of Object.keys(i)) expect(allowed.has(k), k).toBe(true);
  });

  it("Hide for me takes an item out of every view and the count, and back again; a conversation keeps its own Hide", async () => {
    const { plan, run } = await setup();
    const f = await plan.addFollowUp({ who: null, what: "Overdue one", due: "2026-11-01", clientKey: "contoso" });
    const before = await run<{ needsYou: number }>("inbox.count");
    expect(await run("inbox.hide", { key: `f${f.id}`, hidden: true })).toEqual({ hidden: true });
    let list = await run<InboxListData>("inbox.list");
    expect(list.items.find((i) => i.key === `f${f.id}`)?.views).toEqual([]);
    expect((await run<{ needsYou: number }>("inbox.count")).needsYou).toBe(before.needsYou - 1);
    await run("inbox.hide", { key: `f${f.id}`, hidden: false });
    list = await run<InboxListData>("inbox.list");
    expect(list.items.find((i) => i.key === `f${f.id}`)?.views).toContain("needs_you");
    await expect(run("inbox.hide", { key: "v1", hidden: true })).rejects.toThrow(/conversations.hide/);
    await expect(run("inbox.hide", { key: "f999999", hidden: true })).rejects.toThrow(/404/);
  });

  it("a linked chat promise keeps due, who and Close the loop (how and note kept); Open again clears them", async () => {
    const { w, sam, run } = await setup();
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll send the totals next week")]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    await w.convs.updateCommitment(k.id, { itemId: 4417, itemUrl: "https://dev.azure.com/contoso/p/_workitems/edit/4417", itemTitle: "Totals" });
    await sam.run("my_promises.due", { id: k.id, due: "2026-11-03" });
    expect(await w.convs.commitment(k.id)).toMatchObject({ dueDate: "2026-11-03", dueAt: null, itemId: 4417 });
    expect((await run<InboxListData>("inbox.list")).items.find((i) => i.key === `c${k.id}`)).toMatchObject({ late: true, itemId: 4417 });
    await sam.run("my_promises.who", { id: k.id, who: "Lena Hart" });
    expect((await w.convs.commitment(k.id))?.toName).toBe("Lena Hart");
    // Never me: naming myself leaves it to nobody.
    await sam.run("my_promises.who", { id: k.id, who: SAM.displayName });
    expect((await w.convs.commitment(k.id))?.toName).toBeNull();
    expect((await sam.fail("my_promises.due", { id: k.id, due: "soon" })).status).toBe(400);
    await sam.run("my_promises.close", { id: k.id, how: "teams", note: "Sent the totals" });
    expect(await w.convs.commitment(k.id)).toMatchObject({ state: "done", closeHow: "teams", closeNote: "Sent the totals" });
    expect((await sam.fail("my_promises.close", { id: k.id })).status).toBe(409);
    await sam.run("my_promises.reopen", { id: k.id });
    expect(await w.convs.commitment(k.id)).toMatchObject({ state: "open", closeHow: null, closeNote: null });
  });
});

describe("slice 3: Waiting on, reasons and Snooze", () => {
  it("IB-4: someone else's open commitment to me never shows: no Waiting on", async () => {
    const { w, run } = await setup();
    await w.run(CHAT, [await w.say(CHAT, LENA, "2026-11-04T21:00:00Z", "I'll send the October totals tomorrow")]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId)).find((x) => x.whoName === LENA.displayName)!;
    let row = (await run<InboxListData>("inbox.list")).items.find((i) => i.key === `c${k.id}`);
    expect(row).toBeUndefined();
    await w.convs.updateCommitment(k.id, { toId: SAM.userId!, toName: SAM.displayName });
    row = (await run<InboxListData>("inbox.list")).items.find((i) => i.key === `c${k.id}`);
    expect(row).toBeUndefined();
  });

  it("each Needs you row says why", async () => {
    const { plan, run } = await setup();
    const f = await plan.addFollowUp({ who: "Lena", what: "Send the mapping notes", due: "2026-11-01", clientKey: "contoso" });
    const row = (await run<InboxListData>("inbox.list")).items.find((i) => i.key === `f${f.id}`)!;
    expect(row.reason).toMatch(/^You (added|promised) it, \d+ days late$/);
  });

  it("Snooze takes it out of every view and the count until then, never changes its due, and null wakes it", async () => {
    const nine = [{ start: "09:00", end: "17:00" }];
    const model = { timeZone: ZONE, weekdays: { mon: nine, tue: nine, wed: nine, thu: nine, fri: nine, sat: [], sun: [] }, lunch: null, overrides: [] } as unknown as TimeModel;
    const { plan, run } = await setup({ day: snoozeDayOf(model, new Set()) });
    const f = await plan.addFollowUp({ who: null, what: "Overdue one", due: "2026-11-01", clientKey: "contoso" });
    const before = (await run<{ needsYou: number }>("inbox.count")).needsYou;
    const r = await run<{ snoozedUntil: string }>("inbox.snooze", { key: `f${f.id}`, until: "tomorrow" });
    expect(r.snoozedUntil).toBe("2026-11-05T15:00:00Z");
    const list = await run<InboxListData>("inbox.list");
    expect(list.items.find((i) => i.key === `f${f.id}`)).toMatchObject({ views: [], due: "2026-11-01", snoozedUntil: r.snoozedUntil });
    expect(list.needsYou).toBe(before - 1);
    expect((await plan.openFollowUps()).find((x) => x.id === f.id)?.due).toBe("2026-11-01");
    await run("inbox.snooze", { key: `f${f.id}`, until: null });
    expect((await run<InboxListData>("inbox.list")).items.find((i) => i.key === `f${f.id}`)?.views).toContain("needs_you");
    await expect(run("inbox.snooze", { key: `f${f.id}`, until: "2026-10-01" })).rejects.toThrow(/after today/);
    await expect(run("inbox.snooze", { key: `f${f.id}`, until: "soon" })).rejects.toThrow(/400/);
    await expect(run("inbox.snooze", { key: "f999999", until: "tomorrow" })).rejects.toThrow(/404/);
  });

  it("a former follow-up's own snooze date gives way to the Inbox's", async () => {
    const nine = [{ start: "09:00", end: "17:00" }];
    const model = { timeZone: ZONE, weekdays: { mon: nine, tue: nine, wed: nine, thu: nine, fri: nine, sat: [], sun: [] }, lunch: null, overrides: [] } as unknown as TimeModel;
    const { plan, run } = await setup({ day: snoozeDayOf(model, new Set()) });
    const f = await plan.addFollowUp({ who: null, what: "Overdue one", due: "2026-11-01", clientKey: "contoso" });
    await plan.snoozeFollowUp(f.id, "2026-11-20");
    await run("inbox.snooze", { key: `f${f.id}`, until: null });
    expect((await plan.openFollowUps()).find((x) => x.id === f.id)?.snoozedUntil).toBeNull();
    expect((await run<InboxListData>("inbox.list")).items.find((i) => i.key === `f${f.id}`)?.views).toContain("needs_you");
  });
});

describe("IB-2: the Everything timeline", () => {
  it("last looked lives on the server: a second device reads what the first wrote, and it only moves forward", async () => {
    const { w, run } = await setup();
    // Two devices are two reads of the same store; nothing is kept in a browser.
    const deviceA = () => run<InboxListData>("inbox.list");
    const deviceB = () => run<InboxListData>("inbox.list");
    expect((await deviceA()).lastLooked).toBeNull();
    const first = (await deviceA()).now!;
    expect(first).toBe(w.now());
    await run("inbox.looked", { at: first });
    expect((await deviceB()).lastLooked).toBe(first);
    // An older device can't move it back.
    expect(await run("inbox.looked", { at: "2020-01-01T00:00:00Z" })).toEqual({ lastLooked: first });
    expect((await deviceB()).lastLooked).toBe(first);
    await expect(run("inbox.looked", { at: "2099-01-01T00:00:00Z" })).rejects.toThrow(/future/);
    await expect(run("inbox.looked", { at: "nope" })).rejects.toThrow(/takes/);
    await expect(run("inbox.looked", {})).rejects.toThrow(/takes/);
  });

  it("each person has their own marker", async () => {
    const { w, plan, run } = await setup();
    await run("inbox.looked", { at: w.now() });
    const other = planStoreOn(w.conn, { now: () => Temporal.Instant.from(w.now()).toZonedDateTimeISO(ZONE), userId: LENA.userId! });
    expect(await plan.getState("inbox_last_looked")).toBe(w.now());
    expect(await other.getState("inbox_last_looked")).toBeNull();
  });

  it("a promise's activity is its last change, not when it was opened", async () => {
    const { plan, run } = await setup();
    const a = await plan.addFollowUp({ who: "Lena", what: "Send the mapping notes", due: null, clientKey: "contoso" });
    const before = (await run<InboxListData>("inbox.list")).items.find((i) => i.key === `f${a.id}`)!.at;
    expect((await plan.openFollowUps()).find((f) => f.id === a.id)?.changedAt ?? null).toBeNull();
    await plan.snoozeFollowUp(a.id, "2026-12-01");
    await plan.snoozeFollowUp(a.id, null);
    const f = (await plan.openFollowUps()).find((x) => x.id === a.id)!;
    expect(f.changedAt).toBeTruthy();
    expect(before).toBe(f.openedAt);
    expect((await run<InboxListData>("inbox.list")).items.find((i) => i.key === `f${a.id}`)!.at).toBe(f.changedAt);
  });

  it("a closed promise stays in Done for the Closed shown days rule (14 by default), not just a day", async () => {
    const { w, plan, run } = await setup();
    const a = await plan.addFollowUp({ who: null, what: "Told them", due: null, clientKey: "contoso" });
    await plan.closeFollowUp(a.id, null);
    const closed = Date.parse(w.now());
    const at = (days: number) => new Date(closed + days * 86_400_000).toISOString();
    w.setNow(at(3));
    expect((await run<InboxListData>("inbox.list")).items.find((i) => i.key === `f${a.id}`)?.views).toEqual(["done"]);
    w.setNow(at(15));
    expect((await run<InboxListData>("inbox.list")).items.some((i) => i.key === `f${a.id}`)).toBe(false);
  });
});
