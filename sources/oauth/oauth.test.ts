import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { createOAuthClient, microsoftProvider, googleProvider, AuthFailure } from "./oauth.ts";
import {
  FAKE_ACCESS, FAKE_AUTH_CODE, FAKE_CLIENT_SECRET, FAKE_REFRESH, FAKE_REFRESH_ROTATED,
  fakeBrowser, fakeTokenEndpoint, memoryKeyring, type TokenBehavior,
} from "./test-fakes.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const MS_CLIENT = "44444444-4444-4444-8444-444444444444";
const MS_TOKEN = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const G_CLIENT = "123-abc.apps.googleusercontent.com";
const G_TOKEN = "https://oauth2.googleapis.com/token";

function ms(opts: { exchange?: TokenBehavior; refresh?: TokenBehavior; keyring?: ReturnType<typeof memoryKeyring>; browser?: ReturnType<typeof fakeBrowser>; signInTimeoutMs?: number } = {}) {
  const tok = fakeTokenEndpoint(MS_TOKEN, opts);
  const keyring = opts.keyring ?? memoryKeyring();
  const browser = opts.browser ?? fakeBrowser({ kind: "approve" });
  const logs: LogRecord[] = [];
  const client = createOAuthClient(microsoftProvider({ tenantId: TENANT, clientId: MS_CLIENT }), {
    fetch: tok.fetch, keyring, openBrowser: browser.open, log: (r) => logs.push(r), signInTimeoutMs: opts.signInTimeoutMs ?? 2000,
  });
  return { client, tok, keyring, browser, logs };
}

function google(opts: { exchange?: TokenBehavior; refresh?: TokenBehavior; keyring?: ReturnType<typeof memoryKeyring> } = {}) {
  const tok = fakeTokenEndpoint(G_TOKEN, opts);
  const keyring = opts.keyring ?? memoryKeyring({ "google-client-secret": FAKE_CLIENT_SECRET });
  const browser = fakeBrowser({ kind: "approve" });
  const client = createOAuthClient(googleProvider({ clientId: G_CLIENT, calendars: ["primary"] }), {
    fetch: tok.fetch, keyring, openBrowser: browser.open, log: () => {}, signInTimeoutMs: 2000,
  });
  return { client, tok, keyring, browser };
}

describe("sign-in (auth code + PKCE over loopback)", () => {
  it("Microsoft: sends a PKCE S256 challenge, redirects to localhost, stores the refresh token", async () => {
    const { client, tok, keyring, browser } = ms();
    expect(await client.connect()).toEqual({ status: "connected" });

    const auth = browser.seen[0]!;
    expect(auth.origin + auth.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(auth.searchParams.get("client_id")).toBe(MS_CLIENT);
    expect(auth.searchParams.get("response_type")).toBe("code");
    expect(auth.searchParams.get("scope")).toBe("offline_access https://graph.microsoft.com/Calendars.ReadBasic");
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
    expect(await client.connect()).toEqual({ status: "connected" });
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
    expect(await client.connect()).toEqual({ status: "connected" });
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
      message: "No Google client secret in the keyring (service coopilot, account google-client-secret)",
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
