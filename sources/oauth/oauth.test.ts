import { createLoopback } from "../../host/local/loopback.ts";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { createOAuthClient, microsoftProvider, googleProvider, AuthFailure, needsInteraction } from "./oauth.ts";
import { parseIdToken, workEmail } from "./idtoken.ts";
import {
  FAKE_ACCESS, FAKE_AUTH_CODE, FAKE_CLIENT_SECRET, FAKE_PERSON, FAKE_REFRESH, FAKE_REFRESH_ROTATED, fakeIdToken,
  fakeBrowser, fakeTokenEndpoint, memoryKeyring, type TokenBehavior,
} from "./test-fakes.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const MS_CLIENT = "44444444-4444-4444-8444-444444444444";
const MS_TOKEN = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const G_CLIENT = "123-abc.apps.googleusercontent.com";
const G_TOKEN = "https://oauth2.googleapis.com/token";

function ms(opts: { exchange?: TokenBehavior; refresh?: TokenBehavior; consented?: string[]; grantFewer?: boolean; interaction?: boolean; keyring?: ReturnType<typeof memoryKeyring>; browser?: ReturnType<typeof fakeBrowser>; signInTimeoutMs?: number } = {}) {
  const tok = fakeTokenEndpoint(MS_TOKEN, opts);
  const keyring = opts.keyring ?? memoryKeyring();
  const browser = opts.browser ?? fakeBrowser({ kind: "approve" }, tok.authorize);
  const logs: LogRecord[] = [];
  const client = createOAuthClient(microsoftProvider({ tenantId: TENANT, clientId: MS_CLIENT }), {
    fetch: tok.fetch, keyring, loopback: createLoopback(), openBrowser: browser.open, log: (r) => logs.push(r), signInTimeoutMs: opts.signInTimeoutMs ?? 2000,
  });
  return { client, tok, keyring, browser, logs };
}

function google(opts: { exchange?: TokenBehavior; refresh?: TokenBehavior; keyring?: ReturnType<typeof memoryKeyring> } = {}) {
  const tok = fakeTokenEndpoint(G_TOKEN, opts);
  const keyring = opts.keyring ?? memoryKeyring({ "google-client-secret": FAKE_CLIENT_SECRET });
  const browser = fakeBrowser({ kind: "approve" });
  const client = createOAuthClient(googleProvider({ clientId: G_CLIENT, calendars: ["primary"] }), {
    fetch: tok.fetch, keyring, loopback: createLoopback(), openBrowser: browser.open, log: () => {}, signInTimeoutMs: 2000,
  });
  return { client, tok, keyring, browser };
}

