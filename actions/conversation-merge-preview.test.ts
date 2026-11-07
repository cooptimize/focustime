// IB-1 slice 4: Merge into… in the detail pane. The before → after preview says exactly what the merge then moves
// (which absorbs which, messages, commitments, suggestions, people, the linked item), and Undo puts both conversations
// back exactly as they were. Fictional names.
import { describe, expect, it } from "vitest";
import type { ConversationCard, ConversationsData } from "../plan/conversation-views.ts";
import { mergePreview, movesLines, type MergePreview, type MergeSide } from "../plan/merge-preview.ts";
import { HOME_TENANT } from "../test/builders/index.ts";
import { CHAT, BLAKE, EVAN, LENA, world } from "../test/conversations.ts";
import { OUTSIDER, people, type W } from "../test/conversation-people.ts";

async function conversation(w: W, title: string, summary: string, said: [typeof EVAN, string, string][]) {
  const ms = [];
  for (const [who, at, text] of said) ms.push(await w.say(CHAT, who, at, text));
  const c = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: CHAT.clientKey, title, summary, participants: said.map(([who]) => ({ id: who.userId!, name: who.displayName!, external: who.tenantId !== HOME_TENANT })).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i), firstAt: ms[0]!.createdAt, lastAt: ms.at(-1)!.createdAt, lastWorkAt: ms.at(-1)!.createdAt });
  await w.convs.place(ms.map((m) => ({ chatId: CHAT.chatId, messageId: m.messageId, conversationId: c.id, role: "work" as const, reason: null, placedBy: "ai" as const, at: m.createdAt })));
  return { c, ms };
}

async function twoTopics(w: W) {
  const a = await conversation(w, "Shipments report totals differ", "October totals differ from the dashboard.", [[BLAKE, "2026-11-04T21:13:00Z", "The totals on the shipments report don't match the dashboard for October."], [BLAKE, "2026-11-04T21:14:00Z", "Here's what I see"]]);
  const b = await conversation(w, "October filter looks off", "Leo thinks the October filter is wrong.", [[LENA, "2026-11-04T22:13:00Z", "Looking at it now, the October filter looks off."]]);
  const k = await w.convs.addCommitment({ conversationId: b.c.id, chatId: CHAT.chatId, clientKey: "contoso", whoId: EVAN.userId!, whoName: "Evan Ford", toId: BLAKE.userId!, toName: "Blake Novak", what: "Fix the October filter", dueAt: null, dueDate: null, impliesItem: true, messageIds: [b.ms[0]!.messageId], reason: null });
  const s = await w.convs.addSuggestion({ conversationId: b.c.id, itemId: 4101, kind: "comment", forUser: EVAN.userId!, body: "x", before: null, after: null, internal: [], day: "2026-11-04" });
  return { a, b, k, s };
}

/** What a person sees of a conversation, without the fields a write always touches (version, change note, "Updated"). */
const seen = (c: ConversationCard) => ({ id: c.id, title: c.title, summary: c.summary, status: c.status, statusLine: c.statusLine, participants: c.participants.map((p) => p.name), lastAt: c.lastAt, item: c.item?.id ?? null, owner: c.owner, commitments: c.commitments.map((k) => [k.id, k.what]), suggestions: c.suggestions.map((x) => x.itemId), primary: c.primary });
const cardsOf = (d: ConversationsData) => [...d.needsYou, ...d.inProgress, ...d.teammates, ...d.closed];

const side = (o: Partial<MergeSide> & { id: number; title: string }): MergeSide => ({ messages: 1, commitments: 0, suggestions: 0, people: [], item: null, ...o });

describe("the merge preview (pure)", () => {
  it("adds up what moves, joins people once, and says what happens to each linked item", () => {
    const p = mergePreview(side({ id: 2, title: "Filter", messages: 1, commitments: 1, suggestions: 1, people: ["Lena Hart", "blake novak"] }), side({ id: 1, title: "Totals", messages: 2, people: ["Blake Novak"] }));
    expect(p.after).toMatchObject({ id: 1, title: "Totals", messages: 3, commitments: 1, suggestions: 1, people: ["Blake Novak", "Lena Hart"], added: ["Lena Hart"], item: { kind: "none" } });
    const item = (id: number) => ({ id, title: null });
    expect(mergePreview(side({ id: 2, title: "B", item: item(7) }), side({ id: 1, title: "A" })).after.item).toEqual({ kind: "carried", item: item(7) });
    expect(mergePreview(side({ id: 2, title: "B" }), side({ id: 1, title: "A", item: item(5) })).after.item).toEqual({ kind: "kept", item: item(5) });
    expect(mergePreview(side({ id: 2, title: "B", item: item(7) }), side({ id: 1, title: "A", item: item(5) })).after.item).toEqual({ kind: "both", item: item(5), left: item(7) });
    expect(mergePreview(side({ id: 2, title: "B", item: item(5) }), side({ id: 1, title: "A", item: item(5) })).after.item.kind).toBe("kept");
  });

  it("words it plainly, with no em dashes", () => {
    const p = mergePreview(side({ id: 2, title: "Filter", messages: 1, commitments: 1, people: ["Lena Hart"], item: { id: 7, title: null } }), side({ id: 1, title: "Totals", messages: 2, item: { id: 5, title: null } }));
    const lines = movesLines(p);
    expect(lines).toEqual([
      '1 message move into "Totals"',
      "1 commitment moves with it, with its items and due dates",
      "Lena Hart joins the people on it",
      "#5 stays its linked item. #7 stays in DevOps but is no longer linked here; Undo links it back",
      "The summary is written again",
    ]);
    expect(lines.join(" ")).not.toContain("—");
  });
});

