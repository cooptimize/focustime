// ADM-1: people's levels and client leads, with their source. Pure: the Dataverse directory and the admins' overrides
// in, answers out. Levels change guidance and emphasis in FocusTime, never permissions to see or do someone else's
// work; nothing here is a permission.
//   levelOf(person)              an admin's override, else Dataverse's position (through the position mapping), else
//                                none ("Level not set": Consultant defaults)
//   clientLeads(client)          the account's owner (the primary lead), Lead Consultants on its Account Workers, and
//                                anyone an admin added; minus anyone an admin removed. Several per client.
//   isClientLead(person, client)
// ADM-2 (D587 to D589): every person is one entry from cooptimizers() (plan/person-match.ts), matched once, so the
// signed-in person's id and their Dataverse row are the same person here. Only Cooptimizers have a level or lead
// anything; only clients (clientAccounts()) have leads. A lead override on a non-client stays stored, unused.
import { LEVEL_NAMES, LEVELS, type Level } from "../config/org.ts";
import { cooptimizers, type Cooptimizers, type DirPerson, type SignedInPerson } from "./person-match.ts";

export type LevelSource = "dataverse" | "override";
/** Why someone is a client's lead: the account's owner, a Lead Consultant on the account, or an admin added them. */
export type LeadWhy = "owner" | "lead_worker" | "override";
export const LEAD_WHY_NAMES: Record<LeadWhy, string> = { owner: "Account owner", lead_worker: "Lead Consultant on the account", override: "Added by an admin" };

export type PersonLevel = { level: Level | null; source: LevelSource | null; dataverse: Level | null };
export type ClientLead = { personId: string; why: LeadWhy[]; primary: boolean };

type DirIn = { personId: string; level?: Level | null; positionName?: string | null; systemUserId?: string; email?: string | null; entra?: boolean; guest?: boolean };
export type LevelsPerson = DirPerson & { email: string | null; positionName: string | null; level: Level | null };

export type PeopleInput = {
  directory: readonly DirIn[];
  /** Stored lead rows: the owners (and, from older reads, Lead Consultant workers when `clients` isn't given). */
  leads: readonly { clientKey: string; personId: string; source: "owner" | "lead_worker" }[];
  overrides: readonly { personId: string; kind: "level" | "lead_add" | "lead_remove"; clientKey: string; value: string | null }[];
  /** Who works where; a worker whose mapped level is Lead is a lead of that client (ADM-2). */
  clients?: readonly { personId: string; clientKey: string; worker?: boolean }[];
  /** The people who signed in, to match to their Dataverse rows. */
  signedIn?: readonly SignedInPerson[];
  /** Ids an admin flagged as automation accounts. */
  automation?: readonly string[];
  /** The Cooptimize email domains (the Rule); empty: the guest check only. */
  domains?: readonly string[];
  /** Which accounts are clients (clientAccounts()); absent: every key. */
  isClient?: (clientKey: string) => boolean;
  /** The position mapping (Admin › People); absent: the level stored with the directory row. */
  positionLevel?: (positionName: string | null) => Level | null;
};

export type Levels = {
  levelOf(personId: string | null): PersonLevel;
  clientLeads(clientKey: string): ClientLead[];
  isClientLead(personId: string | null, clientKey: string): boolean;
  /** Every client a person leads, with why. */
  leadsOf(personId: string): { clientKey: string; why: LeadWhy[]; primary: boolean }[];
  /** Was this lead removed by an admin? */
  removed(personId: string, clientKey: string): boolean;
  /** ADM-2: everyone, matched once, with who is a Cooptimizer. */
  people: Cooptimizers<LevelsPerson>;
  /** The one id this person has here (a signed-in person's Entra id, else the directory's), or the id as given. */
  canonical(personId: string): string;
};

const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);

export function levels(i: PeopleInput): Levels {
  const low = (s: string) => s.toLowerCase();
  const dir: LevelsPerson[] = i.directory.map((p) => {
    const personId = low(p.personId);
    const positionName = p.positionName ?? null;
    return {
      personId,
      systemUserId: p.systemUserId ?? "",
      email: p.email ?? null,
      entra: p.entra ?? !personId.startsWith("dv:"),
      guest: p.guest ?? false,
      positionName,
      level: i.positionLevel ? i.positionLevel(positionName) : (p.level ?? null),
    };
  });
  const people = cooptimizers({ directory: dir, signedIn: i.signedIn ?? [], automation: i.automation ?? [], domains: i.domains ?? [] });
  const canonical = (id: string) => people.entry(id)?.id ?? low(id);
  const isCoop = (id: string) => {
    const e = people.entry(id);
    // Someone only in an override or a lead row (not read yet) isn't ruled out.
    return e ? !e.notCooptimizer : true;
  };
  const isClient = i.isClient ?? (() => true);
  const levelOver = new Map(i.overrides.filter((o) => o.kind === "level" && isLevel(o.value)).map((o) => [canonical(o.personId), o.value as Level]));
  const removed = new Set(i.overrides.filter((o) => o.kind === "lead_remove").map((o) => `${o.clientKey}\u0000${canonical(o.personId)}`));
  const byClient = new Map<string, Map<string, Set<LeadWhy>>>();
  const add = (client: string, person: string, why: LeadWhy) => {
    if (!isClient(client) || !isCoop(person)) return;
    const id = canonical(person);
    if (removed.has(`${client}\u0000${id}`)) return;
    let m = byClient.get(client);
    if (!m) byClient.set(client, (m = new Map()));
    let s = m.get(id);
    if (!s) m.set(id, (s = new Set()));
    s.add(why);
  };
  const dirLevel = (id: string): Level | null => people.entry(id)?.dir?.level ?? null;
  for (const l of i.leads) if (l.source === "owner" || !i.clients) add(l.clientKey, l.personId, l.source);
  if (i.clients) for (const c of i.clients) if (c.worker !== false && dirLevel(c.personId) === "lead") add(c.clientKey, c.personId, "lead_worker");
  for (const o of i.overrides) if (o.kind === "lead_add" && o.clientKey) add(o.clientKey, o.personId, "override");
  const order: LeadWhy[] = ["owner", "lead_worker", "override"];
  const leadsFor = (clientKey: string): ClientLead[] =>
    [...(byClient.get(clientKey) ?? new Map<string, Set<LeadWhy>>()).entries()]
      .map(([personId, why]) => ({ personId, why: order.filter((w) => why.has(w)), primary: why.has("owner") }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.personId.localeCompare(b.personId));
  return {
    levelOf(personId) {
      if (!personId) return { level: null, source: null, dataverse: null };
      // Not a Cooptimizer: no level and no level defaults (D588).
      if (!isCoop(personId)) return { level: null, source: null, dataverse: null };
      const id = canonical(personId);
      const dv = dirLevel(personId);
      const over = levelOver.get(id);
      if (over) return { level: over, source: "override", dataverse: dv };
      return { level: dv, source: dv ? "dataverse" : null, dataverse: dv };
    },
    clientLeads: leadsFor,
    isClientLead: (personId, clientKey) => !!personId && leadsFor(clientKey).some((l) => l.personId === canonical(personId)),
    leadsOf: (personId) => [...byClient.keys()].sort().flatMap((k) => leadsFor(k).filter((l) => l.personId === canonical(personId)).map((l) => ({ clientKey: k, why: l.why, primary: l.primary }))),
    removed: (personId, clientKey) => removed.has(`${clientKey}\u0000${canonical(personId)}`),
    people,
    canonical,
  };
}

export const levelName = (l: Level | null) => (l ? LEVEL_NAMES[l] : "No level");
