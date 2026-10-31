// Delegated sign-in for Outlook and Google: authorization code + PKCE (S256) over a one-shot
// loopback listener on 127.0.0.1. Refresh tokens live only in the keyring; access tokens only in memory.
// Nothing here logs or returns tokens, codes, secrets or provider error descriptions.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { GoogleConfig, OutlookConfig } from "../../config/schema.ts";
import type { Logger } from "../../log/logger.ts";
import { SecretError, type AppSecretAccount, type RefreshTokenAccount, type SecretAccount } from "../../secrets/keyring.ts";

export type OAuthProvider = {
  source: "outlook" | "google";
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  /** Microsoft matches http://localhost with any port; Google wants the IP literal. */
  redirectHost: "localhost" | "127.0.0.1";
  extraAuthParams: Record<string, string>;
  /** Microsoft wants the scope repeated on token requests. */
  scopeOnTokenRequests: boolean;
  clientSecretAccount?: AppSecretAccount;
  refreshAccount: RefreshTokenAccount;
};

export function microsoftProvider(cfg: OutlookConfig): OAuthProvider {
  const base = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0`;
  return {
    source: "outlook",
    label: "Outlook",
    authorizeUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
    clientId: cfg.clientId,
    scope: "offline_access https://graph.microsoft.com/Calendars.ReadBasic",
    redirectHost: "localhost",
    extraAuthParams: { response_mode: "query", prompt: "select_account" },
    scopeOnTokenRequests: true,
    refreshAccount: "outlook-refresh-token",
  };
}

export function googleProvider(cfg: GoogleConfig): OAuthProvider {
  return {
    source: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: cfg.clientId,
    scope: "https://www.googleapis.com/auth/calendar.events.readonly",
    redirectHost: "127.0.0.1",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    scopeOnTokenRequests: false,
    clientSecretAccount: "google-client-secret",
    refreshAccount: "google-refresh-token",
  };
}

export type AuthFailureKind = "not_connected" | "expired" | "network" | "misconfigured" | "keyring" | "error";

/** A safe, plain-language auth failure. Never carries tokens or provider error text. */
export class AuthFailure extends Error {
  readonly kind: AuthFailureKind;
  constructor(kind: AuthFailureKind, message: string) {
    super(message);
    this.name = "AuthFailure";
    this.kind = kind;
  }
}

export type Keyring = {
  get: (a: SecretAccount) => Promise<string>;
  set: (a: RefreshTokenAccount, v: string) => Promise<void>;
  delete: (a: RefreshTokenAccount) => Promise<void>;
};

export type OAuthDeps = {
  fetch: typeof fetch;
  keyring: Keyring;
  openBrowser: (url: string) => Promise<void>;
  log: Logger;
  now?: () => number;
  timeoutMs?: number;
  signInTimeoutMs?: number;
};

export type ConnectResult = { status: "connected" } | { status: "cancelled" | "failed"; message: string };

const DONE_PAGE = (ok: boolean) => `<!doctype html><meta charset="utf-8"><title>Coopilot</title>
<body style="font:16px system-ui;padding:40px;max-width:560px">
<h1 style="font-size:20px">${ok ? "Signed in" : "Sign-in not completed"}</h1>
<p>${ok ? "You can close this tab and go back to Coopilot." : "You can close this tab. Coopilot will show what happened."}</p>`;

export function createOAuthClient(p: OAuthProvider, deps: OAuthDeps) {
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? 20_000;
  let access: { token: string; expiresAt: number } | null = null;
  const log = (op: string, extra: { status?: number; kind?: string; durationMs?: number } = {}) => deps.log({ source: p.source, op, ...extra });

  async function clientSecret(): Promise<string | undefined> {
    if (!p.clientSecretAccount) return undefined;
    try {
      return await deps.keyring.get(p.clientSecretAccount);
    } catch (e) {
      if (e instanceof SecretError && e.kind === "not_found")
        throw new AuthFailure("misconfigured", `No ${p.label} client secret in the keyring (service coopilot, account ${p.clientSecretAccount})`);
      throw new AuthFailure("keyring", "Secret storage unavailable (Secret Service). Unlock the keyring and retry");
    }
  }

  /** POST to the token endpoint. Reads only access_token, refresh_token, expires_in and the error code. */
  async function tokenRequest(op: string, params: Record<string, string>) {
    const secret = await clientSecret();
    const body = new URLSearchParams({ client_id: p.clientId, ...params });
    if (secret) body.set("client_secret", secret);
    if (p.scopeOnTokenRequests) body.set("scope", p.scope);
    const started = performance.now();
    let res: Response;
    try {
      res = await deps.fetch(p.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      log(op, { kind: "network" });
      throw new AuthFailure("network", `${p.label} unreachable`);
    }
    log(op, { status: res.status, durationMs: performance.now() - started });
    const json = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown };
    if (!res.ok || typeof json.access_token !== "string") {
      if (json.error === "invalid_grant") throw new AuthFailure("expired", `${p.label} needs reconnecting`);
      if (json.error === "invalid_client" || json.error === "unauthorized_client" || json.error === "invalid_request")
        throw new AuthFailure("misconfigured", `${p.label} sign-in was rejected: check ${p.source}.client_id in config`);
      throw new AuthFailure("error", `${p.label} sign-in failed (HTTP ${res.status})`);
    }
    access = { token: json.access_token, expiresAt: now() + (typeof json.expires_in === "number" ? json.expires_in : 3599) * 1000 };
    return { refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null };
  }

  async function storeRefresh(token: string) {
    try {
      await deps.keyring.set(p.refreshAccount, token);
    } catch {
      throw new AuthFailure("keyring", "Secret storage unavailable (Secret Service). Unlock the keyring and retry");
    }
  }

  async function accessToken(): Promise<string> {
    if (access && access.expiresAt - 5 * 60_000 > now()) return access.token;
    let refresh: string;
    try {
      refresh = await deps.keyring.get(p.refreshAccount);
    } catch (e) {
      if (e instanceof SecretError && e.kind === "not_found") throw new AuthFailure("not_connected", `${p.label} is not connected yet`);
      throw new AuthFailure("keyring", "Secret storage unavailable (Secret Service). Unlock the keyring and retry");
    }
    const r = await tokenRequest("token_refresh", { grant_type: "refresh_token", refresh_token: refresh });
    if (r.refreshToken && r.refreshToken !== refresh) await storeRefresh(r.refreshToken);
    return access!.token;
  }

  /** Wait for the browser to come back to the loopback listener with our state. */
  function waitForCode(server: Server, port: number, state: string): Promise<{ code: string } | { error: "denied" | "timeout" | "failed" }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: "timeout" }), deps.signInTimeoutMs ?? 5 * 60_000);
      const allowedHosts = [`${p.redirectHost}:${port}`, `127.0.0.1:${port}`];
      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", "http://placeholder");
        if (!allowedHosts.includes(String(req.headers.host ?? "").toLowerCase())) {
          res.writeHead(403).end();
          return;
        }
        if (req.method !== "GET" || url.pathname !== "/" || url.searchParams.get("state") !== state) {
          res.writeHead(400, { "content-type": "text/plain" }).end("Unexpected request");
          return;
        }
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
        res.end(DONE_PAGE(!!code));
        clearTimeout(timer);
        if (code) resolve({ code });
        else resolve({ error: error === "access_denied" ? "denied" : "failed" });
      });
    });
  }

  async function connect(): Promise<ConnectResult> {
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(24).toString("base64url");
    const server = createServer();
    try {
      // Fail early if the client secret (Google) is missing, before opening the browser.
      await clientSecret();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const port = (server.address() as AddressInfo).port;
      const redirectUri = `http://${p.redirectHost}:${port}/`;
      const auth = new URL(p.authorizeUrl);
      const params: Record<string, string> = {
        client_id: p.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: p.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...p.extraAuthParams,
      };
      for (const [k, v] of Object.entries(params)) auth.searchParams.set(k, v);

      const waiting = waitForCode(server, port, state);
      log("sign_in_started");
      await deps.openBrowser(auth.toString());
      const result = await waiting;
      if ("error" in result) {
        log("sign_in", { kind: result.error });
        if (result.error === "denied") return { status: "cancelled", message: "Sign-in was cancelled" };
        if (result.error === "timeout") return { status: "cancelled", message: "Sign-in timed out" };
        return { status: "failed", message: `${p.label} sign-in failed` };
      }

      const r = await tokenRequest("token_exchange", { grant_type: "authorization_code", code: result.code, redirect_uri: redirectUri, code_verifier: verifier });
      if (!r.refreshToken) {
        access = null;
        return { status: "failed", message: "Sign-in did not return a refresh token" };
      }
      await storeRefresh(r.refreshToken);
      log("sign_in", { kind: "connected" });
      return { status: "connected" };
    } catch (e) {
      access = null;
      return { status: "failed", message: e instanceof AuthFailure ? e.message : `${p.label} sign-in failed` };
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  async function disconnect(): Promise<void> {
    access = null;
    await deps.keyring.delete(p.refreshAccount);
  }

  return { provider: p, connect, accessToken, disconnect, invalidate: () => (access = null) };
}

export type OAuthClient = ReturnType<typeof createOAuthClient>;