describe("Merge in the detail pane", () => {
  it("the preview matches what the merge moves, either way round", async () => {
    const w = world();
    const { a, b, k, s } = await twoTopics(w);
    await w.convs.updateConversation(b.c.id, { item: { id: 4101, url: null, title: "Fix the October filter" } });
    const evan = (await people(w)).as(EVAN);
    const p = await evan.run<MergePreview>("conversations.merge_preview", { id: b.c.id, into: a.c.id });
    expect(p.from).toMatchObject({ id: b.c.id, title: "October filter looks off", messages: 1, commitments: 1, suggestions: 1, people: ["Lena Hart"], item: { id: 4101 } });
    expect(p.into).toMatchObject({ id: a.c.id, title: "Shipments report totals differ", messages: 2, commitments: 0, suggestions: 0, people: ["Blake Novak"], item: null });
    expect(p.after).toMatchObject({ id: a.c.id, messages: 3, commitments: 1, suggestions: 1, added: ["Lena Hart"], item: { kind: "carried", item: { id: 4101 } } });
    // The other way round is a different merge: Swap asks again.
    const swapped = await evan.run<MergePreview>("conversations.merge_preview", { id: a.c.id, into: b.c.id });
    expect(swapped.after).toMatchObject({ id: b.c.id, messages: 3, item: { kind: "kept" }, added: ["Blake Novak"] });
    // A preview changes nothing.
    expect((await w.convs.conversations([CHAT.chatId])).map((c) => c.id).sort()).toEqual([a.c.id, b.c.id].sort());

    const r = await evan.run<ConversationsData & { merges: number[] }>("conversations.merge", { ids: [b.c.id], into: a.c.id });
    const into = cardsOf(r).find((c) => c.id === a.c.id)!;
    expect((await w.convs.placesIn([a.c.id])).length).toBe(p.after.messages);
    expect(into.commitments.map((x) => x.id)).toEqual([k.id]);
    expect((await w.convs.suggestion(s.id))!.conversationId).toBe(a.c.id);
    expect(into.participants.map((x) => x.name).sort()).toEqual([...p.after.people].sort());
    expect(into.item?.id).toBe(4101);
  });

  it("Undo restores both conversations exactly", async () => {
    const w = world();
    const { a, b } = await twoTopics(w);
    await w.convs.updateConversation(a.c.id, { item: { id: 4200, url: null, title: "Totals" }, status: "tracked" });
    await w.convs.updateConversation(b.c.id, { item: { id: 4101, url: null, title: "Filter" }, status: "tracked" });
    const evan = (await people(w)).as(EVAN);
    const before = cardsOf(await evan.run<ConversationsData>("conversations.list", {})).map(seen).sort((x, y) => x.id - y.id);
    const placesBefore = [await w.convs.placesIn([a.c.id]), await w.convs.placesIn([b.c.id])].map((ps) => ps.map((p) => p.messageId));
    const raw = async (id: number) => {
      const c = (await w.convs.conversation(id))!;
      return { title: c.title, summary: c.summary, participants: c.participants, firstAt: c.firstAt, lastAt: c.lastAt, lastWorkAt: c.lastWorkAt, ownerId: c.ownerId, itemId: c.itemId, itemTitle: c.itemTitle, status: c.status, closedAt: c.closedAt, mergedInto: c.mergedInto };
    };
    const rawBefore = [await raw(a.c.id), await raw(b.c.id)];

    const r = await evan.run<{ merges: number[] }>("conversations.merge", { ids: [b.c.id], into: a.c.id });
    await evan.run("conversations.unmerge", { merges: r.merges });

    expect(cardsOf(await evan.run<ConversationsData>("conversations.list", {})).map(seen).sort((x, y) => x.id - y.id)).toEqual(before);
    expect([await w.convs.placesIn([a.c.id]), await w.convs.placesIn([b.c.id])].map((ps) => ps.map((p) => p.messageId))).toEqual(placesBefore);
    expect([await raw(a.c.id), await raw(b.c.id)]).toEqual(rawBefore);
  });

  it("refuses the same one, another chat's, and anyone not in the chat", async () => {
    const w = world();
    const { a, b } = await twoTopics(w);
    const p = await people(w);
    expect((await p.as(EVAN).fail("conversations.merge_preview", { id: a.c.id, into: a.c.id })).error).toMatch(/another conversation/);
    expect((await p.as(OUTSIDER).fail("conversations.merge_preview", { id: b.c.id, into: a.c.id })).status).toBe(404);
    expect((await p.as(EVAN).fail("conversations.merge_preview", { id: b.c.id })).status).toBe(400);
  });
});
