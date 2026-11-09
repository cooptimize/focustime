// Part 0: one shared owner and state per conversation, the same for every Cooptimizer who can see it; what each person
// sees comes from that record. Fictional names (the repo's names rule).
import { describe, expect, it } from "vitest";
import { backfillOwnership } from "./ownership-backfill.ts";
import type { ConversationCard, ConversationsData, MyPromisesData } from "../plan/conversation-views.ts";
import { aChatMember } from "../test/builders/index.ts";
import { BLAKE, CHAT, allianceAnswer, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { OUTSIDER, people, type W } from "../test/conversation-people.ts";

async function opened(w: W) {
  const first = [await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Evan we see about a 7.7k lb gap for project 4417001.", { mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }] }), await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking into it with Lena now")];
  await w.run(CHAT, first);
  const [c] = await w.convs.conversations([CHAT.chatId]);
  return c!;
}
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
    const { p, c, view } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
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
    const { p, w, c, view } = await setup();
    await w.convs.updateConversation(c.id, { ownerId: LENA.userId! });
    const evan = await view(EVAN);
    expect(evan.shared).toMatchObject({ state: "open", owner: null, offer: "replied" });
    expect((await view(LENA)).shared.view).toBe("up_for_grabs");
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    expect((await view(LENA)).shared.history.map((h) => h.text)).toEqual(["Evan took it after replying"]);
    expect((await view(EVAN)).shared.offer).toBeNull();
  });
});

describe("actions, each with Undo", () => {
  it("claim, then Undo: Open again with nothing left in the history", async () => {
    const { p, c, view } = await setup();
    await p.as(LENA).run("conversations.claim", { id: c.id });
    expect((await view(LENA)).shared.canUndo).toBe(true);
    await p.as(LENA).run("conversations.undo_ownership", { id: c.id });
    expect((await view(LENA)).shared).toMatchObject({ state: "open", owner: null, history: [], canUndo: false });
  });

  it("Give to goes to a Cooptimizer on the chat, by its owner or a lead; Undo gives it back", async () => {
    const { p, c, view } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    expect((await p.as(LENA).fail("conversations.give", { id: c.id, toId: SAM.userId })).error).toContain("Evan has this");
    expect((await p.as(EVAN).fail("conversations.give", { id: c.id, toId: BLAKE.userId })).error).toContain("Choose someone");
    expect((await p.as(EVAN).fail("conversations.give", { id: c.id, toId: aChatMember({ displayName: "Not Here" }).userId })).error).toContain("Choose someone");
    await p.as(EVAN).run("conversations.give", { id: c.id, toId: LENA.userId });
    expect((await view(LENA)).shared).toMatchObject({ view: "yours", owner: { me: true } });
    expect((await view(LENA)).shared.history.at(-1)!.text).toBe("Evan gave it to you");
    await p.as(EVAN).run("conversations.undo_ownership", { id: c.id });
    expect((await view(EVAN)).shared).toMatchObject({ view: "yours", owner: { me: true } });
    // A lead may hand it on.
    await p.as(SAM).run("conversations.give", { id: c.id, toId: LENA.userId });
    expect((await view(SAM)).shared.owner?.name).toBe("Lena Hart");
  });

  it("Add helper puts it in the helper's own view; Undo takes them off", async () => {
    const { p, c, view } = await setup();
    await p.as(LENA).fail("conversations.add_helper", { id: c.id, toId: SAM.userId });
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    await p.as(EVAN).run("conversations.add_helper", { id: c.id, toId: LENA.userId });
    expect((await view(LENA)).shared).toMatchObject({ view: "yours", helpers: [{ name: "Lena Hart", me: true }] });
    await p.as(EVAN).run("conversations.undo_ownership", { id: c.id });
    expect((await view(LENA)).shared).toMatchObject({ view: "teammate", helpers: [] });
  });

  it("Release is the owner's or a lead's; Undo restores the owner", async () => {
    const { p, c, view } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    await p.as(LENA).fail("conversations.release", { id: c.id });
    await p.as(EVAN).run("conversations.release", { id: c.id });
    expect((await view(LENA)).shared).toMatchObject({ state: "open", owner: null });
    await p.as(EVAN).run("conversations.undo_ownership", { id: c.id });
    expect((await view(LENA)).shared.owner?.name).toBe("Evan Ford");
  });

  it("Close out and Undo; Reopen and Undo", async () => {
    const { p, c, view, w } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    await p.as(EVAN).run("conversations.close_out", { id: c.id });
    expect((await w.convs.conversation(c.id))).toMatchObject({ status: "resolved", closedBy: EVAN.userId });
    await p.as(EVAN).run("conversations.undo_ownership", { id: c.id });
    expect((await view(LENA)).shared).toMatchObject({ state: "owned" });
    expect((await w.convs.conversation(c.id))!.closedAt).toBeNull();
    await p.as(LENA).run("conversations.close_out", { id: c.id });
    await p.as(LENA).run("conversations.reopen", { id: c.id });
    expect((await view(LENA)).shared).toMatchObject({ state: "owned", owner: { name: "Evan Ford" } });
    await p.as(LENA).run("conversations.undo_ownership", { id: c.id });
    expect((await view(LENA)).shared.state).toBe("closed");
  });

  it("only my newest change can be undone, and only by me", async () => {
    const { p, c } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    await p.as(LENA).fail("conversations.undo_ownership", { id: c.id });
    await p.as(EVAN).run("conversations.give", { id: c.id, toId: LENA.userId });
    await p.as(LENA).run("conversations.close_out", { id: c.id });
    expect((await p.as(EVAN).fail("conversations.undo_ownership", { id: c.id })).error).toContain("changed since");
  });
});

