// AH-5: who Ahead's assignee dropdown lists for one client. Pure: no I/O.
//
// The people come from that client's own DevOps project only (its teams' members, read with the teams by the central
// poller), plus the client's Cooptimizers (its Account Workers) and whoever is already assigned an item there. Never
// anyone from another client's project. Order: me first, then people already assigned in this view, then everyone
// else by name. Each shows a name and the email's domain (never the address), and whether they're outside Cooptimize.

/** One raw entry of `_apis/projects/{p}/teams/{t}/members` (TeamMember: identity, isTeamAdmin). */
export type RawTeamMember = { identity?: { displayName?: unknown; uniqueName?: unknown; isContainer?: unknown; descriptor?: unknown; isDeletedInOrigin?: unknown } | null };

const EMAIL = /^[^\s@<>\\]+@[^\s@<>\\]+\.[^\s@<>\\]+$/;

/**
 * People in a team members answer: real people only (no groups, which DevOps marks as containers or by a group
 * descriptor; no build or service accounts, which have no email as their uniqueName; nobody deleted in Entra).
 */
export function teamPeople(raw: readonly RawTeamMember[]): { email: string; name: string }[] {
  const out: { email: string; name: string }[] = [];
  for (const m of raw) {
    const id = m.identity;
    if (!id || id.isContainer === true || id.isDeletedInOrigin === true) continue;
    if (typeof id.descriptor === "string" && /^(vssgp|aadgp|svc|s2s)\./i.test(id.descriptor)) continue;
    const email = typeof id.uniqueName === "string" ? id.uniqueName.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 320) continue;
    const name = typeof id.displayName === "string" && id.displayName.trim() ? id.displayName.trim().slice(0, 200) : email;
    out.push({ email, name });
  }
  return out;
}

export type AssignPerson = {
  /** The address the change set keeps and the write sends (the Cooptimizer's own; their client login is written for them). */
  email: string;
  name: string;
  /** The email's domain, the only part of the address shown. */
  domain: string;
  /** Not a Cooptimizer: shown with an "Outside Cooptimize" mark. */
  external: boolean;
  me: boolean;
  /** Already assigned an item of this client in Ahead now. */
  assigned: boolean;
};

export type PeopleInput = {
  /** Every address that is me on this client. */
  mine: readonly string[];
  myName: string | null;
  /** The client's Cooptimizers (its Account Workers) with their own email. */
  cooptimizers: readonly { email: string; name: string }[];
  /** The project's team members (teamPeople), this client's project only. */
  project: readonly { email: string; name: string }[];
  /** Who has an item of this client now (DevOps or my pending changes). */
  assignees: readonly { email: string; name: string }[];
  /** A DevOps address that is a Cooptimizer's client login on this client: their own email, else null. */
  loginOf: (email: string) => string | null;
  isCooptimizer: (email: string) => boolean;
};

const domainOf = (e: string) => e.slice(e.lastIndexOf("@") + 1);

/** The assignee list, deduplicated by person (a client login folds into its Cooptimizer), in the order above. */
export function assignPeople(p: PeopleInput): AssignPerson[] {
  const lc = (s: string) => s.trim().toLowerCase();
  const mine = new Set(p.mine.map(lc));
  const coop = new Map(p.cooptimizers.map((c) => [lc(c.email), c]));
  const byEmail = new Map<string, AssignPerson>();
  const assigned = new Set<string>();
  // A client login is the Cooptimizer it belongs to; my own logins are me.
  const own = (raw: string): string => {
    const e = lc(raw);
    if (mine.has(e)) return [...mine][0]!;
    const login = p.loginOf(e);
    return login ? lc(login) : e;
  };
  const add = (raw: { email: string; name: string }) => {
    const e = own(raw.email);
    if (!EMAIL.test(e) || byEmail.has(e)) return;
    const c = coop.get(e);
    const me = mine.has(e);
    byEmail.set(e, { email: e, name: me && p.myName ? p.myName : (c?.name ?? raw.name), domain: domainOf(e), external: !me && !c && !p.isCooptimizer(e), me, assigned: false });
  };
  for (const a of p.assignees) assigned.add(own(a.email));
  if (p.mine[0]) add({ email: p.mine[0], name: p.myName ?? p.mine[0] });
  for (const c of p.cooptimizers) add(c);
  for (const x of p.project) add(x);
  for (const a of p.assignees) add(a);
  const list = [...byEmail.values()].map((x) => ({ ...x, assigned: assigned.has(x.email) }));
  const rank = (x: AssignPerson) => (x.me ? 0 : x.assigned ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.email.localeCompare(b.email));
}

/** Search by name or domain, words in any order. */
export function searchPeople(list: readonly AssignPerson[], q: string): AssignPerson[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((x) => words.every((w) => x.name.toLowerCase().includes(w) || x.domain.includes(w) || (x.me && "me".startsWith(w))));
}

/** "Tanner Spaulding" → "Tanner S."; one word stays as it is. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  const last = parts.at(-1)!.replace(/^[^\p{L}]+/u, "");
  return last ? `${parts[0]} ${last[0]!.toUpperCase()}.` : parts[0]!;
}
