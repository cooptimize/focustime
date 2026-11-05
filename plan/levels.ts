// ADM-1: people's levels and client leads, with their source. Pure: the Dataverse directory and the admins' overrides
// in, answers out. Levels change guidance and emphasis in FocusTime, never permissions to see or do someone else's
// work; nothing here is a permission.
//   levelOf(person)              an admin's override, else Dataverse's position, else none
//   clientLeads(client)          the account's owner (the primary lead), Lead Consultants on its Account Workers, and
//                                anyone an admin added; minus anyone an admin removed. Several per client.
//   isClientLead(person, client)
import { LEVEL_NAMES, LEVELS, type Level } from "../config/org.ts";

export type LevelSource = "dataverse" | "override";
/** Why someone is a client's lead: the account's owner, a Lead Consultant on the account, or an admin added them. */
export type LeadWhy = "owner" | "lead_worker" | "override";
export const LEAD_WHY_NAMES: Record<LeadWhy, string> = { owner: "Account owner", lead_worker: "Lead Consultant on the account", override: "Added by an admin" };

export type PersonLevel = { level: Level | null; source: LevelSource | null; dataverse: Level | null };
export type ClientLead = { personId: string; why: LeadWhy[]; primary: boolean };

export type PeopleInput = {
  directory: readonly { personId: string; level: Level | null }[];
  leads: readonly { clientKey: string; personId: string; source: "owner" | "lead_worker" }[];
  overrides: readonly { personId: string; kind: "level" | "lead_add" | "lead_remove"; clientKey: string; value: string | null }[];
};

export type Levels = {
  levelOf(personId: string | null): PersonLevel;
  clientLeads(clientKey: string): ClientLead[];
  isClientLead(personId: string | null, clientKey: string): boolean;
  /** Every client a person leads, with why. */
  leadsOf(personId: string): { clientKey: string; why: LeadWhy[]; primary: boolean }[];
  /** Was this lead removed by an admin? */
  removed(personId: string, clientKey: string): boolean;
};

const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);

export function levels(i: PeopleInput): Levels {
  const id = (s: string) => s.toLowerCase();
  const dvLevel = new Map(i.directory.map((p) => [id(p.personId), p.level]));
  const levelOver = new Map(i.overrides.filter((o) => o.kind === "level" && isLevel(o.value)).map((o) => [id(o.personId), o.value as Level]));
  const removed = new Set(i.overrides.filter((o) => o.kind === "lead_remove").map((o) => `${o.clientKey}\u0000${id(o.personId)}`));
  const byClient = new Map<string, Map<string, Set<LeadWhy>>>();
  const add = (client: string, person: string, why: LeadWhy) => {
    if (removed.has(`${client}\u0000${person}`)) return;
    let m = byClient.get(client);
    if (!m) byClient.set(client, (m = new Map()));
    let s = m.get(person);
    if (!s) m.set(person, (s = new Set()));
    s.add(why);
  };
  for (const l of i.leads) add(l.clientKey, id(l.personId), l.source);
  for (const o of i.overrides) if (o.kind === "lead_add" && o.clientKey) add(o.clientKey, id(o.personId), "override");
  const order: LeadWhy[] = ["owner", "lead_worker", "override"];
  const leadsFor = (clientKey: string): ClientLead[] =>
    [...(byClient.get(clientKey) ?? new Map<string, Set<LeadWhy>>()).entries()]
      .map(([personId, why]) => ({ personId, why: order.filter((w) => why.has(w)), primary: why.has("owner") }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.personId.localeCompare(b.personId));
  return {
    levelOf(personId) {
      if (!personId) return { level: null, source: null, dataverse: null };
      const dv = dvLevel.get(id(personId)) ?? null;
      const over = levelOver.get(id(personId));
      if (over) return { level: over, source: "override", dataverse: dv };
      return { level: dv, source: dv ? "dataverse" : null, dataverse: dv };
    },
    clientLeads: leadsFor,
    isClientLead: (personId, clientKey) => !!personId && leadsFor(clientKey).some((l) => l.personId === id(personId)),
    leadsOf: (personId) => [...byClient.keys()].sort().flatMap((k) => leadsFor(k).filter((l) => l.personId === id(personId)).map((l) => ({ clientKey: k, why: l.why, primary: l.primary }))),
    removed: (personId, clientKey) => removed.has(`${clientKey}\u0000${id(personId)}`),
  };
}

export const levelName = (l: Level | null) => (l ? LEVEL_NAMES[l] : "No level");
