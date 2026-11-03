// Delegated sign-in for Outlook and Google: authorization code + PKCE (S256) over the host's one-shot
// redirect listener (host/local: a loopback on 127.0.0.1). Refresh tokens live only in the keyring; access tokens only in memory.
// Nothing here logs or returns tokens, codes, secrets or provider error descriptions.
import { createHash, randomBytes } from "node:crypto";
import type { GoogleConfig, OutlookConfig } from "../../config/schema.ts";
import type { Logger } from "../../log/logger.ts";
import { parseIdToken, type IdClaims } from "./idtoken.ts";
import { SecretError, type AppSecretAccount, type Loopback, type LoopbackListener, type RefreshTokenAccount, type SecretAccount } from "../../host/types.ts";

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
  /**
   * Step 12: an optional write scope (Outlook Calendars.ReadWrite). Asked for only when connecting with write; its
   * access token is separate from the read token and kept in memory only. Reads never ask for it.
   */
  writeScope?: string;
  /**
   * Step 15.4: more scope sets on the same sign-in (Microsoft only). "id" is the read scope plus OpenID (openid profile
   * email), so a refresh returns an ID token with who signed in; "arm" is Azure Resource Manager (user_impersonation).
   * One token request covers one resource, so each set names one resource plus OpenID scopes.
   */
  kinds?: Partial<Record<"id" | "arm" | "presence" | "photo", string>>;
  clientSecretAccount?: AppSecretAccount;
  refreshAccount: RefreshTokenAccount;
};

/** OpenID scopes: who signed in (ID token claims), allowed alongside any one resource. */
export const OIDC = "openid profile email";
/** Azure Resource Manager, delegated (step 15.4): acts as the signed-in user, limited by their Azure RBAC. */
export const ARM_SCOPE = "https://management.azure.com/user_impersonation";
/** Teams presence (step 16.3): my own status during focus, and teammates' presence. Delegated, no admin consent. */
export const PRESENCE_SCOPE = "https://graph.microsoft.com/Presence.ReadWrite https://graph.microsoft.com/Presence.Read.All";
/** Profile photos (step 16.4): mine and teammates', read only. Delegated, but needs an admin's consent in Entra. */
export const PHOTO_SCOPE = "https://graph.microsoft.com/ProfilePhoto.Read.All";

export function microsoftProvider(cfg: OutlookConfig): OAuthProvider {
  const base = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0`;
  return {
    source: "outlook",
    label: "Outlook",
    authorizeUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
    clientId: cfg.clientId,
    scope: "offline_access https://graph.microsoft.com/Calendars.ReadBasic",
    writeScope: "offline_access https://graph.microsoft.com/Calendars.ReadWrite",
    kinds: { id: `${OIDC} offline_access https://graph.microsoft.com/Calendars.ReadBasic`, arm: `offline_access ${ARM_SCOPE}`, presence: `offline_access ${PRESENCE_SCOPE}`, photo: `offline_access ${PHOTO_SCOPE}` },
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

/** "consent": this scope needs an interactive sign-in first (not consented yet, or the tenant asks for MFA). */
export type AuthFailureKind = "not_connected" | "expired" | "consent" | "network" | "misconfigured" | "keyring" | "error";

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
  /** The host's sign-in redirect listener. Absent: signing in isn't available here. */
  loopback?: Loopback;
  log: Logger;
  now?: () => number;
  timeoutMs?: number;
  signInTimeoutMs?: number;
};

export type ConnectResult = { status: "connected"; identity?: IdClaims } | { status: "cancelled" | "failed"; message: string; /** Microsoft couldn't be reached (step 15.5, Q88: offline use). */ offline?: boolean };
export type ConnectOptions = {
  /** Calendar changes (step 12). */
  write?: boolean;
  /** Azure Resource Manager (step 15.4): asked for in the same browser visit, redeemed later on its own. */
  azure?: boolean;
  /** Teams presence (step 16.3): Graph scopes, so they are part of the Graph token the code exchange redeems. */
  teams?: boolean;
  /** Profile photos (step 16.4): a Graph scope, part of the Graph token the code exchange redeems. */
  photos?: boolean;
  /** Prefills the account (an incremental consent for someone already signed in). */
  loginHint?: string;
};
/** Whether this sign-in can write (step 12): "write" only when a write token was granted with the write scope. */
export type WriteAccess = { status: "write" } | { status: "read_only" | "not_connected" | "unavailable"; message: string };
type TokenKind = "read" | "write" | "id" | "arm" | "presence" | "photo";

const DONE_PAGE = (ok: boolean) => `<!doctype html><meta charset="utf-8"><title>FocusTime</title>
<body style="font:16px system-ui;padding:40px;max-width:560px">
<h1 style="font-size:20px">${ok ? "Signed in" : "Sign-in not completed"}</h1>
<p>${ok ? "You can close this tab and go back to FocusTime." : "You can close this tab. FocusTime will show what happened."}</p>`;

