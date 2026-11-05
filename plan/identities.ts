// AH-3: client DevOps identities, pure. A Cooptimizer often signs in to a client's DevOps with a client login (an
// "Ext-" account, say) whose email isn't their Cooptimize one. Each such identity maps to the one person everywhere.
//
// Sources, per client:
//   dataverse   the person's own Account Worker DevOps email (what Settings › Clients shows them), read daily
//   link        a confirmed link (by the person for themselves, or by an admin), audited
//   unlink      an admin removed a Dataverse identity (Dataverse is read-only, so this hides it)
// A suggestion (a DevOps display name that is a Cooptimizer's name apart from a prefix or suffix, or exactly their
// name with another email) is only shown, for the person or an admin to confirm; it is never applied by itself.
//
// Teammates' DevOps emails are for matching and for showing their FocusTime name only: never displayed, never logged.
// What leaves the server is a display name and an opaque reference (actions/identity-actions.ts).

export type IdentitySource = "dataverse" | "link" | "unlink";
export type IdentityRow = { clientKey: string; email: string; personId: string; source: IdentitySource; name: string | null; byName?: string | null; at?: string | null };
/** A Cooptimizer as the index knows them: their one id, their name, the addresses that are always theirs. */
export type IdentityPerson = { id: string; name: string; emails: readonly string[] };
export type LinkedIdentity = { clientKey: string; email: string; personId: string; name: string | null; source: "dataverse" | "link" };

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Prefixes and suffixes clients put on outside people's logins: "Ext-", "ext_", "X-", "EXT ", "(External)", " - Ext",
// " [Contractor]", "_ext". Words only, no names.
const LOGIN_WORDS = "ext|external|extern|guest|contractor|contract|vendor|partner|consultant|temp|x";
const PREFIX = new RegExp(`^\\s*(?:${LOGIN_WORDS})\\s*[-_.:|]\\s*`, "i");
const PREFIX_SPACE = new RegExp(`^\\s*(?:ext|external|guest|contractor|vendor)\\s+(?=\\S+\\s+\\S)`, "i");
const SUFFIX_BRACKET = new RegExp(`\\s*[([{]\\s*(?:${LOGIN_WORDS})\\s*[)\\]}]\\s*$`, "i");
const SUFFIX_DASH = new RegExp(`\\s*[-_|]\\s*(?:${LOGIN_WORDS})\\s*$`, "i");

/** A display name without a client-login prefix or suffix, and whether one was there. */
export function stripLogin(name: string): { base: string; stripped: boolean } {
  let s = name.trim();
  const before = s;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIX_BRACKET, "").replace(SUFFIX_DASH, "").replace(PREFIX, "").replace(PREFIX_SPACE, "").trim();
    if (next === s) break;
    s = next;
  }
  return { base: s, stripped: s !== before && s.length > 0 };
}

/** A name for comparing: lowercase, accents off, "Last, First" turned around, spaces and dots collapsed. */
export function nameKey(name: string): string {
  let s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
  const comma = /^([^,]+),\s*([^,]+)$/.exec(s);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  return s.toLowerCase().replace(/[.\s]+/g, " ").trim();
}

export type IdentityIndex = {
  /** The Cooptimizer this DevOps email is on this client: their own address anywhere, or a linked identity here. */
  personOf(clientKey: string, email: string | null | undefined): IdentityPerson | null;
  /** Every address that is this person on this client: their own, plus their linked identities there. */
  emailsOf(clientKey: string, personId: string): string[];
  /** The linked identities (Dataverse ones not removed, and confirmed links), for Admin › People. */
  linked: readonly LinkedIdentity[];
  /** Whether an admin removed this one (a suggestion for that person and identity isn't offered again). */
  removed(clientKey: string, email: string, personId: string): boolean;
  people: readonly IdentityPerson[];
};

