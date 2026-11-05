// CV-2: images pasted into a client chat. Rows follow their message's body (made on save, kept on a reaction-only
// update, dropped with an edit that removes them and with the message itself); the poll fetches them with the token
// that read the chat, stripped of metadata; a viewer's own token fetches one the poll hasn't; only a member of the
// chat who follows its client gets the bytes (403 otherwise); the page only ever sees FocusTime's own address, never
// Graph's; logs carry counts only. Fictional names and images.
import { describe, expect, it } from "vitest";
import type { ConversationMessages } from "../plan/conversation-views.ts";
import { HttpError } from "../sources/calendar/http.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { gifWithMetadata, jpegWithMetadata, leaks, SECRET } from "../test/images.ts";
import { BLAKE, CHAT, EVAN, LENA, world } from "../test/conversations.ts";
import { OUTSIDER, people, type W } from "../test/conversation-people.ts";
import { fetchChatImages, serveChatImage } from "./chat-images.ts";

const src = (hosted: string, messageId = "1730750000000") => `https://graph.microsoft.com/v1.0/chats/${CHAT.chatId}/messages/${messageId}/hostedContents/${hosted}/$value`;
const body = (...hosted: string[]) =>
  `<p>See the totals:</p>${hosted.map((h) => `<p><img src="${src(h)}" width="400" height="300" alt="image" itemtype="http://schema.skype.com/AMSImage"></p>`).join("")}<p>Thanks <img itemtype="http://schema.skype.com/Emoji" alt="🙂" src="https://statics.teams.cdn.office.net/smile.png"></p>`;

/** A fake Graph reader: hosted content by id, a refusal for "refuse", a throttle for "slow"; counts every call. */
function graph(files: Record<string, Uint8Array>) {
  const calls: string[] = [];
  const client: ChatMessagesClient = {
    messagesSince: async () => ({ messages: [], newest: null }),
    hostedContent: async (_chat, _message, hosted) => {
      calls.push(hosted);
      if (hosted === "refuse") throw new HttpError(403, null);
      if (hosted === "slow") throw new HttpError(429, 30);
      if (hosted === "huge") return { tooBig: true };
      return { bytes: files[hosted] ?? new TextEncoder().encode("<svg onload='x'/>") };
    },
  };
  return { client, calls };
}

async function withImages(w: W, hosted: string[], at = "2026-11-04T21:00:00Z") {
  const m = await w.say(CHAT, BLAKE, at, "See the totals:\nThanks 🙂", { messageId: "1730750000000", html: body(...hosted), hasImage: true });
  const c = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: "contoso", title: "Totals", summary: "Totals differ.", participants: [], firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt });
  await w.convs.place([{ chatId: CHAT.chatId, messageId: m.messageId, conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: m.createdAt }]);
  return { m, c };
}

