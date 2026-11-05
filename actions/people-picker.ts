// CV-2: who the shared PersonPicker offers, in three groups. "In this conversation": its people (externals marked,
// referenced by their chat member id; Cooptimizers by their Entra id). "On <client>": the client's Account Workers
// who are Cooptimizers. "Everyone at Cooptimize": cooptimizers() only (no guests, nobody outside the Cooptimize
// domains, no automation accounts). Never me, never an email address for someone outside Cooptimize (a Cooptimizer's
// email is for their photo only). Read only. The client and people lists come from clientAccounts() and
// cooptimizers() (actions/org.ts); nothing here rebuilds them.
import type { Levels } from "../plan/levels.ts";
import type { PersonRef } from "../plan/person-ref.ts";
import type { DirectoryPerson, PersonClient } from "../store/admin-store.ts";

export type PickerPerson = { name: string; ref: PersonRef; email: string | null; external: boolean };
export type PickerGroup = { key: "conversation" | "client" | "everyone"; label: string; people: PickerPerson[] };
export type PeoplePickerData = { groups: PickerGroup[]; problems: string[] };

/** A Cooptimizer as the picker knows them: the one id cooptimizers() gives them, a name, an email for the photo. */
export type PickerCooptimizer = { id: string; name: string; email: string | null };
export type PickerPeople = { cooptimizers: PickerCooptimizer[]; workers: (clientKey: string) => PickerCooptimizer[]; isCooptimizer: (id: string) => PickerCooptimizer | null };
/** Someone in the conversation (or around a promise with none): their chat member id, name and whether they're external. */
export type ConversationPerson = { id: string; name: string; external: boolean; email: string | null };

export type PickerDeps = {
  me: () => Promise<string | null>;
  people: () => Promise<PickerPeople | null>;
  conversation: (q: { conversationId?: number; commitmentId?: number }) => Promise<ConversationPerson[] | null>;
  clientName: (clientKey: string) => Promise<string>;
};

const low = (s: string) => s.toLowerCase();

/**
 * The picker's Cooptimizers from what the org runtime holds: cooptimizers() for who counts (one entry per person),
 * the directory or the signed-in users for their names, people_clients for each client's Account Workers. Someone
 * with no name anywhere isn't offered.
 */
export function pickerPeopleOf(i: { levels: Pick<Levels, "people">; directory: readonly Pick<DirectoryPerson, "personId" | "name">[]; peopleClients: readonly PersonClient[]; users: readonly { id: string; name: string; deleted?: boolean }[] }): PickerPeople {
  const dirName = new Map(i.directory.map((d) => [low(d.personId), d.name]));
  const userName = new Map(i.users.filter((u) => !u.deleted).map((u) => [low(u.id), u.name]));
  type Entry = Levels["people"]["cooptimizers"][number];
  const person = (e: Entry): PickerCooptimizer | null => {
    const name = (e.dir ? dirName.get(low(e.dir.personId)) : undefined) ?? userName.get(e.id) ?? null;
    return name ? { id: e.id, name, email: (e.dir?.email ?? e.signedIn?.email ?? null)?.toLowerCase() ?? null } : null;
  };
  const coop = (id: string) => {
    const e = i.levels.people.entry(id);
    return e && !e.notCooptimizer ? person(e) : null;
  };
  const some = <T>(xs: (T | null)[]) => xs.filter((x): x is T => !!x);
  return {
    cooptimizers: some(i.levels.people.cooptimizers.map(person)),
    workers: (k) => some(i.peopleClients.filter((x) => x.worker !== false && x.clientKey === k).map((x) => coop(x.personId))),
    isCooptimizer: coop,
  };
}
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const coop = (p: PickerCooptimizer): PickerPerson => ({ name: p.name, ref: { kind: "cooptimizer", id: low(p.id), name: p.name }, email: p.email, external: false });

export async function peoplePicker(d: PickerDeps, q: { clientKey?: string | null; conversationId?: number; commitmentId?: number }): Promise<PeoplePickerData> {
  const me = low((await d.me()) ?? "");
  const problems: string[] = [];
  const people = await d.people().catch(() => null);
  if (!people) problems.push("Cooptimizers couldn't be read just now; type a name instead");
  const shown = new Set<string>();
  const take = (p: PickerPerson) => {
    const key = p.ref.kind === "cooptimizer" ? `c:${p.ref.id}` : `x:${p.ref.memberId}`;
    if (shown.has(key) || (p.ref.kind === "cooptimizer" && p.ref.id === me)) return false;
    shown.add(key);
    return true;
  };
  const groups: PickerGroup[] = [];

  if (q.conversationId !== undefined || q.commitmentId !== undefined) {
    const inIt = (await d.conversation(q).catch(() => null)) ?? [];
    const list = inIt
      .map((p): PickerPerson => {
        // A Cooptimizer in the chat is the same person as in the directory (their Entra id); anyone else is a chat member.
        const c = !p.external && people ? people.isCooptimizer(p.id) : null;
        return c ? coop(c) : p.external ? { name: p.name, ref: { kind: "external", memberId: low(p.id), name: p.name }, email: null, external: true } : { name: p.name, ref: { kind: "cooptimizer", id: low(p.id), name: p.name }, email: p.email, external: false };
      })
      .filter(take);
    if (list.length) groups.push({ key: "conversation", label: "In this conversation", people: list });
  }
  if (people && q.clientKey) {
    const list = people.workers(q.clientKey).map(coop).filter(take).sort(byName);
    if (list.length) groups.push({ key: "client", label: `On ${await d.clientName(q.clientKey)}`, people: list });
  }
  if (people) {
    const list = people.cooptimizers.map(coop).filter(take).sort(byName);
    if (list.length) groups.push({ key: "everyone", label: "Everyone at Cooptimize", people: list });
  }
  return { groups, problems };
}
