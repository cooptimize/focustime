// SA-4: Search Admin, in Admin's rail: parts, tabs, clients by name or other name, people by name, and settings by
// label (the one list, settings-list.ts). Pure: the rail draws the hits. A client's setting found while a client's page
// is open goes to that client's tab; otherwise to Clients. SA-5: ranked the way Settings' search ranks
// (ui/settings/search.ts `rank`): a part named exactly, then a tab, client or person by whole words, then a setting's
// label, its other words, then the start of a word. Nothing typed leaves the browser.
import { adminItems, rank, wordsOf, type Matchable } from "../search.ts";
import { adminHref, type AdminAt } from "./places.ts";

export type SearchClient = { key: string; names?: readonly string[]; aliases?: readonly string[] };
export type SearchPerson = { id: string; name: string };
export type AdminHit = { id: string; kind: "part" | "tab" | "client" | "person" | "setting"; label: string; where: string; href: string };

export function searchAdmin(q: string, o: { clients: readonly SearchClient[]; people: readonly SearchPerson[]; at: AdminAt | null }): AdminHit[] {
  const ws = wordsOf(q);
  if (!ws.length) return [];
  const client = o.at?.client ?? null;
  const out: (AdminHit & { tier: number; order: number })[] = [];
  const add = (h: AdminHit, m: Matchable, asPlace: false | "section" | "tab") => {
    const r = rank(ws, m, asPlace);
    if (r) out.push({ ...h, tier: r.tier, order: out.length });
  };
  for (const a of adminItems(client)) {
    if (a.id === "place:admin") continue;
    const kind = a.id.startsWith("part:") ? "part" : a.id.startsWith("tab:") ? "tab" : "setting";
    // Search Admin says where inside Admin ("Team defaults › AI").
    add({ id: a.id, kind, label: a.match.label, where: a.local, href: a.href }, a.match, a.asPlace);
  }
  for (const c of o.clients) {
    const other = [...(c.names ?? []), ...(c.aliases ?? [])].filter((n) => n !== c.key);
    const r = rank(ws, { label: c.key, old: other }, "tab");
    if (r) out.push({ id: `client:${c.key}`, kind: "client", label: c.key, where: r.matched ? `Client · also "${r.matched}"` : "Client", href: adminHref({ part: "clients", client: c.key }), tier: r.tier, order: out.length });
  }
  for (const p of o.people) add({ id: `person:${p.id}`, kind: "person", label: p.name, where: "People", href: adminHref({ part: "people", tab: "people" }) }, { label: p.name }, "tab");
  return out
    .sort((a, b) => a.tier - b.tier || a.order - b.order)
    .slice(0, 40)
    .map(({ tier: _t, order: _o, ...h }) => h);
}
