// AH-3: client DevOps identities for one signed-in person, over the org runtime's index (plan/identities.ts). Ahead,
// the DevOps scope and the notes ask here who an email is on a client and which addresses are me there. Emails are for
// matching only: what leaves the server is a FocusTime name.
import { createHash } from "node:crypto";
import { identityEmail, identityName } from "../sources/devops/normalize.ts";
import { clientIdentities, type Assignee, type ClientIdentitiesView, type IdentityIndex, type IdentityRowView } from "../plan/identities.ts";
import type { AheadIdentities } from "./ahead-actions.ts";

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The address to write for a person on a client: their linked client login there, else the address given. */
export function writeAs(ix: IdentityIndex, clientKey: string, email: string): string {
  const p = ix.personOf(clientKey, email);
  if (!p) return email;
  const login = ix.linked.find((l) => l.clientKey === clientKey && l.personId === low(p.id));
  return login?.email ?? email;
}

/**
 * Ahead's view: me is my person id plus the DevOps addresses only I hold for each client (my Dataverse DevOps email, my
 * write PAT's identity). Unknown me: only those addresses count as mine.
 */
export function aheadIdentities(ix: IdentityIndex, meId: string | null, myAddresses: (clientKey: string) => string[]): AheadIdentities {
  return {
    mine: (k) => [...new Set([...(meId ? ix.emailsOf(k, meId) : []), ...myAddresses(k).map(low)].filter(Boolean))],
    personOf: (k, e) => {
      const p = ix.personOf(k, e);
      return p ? { id: low(p.id), name: p.name } : null;
    },
    writeAs: (k, e) => writeAs(ix, k, e),
  };
}

/** AH-3: every client login linked to me (any client), so notes and takes addressed to one reach me. */
export async function myLinkedLogins(org: { identities(): Promise<IdentityIndex> } | undefined, meId: string | null | undefined): Promise<string[]> {
  if (!org || !meId) return [];
  const ix = await org.identities().catch(() => null);
  return ix ? ix.linked.filter((l) => l.personId === low(meId)).map((l) => l.email) : [];
}

// ---- Admin › People: identities per client (AH-3) ----

/** An opaque reference to a client's DevOps identity: never the email, stable for one client and address. */
export const identityRef = (clientKey: string, email: string) => createHash("sha256").update(`ah3\u0000${clientKey}\u0000${low(email)}`).digest("hex").slice(0, 20);


const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const identityLine = (clientKey: string, looks: number, linked: number) => `${plural(looks, "identity", "identities")} on ${clientKey} look${looks === 1 ? "s" : ""} like client logins, ${linked} linked`;

/**
 * For Admin › People: each client's identities that look like client logins (linked, suggested, unmatched), by DevOps
 * display name and an opaque ref. `assignees`: the client's DevOps assignees (the central store), emails server-side only.
 */
export function identitiesView(ix: IdentityIndex, clientKeys: readonly string[], assignees: Readonly<Record<string, readonly Assignee[]>>): ClientIdentitiesView[] {
  const nameOf = new Map(ix.people.map((p) => [low(p.id), p.name]));
  const out: ClientIdentitiesView[] = [];
  for (const k of [...new Set([...clientKeys, ...ix.linked.map((l) => l.clientKey)])].sort()) {
    const as = assignees[k] ?? [];
    const c = clientIdentities(ix, k, as);
    const shown = new Map(as.map((a) => [low(a.email), a.name]));
    const rows: IdentityRowView[] = [
      ...ix.linked.filter((l) => l.clientKey === k).map((l) => ({ ref: identityRef(k, l.email), clientKey: k, name: shown.get(l.email) ?? l.name ?? `${k} DevOps login`, state: "linked" as const, source: l.source, personId: l.personId, personName: nameOf.get(l.personId) ?? null })),
      ...c.suggestions.map((s) => ({ ref: identityRef(k, s.email), clientKey: k, name: s.name, state: "suggested" as const, source: null, personId: s.personId, personName: s.personName })),
      ...c.unmatched.map((u) => ({ ref: identityRef(k, u.email), clientKey: k, name: u.name, state: "unmatched" as const, source: null, personId: null, personName: null })),
    ];
    if (!rows.length) continue;
    out.push({ clientKey: k, looks: c.looks, linked: c.linked, line: identityLine(k, c.looks, c.linked), rows });
  }
  return out;
}

/** The email behind a ref on a client (a linked identity or an assignee there), or null. Server-side only. */
export function emailOfRef(ix: IdentityIndex, clientKey: string, ref: string, assignees: readonly Assignee[]): { email: string; name: string | null } | null {
  for (const l of ix.linked) if (l.clientKey === clientKey && identityRef(clientKey, l.email) === ref) return { email: l.email, name: assignees.find((a) => low(a.email) === l.email)?.name ?? l.name };
  for (const a of assignees) if (identityRef(clientKey, a.email) === ref) return { email: low(a.email), name: a.name };
  return null;
}

/** The distinct assignees (email, display name) of a client's stored items, as DevOps shows them. */
export function assigneesOf(values: readonly { fields: Readonly<Record<string, unknown>> }[]): Assignee[] {
  const out = new Map<string, Assignee>();
  for (const v of values) {
    const e = identityEmail(v.fields["System.AssignedTo"]);
    if (!e || out.has(low(e))) continue;
    out.set(low(e), { email: low(e), name: identityName(v.fields["System.AssignedTo"]) ?? e.split("@")[0]! });
  }
  return [...out.values()];
}