export function identityIndex(rows: readonly IdentityRow[], people: readonly IdentityPerson[]): IdentityIndex {
  const byId = new Map(people.map((p) => [low(p.id), p]));
  const own = new Map<string, IdentityPerson>();
  for (const p of people) for (const e of p.emails) if (e) own.set(low(e), p);
  const key = (k: string, e: string) => `${k}\u0000${low(e)}`;
  const unlinked = new Set(rows.filter((r) => r.source === "unlink").map((r) => `${key(r.clientKey, r.email)}\u0000${low(r.personId)}`));
  const linked = new Map<string, LinkedIdentity>();
  // A confirmed link wins over Dataverse for the same identity.
  for (const src of ["dataverse", "link"] as const)
    for (const r of rows.filter((x) => x.source === src)) {
      if (!byId.has(low(r.personId))) continue;
      if (src === "dataverse" && unlinked.has(`${key(r.clientKey, r.email)}\u0000${low(r.personId)}`)) continue;
      // An identity that is someone's own Cooptimize address needs no link.
      if (own.has(low(r.email))) continue;
      linked.set(key(r.clientKey, r.email), { clientKey: r.clientKey, email: low(r.email), personId: low(r.personId), name: r.name, source: src });
    }
  return {
    personOf(clientKey, email) {
      const e = low(email);
      if (!e) return null;
      const l = linked.get(key(clientKey, e));
      return own.get(e) ?? (l ? (byId.get(l.personId) ?? null) : null);
    },
    emailsOf(clientKey, personId) {
      const p = byId.get(low(personId));
      const out = new Set((p?.emails ?? []).map(low).filter(Boolean));
      for (const l of linked.values()) if (l.clientKey === clientKey && l.personId === low(personId)) out.add(l.email);
      return [...out];
    },
    linked: [...linked.values()].sort((a, b) => a.clientKey.localeCompare(b.clientKey) || (a.name ?? "").localeCompare(b.name ?? "")),
    removed: (clientKey, email, personId) => unlinked.has(`${key(clientKey, email)}\u0000${low(personId)}`),
    people,
  };
}

/** A DevOps assignee as the client's project shows them. */
export type Assignee = { email: string; name: string };
export type Suggestion = { clientKey: string; email: string; name: string; personId: string; personName: string };
export type ClientIdentities = {
  clientKey: string;
  /** Identities that look like a Cooptimizer's client login (linked, suggested, or with a login prefix or suffix). */
  looks: number;
  linked: number;
  suggestions: Suggestion[];
  /** Client-login-looking identities nobody matches: shown as they are, with Link to a person for admins. */
  unmatched: Assignee[];
};

/**
 * For one client: which of its DevOps assignees look like Cooptimizers' client logins, which are linked, which have a
 * suggested person (exactly one Cooptimizer with that name once a prefix or suffix is off), and which nobody matches.
 */
export function clientIdentities(index: IdentityIndex, clientKey: string, assignees: readonly Assignee[]): ClientIdentities {
  const names = new Map<string, IdentityPerson[]>();
  for (const p of index.people) {
    const k = nameKey(p.name);
    if (k) names.set(k, [...(names.get(k) ?? []), p]);
  }
  const seen = new Set<string>();
  const out: ClientIdentities = { clientKey, looks: 0, linked: 0, suggestions: [], unmatched: [] };
  const linkedHere = index.linked.filter((l) => l.clientKey === clientKey);
  for (const a of assignees) {
    const e = low(a.email);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    const person = index.personOf(clientKey, e);
    const isLinked = linkedHere.some((l) => l.email === e);
    if (person && !isLinked) continue; // their own Cooptimize address: not an identity
    const { base, stripped } = stripLogin(a.name);
    const candidates = names.get(nameKey(base)) ?? [];
    if (isLinked) {
      out.looks++;
      out.linked++;
      continue;
    }
    if (!stripped && !candidates.length) continue; // someone of the client's
    out.looks++;
    const one = candidates.length === 1 ? candidates[0]! : null;
    if (one && !index.removed(clientKey, e, one.id)) out.suggestions.push({ clientKey, email: e, name: a.name, personId: low(one.id), personName: one.name });
    else out.unmatched.push({ email: e, name: a.name });
  }
  // Linked identities that aren't assigned anything right now still count.
  for (const l of linkedHere)
    if (!seen.has(l.email)) {
      out.looks++;
      out.linked++;
    }
  return out;
}

// ---- What Admin › People shows (no emails: a display name and an opaque ref) ----

export type IdentityRowView = {
  ref: string;
  clientKey: string;
  /** The DevOps display name ("Ext-Sam Ortiz"), or a plain stand-in when DevOps shows no name. */
  name: string;
  state: "linked" | "suggested" | "unmatched";
  /** Linked: from Dataverse (the Account Worker row) or a confirmed link. */
  source: "dataverse" | "link" | null;
  personId: string | null;
  personName: string | null;
};
export type ClientIdentitiesView = { clientKey: string; looks: number; linked: number; line: string; rows: IdentityRowView[] };