export function createOAuthClient(p: OAuthProvider, deps: OAuthDeps) {
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? 20_000;
  // One access token per scope set, memory only.
  const access = new Map<TokenKind, { token: string; expiresAt: number; scope: string }>();
  // Who signed in, from the last ID token (memory only; the caller keeps what it needs).
  let lastIdentity: IdClaims | null = null;
  const scopeOf = (k: TokenKind) => (k === "write" && p.writeScope ? p.writeScope : (k === "id" || k === "arm" || k === "presence" || k === "photo") && p.kinds?.[k] ? p.kinds[k]! : p.scope);
  const log = (op: string, extra: { status?: number; kind?: string; durationMs?: number } = {}) => deps.log({ source: p.source, op, ...extra });

  async function clientSecret(): Promise<string | undefined> {
    if (!p.clientSecretAccount) return undefined;
    try {
      return await deps.keyring.get(p.clientSecretAccount);
    } catch (e) {
      if (e instanceof SecretError && e.kind === "not_found")
        throw new AuthFailure("misconfigured", `No ${p.label} client secret in the keyring (service focustime, account ${p.clientSecretAccount})`);
      throw new AuthFailure("keyring", "Secret storage unavailable (Secret Service). Unlock the keyring and retry");
    }
  }

  /** POST to the token endpoint. Reads only access_token, refresh_token, expires_in and the error code. */
  async function tokenRequest(op: string, params: Record<string, string>, kind: TokenKind = "read", scope = scopeOf(kind)) {
    const secret = await clientSecret();
    const body = new URLSearchParams({ client_id: p.clientId, ...params });
    if (secret) body.set("client_secret", secret);
    if (p.scopeOnTokenRequests) body.set("scope", scope);
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
    const json = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown; scope?: unknown; id_token?: unknown; suberror?: unknown; error_codes?: unknown };
    if (!res.ok || typeof json.access_token !== "string") {
      // Only the error code, sub-error and numeric codes are read; the description can echo request values.
      if (needsInteraction(json)) throw new AuthFailure("consent", `${p.label} needs you to sign in again to allow this`);
      if (json.error === "invalid_grant") throw new AuthFailure("expired", `${p.label} needs reconnecting`);
      if (json.error === "invalid_client" || json.error === "unauthorized_client" || json.error === "invalid_request")
        throw new AuthFailure("misconfigured", `${p.label} sign-in was rejected: check ${p.source}.client_id in config`);
      throw new AuthFailure("error", `${p.label} sign-in failed (HTTP ${res.status})`);
    }
    if (typeof json.id_token === "string") lastIdentity = parseIdToken(json.id_token) ?? lastIdentity;
    // The granted scopes (Microsoft's non-standard field; absent means what was asked for).
    access.set(kind, { token: json.access_token, expiresAt: now() + (typeof json.expires_in === "number" ? json.expires_in : 3599) * 1000, scope: typeof json.scope === "string" ? json.scope : scope });
    return { refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null };
  }

  async function storeRefresh(token: string) {
    try {
      await deps.keyring.set(p.refreshAccount, token);
    } catch {
      throw new AuthFailure("keyring", "Secret storage unavailable (Secret Service). Unlock the keyring and retry");
    }
  }

  async function accessToken(kind: TokenKind = "read"): Promise<string> {
    const held = access.get(kind);
    if (held && held.expiresAt - 5 * 60_000 > now()) return held.token;
    let refresh: string;
    try {
      refresh = await deps.keyring.get(p.refreshAccount);
    } catch (e) {
      if (e instanceof SecretError && e.kind === "not_found") throw new AuthFailure("not_connected", `${p.label} is not connected yet`);
      throw new AuthFailure("keyring", "Secret storage unavailable (Secret Service). Unlock the keyring and retry");
    }
    const r = await tokenRequest("token_refresh", { grant_type: "refresh_token", refresh_token: refresh }, kind);
    if (r.refreshToken && r.refreshToken !== refresh) await storeRefresh(r.refreshToken);
    return access.get(kind)!.token;
  }

  /**
   * Can this sign-in write? Asks for a write token (memory only). A refusal means the write scope was never consented:
   * read-only, and reading is untouched (its token and the stored refresh token stay as they are).
   */
  async function writeAccess(): Promise<WriteAccess> {
    if (!p.writeScope) return { status: "read_only", message: `${p.label} is read-only in FocusTime` };
    try {
      await accessToken("write");
    } catch (e) {
      access.delete("write");
      if (e instanceof AuthFailure && e.kind === "not_connected") return { status: "not_connected", message: e.message };
      if (e instanceof AuthFailure && (e.kind === "network" || e.kind === "keyring")) return { status: "unavailable", message: e.message };
      return { status: "read_only", message: `FocusTime can't change your ${p.label} calendar yet. Reconnect ${p.label} in Settings > Connections and allow calendar changes` };
    }
    // Granted scopes come back as full URIs or bare names; compare the bare names.
    const bare = (x: string) => x.split("/").pop()!.toLowerCase();
    const granted = new Set((access.get("write")?.scope ?? "").split(" ").map(bare));
    if (!p.writeScope.split(" ").filter((x) => x !== "offline_access").every((w) => granted.has(bare(w)))) {
      access.delete("write");
      return { status: "read_only", message: `FocusTime can't change your ${p.label} calendar yet. Reconnect ${p.label} in Settings > Connections and allow calendar changes` };
    }
    return { status: "write" };
  }

  async function connect(opts: ConnectOptions = {}): Promise<ConnectResult> {
    // The browser visit asks for every scope set at once (it may span resources), so later refreshes for any of them
    // are a subset of what was consented. The code exchange redeems one resource: Graph, with OpenID for who it is.
    const join = (...sets: (string | undefined | false)[]) => [...new Set(sets.filter((x): x is string => !!x).flatMap((x) => x.split(" ")))].join(" ");
    const graph = join(p.kinds?.id, p.scope, opts.write && p.writeScope, opts.teams && p.kinds?.presence, opts.photos && p.kinds?.photo);
    const scope = join(graph, opts.azure && p.kinds?.arm);
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(24).toString("base64url");
    if (!deps.loopback) return { status: "failed", message: `${p.label} sign-in isn't available here` };
    let listener: LoopbackListener | null = null;
    try {
      // Fail early if the client secret (Google) is missing, before opening the browser.
      await clientSecret();
      listener = await deps.loopback.listen(p.redirectHost);
      const redirectUri = listener.redirectUri;
      const auth = new URL(p.authorizeUrl);
      const params: Record<string, string> = {
        client_id: p.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...p.extraAuthParams,
      };
      // Someone already signed in: prefill the account and skip the account picker.
      if (opts.loginHint) {
        params.login_hint = opts.loginHint;
        delete params.prompt;
      }
      for (const [k, v] of Object.entries(params)) auth.searchParams.set(k, v);

      const waiting = listener.wait(state, deps.signInTimeoutMs ?? 5 * 60_000, DONE_PAGE);
      log("sign_in_started");
      await deps.openBrowser(auth.toString());
      const result = await waiting;
      if ("error" in result) {
        log("sign_in", { kind: result.error });
        if (result.error === "denied") return { status: "cancelled", message: "Sign-in was cancelled" };
        if (result.error === "timeout") return { status: "cancelled", message: "Sign-in timed out" };
        return { status: "failed", message: `${p.label} sign-in failed` };
      }

      access.clear();
      lastIdentity = null;
      const r = await tokenRequest("token_exchange", { grant_type: "authorization_code", code: result.code, redirect_uri: redirectUri, code_verifier: verifier }, "read", graph);
      // The exchange token carries both scopes when write was asked for; reads ask for their own on refresh.
      access.clear();
      if (!r.refreshToken) {
        return { status: "failed", message: "Sign-in did not return a refresh token" };
      }
      await storeRefresh(r.refreshToken);
      log("sign_in", { kind: "connected" });
      return lastIdentity ? { status: "connected", identity: lastIdentity } : { status: "connected" };
    } catch (e) {
      access.clear();
      return e instanceof AuthFailure && e.kind === "network" ? { status: "failed", message: "Microsoft can't be reached. Check your connection", offline: true } : { status: "failed", message: e instanceof AuthFailure ? e.message : `${p.label} sign-in failed` };
    } finally {
      listener?.close();
    }
  }

  async function disconnect(): Promise<void> {
    access.clear();
    lastIdentity = null;
    await deps.keyring.delete(p.refreshAccount);
  }

  /**
   * Who is signed in (step 15.4): the claims from the last ID token, or a refresh with the OpenID scopes added. An
   * older sign-in (before step 15.4) gets its identity this way without a new consent: openid, profile and email
   * need none. Throws AuthFailure like accessToken.
   */
  async function identity(): Promise<IdClaims> {
    if (lastIdentity) return lastIdentity;
    if (!p.kinds?.id) throw new AuthFailure("error", `${p.label} sign-in has no identity`);
    access.delete("id");
    await accessToken("id");
    if (!lastIdentity) throw new AuthFailure("error", `${p.label} did not say who signed in`);
    return lastIdentity;
  }

  return { provider: p, connect, accessToken, writeAccess, identity, disconnect, invalidate: () => access.clear() };
}

export type OAuthClient = ReturnType<typeof createOAuthClient>;
export type { IdClaims };

/**
 * A token error that a browser sign-in fixes (incremental consent): consent_required or interaction_required, or
 * Entra's invalid_grant with sub-error consent_required or AADSTS65001 (consent) / 50076, 50079 (MFA).
 */
export function needsInteraction(json: { error?: unknown; suberror?: unknown; error_codes?: unknown }): boolean {
  if (json.error === "consent_required" || json.error === "interaction_required") return true;
  if (json.suberror === "consent_required") return true;
  const codes = Array.isArray(json.error_codes) ? json.error_codes : [];
  return codes.some((c) => c === 65001 || c === 50076 || c === 50079);
}
