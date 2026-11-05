import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { startTestApp } from "./test-app.ts";
import { USE_HEADER } from "./app.ts";

// HK-3: only a call the page marks "active" (or its report at /api/activity) counts as someone using FocusTime.
const uses: string[] = [];
let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  app = await startTestApp({
    ctx: () => ({ now: () => "2026-11-03T15:00:00Z" }) as unknown as ActionContext,
    extra: { onUse: (s) => (uses.push(s.userId), 10) },
  });
});
afterAll(() => app.close());

describe("real use (HK-3)", () => {
  it("a background call, or one with no mark, never counts; an active one does", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    uses.length = 0;
    await b.action("notices.list", {}, { [USE_HEADER]: "background" });
    await b.action("notices.list", {});
    expect(uses).toEqual([]);
    await b.action("notices.list", {}, { [USE_HEADER]: "active" });
    expect(uses).toEqual(["user-a"]);
  });

  it("the page's report answers with the Rule's minutes; a background report changes nothing", async () => {
    const b = app.browser();
    await b.signIn("user-b");
    uses.length = 0;
    expect(JSON.parse((await b.post("/api/activity", {}, { [USE_HEADER]: "background" })).body)).toEqual({ idleMinutes: null });
    expect(uses).toEqual([]);
    expect(JSON.parse((await b.post("/api/activity", {}, { [USE_HEADER]: "active" })).body)).toEqual({ idleMinutes: 10 });
    expect(uses).toEqual(["user-b"]);
  });

  it("is guarded like every call: no session, no use", async () => {
    uses.length = 0;
    expect((await app.browser().post("/api/activity", {}, { [USE_HEADER]: "active" })).status).toBe(401);
    expect(uses).toEqual([]);
  });
});
