// Part 0: one shared owner and state per conversation, the same for every Cooptimizer who can see it; what each person
// sees comes from that record. Fictional names (the repo's names rule). RM-1: nothing claims, gives, adds a helper,
// releases or closes out by hand any more; those records stay and are still read, so this file plants them the way
// the removed actions wrote them, and tests what still runs: the views, the pipeline's reopen, Undo of an old change
// (the assistant's), visibility and the backfill.
import { describe, expect, it } from "vitest";
import { backfillOwnership } from "./ownership-backfill.ts";
import type { ConversationCard, ConversationsData, MyPromisesData } from "../plan/conversation-views.ts";
import { BLAKE, CHAT, allianceAnswer, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { OUTSIDER, people, type W } from "../test/conversation-people.ts";

async function opened(w: W) {
  const first = [await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Evan we see about a 7.7k lb gap for project 4417001.", { mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }] }), await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking into it with Lena now")];
  await w.run(CHAT, first);
  const [c] = await w.convs.conversations([CHAT.chatId]);
  return c!;
}
type Who = typeof EVAN;
const person = (who: Who) => ({ id: who.userId!, name: who.displayName! });
/** An owner as the removed conversations.claim wrote one: the record and its history row. */
async function claimed(w: W, id: number, who: Who, via: "replied" | "committed" | null = null) {
  const cur = (await w.convs.conversation(id))!;
  const before = { claimedBy: cur.claimedBy, claimedName: cur.claimedName, claimedAt: cur.claimedAt, helpers: cur.helpers, status: cur.status, closedBy: cur.closedBy, closedAt: cur.closedAt, closeReason: cur.closeReason };
  const at = w.now();
  await w.conn.run("UPDATE conversations SET claimed_by = ?, claimed_name = ?, claimed_at = ?, change_note = ?, version = version + 1, updated_at = ? WHERE id = ?", [who.userId!, who.displayName!, at, `${who.displayName!.split(" ")[0]} took it`, at, id]);
  await w.conn.run("INSERT INTO conversation_events (conversation_id, kind, by_user, by_name, to_user, to_name, via, note, before_json, at) VALUES (?, 'claim', ?, ?, ?, ?, ?, NULL, ?, ?)", [id, who.userId!, who.displayName!, who.userId!, who.displayName!, via, JSON.stringify(before), at]);
}
/** Closed out, as the removed conversations.close_out did (the store's close stays for Not work-related). */
const closedOut = (w: W, id: number, who: Who) => w.convs.applyOwnership(id, { kind: "close", by: person(who), status: "resolved", reason: null, changeNote: "Closed out" });
const cardIn = (d: ConversationsData, id: number): ConversationCard | undefined => [...d.needsYou, ...d.inProgress, ...d.teammates, ...d.closed].find((c) => c.id === id);
const setup = async () => {
  const w = world({ respond: allianceAnswer });
  const c = await opened(w);
  const p = await people(w, { leads: [SAM.userId!] });
  const view = async (who: typeof SAM) => cardIn(await p.as(who).run("conversations.list"), c.id)!;
  return { w, c, p, view };
};
/** The record as a teammate reads it: the same whoever looks. */
const record = (x: ConversationCard) => ({ state: x.shared.state, owner: x.shared.owner?.name ?? null, helpers: x.shared.helpers.map((h) => h.name), history: x.shared.history.map((h) => h.at) });

