// Microsoft sign-in (A2): OpenID Connect authorization code flow against one Entra tenant (single tenant), as a
// confidential client (client secret from the host's secret store) with PKCE, state and nonce. The library
// (openid-client, MIT) fetches the tenant's discovery document and keys, redeems the code, and validates the ID token
// (signature against the tenant's keys, with non-repudiation checks on; issuer, audience, expiry, nonce); FocusTime then checks the tenant id itself.
// Nothing here logs or returns tokens, codes, secrets or provider error descriptions.
import { guestToken } from "../../plan/person-match.ts";
import * as oidc from "openid-client";
import type { Logger } from "../../log/logger.ts";
import { groupsOf, type SignInGroups } from "../../actions/admin.ts";

/** Graph with every permission the tenant consented to (one token), plus who signed in and a refresh token. */
export const SIGN_IN_SCOPE = "openid profile email offline_access https://graph.microsoft.com/.default";
/**
 * AP-1 (D490): incremental consents, each a scope that isn't on the app registration, asked for on its own (Entra
 * doesn't mix .default with named scopes of the same resource). The refresh token that comes back serves every scope
 * the person has allowed.
 */
export const CONSENTS = {
  chat_read: "openid profile email offline_access https://graph.microsoft.com/Chat.Read",
  // LP-1: Close the loop's sends, each the first time a person sends that way.
  teams_send: "openid profile email offline_access https://graph.microsoft.com/ChatMessage.Send https://graph.microsoft.com/Chat.Create",
  mail_draft: "openid profile email offline_access https://graph.microsoft.com/Mail.ReadWrite",
  mail_send: "openid profile email offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send",
} as const;
/** Where a consent comes back to: Settings › Clients for chat reading, the Inbox for a send (LP-1). */
export const CONSENT_RETURN: Record<keyof typeof CONSENTS, string> = { chat_read: "#/settings/clients", teams_send: "#/inbox", mail_draft: "#/inbox", mail_send: "#/inbox" };
export type Consent = keyof typeof CONSENTS;

export type EntraOptions = {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  clientSecret: () => Promise<string>;
  log: Logger;
  /** Tests: the fake identity provider. */
  fetch?: oidc.CustomFetch;
  /** Tests: another issuer than https://login.microsoftonline.com/<tenant>/v2.0. */
  issuer?: string;
};

/** What a started sign-in keeps (server side, until the callback): never sent to the browser except `state`. */
export type PendingSignIn = { state: string; nonce: string; verifier: string };

/** Who signed in, from the validated ID token. */
/** ADM-1: `groups` is what the groups claim said (admin membership); used once at sign-in, never stored. */
/** `guest`: why the ID token is a B2B guest's (ADM-2, from the token alone: plan/person-match.ts guestToken), or absent for a member. */
export type SignedIn = { oid: string; tid: string; upn: string; name: string; email: string | null; groups?: SignInGroups; guest?: "acct" | "idp" | "upn" | null };

export type SignInTokens = { refreshToken: string; accessToken: string; expiresIn: number; scope: string };

/** Why a sign-in didn't complete, in words the sign-in page can show. Never carries provider text. */
export type SignInFailure = "denied" | "wrong_tenant" | "invalid" | "unavailable" | "misconfigured";
export class SignInError extends Error {
  readonly reason: SignInFailure;
  constructor(reason: SignInFailure) {
    super(`Sign-in failed: ${reason}`);
    this.name = "SignInError";
    this.reason = reason;
  }
}

