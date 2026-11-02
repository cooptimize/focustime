// Fake OAuth provider and fake browser for tests. Error bodies echo secrets on purpose.
import { request } from "node:http";
import type { SecretAccount } from "../../secrets/keyring.ts";
import { SecretError } from "../../secrets/keyring.ts";

export const FAKE_AUTH_CODE = "FAKE-AUTHCODE-c0de11";
export const FAKE_REFRESH = "FAKE-REFRESH-5e5e77";
export const FAKE_REFRESH_ROTATED = "FAKE-REFRESH-ROTATED-6f6f88";
export const FAKE_ACCESS = "FAKE-ACCESS-aa99bb";
export const FAKE_CLIENT_SECRET = "FAKE-GCLIENTSECRET-1234";
/** Step 15.4: the fictional person in fake ID tokens. */
export const FAKE_PERSON = { oid: "0f0f0f0f-1111-4222-8333-444455556666", tid: "11111111-1111-4111-8111-111111111111", name: "Pat Example", preferred_username: "pat@example.com", email: "pat@example.com" };
export const fakeIdToken = (claims: Record<string, unknown> = FAKE_PERSON) =>
  `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.FAKE-SIG`;
const OIDC_SCOPES = ["openid", "profile", "email"];

export function memoryKeyring(initial: Partial<Record<SecretAccount, string>> = {}, opts: { locked?: boolean } = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    get: async (a: SecretAccount) => {
      if (opts.locked) throw new SecretError("locked");
      const v = store.get(a);
      if (v === undefined) throw new SecretError("not_found");
      return v;
    },
    set: async (a: SecretAccount, v: string) => {
      if (opts.locked) throw new SecretError("locked");
      store.set(a, v);
    },
    delete: async (a: SecretAccount) => {
      store.delete(a);
    },
  };
}

export type TokenBehavior = "ok" | "ok_rotate" | "invalid_grant" | "invalid_client" | "network" | "no_refresh_token";

/**
 * `consented`: scopes the user has agreed to (bare names, e.g. Calendars.ReadBasic). A refresh asking for anything
 * else fails like Microsoft's consent_required (invalid_grant, AADSTS65001); a code exchange grants what was asked.
 * Omitted: everything is consented. The response carries `scope` (what was granted, offline_access left out).
 */
export function fakeTokenEndpoint(tokenUrl: string, behavior: { exchange?: TokenBehavior; refresh?: TokenBehavior; consented?: string[]; grantFewer?: boolean; interaction?: boolean } = {}) {
  /** The browser visit: consents to everything it asked for (OpenID scopes never need consent). */
  const authorize = (scope: string | null) => {
    if (!behavior.consented) return;
    const bare = (x: string) => x.split("/").pop()!;
    behavior.consented = [...new Set([...behavior.consented, ...(scope ?? "").split(" ").filter((x) => x && x !== "offline_access").map(bare)])];
  };
  const calls: { url: string; body: URLSearchParams }[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    if (url !== tokenUrl) throw new Error(`unexpected fetch ${url}`);
    const body = new URLSearchParams(String(init.body));
    calls.push({ url, body });
    const b = body.get("grant_type") === "authorization_code" ? (behavior.exchange ?? "ok") : (behavior.refresh ?? "ok");
    if (b === "network") throw new TypeError("fetch failed");
    if (b === "invalid_grant") return json(400, { error: "invalid_grant", error_description: `Token has been expired or revoked: ${FAKE_REFRESH} ${FAKE_CLIENT_SECRET}` });
    if (b === "invalid_client") return json(401, { error: "invalid_client", error_description: `bad secret ${FAKE_CLIENT_SECRET}` });
    const asked = (body.get("scope") ?? "").split(" ").filter((x) => x && x !== "offline_access");
    if (asked.some((a) => a.startsWith("https://") && !a.startsWith(new URL(asked.find((x) => x.startsWith("https://"))!).origin)))
      return json(400, { error: "invalid_request", error_description: `AADSTS28000: more than one resource ${FAKE_REFRESH}` });
    if (behavior.interaction && body.get("grant_type") === "refresh_token") return json(400, { error: "invalid_grant", error_codes: [50076], error_description: `AADSTS50076: MFA ${FAKE_REFRESH}` });
    const bare = (x: string) => x.split("/").pop()!;
    if (body.get("grant_type") === "authorization_code") behavior.consented = [...new Set([...(behavior.consented ?? []), ...asked.map(bare)])];
    else if (behavior.consented && asked.some((a) => !OIDC_SCOPES.includes(a) && !behavior.consented!.includes(bare(a))))
      return json(400, { error: "invalid_grant", error_description: `AADSTS65001: The user or administrator has not consented. ${FAKE_REFRESH}`, suberror: "consent_required" });
    const granted = behavior.grantFewer ? asked.filter((a) => !/ReadWrite/.test(a)) : asked;
    const out: Record<string, unknown> = { access_token: body.get("scope")?.includes("ReadWrite") && !behavior.grantFewer ? `${FAKE_ACCESS}-W` : FAKE_ACCESS, expires_in: 3599, token_type: "Bearer", scope: granted.join(" ") };
    if (b === "ok" && body.get("grant_type") === "authorization_code") out.refresh_token = FAKE_REFRESH;
    if (asked.includes("openid")) out.id_token = fakeIdToken();
    if (b === "ok_rotate") out.refresh_token = FAKE_REFRESH_ROTATED;
    return json(200, out);
  };
  return { fetch: fetchFn as typeof fetch, calls, authorize };
}

/** Plays the browser: reads the authorize URL and hits the loopback redirect like a real browser would. */
export function fakeBrowser(mode: { kind: "approve" } | { kind: "deny" } | { kind: "wrong_state_then_approve" } | { kind: "foreign_host" } | { kind: "ignore" }, onApprove?: (scope: string | null) => void) {
  const seen: URL[] = [];
  const hits: number[] = [];
  const open = async (authUrl: string) => {
    const u = new URL(authUrl);
    seen.push(u);
    if (mode.kind === "ignore") return;
    const redirect = new URL(u.searchParams.get("redirect_uri")!);
    const state = u.searchParams.get("state")!;
    const hit = (query: string, host = redirect.host) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: Number(redirect.port), path: `${redirect.pathname}?${query}`, headers: { host } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });
    setTimeout(async () => {
      if (mode.kind === "deny") hits.push(await hit(`error=access_denied&state=${state}`));
      else if (mode.kind === "foreign_host") hits.push(await hit(`code=${FAKE_AUTH_CODE}&state=${state}`, "evil.example"));
      else {
        if (mode.kind === "wrong_state_then_approve") hits.push(await hit(`code=${FAKE_AUTH_CODE}&state=wrong`));
        onApprove?.(u.searchParams.get("scope"));
        hits.push(await hit(`code=${FAKE_AUTH_CODE}&state=${state}`));
      }
    }, 5);
  };
  return { open, seen, hits };
}
