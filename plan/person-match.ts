// ADM-2 (D587, D588): who a person is in Dataverse, and who is a Cooptimizer. Pure. One match and one rule, used by
// levels and client leads (plan/levels.ts), Admin › People's Dataverse column, the person pickers and sign-in, so a
// column can never disagree with the data beside it.
//
//   matchPerson(directory, who)   the Dataverse user for a signed-in person: their Entra object id, else their work
//                                 email, else their UPN, else the Dataverse user their sign-in was matched to
//                                 (ms_identity's systemuserid, what matchMe keeps). Says which key matched, and
//                                 whether Dataverse is missing their Entra id.
//   notCooptimizer(person, ...)   why someone isn't a Cooptimizer: an admin's "Automation account" flag, a B2B guest
//                                 (#EXT# in Dataverse's domainname or the UPN), or an email domain outside the
//                                 "Cooptimize email domains" Rule (when set; empty means the guest check only, with a
//                                 Status warning). Null: a Cooptimizer.
//   guestToken(claims)            whether an ID token is a guest's, from the token alone (never Dataverse): the acct
//                                 optional claim (1), an idp that isn't the issuer, or a #EXT# UPN (Microsoft Learn,
//                                 ID token claims and optional claims references, checked Nov 6 2026).

export type MatchKey = "entra_id" | "dataverse_user" | "email" | "upn";
export const MATCH_TEXT: Record<MatchKey, string> = { entra_id: "Entra id", dataverse_user: "the Dataverse user found at sign-in", email: "email", upn: "UPN" };

/** A Dataverse person as the directory keeps them. `personId`: the Entra object id, or "dv:<systemuserid>". */
export type DirPerson = { personId: string; systemUserId: string; email: string | null; entra: boolean; guest: boolean };
/** A signed-in person: their Entra object id, email and UPN, and the Dataverse user their sign-in was matched to. */
export type SignedInPerson = { id: string; email: string | null; upn: string | null; systemUserId?: string | null };

export type PersonMatch<P extends DirPerson = DirPerson> = { person: P; by: MatchKey; entraMissing: boolean };

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function matchPerson<P extends DirPerson>(directory: readonly P[], who: SignedInPerson): PersonMatch<P> | null {
  const id = low(who.id);
  const out = (person: P, by: MatchKey): PersonMatch<P> => ({ person, by, entraMissing: !person.entra });
  const byId = directory.find((p) => p.entra && low(p.personId) === id);
  if (byId) return out(byId, "entra_id");
  const email = low(who.email);
  const byEmail = email.includes("@") ? directory.find((p) => low(p.email) === email) : undefined;
  if (byEmail) return out(byEmail, "email");
  const upn = low(who.upn);
  const byUpn = upn.includes("@") ? directory.find((p) => low(p.email) === upn) : undefined;
  if (byUpn) return out(byUpn, "upn");
  const sys = low(who.systemUserId);
  const bySys = sys ? directory.find((p) => low(p.systemUserId) === sys) : undefined;
  if (bySys) return out(bySys, "dataverse_user");
  return null;
}

/** "Matched by email", "Matched by email, Entra id missing". */
export const matchText = (m: Pick<PersonMatch, "by" | "entraMissing">) => `Matched by ${MATCH_TEXT[m.by]}${m.entraMissing ? ", Entra id missing" : ""}`;

export type NotCooptimizer = "guest" | "domain" | "automation";
export const NOT_COOPTIMIZER_TEXT: Record<NotCooptimizer, string> = { guest: "Guest account", domain: "Email outside the Cooptimize domains", automation: "Automation" };

const domainOf = (email: string | null | undefined) => {
  const e = low(email);
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(at + 1) : "";
};
/** Whether an address is at one of the domains (or a subdomain of one). Empty domains: no domain rule. */
export const inDomains = (email: string | null | undefined, domains: readonly string[]) => {
  if (!domains.length) return true;
  const d = domainOf(email);
  return !!d && domains.some((x) => d === low(x) || d.endsWith(`.${low(x)}`));
};
/** A guest's UPN form in the resource tenant: name_home.com#EXT#@tenant. */
export const isGuestUpn = (v: string | null | undefined) => (v ?? "").toUpperCase().includes("#EXT#");

