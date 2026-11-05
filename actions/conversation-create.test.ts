// CV-5: Create DevOps item and Link to item on any conversation or promise. Create is offered where it wasn't before
// (In discussion, no write access), Link searches only the client's items in scope, Unlink is the link's undo (never a
// create's), a link moves a conversation to In progress, a closed item shows Mark done and nothing closes by itself,
// a linked promise stays actionable, the one-time move of "Kept by" promises, and the AI-off draft is empty with no AI
// call. The write path itself (preview, confirm, read back, audit, undo, GD-1) is in actions/devops-write.test.ts.
// Fictional names (the repo's names rule).
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import type { MyPromisesData } from "../plan/conversation-views.ts";
import { anAiApp, anAiRules, aWorkItem } from "../test/builders/index.ts";
import { allianceAnswer, BLAKE, CHAT, EVAN, SAM, world } from "../test/conversations.ts";
import { people, type W } from "../test/conversation-people.ts";
import type { WorkItem } from "../week/types.ts";

const DASHBOARD = aWorkItem({ id: 4101, title: "Movement dashboard refresh", state: "Active", stateCategory: "InProgress", assignedTo: "Evan Ford" });
const FEATURE = aWorkItem({ id: 4102, title: "BOM bridging", tier: "feature", level: "portfolio" });

/** Blake asks, Evan answers: In discussion, no commitment (Create used to be under ⋯ only, or nowhere without access). */
async function discussion(w: W) {
  const batch = [
    await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Evan we see about a 7.7k lb gap for project 4417001.", { mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }] }),
    await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking into it with Lena now"),
  ];
  await w.run(CHAT, batch);
  return (await w.convs.conversations([CHAT.chatId]))[0]!;
}

/** The store as linkedItems reads it: these items, in their states. */
const store = (items: WorkItem[]) => async (_cfg: unknown, _k: string, ids: readonly number[]) => items.filter((i) => ids.includes(i.id));

describe("Create DevOps item is offered", () => {
  it("on a conversation In discussion, as its primary, with or without my write access", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await discussion(w);
    expect(c.status).toBe("discussion");
    const withPat = (await (await people(w)).as(EVAN).run("conversations.list")).needsYou[0]!;
    expect(withPat).toMatchObject({ primary: "create", canCreate: true });
    const without = (await (await people(w, { more: { writeClients: async () => [] } })).as(EVAN).run("conversations.list")).needsYou[0]!;
    expect(without).toMatchObject({ primary: "create", canCreate: false });
  });

  it("on a promise that implies no item: it has no item, so its card leads with Create (the UI's rule), and it isn't asked to wait", async () => {
    const w = world({ allowed: [] });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll sort out the date formats this week")]);
    const p = (await (await people(w)).as(SAM).run<MyPromisesData>("my_promises.list")).promises[0]!;
    expect(p).toMatchObject({ state: "open", item: null, needsItem: false, waitingDays: null });
  });

  it("a work-like promise ('add X to the backlog and take it on') implies an item, by the rule, also when the AI paraphrased it", async () => {
    const w = world({ allowed: [] });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll add the report cleanup to the backlog and take it on")]);
    expect((await w.convs.commitmentsInChat(CHAT.chatId))[0]).toMatchObject({ impliesItem: true });
  });
});

