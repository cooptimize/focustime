// Who signed in (step 15.4): the claims Coopilot keeps from an ID token. The token comes straight from the token
// endpoint over TLS to a public client, so it is read, not validated (Microsoft: public apps don't benefit from
// validating it); it is used to show who is signed in and to find "me" in Dataverse, never to authorize anything.
export type IdClaims = {
  /** Object id of the user in the tenant. */
  oid: string;
  tid: string;
  /** Display name. */
  name: string;
  /** preferred_username: usually the UPN. */
  username: string;
  /** The email claim, when the account has one. */
  email: string | null;
};

const text = (v: unknown, max = 256) => (typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v : null);

/** The claims Coopilot keeps, or null for anything that isn't a well-formed ID token with an oid and a username. */
export function parseIdToken(jwt: string): IdClaims | null {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  let body: Record<string, unknown>;
  try {
    const v = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    body = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const oid = text(body.oid, 64);
  const tid = text(body.tid, 64);
  const username = text(body.preferred_username) ?? text(body.upn) ?? text(body.email);
  if (!oid || !tid || !username) return null;
  return { oid, tid, name: text(body.name) ?? username, username, email: text(body.email) };
}

/** The address Dataverse knows me by: the email claim, else the username when it looks like an address. */
export function workEmail(c: IdClaims): string | null {
  const e = c.email ?? c.username;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e.toLowerCase() : null;
}