/** Why this person isn't a Cooptimizer, or null. */
export function notCooptimizer(p: { email: string | null; upn?: string | null; guest?: boolean; automation?: boolean }, domains: readonly string[]): NotCooptimizer | null {
  if (p.automation) return "automation";
  if (p.guest || isGuestUpn(p.upn) || isGuestUpn(p.email)) return "guest";
  const address = p.email ?? p.upn ?? null;
  if (domains.length && !inDomains(address, domains)) return "domain";
  return null;
}

/** Why an ID token is a guest's (from the token alone), or null for a member. */
export function guestToken(claims: Record<string, unknown>): "acct" | "idp" | "upn" | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (claims.acct === 1 || claims.acct === "1") return "acct";
  const idp = str(claims.idp);
  const iss = str(claims.iss);
  if (idp && iss && idp.replace(/\/+$/, "").toLowerCase() !== iss.replace(/\/+$/, "").toLowerCase()) return "idp";
  if (isGuestUpn(str(claims.upn)) || isGuestUpn(str(claims.unique_name))) return "upn";
  return null;
}

/** One person as FocusTime knows them: signed in, in Dataverse, or both (matched by matchPerson). */
export type PersonEntry<P extends DirPerson = DirPerson> = {
  /** The signed-in person's Entra object id, else the directory's id ("dv:<systemuserid>" without one). Lowercase. */
  id: string;
  dir: P | null;
  signedIn: SignedInPerson | null;
  match: PersonMatch<P> | null;
  notCooptimizer: NotCooptimizer | null;
};

export type Cooptimizers<P extends DirPerson = DirPerson> = {
  /** Everyone, Cooptimizers or not. */
  all: PersonEntry<P>[];
  /** Cooptimizers only: People, lead pickers, level defaults, "Everyone at Cooptimize". */
  cooptimizers: PersonEntry<P>[];
  /** Guests, people outside the Cooptimize domains, automation accounts: the "Not Cooptimizers" fold. */
  others: PersonEntry<P>[];
  /** The entry for an id (a signed-in person's or a directory id), or null. */
  entry(id: string | null | undefined): PersonEntry<P> | null;
  isCooptimizer(id: string | null | undefined): boolean;
  /** Whether the domains Rule is empty (the guest check only, and a Status warning). */
  noDomains: boolean;
};

/**
 * cooptimizers(): everyone signed in or in Dataverse, each matched once (matchPerson), each with why they aren't a
 * Cooptimizer (notCooptimizer), or null. `automation`: ids an admin flagged (either id of a person counts).
 */
export function cooptimizers<P extends DirPerson & { email: string | null }>(i: { directory: readonly P[]; signedIn: readonly SignedInPerson[]; automation: readonly string[]; domains: readonly string[] }): Cooptimizers<P> {
  const auto = new Set(i.automation.map(low));
  const entries: PersonEntry<P>[] = [];
  const taken = new Set<string>();
  for (const s of i.signedIn) {
    const m = matchPerson(i.directory, s);
    if (m) taken.add(low(m.person.personId));
    const id = low(s.id);
    const automation = auto.has(id) || (!!m && auto.has(low(m.person.personId)));
    entries.push({ id, dir: m?.person ?? null, signedIn: s, match: m, notCooptimizer: notCooptimizer({ email: s.email ?? m?.person.email ?? null, upn: s.upn, guest: m?.person.guest ?? false, automation }, i.domains) });
  }
  for (const p of i.directory) {
    const id = low(p.personId);
    if (taken.has(id) || entries.some((e) => e.id === id)) continue;
    entries.push({ id, dir: p, signedIn: null, match: null, notCooptimizer: notCooptimizer({ email: p.email, guest: p.guest, automation: auto.has(id) }, i.domains) });
  }
  const index = new Map<string, PersonEntry<P>>();
  for (const e of entries) {
    index.set(e.id, e);
    if (e.dir) index.set(low(e.dir.personId), e);
  }
  const entry = (id: string | null | undefined) => (id ? (index.get(low(id)) ?? null) : null);
  return {
    all: entries,
    cooptimizers: entries.filter((e) => !e.notCooptimizer),
    others: entries.filter((e) => !!e.notCooptimizer),
    entry,
    isCooptimizer: (id) => {
      const e = entry(id);
      return !!e && !e.notCooptimizer;
    },
    noDomains: i.domains.length === 0,
  };
}
