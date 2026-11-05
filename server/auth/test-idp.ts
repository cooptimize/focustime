// A fake Entra for tests (A2): a discovery document, a JWKS with one RSA key, and a token endpoint that redeems the
// code it issued for an ID token signed with that key. Knobs make the answers wrong in the ways sign-in must refuse:
// another tenant, an expired token, a different nonce, a signature from another key. Test-only (never imported by
// server/main.ts); it signs tokens, it never reads one.
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

export const FAKE_TENANT = "11111111-2222-4333-8444-555555555555";
export const FAKE_CLIENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const FAKE_OID = "99999999-8888-4777-8666-555555555555";
export const FAKE_ISSUER = `https://login.example.test/${FAKE_TENANT}/v2.0`;
export const FAKE_SECRET = "fake-entra-client-secret";

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, jwk: { ...(publicKey.export({ format: "jwk" }) as object), kid: `k${Math.random().toString(36).slice(2, 8)}`, use: "sig", alg: "RS256" } as Record<string, string> };
}

function sign(key: KeyObject, kid: string, claims: Record<string, unknown>): string {
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64(JSON.stringify(claims));
  const s = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key);
  return `${head}.${body}.${b64(s)}`;
}

export type IdpKnobs = {
  tid?: string;
  oid?: string;
  upn?: string;
  name?: string;
  email?: string;
  /** Seconds from now the ID token expires (negative: already expired). */
  expiresIn?: number;
  /** Put this nonce in the ID token instead of the one asked for. */
  nonce?: string;
  /** Sign with a key that isn't in the JWKS. */
  foreignKey?: boolean;
  /** The token endpoint refuses the code. */
  refuse?: boolean;
  /** ADM-2: more claims in the ID token (acct, idp, upn for a guest). */
  claims?: Record<string, unknown>;
};

export function createFakeIdp(knobs: IdpKnobs = {}) {
  const key = keypair();
  const other = keypair();
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>();
  const seen: { tokenRequests: URLSearchParams[] } = { tokenRequests: [] };
  const k = knobs;

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/.well-known/openid-configuration"))
      return json(200, {
        issuer: FAKE_ISSUER,
        authorization_endpoint: `https://login.example.test/${FAKE_TENANT}/oauth2/v2.0/authorize`,
        token_endpoint: `https://login.example.test/${FAKE_TENANT}/oauth2/v2.0/token`,
        jwks_uri: `https://login.example.test/${FAKE_TENANT}/discovery/v2.0/keys`,
        response_types_supported: ["code"],
        subject_types_supported: ["pairwise"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname.endsWith("/discovery/v2.0/keys")) return json(200, { keys: [key.jwk] });
    if (url.pathname.endsWith("/oauth2/v2.0/token")) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      seen.tokenRequests.push(body);
      if (body.get("client_secret") !== FAKE_SECRET) return json(401, { error: "invalid_client" });
      if (body.get("grant_type") === "refresh_token") {
        if (body.get("refresh_token") !== "fake-refresh-token") return json(400, { error: "invalid_grant" });
        return json(200, { access_token: `fake-access:${body.get("scope") ?? ""}`, token_type: "Bearer", expires_in: 3599, scope: body.get("scope") ?? "", refresh_token: "fake-refresh-token" });
      }
      const c = codes.get(body.get("code") ?? "");
      if (k.refuse || !c) return json(400, { error: "invalid_grant" });
      codes.delete(body.get("code")!);
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: FAKE_ISSUER,
        aud: FAKE_CLIENT,
        iat: now - 5,
        nbf: now - 5,
        exp: now + (k.expiresIn ?? 3600),
        nonce: k.nonce ?? c.nonce,
        oid: k.oid ?? FAKE_OID,
        tid: k.tid ?? FAKE_TENANT,
        sub: "fake-sub",
        preferred_username: k.upn ?? "ana@cooptimize.example",
        name: k.name ?? "Ana Example",
        email: k.email ?? "ana@cooptimize.example",
        ver: "2.0",
        ...(k.claims ?? {}),
      };
      const signer = k.foreignKey ? other : key;
      return json(200, {
        access_token: "fake-graph-access",
        token_type: "Bearer",
        expires_in: 3599,
        scope: "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read",
        refresh_token: "fake-refresh-token",
        id_token: sign(signer.privateKey, signer.jwk.kid!, claims),
      });
    }
    return json(404, { error: "not_found" });
  };

  /** What Microsoft does after a good sign-in: the browser comes back to the redirect URI with a code and the state. */
  function approve(authorizeUrl: string): string {
    const u = new URL(authorizeUrl);
    const code = `code-${Math.random().toString(36).slice(2)}`;
    codes.set(code, { nonce: u.searchParams.get("nonce") ?? "", challenge: u.searchParams.get("code_challenge") ?? "", redirectUri: u.searchParams.get("redirect_uri") ?? "" });
    const back = new URL(u.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", u.searchParams.get("state") ?? "");
    return back.pathname + back.search;
  }

  return { fetch, approve, seen, knobs: k };
}
