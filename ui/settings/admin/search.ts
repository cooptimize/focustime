// SA-4: Search Admin, in Admin's rail: parts, tabs, clients by name or other name, people by name, and settings by
// label (the one list, settings-list.ts). Pure: the rail draws the hits. A client's setting found while a client's page
// is open goes to that client's tab; otherwise to Clients.
import { ADMIN_PARTS, CLIENT_TABS, PART_NAME, PART_TABS, adminHref, type AdminAt, type TabbedPart } from "./places.ts";
import { SETTINGS_ON_SCREEN } from "./settings-list.ts";

export type SearchClient = { key: string; names?: readonly string[]; aliases?: readonly string[] };
export type SearchPerson = { id: string; name: string };
export type AdminHit = { id: string; kind: "part" | "tab" | "client" | "person" | "setting"; label: string; where: string; href: string };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export function searchAdmin(q: string, o: { clients: readonly SearchClient[]; people: readonly SearchPerson[]; at: AdminAt | null }): AdminHit[] {
  const s = norm(q.trim());
  if (!s) return [];
  const has = (t: string) => norm(t).includes(s);
  const out: AdminHit[] = [];
  for (const [p, name] of ADMIN_PARTS) if (has(name)) out.push({ id: `part:${p}`, kind: "part", label: name, where: "Admin", href: adminHref({ part: p }) });
  for (const p of Object.keys(PART_TABS) as TabbedPart[])
    for (const [t, name] of PART_TABS[p]) if (has(name) && norm(name) !== norm(PART_NAME[p])) out.push({ id: `tab:${p}/${t}`, kind: "tab", label: name, where: PART_NAME[p], href: adminHref({ part: p, tab: t }) });
  const client = o.at?.client ?? null;
  for (const [t, name] of CLIENT_TABS) if (has(name)) out.push({ id: `tab:client/${t}`, kind: "tab", label: name, where: client ? `${client}'s page` : "A client's page", href: client ? adminHref({ part: "clients", client, tab: t }) : adminHref({ part: "clients" }) });
  for (const c of o.clients) {
    const other = [...(c.names ?? []), ...(c.aliases ?? [])].find((n) => n !== c.key && has(n));
    if (has(c.key) || other) out.push({ id: `client:${c.key}`, kind: "client", label: c.key, where: other ? `Client · also "${other}"` : "Client", href: adminHref({ part: "clients", client: c.key }) });
  }
  for (const p of o.people) if (has(p.name)) out.push({ id: `person:${p.id}`, kind: "person", label: p.name, where: "People", href: adminHref({ part: "people", tab: "people" }) });
  for (const x of SETTINGS_ON_SCREEN) {
    if (!has(x.label)) continue;
    if (x.scope === "client" && x.part === "clients") {
      const tabLabel = CLIENT_TABS.find(([t]) => t === x.tab)?.[1];
      out.push({ id: `setting:client/${x.key}`, kind: "setting", label: x.label, where: tabLabel ? `${client ? `${client} › ` : "Each client › "}${tabLabel}` : "Clients › All accounts", href: client && x.tab ? adminHref({ part: "clients", client, tab: x.tab }) : adminHref({ part: "clients" }) });
    } else if (x.part) {
      const tabLabel = x.tab && x.part !== "clients" ? PART_TABS[x.part as TabbedPart]?.find(([t]) => t === x.tab)?.[1] : null;
      out.push({ id: `setting:${x.scope}/${x.key}`, kind: "setting", label: x.label, where: [PART_NAME[x.part], tabLabel].filter(Boolean).join(" › "), href: adminHref({ part: x.part, tab: x.tab }) });
    }
  }
  return out.slice(0, 40);
}