describe("the draft without AI", () => {
  it("AI off for FocusTime, or the client's Allow AI off: an empty form, no AI request, nothing kept", async () => {
    for (const rules of [anAiRules({ on: false, allowedClients: ["contoso"] }), anAiRules({ on: true, allowedClients: [] })]) {
      const w = world({ respond: allianceAnswer });
      const c = await discussion(w);
      const calls: ProviderCall[] = [];
      const ai = createAi({ provider: async () => stubProvider({ respond: (x) => (calls.push(x), "{}") }), app: anAiApp({ provider: "openai", appCapUsd: 100 }), rules: async () => rules, guard: async () => ({ directory: [], homeDomains: ["contoso.example"], forbidden: [] }), log: w.convs.appAiLog, appSpend: { get: async () => 0, add: async () => {} }, now: w.now });
      const d = await (await people(w, { ai })).as(EVAN).run<{ draft: { title: string; asked: string; acceptance: string[]; byAi: boolean }; notSorted: string | null; canCreate: boolean }>("conversations.draft", { id: c.id });
      expect(d.draft).toMatchObject({ title: "", asked: "", acceptance: [], byAi: false });
      expect(d.notSorted).toBeTruthy();
      expect(calls).toEqual([]);
    }
  });

  it("parents are the client's open features and epics in scope", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await discussion(w);
    const epic = aWorkItem({ id: 4103, title: "Supply analytics", tier: "epic", level: "portfolio" });
    const d = await (await people(w, { more: { searchItems: async () => [DASHBOARD, FEATURE, epic] } })).as(EVAN).run<{ features: { id: number }[] }>("conversations.draft", { id: c.id });
    expect(d.features.map((f) => f.id)).toEqual([4102, 4103]);
  });
});

describe("Link to item", () => {
  it("only items of that client in scope; In progress with the item's live state; Unlink puts it back", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await discussion(w);
    const searched: string[] = [];
    const p = await people(w, { more: { searchItems: async (_cfg, k, q) => (searched.push(`${k}:${q}`), [DASHBOARD, FEATURE]), linkedItems: store([DASHBOARD]) } });
    const evan = p.as(EVAN);
    const hits = await evan.run<{ items: { id: number }[] }>("conversations.search_items", { id: c.id, query: "dashboard" });
    expect(hits.items.map((i) => i.id)).toEqual([4101]);
    expect(searched.every((s) => s.startsWith("contoso:"))).toBe(true);
    expect((await evan.fail("conversations.link", { id: c.id, itemId: 9999 })).error).toBe("That isn't one of this client's open items in scope");
    const after = await evan.run("conversations.link", { id: c.id, itemId: 4101 });
    expect(after.needsYou).toEqual([]);
    expect(after.inProgress[0]).toMatchObject({ id: c.id, status: "tracked", item: { id: 4101, state: "Active", assignee: "Evan Ford", closed: false }, primary: "resolve" });
    // Shared: a teammate sees it In progress too. Linking writes nothing to DevOps (no writer here at all).
    expect((await p.as(SAM).run("conversations.list")).inProgress.map((x) => x.id)).toEqual([c.id]);
    const back = await evan.run("conversations.unlink", { id: c.id });
    expect(back.inProgress).toEqual([]);
    expect(back.needsYou[0]).toMatchObject({ id: c.id, item: null, primary: "create" });
  });

  it("Unlink never undoes a create (that's the audit log's Undo)", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await discussion(w);
    const p = await people(w);
    const evan = p.as(EVAN);
    await w.convs.updateConversation(c.id, { item: { id: 4101, url: null, title: "Made here" } });
    const e = await evan.ctx.plan!.logDevopsWrite({ clientKey: "contoso", org: "contoso", project: "p", op: "create", itemId: null, parentId: null, title: "Made here", identity: "evan@contoso.example", before: {}, after: {}, ops: [], revBefore: null, revAfter: null, commentId: null, draftId: null, followUpId: null, undoOf: null, ask: null, conv: { conversationId: c.id, commitmentId: null, suggestionId: null } });
    await evan.ctx.plan!.settleDevopsWrite(e.id, { status: "confirmed", itemId: 4101 });
    expect(await evan.fail("conversations.unlink", { id: c.id })).toMatchObject({ status: 409, code: "created" });
  });

  it("the item closing in DevOps shows Item closed with Mark done; nothing is closed automatically", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await discussion(w);
    let state = DASHBOARD;
    const p = await people(w, { more: { searchItems: async () => [DASHBOARD], linkedItems: async () => [state] } });
    await p.as(EVAN).run("conversations.link", { id: c.id, itemId: 4101 });
    state = { ...DASHBOARD, state: "Closed", stateCategory: "Completed" };
    const card = (await p.as(EVAN).run("conversations.list")).inProgress[0]!;
    expect(card).toMatchObject({ item: { id: 4101, closed: true, state: "Closed" }, primary: "mark_done", closed: null });
    expect((await w.convs.conversation(c.id))!.closedAt).toBeNull();
    // Mark done is Resolve.
    const done = await p.as(EVAN).run("conversations.resolve", { id: c.id });
    expect(done.closed.map((x) => x.id)).toEqual([c.id]);
  });
});

