// DX-1: Settings › Data › Diagnostics on the shared world. Each promise reason code and each chatter outcome counts
// what the fixtures hold; only my chats appear (not a chat I'm not in, not a client I don't follow); the response and
// the copy text carry no message text; the copy text has no titles. Names and messages are fictional.
import { describe, expect, it } from "vitest";
import { aChatMember, aClientChat } from "../test/builders/index.ts";
import { people } from "../test/conversation-people.ts";
import { CHAT, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { diagnosticsText, IS_WORK_PLACE, type Diagnostics } from "../plan/diagnostics.ts";
import { itemKey } from "../plan/inbox-items.ts";
import { diagnosticsAction } from "./diagnostics.ts";

/** Another FocusTime user with my first name, and a guest copy of me (my name under another id). */
const EVAN_TWO = aChatMember({ displayName: "Evan Stone" });
const GUEST_ME = aChatMember({ displayName: "Evan Ford" });
/** A chat of a followed client I'm not in, and a chat I'm in of a client I don't follow. */
const NOT_MINE = aClientChat({ chatId: "19:contoso-other@thread.v2", clientKey: "contoso", displayName: "Contoso Other Team", members: [LENA, SAM] });
const UNFOLLOWED = aClientChat({ chatId: "19:fabrikam-ops@thread.v2", clientKey: "fabrikam", displayName: "Fabrikam Ops", members: [EVAN, LENA] });

const T = (min: number) => new Date(Date.parse("2026-11-04T15:00:00Z") + min * 60_000).toISOString();

async function setup() {
  const w = world();
  const texts: string[] = [];
  const say = async (chat: typeof CHAT, who: typeof EVAN, min: number, text: string) => {
    texts.push(text);
    return w.say(chat, who, T(min), text);
  };
  const conv = async (title: string, at: number, chat = CHAT) =>
    w.convs.addConversation({ chatId: chat.chatId, clientKey: chat.clientKey, title, summary: "s", participants: [], firstAt: T(at), lastAt: T(at), lastWorkAt: T(at) });
  const commit = async (c: { id: number }, who: { id: string | null; name: string }, mid: string, chat = CHAT) =>
    w.convs.addCommitment({ conversationId: c.id, chatId: chat.chatId, clientKey: chat.clientKey, whoId: who.id, whoName: who.name, toId: null, toName: null, what: "Something", dueAt: null, dueDate: null, impliesItem: false, messageIds: [mid], reason: null });
  const committed = (c: { id: number }) => w.convs.updateConversation(c.id, { status: "committed" });
  const work = (c: { id: number }, m: { messageId: string; createdAt: string }, chat = CHAT) => w.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: m.createdAt }]);

  // Promises: one committed conversation per reason.
  const reasons: Record<string, { id: number }> = {};
  const shown = await conv("Shown promise", 0);
  const m0 = await say(CHAT, EVAN, 0, "I will update the export today");
  await work(shown, m0);
  await commit(shown, { id: EVAN.userId!, name: "Evan Ford" }, m0.messageId);
  reasons.shown = shown;
  const theirs = await conv("Lena's promise", 1);
  const m1 = await say(CHAT, LENA, 1, "I will look at the totals");
  await work(theirs, m1);
  await commit(theirs, { id: LENA.userId!, name: "Lena Hart" }, m1.messageId);
  const stale = await conv("Stale status", 2);
  const guest = await conv("Guest copy", 3);
  const m3 = await say(CHAT, GUEST_ME, 3, "I will send the file");
  await work(guest, m3);
  await commit(guest, { id: GUEST_ME.userId!, name: "Evan Ford" }, m3.messageId);
  const noId = await conv("No person id", 4);
  await commit(noId, { id: null, name: "Evan Ford" }, "none-1");
  const twin = await conv("Same first name", 5);
  await commit(twin, { id: EVAN_TWO.userId!, name: "Evan Stone" }, "none-2");
  const filtered = await conv("Snoozed promise", 6);
  const m6 = await say(CHAT, EVAN, 6, "I will draft the notes");
  await work(filtered, m6);
  const k6 = await commit(filtered, { id: EVAN.userId!, name: "Evan Ford" }, m6.messageId);
  for (const c of [shown, theirs, stale, guest, noId, twin, filtered]) await committed(c);
  const open = await conv("Just a question", 7);
  const m7 = await say(CHAT, LENA, 7, "Where is the report?");
  await work(open, m7);

  // Chatter: one message per outcome (rules, AI, Social chat, Not work-related by me, unsorted, This is work by me, not placed).
  const place = async (m: { messageId: string; createdAt: string }, role: "work" | "chatter" | "ack" | "unsorted", reason: string | null, placedBy: "ai" | "rule" | "person", conversationId: number | null = null) =>
    w.convs.place([{ chatId: CHAT.chatId, messageId: m.messageId, conversationId, role, reason, placedBy, at: m.createdAt }]);
  await place(await say(CHAT, LENA, 10, "(gif)"), "chatter", "gif", "rule");
  await place(await say(CHAT, LENA, 11, "Happy Friday everyone"), "chatter", "ai", "ai");
  await place(await say(CHAT, LENA, 12, "Lunch at noon?"), "chatter", "social", "rule");
  const nw = await say(CHAT, LENA, 13, "Anyone watching the game");
  await w.convs.viewer(EVAN.userId!).place([{ chatId: CHAT.chatId, messageId: nw.messageId, conversationId: null, role: "chatter", reason: `not_work:${open.id}`, placedBy: "person", at: nw.createdAt }]);
  const iw = await say(CHAT, LENA, 14, "Can someone fix the filter");
  await w.convs.viewer(EVAN.userId!).place([{ chatId: CHAT.chatId, messageId: iw.messageId, conversationId: open.id, role: "work", reason: IS_WORK_PLACE, placedBy: "person", at: iw.createdAt }]);
  // My own promise-sounding messages: one waiting (the service was busy: Retry helps), one read as an ack.
  await place(await say(CHAT, EVAN, 15, "I'll send the numbers tonight"), "unsorted", "rate_limited", "rule");
  await place(await say(CHAT, EVAN, 16, "I will, thanks"), "chatter", "ack", "rule");
  await say(CHAT, LENA, 17, "Not sorted yet");

  // Other chats: never in my diagnostics.
  const elsewhere = await conv("Not my chat", 20, NOT_MINE);
  await w.convs.updateConversation(elsewhere.id, { status: "committed" });
  await say(NOT_MINE, LENA, 20, "I will do the other thing");
  await say(UNFOLLOWED, EVAN, 21, "I will do the unfollowed thing");
  await w.convs.addConversation({ chatId: UNFOLLOWED.chatId, clientKey: "fabrikam", title: "Unfollowed client", summary: "s", participants: [], firstAt: T(21), lastAt: T(21), lastWorkAt: T(21) });

  const p = await people(w, { more: { users: async () => [...w.users, { id: EVAN_TWO.userId!, name: "Evan Stone", deleted: false }] } });
  const me = p.as(EVAN);
  // My promise in "Snoozed promise" is snoozed in the Inbox, so Promises and Needs you leave it out.
  await me.ctx.plan!.markInbox([itemKey("chatPromise", k6.id)], { snoozedUntil: "2026-11-20T00:00:00Z" });
  const run = async () => {
    const r = await diagnosticsAction(me.ctx, "diagnostics.check", {});
    if (!r.ok) throw new Error(r.error);
    return r.data as Diagnostics;
  };
  return { w, p, run, texts, reasons };
}

