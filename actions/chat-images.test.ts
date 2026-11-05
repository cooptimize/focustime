// CV-2, CV-4: images pasted into a client chat. Rows follow their message's body (made on save, kept on a reaction-only
// update, dropped with an edit that removes them and with the message itself). CV-4: never stored: read from Teams
// on view with the viewer's own token (FocusTime's member and client checks first), stripped, held in memory 5
// minutes per image and viewer; a failure shows Open in Teams; the poll no longer fetches them. The page only ever
// sees FocusTime's own address, never Graph's; logs carry counts only. Fictional names and images.
import { describe, expect, it } from "vitest";
import type { ConversationMessages } from "../plan/conversation-views.ts";
import { HttpError } from "../sources/calendar/http.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { gifWithMetadata, jpegWithMetadata, leaks, SECRET } from "../test/images.ts";
import { BLAKE, CHAT, EVAN, LENA, world } from "../test/conversations.ts";
import { OUTSIDER, people, type W } from "../test/conversation-people.ts";
import { ImageCache, readImage, serveChatImage, VIEW_CACHE_MS } from "./chat-images.ts";

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

  it("read with a member's token: stripped, type and size noted, never the bytes; what isn't a PNG, JPEG or GIF or is over 10 MB is skipped for good; one retry on a throttle", async () => {
    const w = world();
    const { m } = await withImages(w, ["jpeg", "gif", "svg", "huge", "refuse"]);
    const g = graph({ jpeg: jpegWithMetadata(), gif: gifWithMetadata() });
    const rows = await w.teams.images(CHAT.chatId, [m.messageId]);
    const got = [];
    for (const r of rows) got.push(await readImage(w.teams, g.client, r, { sleep: async () => {} }));
    expect(got.map((x) => (x.ok ? x.type : x.why))).toEqual(["image/jpeg", "image/gif", "skipped", "skipped", "gone"]);
    for (const x of got) if (x.ok) expect(leaks(x.bytes)).toEqual([]);
    const after = await w.teams.images(CHAT.chatId, [m.messageId]);
    expect(after.map((r) => [r.state, r.reason, r.contentType])).toEqual([
      ["ok", null, "image/jpeg"], ["ok", null, "image/gif"], ["skipped", "not a PNG, JPEG or GIF", null], ["skipped", "too big", null], ["pending", null, null],
    ]);
    expect(after[0]!.byteSize).toBe((got[0] as { bytes: Uint8Array }).bytes.length);
    expect(await w.conn.all("SELECT id FROM teams_message_images WHERE bytes IS NOT NULL")).toEqual([]);
    // A throttle: one wait (Retry-After, at most 5 s), one more try.
    let tries = 0;
    const slow: ChatMessagesClient = { messagesSince: async () => ({ messages: [], newest: null }), hostedContent: async () => (++tries === 1 ? Promise.reject(new HttpError(429, 30)) : { bytes: jpegWithMetadata() }) };
    const waits: number[] = [];
    expect(await readImage(w.teams, slow, rows[0]!, { sleep: async (ms) => void waits.push(ms) })).toMatchObject({ ok: true });
    expect([tries, waits]).toEqual([2, [5000]]);
  });

  it("served to a member who follows the client, read with their own token, held 5 minutes per viewer; 403 for anyone else; a failure is 404 for 5 minutes", async () => {
    const w = world();
    const { m } = await withImages(w, ["jpeg", "svg", "refuse"]);
    const [jpeg, svg, refused] = await w.teams.images(CHAT.chatId, [m.messageId]);
    const p = await people(w);
    const cache = new ImageCache();
    const t0 = Date.parse("2026-11-04T21:30:00Z");
    const mine = graph({ jpeg: jpegWithMetadata() });
    const lena = { ...p.as(LENA).ctx, chatMessages: async () => mine.client };
    const first = await serveChatImage(lena, jpeg!.id, { cache, now: t0 });
    expect(first).toMatchObject({ status: 200, contentType: "image/jpeg" });
    expect(leaks((first as { bytes: Uint8Array }).bytes)).toEqual([]);
    expect(mine.calls).toEqual(["jpeg"]);
    // Within 5 minutes: from memory. After: read again with her token.
    await serveChatImage(lena, jpeg!.id, { cache, now: t0 + 60_000 });
    expect(mine.calls).toEqual(["jpeg"]);
    await serveChatImage(lena, jpeg!.id, { cache, now: t0 + VIEW_CACHE_MS + 1 });
    expect(mine.calls).toEqual(["jpeg", "jpeg"]);
    // Another member gets it with their own token, never from Lena's read.
    const blakes = graph({ jpeg: jpegWithMetadata() });
    expect(await serveChatImage({ ...p.as(BLAKE).ctx, chatMessages: async () => blakes.client }, jpeg!.id, { cache, now: t0 + 60_000 })).toMatchObject({ status: 200 });
    expect(blakes.calls).toEqual(["jpeg"]);
    // Skipped: 404 and never read again. Refused by Teams: 404, remembered for 5 minutes.
    expect(await serveChatImage(lena, svg!.id, { cache, now: t0 })).toEqual({ status: 404 });
    expect(await serveChatImage(lena, svg!.id, { cache, now: t0 + VIEW_CACHE_MS + 1 })).toEqual({ status: 404 });
    expect(await serveChatImage(lena, refused!.id, { cache, now: t0 })).toEqual({ status: 404 });
    expect(await serveChatImage(lena, refused!.id, { cache, now: t0 + 60_000 })).toEqual({ status: 404 });
    expect(mine.calls.filter((c) => c !== "jpeg")).toEqual(["svg", "refuse"]);
    // Not in the chat, or in it without following Contoso: refused, and nothing read with their token.
    const theirs = graph({ jpeg: jpegWithMetadata() });
    expect(await serveChatImage({ ...p.as(OUTSIDER).ctx, chatMessages: async () => theirs.client }, jpeg!.id, { cache })).toEqual({ status: 403 });
    const notFollowing = await people(w, { followed: ["wingtip"] });
    expect(await serveChatImage({ ...notFollowing.as(EVAN).ctx, chatMessages: async () => theirs.client }, jpeg!.id, { cache })).toEqual({ status: 403 });
    expect(theirs.calls).toEqual([]);
    expect(await serveChatImage(lena, 99999, { cache })).toEqual({ status: 404 });
    // Nothing on disk: no bytes in the store after all that.
    expect(await w.conn.all("SELECT id FROM teams_message_images WHERE bytes IS NOT NULL")).toEqual([]);
  });

  it("the memory holds about 64 MB in all: the oldest go first", () => {
    const c = new ImageCache(VIEW_CACHE_MS, 10);
    const img = (n: number) => ({ contentType: "image/png", bytes: new Uint8Array(n) });
    c.set(1, "a", img(4), 0);
    c.set(2, "a", img(4), 1);
    c.set(3, "b", img(4), 2);
    expect([c.get(1, "a", 3), !!c.get(2, "a", 3), !!c.get(3, "b", 3), c.bytes]).toEqual([undefined, true, true, 8]);
    c.set(4, "a", img(11), 4);
    expect(c.get(4, "a", 5)).toBeUndefined();
  });

  it("Show messages gives FocusTime's own address for each image and leaves the images out of the body; never Graph's URL; the card counts them", async () => {
    const w = world();
    const { c, m } = await withImages(w, ["aWQ9MQ==", "aWQ9Mg=="]);
    const p = (await people(w)).as(LENA);
    const r = await p.run<ConversationMessages>("conversations.messages", { id: c.id });
    const ids = (await w.teams.images(CHAT.chatId, [m.messageId])).map((i) => i.id);
    const link = expect.stringMatching(/^https:\/\/teams\.microsoft\.com\//);
    expect(r.messages[0]!.images).toEqual(ids.map((id) => ({ id, src: `/media/chat-images/${id}`, note: null, link })));
    expect(r.messages[0]!.html).toBe("<p>See the totals:</p><p></p><p></p><p>Thanks 🙂</p>");
    const json = JSON.stringify(r);
    for (const x of ["graph.microsoft.com", "hostedContents", "aWQ9MQ"]) expect(json).not.toContain(x);
    const list = await p.run("conversations.list");
    expect([...list.needsYou, ...list.teammates][0]!.images).toBe(2);
    expect(JSON.stringify(list)).not.toContain("hostedContents");
  });

  it("a skipped image says why instead of a thumbnail; a described one carries its words, on the card too", async () => {
    const w = world();
    const { c, m } = await withImages(w, ["huge", "jpeg"]);
    const [huge, jpeg] = await w.teams.images(CHAT.chatId, [m.messageId]);
    await readImage(w.teams, graph({}).client, huge!);
    await w.teams.setImageDescription(jpeg!.id, "Refresh failed error on the sales model");
    const p = (await people(w)).as(LENA);
    const r = await p.run<ConversationMessages>("conversations.messages", { id: c.id });
    expect(r.messages[0]!.images).toEqual([
      { id: huge!.id, src: null, note: "Image not shown: over 10 MB", link: expect.any(String) },
      { id: jpeg!.id, src: `/media/chat-images/${jpeg!.id}`, note: null, link: expect.any(String), description: "Refresh failed error on the sales model" },
    ]);
    const list = await p.run("conversations.list");
    expect([...list.needsYou, ...list.teammates][0]).toMatchObject({ images: 2, imageNote: "Refresh failed error on the sales model" });
  });

  it("go with their message: expiry, a purge and a removed chat; never in the poll's logs but as counts", async () => {
    const w = world();
    const { m } = await withImages(w, ["jpeg"]);
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
  it("CV-4: no longer reads a chat's images (they are read on view, or for the AI with the client's switch on)", async () => {
    const { pollCycle } = await import("./request-poll.ts");
    const w = world();
    await withImages(w, ["jpeg"]);
    const logs: unknown[] = [];
    const g = graph({ jpeg: jpegWithMetadata() });
    await w.teams.recordPoll(CHAT.chatId, { polledAt: null, retryAt: null, failures: 0, state: null, note: null, tokenUser: null });
    await pollCycle(
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
    expect(g.calls).toEqual([]);
    const logged = JSON.stringify(logs);
    for (const x of ["jpeg", CHAT.chatId, SECRET.place, "hostedContents"]) expect(logged).not.toContain(x);
  });
});