describe("a promise with an item stays actionable", () => {
  async function promise(w: W) {
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll sort out the date formats this week")]);
    return (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
  }

  it("linked: still open, with due, Today, a follow-up and done; Unlink is its undo; the item closing never closes it", async () => {
    const w = world({ allowed: [] });
    const k = await promise(w);
    let state = DASHBOARD;
    const sam = (await people(w, { more: { searchItems: async () => [DASHBOARD], linkedItems: async () => [state] } })).as(SAM);
    const linked = await sam.run<MyPromisesData>("my_promises.link", { id: k.id, itemId: 4101 });
    expect(linked.promises[0]).toMatchObject({ state: "open", item: { id: 4101, state: "Active", closed: false } });
    expect(linked.open).toBe(1);
    expect((await sam.run<MyPromisesData>("my_promises.today", { id: k.id, on: true })).promises[0]!.onToday).toBeTruthy();
    state = { ...DASHBOARD, stateCategory: "Completed", state: "Closed" };
    expect((await sam.run<MyPromisesData>("my_promises.list")).promises[0]).toMatchObject({ state: "open", item: { closed: true } });
    const back = await sam.run<MyPromisesData>("my_promises.unlink", { id: k.id });
    expect(back.promises[0]).toMatchObject({ state: "open", item: null });
    await sam.run("my_promises.link", { id: k.id, itemId: 4101 });
    const f = await sam.run<MyPromisesData>("my_promises.followup", { id: k.id });
    expect(f.promises[0]!.state).toBe("followup");
  });

  it("the one-time move: Kept by an open item becomes open with it; a closed item's stays kept; once only", async () => {
    const w = world({ allowed: [] });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll sort out the date formats this week")]);
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:50:00Z", "Separately, I'll send the totals tonight")]);
    const [a, b] = await w.convs.commitmentsInChat(CHAT.chatId);
    await w.convs.updateCommitment(a!.id, { state: "linked", itemId: 4101, itemUrl: null, itemTitle: "Movement dashboard refresh" });
    await w.convs.updateCommitment(b!.id, { state: "created", itemId: 4102, itemUrl: null, itemTitle: "BOM bridging" });
    let reads = 0;
    const items = [DASHBOARD, { ...FEATURE, stateCategory: "Completed", state: "Closed" }];
    const sam = (await people(w, { more: { linkedItems: async (_c, _k, ids) => (reads++, items.filter((i) => ids.includes(i.id))) } })).as(SAM);
    await sam.run("my_promises.list");
    expect((await w.convs.commitment(a!.id))!.state).toBe("open");
    expect((await w.convs.commitment(b!.id))!.state).toBe("created");
    // Once: a later list doesn't move anything again.
    await w.convs.updateCommitment(a!.id, { state: "linked" });
    const before = reads;
    await sam.run("my_promises.list");
    expect((await w.convs.commitment(a!.id))!.state).toBe("linked");
    expect(reads - before).toBe(1); // the cards' live state only, not the move
  });

  it("the move waits when DevOps can't say, and changes nothing", async () => {
    const w = world({ allowed: [] });
    const k = await promise(w);
    await w.convs.updateCommitment(k.id, { state: "linked", itemId: 4101, itemUrl: null, itemTitle: null });
    const sam = (await people(w, { more: { linkedItems: async () => null } })).as(SAM);
    await sam.run("my_promises.list");
    expect((await w.convs.commitment(k.id))!.state).toBe("linked");
    expect(await sam.ctx.plan!.accountState("cv5_kept_reopened")).toBeNull();
  });
});