describe("one shared record", () => {
  it("is the same for two teammates, and each reads it from their own side", async () => {
    const { p, c, w, view } = await setup();
    await claimed(w, c.id, EVAN);
    const [evan, lena] = [await view(EVAN), await view(LENA)];
    expect(record(evan)).toEqual(record(lena));
    expect(evan.shared).toMatchObject({ state: "owned", view: "yours", owner: { name: "Evan Ford", me: true } });
    expect(lena.shared).toMatchObject({ state: "owned", view: "teammate", owner: { name: "Evan Ford", me: false } });
    const data = await p.as(LENA).run("conversations.list");
    expect(data.teammates.map((x) => x.id)).toEqual([c.id]);
    expect(data.needsYou).toEqual([]);
  });

  it("asked by name is Asked you; asked of the team is Up for grabs", async () => {
    const { view } = await setup();
    expect((await view(EVAN)).shared.view).toBe("asked_you");
    expect((await view(LENA)).shared.view).toBe("up_for_grabs");
  });

  it("the AI's guess at an owner, a reply or an I'll-do-it never claims; it offers one tap, and the history says so", async () => {
    const { w, c, view } = await setup();
    await w.convs.updateConversation(c.id, { ownerId: LENA.userId! });
    const evan = await view(EVAN);
    expect(evan.shared).toMatchObject({ state: "open", owner: null, offer: "replied" });
    expect((await view(LENA)).shared.view).toBe("up_for_grabs");
    await claimed(w, c.id, EVAN, evan.shared.offer as "replied");
    expect((await view(LENA)).shared.history.map((h) => h.text)).toEqual(["Evan took it after replying"]);
    expect((await view(EVAN)).shared.offer).toBeNull();
  });
});

describe("Undo of an old change (an assistant proposal confirmed before IB-4)", () => {
  it("only my newest change can be undone, and only by me; Undo puts the record back", async () => {
    const { p, c, w, view } = await setup();
    await claimed(w, c.id, EVAN);
    expect((await view(EVAN)).shared.canUndo).toBe(true);
    await p.as(LENA).fail("conversations.undo_ownership", { id: c.id });
    await p.as(EVAN).run("conversations.undo_ownership", { id: c.id });
    expect((await view(EVAN)).shared).toMatchObject({ state: "open", owner: null, history: [], canUndo: false });
    await claimed(w, c.id, EVAN);
    await closedOut(w, c.id, LENA);
    expect((await p.as(EVAN).fail("conversations.undo_ownership", { id: c.id })).error).toContain("changed since");
  });
});

describe("closing", () => {
  it("takes it out of both people's active views, into Done for everyone", async () => {
    const { p, c, w } = await setup();
    await closedOut(w, c.id, EVAN);
    for (const who of [EVAN, LENA]) {
      const d = await p.as(who).run("conversations.list");
      expect([...d.needsYou, ...d.inProgress, ...d.teammates]).toEqual([]);
      expect(d.closed.map((x) => [x.id, x.shared.view])).toEqual([[c.id, "done"]]);
    }
  });

  it("a conversation can be Closed while a promise from it stays open, and the promise says so", async () => {
    const { p, c, w } = await setup();
    await w.convs.addCommitment({ conversationId: c.id, chatId: CHAT.chatId, clientKey: "contoso", whoId: EVAN.userId!, whoName: "Evan Ford", toId: null, toName: null, what: "Send the numbers", dueAt: null, dueDate: null, impliesItem: false, messageIds: [], reason: null });
    await closedOut(w, c.id, LENA);
    const m = await p.as(EVAN).run<MyPromisesData>("my_promises.list");
    expect(m.promises[0]).toMatchObject({ state: "open", conversationClosed: true });
  });
});

describe("new messages", () => {
  const later = "2026-11-04T22:00:00Z";
  it("asking again on a Closed one reopens it to its last owner", async () => {
    const { c, w, view } = await setup();
    await claimed(w, c.id, EVAN);
    await closedOut(w, c.id, EVAN);
    w.setNow(later);
    await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T21:59:00Z", "Evan, one more thing on 4417001: the gap is back today")]);
    const s = (await view(EVAN)).shared;
    expect(s).toMatchObject({ state: "owned", view: "yours" });
    expect(s.history.at(-1)!.text).toBe("Reopened: Blake asked again");
    expect((await w.convs.conversation(c.id))!.changeNote).toBe("Reopened: Blake asked again");
  });

  it("whoever closed it can still write in the chat without reopening it", async () => {
    const { c, w } = await setup();
    await closedOut(w, c.id, EVAN);
    w.setNow(later);
    await w.run(CHAT, [await w.say(CHAT, EVAN, "2026-11-04T21:59:00Z", "For the record the 4417001 fix went out this morning")]);
    expect((await w.convs.conversation(c.id))!.closedAt).not.toBeNull();
  });

  it("a new message on an Owned one stays with its owner", async () => {
    const { c, w, view } = await setup();
    await claimed(w, c.id, EVAN);
    w.setNow(later);
    await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T21:59:00Z", "Any news on 4417001, Evan?")]);
    expect((await view(LENA)).shared).toMatchObject({ view: "teammate", owner: { name: "Evan Ford" } });
  });
});