describe("sign-in (auth code + PKCE over loopback)", () => {
  it("Microsoft: sends a PKCE S256 challenge, redirects to localhost, stores the refresh token", async () => {
    const { client, tok, keyring, browser } = ms();
    expect(await client.connect()).toMatchObject({ status: "connected" });

    const auth = browser.seen[0]!;
    expect(auth.origin + auth.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(auth.searchParams.get("client_id")).toBe(MS_CLIENT);
    expect(auth.searchParams.get("response_type")).toBe("code");
    expect(auth.searchParams.get("scope")).toBe("openid profile email offline_access https://graph.microsoft.com/Calendars.ReadBasic");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+\/$/);

    const exchange = tok.calls[0]!.body;
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code")).toBe(FAKE_AUTH_CODE);
    expect(exchange.get("redirect_uri")).toBe(auth.searchParams.get("redirect_uri"));
    expect(exchange.get("client_secret")).toBeNull();
    const challenge = createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url");
    expect(auth.searchParams.get("code_challenge")).toBe(challenge);

    expect(keyring.store.get("outlook-refresh-token")).toBe(FAKE_REFRESH);
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
  });

  it("Google: asks for offline access with consent, uses 127.0.0.1 and the keyring client secret", async () => {
    const { client, tok, keyring, browser } = google();
    expect(await client.connect()).toMatchObject({ status: "connected" });
    const auth = browser.seen[0]!;
    expect(auth.origin + auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events.readonly");
    expect(auth.searchParams.get("access_type")).toBe("offline");
    expect(auth.searchParams.get("prompt")).toBe("consent");
    expect(auth.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(tok.calls[0]!.body.get("client_secret")).toBe(FAKE_CLIENT_SECRET);
    expect(keyring.store.get("google-refresh-token")).toBe(FAKE_REFRESH);
  });

  it("reports consent cancelled when the user declines", async () => {
    const { client, keyring } = ms({ browser: fakeBrowser({ kind: "deny" }) });
    expect(await client.connect()).toEqual({ status: "cancelled", message: "Sign-in was cancelled" });
    expect(keyring.store.has("outlook-refresh-token")).toBe(false);
  });

  it("times out when the browser never comes back", async () => {
    const { client } = ms({ browser: fakeBrowser({ kind: "ignore" }), signInTimeoutMs: 100 });
    expect(await client.connect()).toEqual({ status: "cancelled", message: "Sign-in timed out" });
  });

  it("ignores a callback with the wrong state and still completes with the right one", async () => {
    const browser = fakeBrowser({ kind: "wrong_state_then_approve" });
    const { client } = ms({ browser });
    expect(await client.connect()).toMatchObject({ status: "connected" });
    await new Promise((r) => setTimeout(r, 50));
    expect(browser.hits).toEqual([400, 200]);
  });

  it("refuses a callback with a foreign Host header", async () => {
    const browser = fakeBrowser({ kind: "foreign_host" });
    const { client } = ms({ browser, signInTimeoutMs: 300 });
    expect((await client.connect()).status).toBe("cancelled");
    expect(browser.hits).toEqual([403]);
  });

  it("fails clearly when the token response has no refresh token", async () => {
    const { client } = ms({ exchange: "no_refresh_token" });
    expect(await client.connect()).toEqual({ status: "failed", message: "Sign-in did not return a refresh token" });
  });

  it("fails clearly when Google's client secret is missing from the keyring", async () => {
    const { client } = google({ keyring: memoryKeyring() });
    expect(await client.connect()).toEqual({
      status: "failed",
      message: "No Google client secret in the keyring (service focustime, account google-client-secret)",
    });
  });
});

describe("access tokens from the stored refresh token", () => {
  it("refreshes once and reuses the access token from memory", async () => {
    const { client, tok } = ms({ keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    expect(tok.calls).toHaveLength(1);
    expect(tok.calls[0]!.body.get("grant_type")).toBe("refresh_token");
    expect(tok.calls[0]!.body.get("refresh_token")).toBe(FAKE_REFRESH);
  });

  it("stores a rotated refresh token (Microsoft rotates on use)", async () => {
    const { client, keyring } = ms({ refresh: "ok_rotate", keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    await client.accessToken();
    expect(keyring.store.get("outlook-refresh-token")).toBe(FAKE_REFRESH_ROTATED);
  });

  it("keeps the old refresh token when none comes back (Google)", async () => {
    const { client, keyring } = google({ keyring: memoryKeyring({ "google-client-secret": FAKE_CLIENT_SECRET, "google-refresh-token": FAKE_REFRESH }), refresh: "ok" });
    await client.accessToken();
    expect(keyring.store.get("google-refresh-token")).toBe(FAKE_REFRESH);
  });

  it.each<[string, Parameters<typeof ms>[0], string]>([
    ["never connected", { keyring: memoryKeyring() }, "not_connected"],
    ["expired or revoked refresh token", { refresh: "invalid_grant", keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) }, "expired"],
    ["offline", { refresh: "network", keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) }, "network"],
    ["app registration rejected", { refresh: "invalid_client", keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) }, "misconfigured"],
    ["keyring locked", { keyring: memoryKeyring({}, { locked: true }) }, "keyring"],
  ])("%s → %s", async (_label, opts, kind) => {
    const err = await ms(opts).client.accessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthFailure);
    expect((err as AuthFailure).kind).toBe(kind);
  });

  it("a refresh token from another client (Google's unauthorized_client) needs reconnecting, not a config fix", async () => {
    const { client } = google({ refresh: "unauthorized_client", keyring: memoryKeyring({ "google-client-secret": FAKE_CLIENT_SECRET, "google-refresh-token": FAKE_REFRESH }) });
    const err = await client.accessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthFailure);
    expect((err as AuthFailure).kind).toBe("expired");
    expect((err as AuthFailure).message).toMatch(/needs reconnecting/);
  });

  it("disconnect clears only this source's refresh token and the in-memory token", async () => {
    const keyring = memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH, "google-refresh-token": "other", "dataverse-client-secret": "dv" });
    const { client, tok } = ms({ keyring });
    await client.accessToken();
    await client.disconnect();
    expect([...keyring.store.keys()].sort()).toEqual(["dataverse-client-secret", "google-refresh-token"]);
    await expect(client.accessToken()).rejects.toMatchObject({ kind: "not_connected" });
    expect(tok.calls).toHaveLength(1);
  });
});