export function createEntraSignIn(o: EntraOptions) {
  const issuer = o.issuer ?? `https://login.microsoftonline.com/${o.tenantId}/v2.0`;
  let config: Promise<oidc.Configuration> | null = null;

  /** The tenant's discovery document, fetched once (again after a failure). */
  function configuration(): Promise<oidc.Configuration> {
    if (!config) {
      config = (async () => {
        const secret = await o.clientSecret().catch(() => {
          throw new SignInError("misconfigured");
        });
        const c = await oidc.discovery(new URL(issuer), o.clientId, undefined, oidc.ClientSecretPost(secret), o.fetch ? { [oidc.customFetch]: o.fetch } : undefined);
        // The library trusts TLS for an ID token from the token endpoint by default; also check its signature
        // against the tenant's published keys (jwks_uri).
        oidc.enableNonRepudiationChecks(c);
        return c;
      })();
      config.catch(() => (config = null));
    }
    return config;
  }

  /** Where to send the browser, and what to keep until it comes back. */
  async function start(opts: { loginHint?: string; consent?: Consent } = {}): Promise<{ url: string; pending: PendingSignIn }> {
    let c: oidc.Configuration;
    try {
      c = await configuration();
    } catch (e) {
      o.log({ source: "auth", op: "discovery", kind: e instanceof SignInError ? e.reason : "unavailable" });
      throw e instanceof SignInError ? e : new SignInError("unavailable");
    }
    const pending: PendingSignIn = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier() };
    const params: Record<string, string> = {
      redirect_uri: o.redirectUri,
      scope: opts.consent ? CONSENTS[opts.consent] : SIGN_IN_SCOPE,
      response_type: "code",
      response_mode: "query",
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(pending.verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    };
    if (opts.loginHint) {
      params.login_hint = opts.loginHint;
      delete params.prompt;
    }
    o.log({ source: "auth", op: opts.consent ? "consent_started" : "sign_in_started", ...(opts.consent ? { kind: opts.consent } : {}) });
    return { url: oidc.buildAuthorizationUrl(c, params).href, pending };
  }

  /** Redeems the callback: the code for tokens, the ID token validated, the tenant checked. */
  async function finish(callbackUrl: URL, pending: PendingSignIn): Promise<{ user: SignedIn; tokens: SignInTokens }> {
    if (callbackUrl.searchParams.get("error")) {
      const denied = callbackUrl.searchParams.get("error") === "access_denied";
      o.log({ source: "auth", op: "sign_in", kind: denied ? "denied" : "provider_error" });
      throw new SignInError(denied ? "denied" : "invalid");
    }
    let c: oidc.Configuration;
    try {
      c = await configuration();
    } catch {
      throw new SignInError("unavailable");
    }
    let t: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    const started = performance.now();
    try {
      t = await oidc.authorizationCodeGrant(c, callbackUrl, { pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce, idTokenExpected: true });
    } catch (e) {
      // The library's errors can quote the provider; only their class is logged.
      const kind = e instanceof oidc.ResponseBodyError ? "token_refused" : e instanceof TypeError ? "unavailable" : "invalid";
      o.log({ source: "auth", op: "token_exchange", kind });
      throw new SignInError(kind === "unavailable" ? "unavailable" : "invalid");
    }
    o.log({ source: "auth", op: "token_exchange", status: 200, durationMs: performance.now() - started });
    const claims = t.claims();
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const oid = str(claims?.oid);
    const tid = str(claims?.tid).toLowerCase();
    if (!claims || !oid) throw new SignInError("invalid");
    // Single tenant: the issuer check already pins the tenant; the claim is checked as well.
    if (tid !== o.tenantId.toLowerCase()) {
      o.log({ source: "auth", op: "sign_in", kind: "wrong_tenant" });
      throw new SignInError("wrong_tenant");
    }
    if (!t.refresh_token || !t.access_token) throw new SignInError("invalid");
    const upn = str(claims.preferred_username) || str(claims.upn) || str(claims.email);
    const email = str(claims.email) || (upn.includes("@") ? upn : "") || null;
    const guest = guestToken(claims as Record<string, unknown>);
    o.log({ source: "auth", op: "sign_in", kind: guest ? "guest_token" : "signed_in" });
    return {
      user: { oid, tid, upn, name: str(claims.name) || upn, email: email ? email.toLowerCase() : null, groups: groupsOf(claims as Record<string, unknown>), guest },
      tokens: { refreshToken: t.refresh_token, accessToken: t.access_token, expiresIn: typeof t.expires_in === "number" ? t.expires_in : 3599, scope: typeof t.scope === "string" ? t.scope : "" },
    };
  }

  return { start, finish, issuer };
}