describe("visibility", () => {
  it("a non-member sees nothing and can undo nothing", async () => {
    const { p, c, view } = await setup();
    expect(cardIn(await p.as(OUTSIDER).run("conversations.list"), c.id)).toBeUndefined();
    expect((await p.as(OUTSIDER).fail("conversations.undo_ownership", { id: c.id })).status).toBe(404);
    expect((await view(LENA)).shared.owner).toBeNull();
  });
  it("the store's viewer reads no history for a chat I'm not in", async () => {
    const { c, w } = await setup();
    await claimed(w, c.id, EVAN);
    expect(await w.convs.viewer(OUTSIDER.userId!).ownershipEventsIn([c.id])).toEqual([]);
    expect(await w.convs.viewer(EVAN.userId!).ownershipEventsIn([c.id])).toHaveLength(1);
  });
});

describe("the one-time backfill", () => {
  it("moves each to where it stood, and reports the counts", async () => {
    const w = world({});
    await people(w);
    const add = (title: string, o: Record<string, unknown> = {}) => w.convs.addConversation({ chatId: CHAT.chatId, clientKey: "contoso", title, summary: "", participants: [{ id: EVAN.userId!, name: "Evan Ford", external: false }, { id: LENA.userId!, name: "Lena Hart", external: false }, { id: BLAKE.userId!, name: "Blake Novak", external: true }], firstAt: "2026-11-04T19:00:00Z", lastAt: "2026-11-04T19:00:00Z", lastWorkAt: "2026-11-04T19:00:00Z", status: "discussion", ...o });
    const handled = await add("Handled by Evan", { ownerId: EVAN.userId });
    const committed = await add("Lena committed");
    await w.convs.addCommitment({ conversationId: committed.id, chatId: CHAT.chatId, clientKey: "contoso", whoId: LENA.userId!, whoName: "Lena Hart", toId: null, toName: null, what: "x", dueAt: null, dueDate: null, impliesItem: false, messageIds: [], reason: null });
    const done = await add("Done", { closed: { by: EVAN.userId, at: "2026-11-04T20:00:00Z", reason: null }, status: "resolved" });
    const tracked = await add("In progress", { item: { id: 4101, url: null, title: null }, ownerId: EVAN.userId });
    const fresh = await add("New", { status: "new" });
    const nobody = await add("No teammate");
    const client = await add("Owner is outside", { ownerId: BLAKE.userId });
    const counts = await backfillOwnership({ convs: w.convs, teams: w.teams, homeTenant: null });
    expect(counts).toEqual({ owned: 2, closed: 1, open_in_progress: 1, open_needs_you: 1, open_no_teammate: 2, already_claimed: 0 });
    const by = async (id: number) => (await w.convs.conversation(id))!.claimedBy;
    expect(await by(handled.id)).toBe(EVAN.userId);
    expect(await by(committed.id)).toBe(LENA.userId);
    for (const x of [done, tracked, fresh, nobody, client]) expect(await by(x.id)).toBeNull();
    // Run twice, nothing moves again; a claim made meanwhile stands.
    expect((await backfillOwnership({ convs: w.convs, teams: w.teams, homeTenant: null })).owned).toBe(0);
    const events = await w.convs.ownershipEventsIn([handled.id]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ via: "backfill", byUser: null, toUser: EVAN.userId });
  });

  it("one that still asks another Cooptimizer by name stays Open for them", async () => {
    const w = world({ respond: allianceAnswer });
    await people(w);
    await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Lena can you check project 4417001?", { mentions: [{ id: LENA.userId!, name: "Lena Hart", at: 0 }] }), await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking at it")]);
    const [c] = await w.convs.conversations([CHAT.chatId]);
    await w.convs.updateConversation(c!.id, { status: "discussion", ownerId: EVAN.userId! });
    expect((await backfillOwnership({ convs: w.convs, teams: w.teams, homeTenant: null })).open_needs_you).toBe(1);
    expect((await w.convs.conversation(c!.id))!.claimedBy).toBeNull();
  });
});