describe("chat images", () => {
  it("one row per hosted image in body order (emoji aren't images); kept on a reaction-only update, dropped when an edit removes it", async () => {
    const w = world();
    const { m } = await withImages(w, ["aWQ9MQ==", "aWQ9Mg=="]);
    const rows = await w.teams.images(CHAT.chatId, [m.messageId]);
    expect(rows.map((r) => [r.position, r.state])).toEqual([[0, "pending"], [1, "pending"]]);
    // A reaction changes lastModifiedDateTime but not the body: the same rows.
    await w.teams.saveMessages([{ ...m, modifiedAt: "2026-11-04T21:10:00Z", reactions: [{ emoji: "👍", count: 1 }] }]);
    expect((await w.teams.images(CHAT.chatId, [m.messageId])).map((r) => r.id)).toEqual(rows.map((r) => r.id));
    // An edit that drops the second image drops its row; the first keeps its id (and its bytes, once fetched).
    await w.teams.saveMessages([{ ...m, modifiedAt: "2026-11-04T21:20:00Z", html: body("aWQ9MQ==") }]);
    expect((await w.teams.images(CHAT.chatId, [m.messageId])).map((r) => r.id)).toEqual([rows[0]!.id]);
  });

  it("the poll fetches them with its token, strips the metadata, skips what isn't a PNG, JPEG or GIF or is over 10 MB, and waits out a throttle", async () => {
    const w = world();
    const { m } = await withImages(w, ["jpeg", "gif", "svg", "huge", "refuse", "slow"]);
    const g = graph({ jpeg: jpegWithMetadata(), gif: gifWithMetadata() });
    expect(await fetchChatImages(w.teams, g.client, CHAT.chatId)).toEqual({ ok: 2, skipped: 2, failed: 1 });
    const rows = await w.teams.images(CHAT.chatId, [m.messageId]);
    expect(rows.map((r) => [r.state, r.reason, r.contentType])).toEqual([
      ["ok", null, "image/jpeg"], ["ok", null, "image/gif"], ["skipped", "not a PNG, JPEG or GIF", null], ["skipped", "too big", null], ["failed", "refused", null], ["pending", null, null],
    ]);
    for (const r of rows.slice(0, 2)) expect(leaks((await w.teams.imageBytes(r.id))!.bytes)).toEqual([]);
    // Next cycle: only the failed one and the throttled one again; skipped ones are never fetched again.
    g.calls.length = 0;
    await fetchChatImages(w.teams, g.client, CHAT.chatId);
    expect(g.calls).toEqual(["refuse", "slow"]);
  });

  it("serves the bytes only to a member who follows the client; 403 for anyone else; a viewer's own token fetches one the poll hasn't", async () => {
    const w = world();
    const { m } = await withImages(w, ["jpeg", "svg"]);
    const [jpeg, svg] = await w.teams.images(CHAT.chatId, [m.messageId]);
    const p = await people(w);
    const mine = graph({ jpeg: jpegWithMetadata() });
    const lena = { ...p.as(LENA).ctx, chatMessages: async () => mine.client };
    const first = await serveChatImage(lena, jpeg!.id);
    expect(first).toMatchObject({ status: 200, contentType: "image/jpeg" });
    expect(leaks((first as { bytes: Uint8Array }).bytes)).toEqual([]);
    expect(mine.calls).toEqual(["jpeg"]);
    // Fetched once: the next view is from the store.
    await serveChatImage(lena, jpeg!.id);
    expect(mine.calls).toEqual(["jpeg"]);
    expect(await serveChatImage(lena, svg!.id)).toEqual({ status: 404 });
    // Not in the chat, or in it without following Contoso: refused, and nothing fetched with their token.
    const theirs = graph({ jpeg: jpegWithMetadata() });
    expect(await serveChatImage({ ...p.as(OUTSIDER).ctx, chatMessages: async () => theirs.client }, jpeg!.id)).toEqual({ status: 403 });
    const notFollowing = await people(w, { followed: ["wingtip"] });
    expect(await serveChatImage({ ...notFollowing.as(EVAN).ctx, chatMessages: async () => theirs.client }, jpeg!.id)).toEqual({ status: 403 });
    expect(theirs.calls).toEqual([]);
    expect(await serveChatImage(lena, 99999)).toEqual({ status: 404 });
  });

  it("Show messages gives FocusTime's own address for each image and leaves the images out of the body; never Graph's URL; the card counts them", async () => {
    const w = world();
    const { c, m } = await withImages(w, ["aWQ9MQ==", "aWQ9Mg=="]);
    const p = (await people(w)).as(LENA);
    const r = await p.run<ConversationMessages>("conversations.messages", { id: c.id });
    const ids = (await w.teams.images(CHAT.chatId, [m.messageId])).map((i) => i.id);
    expect(r.messages[0]!.images).toEqual(ids.map((id) => ({ id, src: `/media/chat-images/${id}`, note: null })));
    expect(r.messages[0]!.html).toBe("<p>See the totals:</p><p></p><p></p><p>Thanks 🙂</p>");
    const json = JSON.stringify(r);
    for (const x of ["graph.microsoft.com", "hostedContents", "aWQ9MQ"]) expect(json).not.toContain(x);
    const list = await p.run("conversations.list");
    expect([...list.needsYou, ...list.teammates][0]!.images).toBe(2);
    expect(JSON.stringify(list)).not.toContain("hostedContents");
  });

  it("a skipped image says why instead of a thumbnail", async () => {
    const w = world();
    const { c } = await withImages(w, ["huge"]);
    await fetchChatImages(w.teams, graph({}).client, CHAT.chatId);
    const r = await (await people(w)).as(LENA).run<ConversationMessages>("conversations.messages", { id: c.id });
    expect(r.messages[0]!.images).toEqual([{ id: expect.any(Number), src: null, note: "Image not shown: over 10 MB" }]);
  });

  it("go with their message: expiry, a purge and a removed chat; never in the poll's logs but as counts", async () => {
    const w = world();
    const { m } = await withImages(w, ["jpeg"]);
    await fetchChatImages(w.teams, graph({ jpeg: jpegWithMetadata() }).client, CHAT.chatId);
    // Not a work message any more (unplaced): expiry takes it and its image.
    await w.conn.run("DELETE FROM conversation_messages");
    expect(await w.teams.expire("2026-11-30T00:00:00Z")).toBe(1);
    expect(await w.conn.all("SELECT id FROM teams_message_images")).toEqual([]);
    // A purge and a removed chat do the same.
    const m2 = await w.say(CHAT, EVAN, "2026-11-04T22:00:00Z", "Another", { messageId: "1730760000000", html: body("x"), hasImage: true });
    expect(await w.teams.images(CHAT.chatId, [m2.messageId])).toHaveLength(1);
    await w.teams.purgeChats([CHAT.chatId]);
    expect(await w.conn.all("SELECT id FROM teams_message_images")).toEqual([]);
    const m3 = await w.say(CHAT, EVAN, "2026-11-04T22:10:00Z", "And one more", { messageId: "1730770000000", html: body("y"), hasImage: true });
    expect(await w.teams.images(CHAT.chatId, [m3.messageId])).toHaveLength(1);
    await w.teams.removeChat(CHAT.chatId, EVAN.userId!);
    expect(await w.conn.all("SELECT id FROM teams_message_images")).toEqual([]);
    expect(m.messageId).toBeTruthy();
  });
});

describe("the poll cycle", () => {
  it("fetches a chat's images after reading it, and logs only counts", async () => {
    const { pollCycle } = await import("./request-poll.ts");
    const w = world();
    await withImages(w, ["jpeg"]);
    const logs: unknown[] = [];
    const g = graph({ jpeg: jpegWithMetadata() });
    await w.teams.recordPoll(CHAT.chatId, { polledAt: null, retryAt: null, failures: 0, state: null, note: null, tokenUser: null });
    const r = await pollCycle(
      {
        teams: w.teams,
        users: async () => w.users,
        person: async () => ({ name: "Evan Ford", config: null, chatMessages: g.client, ai: null, plan: null, openItems: async () => [] }),
        homeTenant: async () => null,
        now: () => "2026-11-04T21:30:00Z",
        log: (x) => logs.push(x),
      },
      { force: true },
    );
    expect(r.images).toBe(1);
    expect(g.calls).toEqual(["jpeg"]);
    const logged = JSON.stringify(logs);
    expect(logged).toContain('"op":"chat_images"');
    for (const x of ["jpeg", CHAT.chatId, SECRET.place, "hostedContents"]) expect(logged).not.toContain(x);
  });
});
