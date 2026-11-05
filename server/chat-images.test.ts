// CV-2: GET /media/chat-images/<id> over HTTP. Signed out: 401. The member check's 403 and 404 pass through with no
// body. A served image has the type from its bytes, nosniff, a default-src 'none' sandbox CSP and a private cache;
// another site can't embed or open it; it is GET only; the log has the status, never the id. (Who may see an image is
// actions/chat-images.test.ts.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import type { LogRecord } from "../log/logger.ts";
import { stripMetadata } from "../plan/image-strip.ts";
import { jpegWithMetadata } from "../test/images.ts";
import { startTestApp } from "./test-app.ts";

const logs: LogRecord[] = [];
const jpeg = stripMetadata(jpegWithMetadata())!;
const asked: { userId: string; id: number }[] = [];
let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp({
    ctx: (s) => ({ who: s.userId }) as unknown as ActionContext,
    log: (r) => logs.push(r),
    extra: {
      chatImage: async (ctx, id) => {
        const userId = (ctx as unknown as { who: string }).who;
        asked.push({ userId, id });
        if (id === 7 && userId === "member") return { status: 200, contentType: jpeg.type, bytes: jpeg.bytes };
        return { status: id === 7 ? 403 : 404 };
      },
    },
  });
});
afterAll(() => app.close());

describe("/media/chat-images", () => {
  it("serves a member the stripped image with locked-down headers", async () => {
    const b = app.browser();
    await b.signIn("member");
    const r = await b.send("/media/chat-images/7", { "sec-fetch-site": "same-origin", "sec-fetch-dest": "image" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    expect(Number(r.headers["content-length"])).toBe(jpeg.bytes.length);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(r.headers["cache-control"]).toBe("private, max-age=3600");
    expect(r.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(asked.at(-1)).toEqual({ userId: "member", id: 7 });
  });

  it("is 403 for someone outside the chat, 404 for an unknown id, 401 signed out, all with no body", async () => {
    const b = app.browser();
    await b.signIn("outsider");
    const no = await b.send("/media/chat-images/7");
    expect([no.status, no.body]).toEqual([403, ""]);
    expect((await b.send("/media/chat-images/8")).status).toBe(404);
    const out = await app.browser().send("/media/chat-images/7");
    expect([out.status, out.body]).toEqual([401, ""]);
  });

  it("refuses other sites, other methods and other paths under /media", async () => {
    const b = app.browser();
    await b.signIn("member");
    const before = asked.length;
    expect((await b.send("/media/chat-images/7", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" })).status).toBe(403);
    expect((await b.send("/media/chat-images/7", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" })).status).toBe(403);
    expect((await b.send("/media/chat-images/7", { origin: app.publicUrl }, "POST")).status).toBe(403);
    for (const path of ["/media/chat-images/0", "/media/chat-images/abc", "/media/chat-images/7/x", "/media/other/7"]) expect((await b.send(path)).status).toBe(404);
    expect(asked.length).toBe(before);
  });

  it("logs the status under one route name, never the id", () => {
    const mine = logs.filter((l) => l.op === "chat_image");
    expect(mine.map((l) => l.status)).toEqual(expect.arrayContaining([200, 403, 404]));
    expect(JSON.stringify(mine)).not.toMatch(/chat-images\/\d/);
  });
});
