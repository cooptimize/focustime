// IB-4: the slim Inbox's actions on a real store. From chats offers a conversation the sorting step judged to need an
// item only once it has been quiet 4 working hours (never sooner, never after 7 days), only to a member of its chat;
// Dismiss is mine alone and Undo puts it back; linking an item ends it. A chat promise I never touched expires 7 days
// after its due day, lands under Cleared on their own, and Put back brings it back for good. Fictional names.
import { describe, expect, it } from "vitest";
import type { MyPromisesData, SuggestionsData } from "../plan/conversation-views.ts";
import { aCommitmentAnswer, aConversationUpdate } from "../test/builders/index.ts";
import { BLAKE, CHAT, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { OUTSIDER, people, type W } from "../test/conversation-people.ts";
import type { ProviderCall } from "../ai/types.ts";

/** Blake asks for a change; the sorting step says it needs an item (the judgment rides in the same request). */
function asksForWork(c: ProviderCall): string {
  const input = JSON.parse(c.input) as { people: { ref: string; name: string }[]; open_conversations: { ref: string }[]; messages: { ref: string; from: string; text: string }[] };
  const conv = input.open_conversations[0]?.ref ?? "n1";
  const promise = input.messages.find((m) => /I'll send/.test(m.text));
  return JSON.stringify({
    messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: conv, confident_new_topic: false })),
    conversations: [
      aConversationUpdate({
        ref: conv,
        title: "Delivery fee in the order export",
        summary: "Blake asks for the delivery fee as its own column in the order export.",
        item_needed: { why: "Asks for a change to the export no item covers", title: "Show the delivery fee as its own column", level: "child" },
        commitments: promise ? [aCommitmentAnswer({ who: promise.from, what: "Send Blake the sample export", messages: [promise.ref] })] : [],
      }),
    ],
  });
}

async function ask(w: W) {
  await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Could the order export show the delivery fee as its own column?")]);
  return (await w.convs.conversations([CHAT.chatId]))[0]!;
}

const titles = (d: SuggestionsData) => d.suggestions.map((s) => s.title);

describe("From chats", () => {
  it("waits until the conversation has been quiet 4 working hours, and stops after 7 days", async () => {
    const w = world({ respond: asksForWork });
    const c = await ask(w);
    expect(c.itemNeeded).toMatchObject({ level: "child" });
    const evan = (await people(w)).as(EVAN);
    // Two hours later (Wed 3 PM in Chicago): not yet.
    expect(titles(await evan.run<SuggestionsData>("conversations.suggestions"))).toEqual([]);
    // Thursday afternoon: four working hours have passed.
    w.setNow("2026-11-05T21:00:00Z");
    const d = await evan.run<SuggestionsData>("conversations.suggestions");
    expect(titles(d)).toEqual(["Show the delivery fee as its own column"]);
    expect(d.suggestions[0]).toMatchObject({ clientKey: "contoso", why: expect.stringMatching(/export/), canCreate: true });
    // More than 7 days after its last work message: gone.
    w.setNow("2026-11-12T21:00:00Z");
    expect(titles(await evan.run<SuggestionsData>("conversations.suggestions"))).toEqual([]);
  });

  it("only members of the chat see it; Dismiss is mine alone and Undo brings it back", async () => {
    const w = world({ respond: asksForWork });
    const c = await ask(w);
    w.setNow("2026-11-05T21:00:00Z");
    const p = await people(w);
    expect(titles(await p.as(OUTSIDER).run<SuggestionsData>("conversations.suggestions"))).toEqual([]);
    const after = await p.as(EVAN).run<SuggestionsData>("conversations.dismiss", { id: c.id });
    expect(titles(after)).toEqual([]);
    // Lena still has it: a dismissal is personal.
    expect(titles(await p.as(LENA).run<SuggestionsData>("conversations.suggestions"))).toHaveLength(1);
    expect(titles(await p.as(EVAN).run<SuggestionsData>("conversations.undismiss", { id: c.id }))).toHaveLength(1);
    // An id outside my chats is refused, never marked.
    const r = await p.as(OUTSIDER).fail("conversations.dismiss", { id: c.id });
    expect(r.ok).toBe(false);
  });

  it("linking an item ends the suggestion for everyone", async () => {
    const w = world({ respond: asksForWork });
    const c = await ask(w);
    w.setNow("2026-11-05T21:00:00Z");
    const p = await people(w);
    await p.as(EVAN).run("conversations.link", { id: c.id, itemId: 4101 });
    expect(titles(await p.as(EVAN).run<SuggestionsData>("conversations.suggestions"))).toEqual([]);
    expect(titles(await p.as(LENA).run<SuggestionsData>("conversations.suggestions"))).toEqual([]);
  });

  it("with AI off nothing is judged, and nothing is suggested", async () => {
    const w = world({ respond: asksForWork, use: false });
    await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Could the order export show the delivery fee as its own column?")]);
    w.setNow("2026-11-05T21:00:00Z");
    expect(w.calls).toEqual([]);
    expect(titles(await (await people(w)).as(EVAN).run<SuggestionsData>("conversations.suggestions"))).toEqual([]);
  });
});

describe("promises that clear themselves", () => {
  it("an untouched chat promise expires 7 days on, shows under Cleared on their own, and Put back keeps it", async () => {
    const w = world({ respond: asksForWork });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T20:30:00Z", "I'll send Blake the sample export")]);
    const sam = (await people(w)).as(SAM);
    const open = await sam.run<MyPromisesData>("my_promises.list");
    expect(open.promises.map((x) => x.what)).toEqual(["Send Blake the sample export"]);
    // Eight days on: cleared as expired, never done.
    w.setNow("2026-11-12T21:00:00Z");
    const later = await sam.run<MyPromisesData>("my_promises.list");
    expect(later.promises.filter((x) => x.state === "open")).toEqual([]);
    expect(later.cleared).toEqual([expect.objectContaining({ what: "Send Blake the sample export", how: "expired" })]);
    const k = later.cleared![0]!;
    expect((await w.convs.commitmentsInChat(CHAT.chatId)).find((x) => x.id === k.id)?.state).toBe("not_needed");
    // Put back: open again, and reading the list again doesn't clear it a second time.
    await sam.run("my_promises.put_back", { id: k.id });
    w.setNow("2026-11-30T21:00:00Z");
    const back = await sam.run<MyPromisesData>("my_promises.list");
    expect(back.promises.find((x) => x.id === k.id)).toMatchObject({ state: "open" });
    // Someone else can't put back my promise.
    expect((await (await people(w)).as(EVAN).fail("my_promises.put_back", { id: k.id })).ok).toBe(false);
  });
});