describe("write access (step 12, optional)", () => {
  const READ = "Calendars.ReadBasic";
  it("a read-only sign-in reports read_only and reading keeps working, untouched", async () => {
    const { client, tok, keyring } = ms({ consented: [READ], keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    const w = await client.writeAccess();
    expect(w.status).toBe("read_only");
    expect(w.status !== "write" && w.message).toMatch(/Reconnect Outlook in Settings > Connections/);
    expect(w.status !== "write" && w.message).not.toContain(FAKE_REFRESH);
    // Reads still come from memory, and the stored refresh token is unchanged.
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    expect(tok.calls.filter((c) => c.body.get("scope")?.includes(READ))).toHaveLength(1);
    expect(keyring.store.get("outlook-refresh-token")).toBe(FAKE_REFRESH);
    await expect(client.accessToken("write")).rejects.toBeInstanceOf(AuthFailure);
  });

  it("reads never ask for the write scope", async () => {
    const { client, tok } = ms({ keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    await client.accessToken();
    expect(tok.calls.every((c) => !c.body.get("scope")!.includes("ReadWrite"))).toBe(true);
  });

  it("connect with write asks for both scopes; then write and read tokens are separate", async () => {
    const { client, tok, browser } = ms({ consented: [READ] });
    expect(await client.connect({ write: true })).toMatchObject({ status: "connected" });
    const asked = browser.seen[0]!.searchParams.get("scope")!.split(" ");
    expect(asked).toEqual(expect.arrayContaining(["offline_access", "https://graph.microsoft.com/Calendars.ReadBasic", "https://graph.microsoft.com/Calendars.ReadWrite"]));
    expect(await client.writeAccess()).toEqual({ status: "write" });
    expect(await client.accessToken("write")).toBe(`${FAKE_ACCESS}-W`);
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    const refreshes = tok.calls.filter((c) => c.body.get("grant_type") === "refresh_token").map((c) => c.body.get("scope"));
    expect(refreshes).toEqual(["offline_access https://graph.microsoft.com/Calendars.ReadWrite", "offline_access https://graph.microsoft.com/Calendars.ReadBasic"]);
  });

  it("a plain connect does not ask for write", async () => {
    const { client, browser } = ms({ consented: [READ] });
    await client.connect();
    expect(browser.seen[0]!.searchParams.get("scope")).toBe("openid profile email offline_access https://graph.microsoft.com/Calendars.ReadBasic");
    expect((await client.writeAccess()).status).toBe("read_only");
  });

  it("a token granted without Calendars.ReadWrite is not write access", async () => {
    const { client } = ms({ grantFewer: true, keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    expect((await client.writeAccess()).status).toBe("read_only");
  });

  it("not connected and offline are told apart", async () => {
    expect((await ms({ keyring: memoryKeyring() }).client.writeAccess()).status).toBe("not_connected");
    expect((await ms({ refresh: "network", keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) }).client.writeAccess()).status).toBe("unavailable");
  });

  it("Google has no write scope in FocusTime", async () => {
    const { client } = google({ keyring: memoryKeyring({ "google-client-secret": FAKE_CLIENT_SECRET, "google-refresh-token": FAKE_REFRESH }) });
    expect((await client.writeAccess()).status).toBe("read_only");
  });
});

describe("oauth never leaks", () => {
  it.each<TokenBehavior>(["ok", "ok_rotate", "invalid_grant", "invalid_client", "network", "no_refresh_token"])("%s: tokens, code and secret stay out of logs, results and errors", async (b) => {
    const out: string[] = [];
    const m = ms({ exchange: b, refresh: b });
    out.push(JSON.stringify(await m.client.connect()));
    await m.client.accessToken().then((t) => out.push(t === FAKE_ACCESS ? "<access>" : "?"), (e: unknown) => out.push(String(e), (e as Error).stack ?? ""));
    const g = google({ exchange: b, refresh: b });
    out.push(JSON.stringify(await g.client.connect()));
    await g.client.accessToken().catch((e: unknown) => out.push(String(e), (e as Error).stack ?? ""));
    const all = [...out, JSON.stringify(m.logs)].join("\n");
    for (const s of [FAKE_REFRESH, FAKE_REFRESH_ROTATED, FAKE_ACCESS, FAKE_AUTH_CODE, FAKE_CLIENT_SECRET]) expect(all).not.toContain(s);
  });
});

describe("one Microsoft sign-in (step 15.4)", () => {
  const READ = "Calendars.ReadBasic";
  const ARM = "https://management.azure.com/user_impersonation";
  it("signs in once: the browser visit asks for OpenID, Graph and Azure; the code redeems Graph only; who signed in comes back", async () => {
    const { client, tok, browser, keyring } = ms({ consented: [] });
    const r = await client.connect({ azure: true });
    expect(r).toEqual({ status: "connected", identity: { oid: FAKE_PERSON.oid, tid: FAKE_PERSON.tid, name: "Pat Example", username: "pat@example.com", email: "pat@example.com" } });
    expect(browser.seen[0]!.searchParams.get("scope")!.split(" ")).toEqual(["openid", "profile", "email", "offline_access", "https://graph.microsoft.com/Calendars.ReadBasic", ARM]);
    expect(browser.seen[0]!.searchParams.get("prompt")).toBe("select_account");
    // One resource per token request (AADSTS28000 otherwise).
    expect(tok.calls[0]!.body.get("scope")).not.toContain("management.azure.com");
    expect(keyring.store.get("outlook-refresh-token")).toBe(FAKE_REFRESH);
    // The Azure token is redeemed later from the same refresh token, on its own.
    expect(await client.accessToken("arm")).toBe(FAKE_ACCESS);
    expect(tok.calls.at(-1)!.body.get("scope")).toBe(`offline_access ${ARM}`);
    expect(await client.identity()).toMatchObject({ username: "pat@example.com" });
  });

  it("an older Outlook sign-in keeps working and learns who it is without a new consent", async () => {
    const { client, tok, browser } = ms({ consented: [READ], keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    expect(await client.identity()).toMatchObject({ oid: FAKE_PERSON.oid, name: "Pat Example" });
    expect(tok.calls.at(-1)!.body.get("scope")).toBe("openid profile email offline_access https://graph.microsoft.com/Calendars.ReadBasic");
    expect(browser.seen).toHaveLength(0);
  });

  it("Azure not consented yet: the token says consent (an incremental sign-in fixes it), reading is untouched", async () => {
    const { client, browser } = ms({ consented: [READ], keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    await expect(client.accessToken("arm")).rejects.toMatchObject({ kind: "consent" });
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    // Incremental consent: the same account prefilled, no account picker, Azure added.
    expect(await client.connect({ azure: true, loginHint: "pat@example.com" })).toMatchObject({ status: "connected" });
    const u = browser.seen[0]!;
    expect(u.searchParams.get("login_hint")).toBe("pat@example.com");
    expect(u.searchParams.get("prompt")).toBeNull();
    expect(u.searchParams.get("scope")).toContain(ARM);
    expect(await client.accessToken("arm")).toBe(FAKE_ACCESS);
  });

  it("step 16.3: Teams presence is its own token; not consented is consent, and Allow Teams status adds it to the Graph scopes", async () => {
    const { client, browser, tok } = ms({ consented: [READ], keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    await expect(client.accessToken("presence")).rejects.toMatchObject({ kind: "consent" });
    expect(await client.accessToken()).toBe(FAKE_ACCESS);
    expect(await client.connect({ teams: true, loginHint: "pat@example.com" })).toMatchObject({ status: "connected" });
    const asked = browser.seen[0]!.searchParams.get("scope")!.split(" ");
    expect(asked).toEqual(expect.arrayContaining(["https://graph.microsoft.com/Presence.ReadWrite", "https://graph.microsoft.com/Presence.Read.All"]));
    expect(asked).not.toContain(ARM);
    // Graph scopes: the code exchange redeems them together.
    expect(tok.calls.at(-1)!.body.get("scope")).toContain("Presence.ReadWrite");
    expect(await client.accessToken("presence")).toMatch(new RegExp(`^${FAKE_ACCESS}`));
    expect(tok.calls.at(-1)!.body.get("scope")).toBe("offline_access https://graph.microsoft.com/Presence.ReadWrite https://graph.microsoft.com/Presence.Read.All");
  });

  it("MFA or consent asked by the tenant is a consent failure, never 'expired'", async () => {
    const { client } = ms({ interaction: true, keyring: memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH }) });
    await expect(client.accessToken("arm")).rejects.toMatchObject({ kind: "consent" });
    expect(needsInteraction({ error: "invalid_grant", error_codes: [65001] })).toBe(true);
    expect(needsInteraction({ error: "interaction_required" })).toBe(true);
    expect(needsInteraction({ error: "invalid_grant", error_codes: [70008] })).toBe(false);
  });

  it("sign out forgets who signed in along with the token", async () => {
    const { client, keyring } = ms({ consented: [] });
    await client.connect({ azure: true });
    await client.disconnect();
    expect(keyring.store.has("outlook-refresh-token")).toBe(false);
    await expect(client.identity()).rejects.toMatchObject({ kind: "not_connected" });
  });

  it("ID tokens: keeps oid, tid, name, username and email; refuses anything malformed", () => {
    expect(parseIdToken(fakeIdToken())).toMatchObject({ oid: FAKE_PERSON.oid, email: "pat@example.com" });
    expect(parseIdToken(fakeIdToken({ oid: "x", tid: "y", preferred_username: "u@example.com" }))).toEqual({ oid: "x", tid: "y", name: "u@example.com", username: "u@example.com", email: null });
    expect(parseIdToken(fakeIdToken({ tid: "y", preferred_username: "u@example.com" }))).toBeNull();
    expect(parseIdToken("not.a-token")).toBeNull();
    expect(parseIdToken("a.b")).toBeNull();
    expect(workEmail({ oid: "o", tid: "t", name: "n", username: "Pat@Example.com", email: null })).toBe("pat@example.com");
    expect(workEmail({ oid: "o", tid: "t", name: "n", username: "pat", email: null })).toBeNull();
  });
});

describe("web sign-in (A2: the server's own routes, no loopback)", () => {
  const REDIRECT = "http://localhost:5317/auth/google/callback";
  function web(opts: { exchange?: TokenBehavior } = {}) {
    const tok = fakeTokenEndpoint(G_TOKEN, opts);
    const keyring = memoryKeyring({ "google-client-secret": FAKE_CLIENT_SECRET });
    const logs: LogRecord[] = [];
    const client = createOAuthClient(googleProvider({ clientId: G_CLIENT, calendars: ["primary"] }), {
      fetch: tok.fetch, keyring, openBrowser: async () => { throw new Error("no browser on the server"); }, log: (r) => logs.push(r),
      web: { login: () => "/auth/google/login", redirectUri: REDIRECT },
    });
    return { client, tok, keyring, logs };
  }

  it("connect sends this tab to the server's login route", async () => {
    expect(await web().client.connect()).toEqual({ status: "redirect", url: "/auth/google/login" });
  });

  it("start then finish: PKCE S256 to the web redirect, the code redeemed with the client secret, the refresh token kept", async () => {
    const { client, tok, keyring, logs } = web();
    const { url, pending } = await client.webStart();
    const auth = new URL(url);
    expect(auth.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(auth.searchParams.get("state")).toBe(pending.state);
    expect(auth.searchParams.get("code_challenge")).toBe(createHash("sha256").update(pending.verifier).digest("base64url"));
    expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events.readonly");
    expect(url).not.toContain(pending.verifier);
    const r = await client.webFinish(new URL(`${REDIRECT}?code=${FAKE_AUTH_CODE}&state=${pending.state}`), pending);
    expect(r).toEqual({ status: "connected" });
    const body = tok.calls[0]!.body;
    expect(body.get("redirect_uri")).toBe(REDIRECT);
    expect(body.get("code_verifier")).toBe(pending.verifier);
    expect(body.get("client_secret")).toBe(FAKE_CLIENT_SECRET);
    expect(keyring.store.get("google-refresh-token")).toBe(FAKE_REFRESH);
    expect(JSON.stringify(logs)).not.toContain(FAKE_REFRESH);
    expect(JSON.stringify(logs)).not.toContain(FAKE_AUTH_CODE);
  });

  it("a refusal or a failed exchange keeps nothing", async () => {
    const a = web();
    const { pending } = await a.client.webStart();
    expect(await a.client.webFinish(new URL(`${REDIRECT}?error=access_denied&state=${pending.state}`), pending)).toMatchObject({ status: "cancelled" });
    const b = web({ exchange: "invalid_grant" });
    const p2 = (await b.client.webStart()).pending;
    expect(await b.client.webFinish(new URL(`${REDIRECT}?code=x&state=${p2.state}`), p2)).toMatchObject({ status: "failed" });
    expect(a.keyring.store.has("google-refresh-token") || b.keyring.store.has("google-refresh-token")).toBe(false);
  });

  it("a confidential Microsoft client sends its secret from the named account", async () => {
    const tok = fakeTokenEndpoint(MS_TOKEN, {});
    const keyring = memoryKeyring({ "entra-client-secret": "FAKE-ENTRA-SECRET", "outlook-refresh-token": FAKE_REFRESH });
    const client = createOAuthClient(microsoftProvider({ tenantId: TENANT, clientId: MS_CLIENT }), {
      fetch: tok.fetch, keyring, openBrowser: async () => {}, log: () => {}, clientSecretAccount: "entra-client-secret",
      web: { login: () => "/auth/microsoft/login", redirectUri: "http://localhost:5317/auth/microsoft/callback" },
    });
    await client.accessToken();
    expect(tok.calls[0]!.body.get("client_secret")).toBe("FAKE-ENTRA-SECRET");
  });
});

describe("the web registration's calendar scope (A2)", () => {
  it("reads and identity ask for Calendars.ReadWrite, which the FocusTime registration grants (not ReadBasic)", () => {
    const web = microsoftProvider({ tenantId: TENANT, clientId: MS_CLIENT }, { calendars: "Calendars.ReadWrite" });
    expect(web.scope).toBe("offline_access https://graph.microsoft.com/Calendars.ReadWrite");
    expect(web.kinds?.id).toBe("openid profile email offline_access https://graph.microsoft.com/Calendars.ReadWrite");
    expect(`${web.scope} ${web.kinds?.id}`).not.toContain("ReadBasic");
    // The old registration is unchanged.
    expect(microsoftProvider({ tenantId: TENANT, clientId: MS_CLIENT }).scope).toBe("offline_access https://graph.microsoft.com/Calendars.ReadBasic");
  });

  it("every scope the web client asks for is one the registration script grants", async () => {
    const { readFileSync } = await import("node:fs");
    const script = readFileSync(new URL("../../infra/scripts/app-registration.sh", import.meta.url), "utf8");
    const granted = new Set((/GRAPH_SCOPES=\(([^)]*)\)/.exec(script)?.[1] ?? "").split(/\s+/).filter(Boolean));
    const arm = new Set((/ARM_SCOPES=\(([^)]*)\)/.exec(script)?.[1] ?? "").split(/\s+/).filter(Boolean));
    const web = microsoftProvider({ tenantId: TENANT, clientId: MS_CLIENT }, { calendars: "Calendars.ReadWrite" });
    // AP-1 (D490): Chat.Read isn't on the registration: each person allows it when they switch Read for asks on.
    const asked = [web.scope, web.writeScope, ...Object.entries(web.kinds ?? {}).filter(([k]) => k !== "messages").map(([, v]) => v)].join(" ").split(" ").filter(Boolean);
    for (const s of asked) {
      const name = s.split("/").pop()!;
      if (s.startsWith("https://management.azure.com/")) expect(arm.has(name), s).toBe(true);
      else expect(granted.has(name), s).toBe(true);
    }
  });
});

describe("Chat.Read is asked for by each person (AP-1, D490)", () => {
  it("is its own token kind, and the registration script doesn't grant it", async () => {
    const { readFileSync } = await import("node:fs");
    const script = readFileSync(new URL("../../infra/scripts/app-registration.sh", import.meta.url), "utf8");
    const web = microsoftProvider({ tenantId: TENANT, clientId: MS_CLIENT }, { calendars: "Calendars.ReadWrite" });
    expect(web.kinds?.messages).toBe("offline_access https://graph.microsoft.com/Chat.Read");
    expect(/GRAPH_SCOPES=\(([^)]*)\)/.exec(script)?.[1] ?? "").not.toMatch(/\bChat\.Read\b(?!Basic)/);
  });
});