describe("two claims at once", () => {
  it("the first wins; the second is told who has it", async () => {
    const { p, c, w } = await setup();
    const results = await Promise.allSettled([p.as(EVAN).run("conversations.claim", { id: c.id }), p.as(LENA).run("conversations.claim", { id: c.id })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const winner = (await w.convs.conversation(c.id))!;
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason)).toContain(`${winner.claimedName!.split(" ")[0]} has this`);
    expect(await w.convs.ownershipEventsIn([c.id])).toHaveLength(1);
  });
  it("a claim on one somebody has says who", async () => {
    const { p, c } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    expect((await p.as(LENA).fail("conversations.claim", { id: c.id })).error).toBe("Evan has this");
  });
});

describe("closing", () => {
  it("takes it out of both people's active views, into Done for everyone", async () => {
    const { p, c } = await setup();
    await p.as(EVAN).run("conversations.close_out", { id: c.id });
    for (const who of [EVAN, LENA]) {
      const d = await p.as(who).run("conversations.list");
      expect([...d.needsYou, ...d.inProgress, ...d.teammates]).toEqual([]);
      expect(d.closed.map((x) => [x.id, x.shared.view])).toEqual([[c.id, "done"]]);
    }
  });

  it("a conversation can be Closed while a promise from it stays open, and the promise says so", async () => {
    const { p, c, w } = await setup();
    await w.convs.addCommitment({ conversationId: c.id, chatId: CHAT.chatId, clientKey: "contoso", whoId: EVAN.userId!, whoName: "Evan Ford", toId: null, toName: null, what: "Send the numbers", dueAt: null, dueDate: null, impliesItem: false, messageIds: [], reason: null });
    await p.as(LENA).run("conversations.close_out", { id: c.id });
    const m = await p.as(EVAN).run<MyPromisesData>("my_promises.list");
    expect(m.promises[0]).toMatchObject({ state: "open", conversationClosed: true });
  });
});

describe("new messages", () => {
  const later = "2026-11-04T22:00:00Z";
  it("asking again on a Closed one reopens it to its last owner", async () => {
    const { p, c, w, view } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    await p.as(EVAN).run("conversations.close_out", { id: c.id });
    w.setNow(later);
    await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T21:59:00Z", "Evan, one more thing on 4417001: the gap is back today")]);
    const s = (await view(EVAN)).shared;
    expect(s).toMatchObject({ state: "owned", view: "yours" });
    expect(s.history.at(-1)!.text).toBe("Reopened: Blake asked again");
    expect((await w.convs.conversation(c.id))!.changeNote).toBe("Reopened: Blake asked again");
  });

  it("whoever closed it can still write in the chat without reopening it", async () => {
    const { p, c, w } = await setup();
    await p.as(EVAN).run("conversations.close_out", { id: c.id });
    w.setNow(later);
    await w.run(CHAT, [await w.say(CHAT, EVAN, "2026-11-04T21:59:00Z", "For the record the 4417001 fix went out this morning")]);
    expect((await w.convs.conversation(c.id))!.closedAt).not.toBeNull();
  });

  it("a new message on an Owned one stays with its owner", async () => {
    const { p, c, w, view } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
    w.setNow(later);
    await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T21:59:00Z", "Any news on 4417001, Evan?")]);
    expect((await view(LENA)).shared).toMatchObject({ view: "teammate", owner: { name: "Evan Ford" } });
  });
});

describe("visibility", () => {
  it("a non-member sees nothing and can change nothing", async () => {
    const { p, c, view } = await setup();
    expect(cardIn(await p.as(OUTSIDER).run("conversations.list"), c.id)).toBeUndefined();
    for (const a of ["conversations.claim", "conversations.release", "conversations.close_out", "conversations.undo_ownership"] as const) expect((await p.as(OUTSIDER).fail(a, { id: c.id })).status).toBe(404);
    expect((await p.as(OUTSIDER).fail("conversations.give", { id: c.id, toId: LENA.userId })).status).toBe(404);
    expect((await view(LENA)).shared.owner).toBeNull();
  });
  it("the store's viewer reads no history for a chat I'm not in", async () => {
    const { p, c, w } = await setup();
    await p.as(EVAN).run("conversations.claim", { id: c.id });
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

