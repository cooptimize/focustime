// A2: the Microsoft sign-in end to end through the app, against a fake Entra (server/auth/test-idp.ts): discovery,
// keys, the code redeemed with PKCE and the client secret, the ID token validated, the tenant checked, a session made.
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../../actions/dispatch.ts";
import type { LogRecord } from "../../log/logger.ts";
import { startTestApp } from "../test-app.ts";
import { AUTH_COOKIE, CSRF_COOKIE, SESSION_COOKIE } from "./cookies.ts";
import { createEntraSignIn, type SignedIn } from "./entra.ts";
import { createFakeIdp, FAKE_CLIENT, FAKE_ISSUER, FAKE_OID, FAKE_SECRET, FAKE_TENANT, type IdpKnobs } from "./test-idp.ts";

const ctx = { loadConfig: async () => { throw new Error("unused"); } } as unknown as ActionContext;
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function setup(knobs: IdpKnobs = {}, o: { tenantId?: string } = {}) {
  const idp = createFakeIdp(knobs);
  const logs: LogRecord[] = [];
  const signedIn: SignedIn[] = [];
  const demos: string[] = [];
  let entra: ReturnType<typeof createEntraSignIn> | null = null;
  const app = await startTestApp({
    ctx: (s) => ({ ...ctx, who: s.userId }) as unknown as ActionContext,
    log: (r) => logs.push(r),
    auth: {
      microsoft: {
        start: (x) => entra!.start(x),
        finish: (u, p) => entra!.finish(u, p),
      },
      signedIn: async (u) => {
        signedIn.push(u);
        return { userId: u.oid };
      },
      demo: async () => {
        const id = `demo-${demos.length + 1}`;
        demos.push(id);
        return id;
      },
    },
  });
  close = app.close;
  entra = createEntraSignIn({
    tenantId: o.tenantId ?? FAKE_TENANT,
    clientId: FAKE_CLIENT,
    redirectUri: `${app.publicUrl}/auth/microsoft/callback`,
    clientSecret: async () => FAKE_SECRET,
    log: (r) => logs.push(r),
    fetch: idp.fetch as never,
    issuer: FAKE_ISSUER,
  });
  /** A browser goes through the whole sign-in; returns the callback's answer. */
  async function signIn(b = app.browser(), tamper?: (back: string) => string) {
    const go = await b.send("/auth/microsoft/login");
    expect(go.status).toBe(302);
    const back = idp.approve(String(go.headers.location));
    return { b, res: await b.send(tamper ? tamper(back) : back, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }) };
  }
  return { app, idp, logs, signedIn, demos, signIn };
}

describe("Microsoft sign-in", () => {
  it("asks Microsoft with PKCE, state, nonce and the sign-in scope, for this tenant's app only", async () => {
    const t = await setup();
    const go = await t.app.browser().send("/auth/microsoft/login?hint=ana%40cooptimize.example");
    const u = new URL(String(go.headers.location));
    expect(u.origin + u.pathname).toBe(`https://login.example.test/${FAKE_TENANT}/oauth2/v2.0/authorize`);
    expect(u.searchParams.get("client_id")).toBe(FAKE_CLIENT);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(u.searchParams.get("nonce")).toBeTruthy();
    expect(u.searchParams.get("scope")).toContain("openid");
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("login_hint")).toBe("ana@cooptimize.example");
    expect(u.searchParams.get("redirect_uri")).toBe(`${t.app.publicUrl}/auth/microsoft/callback`);
    expect(String(go.headers["set-cookie"])).toContain(`${AUTH_COOKIE}=${u.searchParams.get("state")}`);
    expect(String(go.headers["set-cookie"])).toContain("HttpOnly");
  });

  it("signs in with a good token: a session, its cookies, and the person recorded", async () => {
    const t = await setup();
    const { b, res } = await t.signIn();
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    const set = (res.headers["set-cookie"] as string[]).join("\n");
    expect(set).toMatch(new RegExp(`${SESSION_COOKIE}=[^;]+; Path=/; Secure; HttpOnly; SameSite=Lax`));
    expect(set).toMatch(new RegExp(`${CSRF_COOKIE}=[^;]+; Path=/; Secure; SameSite=Strict`));
    expect(t.signedIn).toEqual([{ oid: FAKE_OID, tid: FAKE_TENANT, upn: "ana@cooptimize.example", name: "Ana Example", email: "ana@cooptimize.example", groups: { kind: "none" } }]);
    const s = (await t.app.accounts.sessions.resolve(b.jar.get(SESSION_COOKIE)));
    expect(s).toMatchObject({ userId: FAKE_OID, demo: false });
    // The code was redeemed with the verifier and the client secret.
    const req = t.idp.seen.tokenRequests[0]!;
    expect(req.get("grant_type")).toBe("authorization_code");
    expect(req.get("code_verifier")).toMatch(/^[\w-]{43}$/);
    // Nothing secret in the logs.
    const logged = JSON.stringify(t.logs);
    for (const v of [FAKE_SECRET, "fake-refresh-token", "fake-graph-access", b.jar.get(SESSION_COOKIE)!, b.jar.get(CSRF_COOKIE)!]) expect(logged).not.toContain(v);
    // The session works for a call.
    expect((await b.action("nothing.here", {})).status).toBe(400);
  });

  it("refuses a token from another tenant", async () => {
    const t = await setup({ tid: "00000000-0000-4000-8000-000000000000" });
    const { b, res } = await t.signIn();
    expect(res.headers.location).toBe("/?signin=wrong_tenant");
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
    expect(t.signedIn).toEqual([]);
  });

  it("refuses an expired ID token", async () => {
    const t = await setup({ expiresIn: -600 });
    const { b, res } = await t.signIn();
    expect(res.headers.location).toBe("/?signin=invalid");
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses an ID token with another nonce", async () => {
    const t = await setup({ nonce: "not-the-one-asked-for" });
    const { b, res } = await t.signIn();
    expect(res.headers.location).toBe("/?signin=invalid");
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses an ID token signed with a key that isn't the tenant's", async () => {
    const t = await setup({ foreignKey: true });
    const { b, res } = await t.signIn();
    expect(res.headers.location).toBe("/?signin=invalid");
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses a callback whose state isn't this browser's, or is used twice", async () => {
    const t = await setup();
    // Another browser's callback (no auth cookie here): a login CSRF.
    const go = await t.app.browser().send("/auth/microsoft/login");
    const back = t.idp.approve(String(go.headers.location));
    const other = t.app.browser();
    expect((await other.send(back)).headers.location).toBe("/?signin=expired");
    // A changed state.
    const { res } = await t.signIn(undefined, (u) => u.replace(/state=[^&]+/, "state=forged"));
    expect(res.headers.location).toBe("/?signin=expired");
    // The same callback twice.
    const b = t.app.browser();
    const go2 = await b.send("/auth/microsoft/login");
    const back2 = t.idp.approve(String(go2.headers.location));
    const auth = b.jar.get(AUTH_COOKIE)!;
    expect((await b.send(back2)).headers.location).toBe("/");
    b.jar.set(AUTH_COOKIE, auth);
    expect((await b.send(back2)).headers.location).toBe("/?signin=expired");
    expect(t.signedIn).toHaveLength(1);
  });

  it("says no when Microsoft says the person declined", async () => {
    const t = await setup();
    const { res } = await t.signIn(undefined, (u) => u.replace(/code=[^&]+/, "error=access_denied"));
    expect(res.headers.location).toBe("/?signin=denied");
  });

  it("refuses sign-out and calls without the CSRF token", async () => {
    const t = await setup();
    const { b } = await t.signIn();
    expect((await b.action("nothing.here", {}, { "x-csrf": "" })).status).toBe(403);
    expect((await b.post("/auth/logout", {}, { "x-csrf": "" })).status).toBe(403);
    expect(b.jar.has(SESSION_COOKIE)).toBe(true);
  });

  it("starts a fresh session id at sign-in, never the one the browser brought", async () => {
    const t = await setup();
    const b = t.app.browser();
    const planted = (await b.signIn("someone-else"));
    await t.signIn(b);
    expect(b.jar.get(SESSION_COOKIE)).not.toBe(planted.cookie);
    expect((await t.app.accounts.sessions.resolve(planted.cookie))).toBeNull();
  });
});

