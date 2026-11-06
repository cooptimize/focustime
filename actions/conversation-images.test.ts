// CV-4: chat images and the AI. With the client's "Send attachments to AI" on, the batch's images are read with the
// poll's token, stripped, and go in the same conversations.update request right after the input, each labelled with
// its message (high detail; at most 4 per message and 10 per call; the rest get no description). The answer's
// descriptions (120 characters at most, no email addresses or secret shapes) land on the image rows. With the switch
// off nothing is read or sent, only counted. Fake Graph, fake provider; fictional names and images.
import { describe, expect, it } from "vitest";
import type { ProviderCall } from "../ai/types.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { anUpdateAnswer } from "../test/builders/index.ts";
import { BLAKE, CHAT, world } from "../test/conversations.ts";
import { jpegWithMetadata, leaks } from "../test/images.ts";
import { imagesForAi } from "./chat-images.ts";

const img = (h: string) => `<img src="https://graph.microsoft.com/v1.0/chats/${CHAT.chatId}/messages/1/hostedContents/${h}/$value" itemtype="http://schema.skype.com/AMSImage">`;
const html = (n: number, tag: string) => `<p>The refresh failed:</p>${Array.from({ length: n }, (_, i) => img(`${tag}${i}`)).join("")}`;

function graph() {
  const calls: string[] = [];
  const client: ChatMessagesClient = {
    messagesSince: async () => ({ messages: [], newest: null }),
    hostedContent: async (_c, _m, hosted) => (calls.push(hosted), { bytes: jpegWithMetadata() }),
  };
  return { client, calls };
}

/** Every message work in one new conversation, and a description per image it was given (from the labels). */
function describing(text: (ref: string) => string) {
  return (c: ProviderCall) => {
    const input = JSON.parse(c.input) as { messages: { ref: string }[] };
    const base = anUpdateAnswer({ messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: "n1", confident_new_topic: false })) });
    const refs = (c.images ?? []).map((i) => /^Image (i\d+),/.exec(i.label)![1]!);
    return JSON.stringify(c.images ? { ...base, images: refs.map((ref) => ({ ref, description: text(ref) })) } : base);
  };
}

describe("chat images and the AI (CV-4)", () => {
  it("switch on: the images go in the same request after their message's label, at high detail, stripped; the descriptions are stored", async () => {
    const w = world({ respond: describing((r) => (r === "i1" ? "Refresh failed error on the sales model, timeout after 30 minutes" : "Gateway offline banner")) });
    const g = graph();
    const m = await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "The refresh failed:", { html: html(2, "a"), hasImage: true });
    const r = await w.run(CHAT, [m], { images: (ids) => imagesForAi(w.teams, g.client, CHAT.chatId, ids) });
    expect(w.calls).toHaveLength(1);
    const call = w.calls[0]!;
    expect(call.images!.map((i) => i.label)).toEqual(["Image i1, in message m1:", "Image i2, in message m1:"]);
    for (const i of call.images!) {
      expect(i.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
      expect(leaks(Buffer.from(i.dataUrl.split(",")[1]!, "base64"))).toEqual([]);
    }
    expect(call.instructions).toMatch(/images: for every image given/);
    expect(call.schema.required).toContain("images");
    expect(r).toMatchObject({ imagesSent: 2, imagesNotSent: 0, described: 2 });
    const rows = await w.teams.images(CHAT.chatId, [m.messageId]);
    expect(rows.map((x) => x.description)).toEqual(["Refresh failed error on the sales model, timeout after 30 minutes", "Gateway offline banner"]);
    expect(await w.conn.all("SELECT id FROM teams_message_images WHERE bytes IS NOT NULL")).toEqual([]);
    // Logged as one request against the app's cap: its cost includes the images' tokens, never their content.
    const [log] = await w.convs.appAiLog.recent(1);
    expect(log).toMatchObject({ task: "conversations.update", outcome: "ok" });
    expect(log!.inputTokens).toBeGreaterThan(2 * 1229);
  });

  it("switch off: nothing is read from Teams or sent; the images are only counted", async () => {
    const w = world({ respond: describing(() => "x") });
    const g = graph();
    const m = await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "The refresh failed:", { html: html(3, "b"), hasImage: true });
    const r = await w.run(CHAT, [m]);
    expect(w.calls[0]!.images).toBeUndefined();
    expect(w.calls[0]!.schema.required).not.toContain("images");
    expect(g.calls).toEqual([]);
    expect(r).toMatchObject({ imagesSent: 0, imagesNotSent: 3, described: 0 });
    expect((await w.teams.images(CHAT.chatId, [m.messageId])).map((x) => x.description)).toEqual([null, null, null]);
  });

  it("at most 4 per message and 10 per call; the rest get no description", async () => {
    const w = world({ respond: describing((r) => `Screenshot ${r}`) });
    const g = graph();
    const batch = [
      await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "First:", { html: html(6, "c"), hasImage: true }),
      await w.say(CHAT, BLAKE, "2026-11-04T19:03:00Z", "Second:", { html: html(4, "d"), hasImage: true }),
      await w.say(CHAT, BLAKE, "2026-11-04T19:04:00Z", "Third:", { html: html(4, "e"), hasImage: true }),
    ];
    const r = await w.run(CHAT, batch, { images: (ids) => imagesForAi(w.teams, g.client, CHAT.chatId, ids) });
    expect(w.calls[0]!.images).toHaveLength(10);
    expect(g.calls).toEqual(["c0", "c1", "c2", "c3", "d0", "d1", "d2", "d3", "e0", "e1"]);
    expect(r).toMatchObject({ imagesSent: 10, imagesNotSent: 4, described: 10 });
    const described = (await w.teams.images(CHAT.chatId, batch.map((m) => m.messageId))).filter((x) => x.description).length;
    expect(described).toBe(10);
  });

  it("a description never keeps an email address or a secret shape, is one line of 120 characters at most, and an unknown ref is dropped", async () => {
    const w = world({
      respond: (c) => {
        const base = JSON.parse(describing(() => "")(c)) as Record<string, unknown>;
        return JSON.stringify({ ...base, images: [{ ref: "i1", description: `Login screen for dana@fabrikam.example\nwith password: hunter2 ${"and more ".repeat(30)}` }, { ref: "i9", description: "Invented" }] });
      },
    });
    const m = await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Login:", { html: html(1, "f"), hasImage: true });
    await w.run(CHAT, [m], { images: (ids) => imagesForAi(w.teams, graph().client, CHAT.chatId, ids) });
    const [row] = await w.teams.images(CHAT.chatId, [m.messageId]);
    expect(row!.description).not.toMatch(/dana@|hunter2|\n/);
    expect(row!.description!.length).toBeLessThanOrEqual(120);
    // HK-4: the service redacts the answer first, so the spans read "[removed]" (CV-4's own scrub is the backstop).
    expect(row!.description!.startsWith("Login screen for [removed] with [removed]")).toBe(true);
  });

  it("a request that fails stores no description", async () => {
    const w = world({ respond: () => ({ ok: false, kind: "provider", status: 500 }) });
    const m = await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "The refresh failed:", { html: html(1, "g"), hasImage: true });
    const r = await w.run(CHAT, [m], { images: (ids) => imagesForAi(w.teams, graph().client, CHAT.chatId, ids) });
    expect(r.described).toBe(0);
    expect((await w.teams.images(CHAT.chatId, [m.messageId]))[0]!.description).toBeNull();
  });
});