describe("DX-1 Diagnostics", () => {
  it("counts committed conversations by reason, lists only the gaps, and sees only my chats", async () => {
    const { run } = await setup();
    const d = await run();
    expect(d.promises.byStatus).toMatchObject({ committed: 7, new: 1 });
    expect(d.promises.committed).toBe(7);
    expect(d.promises.byReason).toEqual({ shown: 1, someone_else: 1, no_open_commitment: 1, who_unknown: 1, my_name_other_id: 1, same_first_name_other_user: 1, filtered: 1 });
    expect(d.promises.rows.map((r) => [r.title, r.reason]).sort()).toEqual([
      ["Guest copy", "my_name_other_id"], ["No person id", "who_unknown"], ["Same first name", "same_first_name_other_user"], ["Snoozed promise", "filtered"], ["Stale status", "no_open_commitment"],
    ]);
    expect(d.promises.rows.every((r) => r.clientName === "Contoso Supply")).toBe(true);
    // Only the chat I'm in, of a client I follow.
    expect(d.chats.map((c) => c.chatName)).toEqual(["Contoso Analytics Alliance"]);
    const all = JSON.stringify(d);
    for (const x of ["Not my chat", "Contoso Other Team", "Unfollowed client", "Fabrikam Ops"]) expect(all).not.toContain(x);
  });

  it("explains my promise-sounding messages with no promise, and offers Retry only for a transient reason", async () => {
    const { run } = await setup();
    const d = await run();
    // Three in the conversation fixtures plus the two loose ones; the shown and snoozed ones have my commitment.
    expect(d.promises.extraction.checked).toBe(4);
    expect(d.promises.extraction.byReason).toEqual({ "unsorted:rate_limited": 1, ack: 1 });
    expect(d.promises.extraction.rows.map((r) => [r.reason, r.retry])).toEqual([["unsorted:rate_limited", true], ["ack", false]]);
  });

  it("counts each chatter outcome and my own marks for the last 14 days", async () => {
    const { run } = await setup();
    const [c] = (await run()).chats;
    expect(c).toBeDefined();
    expect(c!.total).toBe(13);
    expect(c!.outcomes).toEqual({
      sorted: { ai: 5, rules: 0, person: 1 },
      workNoConversation: 0,
      chatter: { rule: 2, ai: 1, social: 1, notWork: 1, other: 0 },
      unsorted: { rate_limited: 1 },
      notPlaced: 1,
    });
    expect(c!.marks).toEqual({ thisIsWork: 1, movedByMe: 0, notWorkMessages: 1, notWorkConversations: 1 });
  });

  it("never returns or copies message text; the copy text has counts and no titles", async () => {
    const { run, texts } = await setup();
    const d = await run();
    const all = JSON.stringify(d);
    for (const t of texts) expect(all, t).not.toContain(t);
    const copy = diagnosticsText(d);
    for (const t of texts) expect(copy).not.toContain(t);
    for (const title of ["Guest copy", "Snoozed promise", "Contoso Analytics Alliance", "Contoso Supply", "contoso"]) expect(copy).not.toContain(title);
    expect(copy).toContain("my_name_other_id 1");
    expect(copy).toContain("Chat 1 (customer)");
  });

  it("is only for the signed-in person: Lena sees her own diagnostics, never mine", async () => {
    const { p } = await setup();
    const r = await diagnosticsAction(p.as(LENA).ctx, "diagnostics.check", {});
    expect(r.ok).toBe(true);
    const d = (r as { data: Diagnostics }).data;
    // Lena's own promise is shown; the others are someone else's (or stale), and nothing names Evan's gaps as hers.
    expect(d.promises.byReason.shown).toBe(1);
    expect(d.promises.rows.map((x) => x.title)).not.toContain("Guest copy");
    expect(d.chats.map((c) => c.chatName).sort()).toEqual(["Contoso Analytics Alliance", "Contoso Other Team"]);
    expect(await diagnosticsAction(p.as(LENA).ctx, "diagnostics.check", { userId: EVAN.userId })).toMatchObject({ ok: false, status: 400 });
  });
});
