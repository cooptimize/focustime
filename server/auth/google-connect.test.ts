// A2: Settings > Connections > Connect Google through the app's routes: only for the signed-in person who started it,
// never for a demo session, the state checked against this browser's cookie and the server's pending request.
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../../actions/dispatch.ts";
import { startTestApp } from "../test-app.ts";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function setup() {
  const finished: { userId: string; code: string | null }[] = [];
  let n = 0;
  const app = await startTestApp({
    ctx: {} as ActionContext,
    auth: {
      google: {
        start: async () => {
          const state = `state-${++n}`;
          return { url: `https://accounts.google.example/o/oauth2/v2/auth?state=${state}`, pending: { state, nonce: "", verifier: `verifier-${n}` } };
        },
        finish: async (userId, callback) => {
          finished.push({ userId, code: callback.searchParams.get("code") });
          return "connected";
        },
      },
    },
  });
  close = app.close;
  const start = async (b: ReturnType<typeof app.browser>) => {
    const r = await b.send("/auth/google/login");
    return { r, state: new URL(String(r.headers.location), "http://x").searchParams.get("state") };
  };
  const back = (b: ReturnType<typeof app.browser>, state: string | null) => b.send(`/auth/google/callback?code=the-code&state=${state}`, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" });
  return { app, finished, start, back };
}

describe("Connect Google (A2)", () => {
  it("goes to Google and comes back to the person who started it", async () => {
    const t = await setup();
    const b = t.app.browser();
    await b.signIn("ana");
    const { r, state } = await t.start(b);
    expect(r.status).toBe(302);
    expect(String(r.headers.location)).toMatch(/^https:\/\/accounts\.google\.example\//);
    const done = await t.back(b, state);
    expect(done.headers.location).toBe("/?google=connected#/settings/connections");
    expect(t.finished).toEqual([{ userId: "ana", code: "the-code" }]);
    // The same state again: used up.
    expect((await t.back(b, state)).headers.location).toBe("/?google=expired#/settings/connections");
  });

  it("refuses another person's browser, a missing state cookie and a demo session", async () => {
    const t = await setup();
    const ana = t.app.browser();
    await ana.signIn("ana");
    const { state } = await t.start(ana);
    const ben = t.app.browser();
    await ben.signIn("ben");
    expect((await t.back(ben, state)).headers.location).toBe("/?google=expired#/settings/connections");
    const demo = t.app.browser();
    await demo.signIn("demo-1", true);
    expect((await demo.send("/auth/google/login")).headers.location).toBe("/#/settings/connections");
    expect(t.finished).toEqual([]);
  });

  it("needs someone signed in", async () => {
    const t = await setup();
    const b = t.app.browser();
    expect((await b.send("/auth/google/login")).headers.location).toBe("/#/settings/connections");
  });
});