describe("demo sessions", () => {
  it("starts from the sign-in page, each its own fictional person, and never the signed-in person's", async () => {
    const t = await setup();
    const { b: real } = await t.signIn();
    const d1 = t.app.browser();
    const r = await d1.post("/auth/demo", {});
    expect(r.status).toBe(200);
    const d2 = t.app.browser();
    await d2.post("/auth/demo", {});
    const s1 = (await t.app.accounts.sessions.resolve(d1.jar.get(SESSION_COOKIE)))!;
    const s2 = (await t.app.accounts.sessions.resolve(d2.jar.get(SESSION_COOKIE)))!;
    expect(s1).toMatchObject({ demo: true, userId: "demo-1" });
    expect(s2).toMatchObject({ demo: true, userId: "demo-2" });
    expect((await t.app.accounts.sessions.resolve(real.jar.get(SESSION_COOKIE)))).toMatchObject({ demo: false, userId: FAKE_OID });
    // The demo cookie lasts hours, not days.
    expect(String(r.headers["set-cookie"])).toMatch(/Max-Age=7200/);
  });

  it("needs a same-origin POST", async () => {
    const t = await setup();
    expect((await t.app.browser().send("/auth/demo")).status).toBe(404);
    expect((await t.app.browser().post("/auth/demo", {}, { origin: "http://evil.example" })).status).toBe(403);
    expect(t.demos).toEqual([]);
  });
});

describe("AP-1: allowing Chat.Read later (incremental consent, D490)", () => {
  it("a signed-in person is sent to Microsoft for Chat.Read alone, and comes back to Settings > Clients", async () => {
    const t = await setup();
    const { b } = await t.signIn();
    const go = await b.send("/auth/microsoft/login?consent=chat_read");
    expect(go.status).toBe(302);
    const u = new URL(String(go.headers.location));
    expect(u.searchParams.get("scope")).toBe("openid profile email offline_access https://graph.microsoft.com/Chat.Read");
    const back = await b.send(t.idp.approve(String(go.headers.location)), { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" });
    expect(back.headers.location).toBe("/?allowed=chat_read#/settings/clients");
    expect(await t.app.accounts.sessions.resolve(b.jar.get(SESSION_COOKIE))).toMatchObject({ userId: FAKE_OID });
  });

  it("without a session it doesn't go to Microsoft; an unknown consent is a plain sign-in", async () => {
    const t = await setup();
    const none = await t.app.browser().send("/auth/microsoft/login?consent=chat_read");
    expect(none.headers.location).toBe("/#/settings/clients");
    const odd = await t.app.browser().send("/auth/microsoft/login?consent=mail_read");
    expect(new URL(String(odd.headers.location)).searchParams.get("scope")).toContain(".default");
  });
});
