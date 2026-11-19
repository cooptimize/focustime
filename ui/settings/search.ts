// SA-5: the one search over Settings (and, for admins, Admin), the same in Settings' box, the command menu's Settings
// results and Search Admin. Pure: no React, no DOM, no request. What a person types is matched here, in the browser,
// and goes nowhere else: it is never sent, stored or logged.
//
// What is matched: each section's name and old names, each setting's label, its old labels and the words people use
// for it (`keywords` in ui/settings/registry.ts), its group, and its section's name; each of Admin's parts, tabs and
// settings (ui/settings/admin/settings-list.ts) the same way; and the short list of things that aren't settings
// (NOT_SETTINGS in the registry). There is no second list of words anywhere.
//
// The order (tiers, best first):
//   0. a section or Admin's part named exactly what was typed ("audit" is Admin › Audit for an admin);
//   1. a section, or one of Admin's tabs, whose name has every word typed as a whole word ("ai" is AI and assistant);
//   2. a setting whose label (or its group's heading) has every word as a whole word;
//   3. every word whole among its other words (old labels, the words people use, its section);
//   4. every word the start of one of its words (3 letters at least: "ai" never matches "email" or "detail").
// Within a tier: the person's own before Admin's, a setting's own row before one of its parts, the whole of what was
// typed being one of its names, fewer words in the label, then the registry's order.
import { NOT_SETTINGS, SECTIONS, SETTINGS, sectionOf, whereOf, type NotSetting, type SectionDef, type SettingDef } from "./registry.ts";
import { ADMIN_PARTS, CLIENT_TABS, PART_NAME, PART_TABS, TAB_WORDS, adminHref, type TabbedPart } from "./admin/places.ts";
import { SETTINGS_ON_SCREEN, type AdminSetting } from "./admin/settings-list.ts";

export type ResultKind = "section" | "setting" | "client" | "admin" | "answer";
export type SearchResult = {
  /** "section:hours", "setting:lunch", "client:client-color", "admin:part:audit", "answer:password". */
  id: string;
  kind: ResultKind;
  label: string;
  /** Where it is, as the result says it: "Reminders and notices › Close out", "Admin › Team defaults › AI". */
  where: string;
  /** The name that matched when it isn't the label ("was “Notify this device”"); null when the label matched. */
  matched: string | null;
  /** A Settings place (section, setting): a section, a setting, a client's page's setting (its section is "client"). */
  section?: string;
  setting?: string | null;
  /** Admin's place (#/admin/...). */
  href?: string;
  /** Something that isn't a setting: what to say. */
  answer?: string;
  tier: number;
};
export type SearchOpts = { demo?: boolean | undefined; dev?: boolean | undefined; phone?: boolean | undefined; admin?: boolean | undefined; limit?: number | undefined };

/** Lower case, accents off, punctuation as spaces ("Who's set up" is "who s set up"). */
export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
/** Words that say nothing about which setting ("how do I change the…"). */
const STOP = new Set(["a", "an", "the", "to", "of", "for", "i", "s", "is", "how", "can", "do", "where", "my", "me", "change", "set", "turn", "find"]);

/** The words typed, without the ones that say nothing (all of them when nothing else is left). */
export function wordsOf(q: string): string[] {
  const all = norm(q).split(" ").filter(Boolean);
  const kept = all.filter((w) => !STOP.has(w));
  return kept.length ? kept : all;
}
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);
/** One word typed against one word of a name: the same word, or its plural. */
const same = (w: string, t: string) => t === w || t === `${w}s` || t === `${w}es` || w === `${t}s` || w === `${t}es`;
const whole = (w: string, ts: readonly string[]) => ts.some((t) => same(w, t));
const starts = (w: string, ts: readonly string[]) => w.length >= 3 && ts.some((t) => t.startsWith(w));
const allWhole = (ws: readonly string[], ts: readonly string[]) => ws.every((w) => whole(w, ts));
/** The whole of what was typed is this name, word for word (plurals aside). */
const exactly = (ws: readonly string[], name: string) => {
  const ts = tokens(name).filter((t) => !STOP.has(t));
  return ts.length === ws.length && ws.every((w, i) => same(w, ts[i]!));
};

/** What one thing is matched on. */
export type Matchable = { label: string; old?: readonly string[] | undefined; words?: readonly string[] | undefined; group?: string | undefined; place?: string | undefined };

/**
 * How well one thing matches what was typed: its tier (0 to 4, see the top of this file) and the name that matched
 * when it isn't the label; null when it doesn't match. `asPlace` is for sections and Admin's parts and tabs (tiers 0
 * and 1); everything else starts at tier 2.
 */
export function rank(ws: readonly string[], m: Matchable, asPlace: false | "section" | "tab" = false): { tier: number; matched: string | null; exact: boolean } | null {
  if (!ws.length) return null;
  const names = [m.label, ...(m.old ?? [])];
  const exact = [...names, ...(m.words ?? [])].some((n) => exactly(ws, n));
  if (asPlace) {
    const hit = names.find((n) => exactly(ws, n));
    // The label itself having the words, the old name isn't said ("ai" is AI and assistant, not "was AI").
    if (hit && asPlace === "section") return { tier: 0, matched: hit === m.label || allWhole(ws, tokens(m.label)) ? null : hit, exact: true };
    const w = names.find((n) => allWhole(ws, tokens(n)));
    if (w) return { tier: 1, matched: w === m.label ? null : w, exact };
  }
  const label = tokens(m.label);
  if (allWhole(ws, label) || (m.group && allWhole(ws, tokens(m.group)))) return { tier: 2, matched: null, exact };
  const others = [...(m.old ?? []), ...(m.words ?? [])];
  const every = [...label, ...tokens(m.group ?? ""), ...tokens(m.place ?? ""), ...others.flatMap(tokens)];
  // The old name said beside it: the one with the most of the words typed.
  const oldHit = () => {
    const score = (o: string) => ws.filter((w) => whole(w, tokens(o)) || starts(w, tokens(o))).length;
    const best = [...(m.old ?? [])].sort((a, b) => score(b) - score(a))[0];
    return best && score(best) > 0 ? best : null;
  };
  if (allWhole(ws, every)) return { tier: 3, matched: oldHit(), exact };
  if (ws.every((w) => whole(w, every) || starts(w, every))) return { tier: 4, matched: oldHit(), exact };
  return null;
}

type Scored = SearchResult & { admin: boolean; part: boolean; exact: boolean; size: number; order: number };

const shownSection = (s: SectionDef | undefined, o: SearchOpts) => !!s && (!s.demoOnly || !!o.demo);
const shownSetting = (d: SettingDef, o: SearchOpts) => !(d.devOnly && !o.dev) && !(d.demoOnly && !o.demo) && !(d.phoneOnly && !o.phone);

/** Every candidate, scored. */
function candidates(ws: readonly string[], o: SearchOpts): Scored[] {
  const out: Scored[] = [];
  let order = 0;
  const push = (r: Omit<Scored, "order">) => out.push({ ...r, order: order++ });
  for (const s of SECTIONS) {
    if (!shownSection(s, o) || s.parent) continue;
    const r = rank(ws, { label: s.label, old: s.old, words: s.keywords }, "section");
    // An old section name that is a setting's own label now ("Standing blocks", "My VM") finds that setting instead.
    if (r?.matched && SETTINGS.some((d) => norm(d.label) === norm(r.matched!))) continue;
    if (r) push({ id: `section:${s.id}`, kind: "section", label: s.label, where: "Settings", matched: r.matched, section: s.id, setting: null, tier: r.tier, admin: false, part: false, exact: r.exact, size: tokens(s.label).length });
  }
  for (const d of SETTINGS) {
    const s = sectionOf(d.section);
    if (!shownSection(s, o) || !shownSetting(d, o)) continue;
    const client = d.section === "client";
    const r = rank(ws, { label: d.label, old: d.old, words: d.keywords, group: d.group, place: client ? "client" : s!.label });
    if (!r) continue;
    push({ id: `${client ? "client" : "setting"}:${d.id}`, kind: client ? "client" : "setting", label: d.label, where: client ? "A client's page" : whereOf(d), matched: r.matched, section: d.section, setting: d.id, tier: r.tier, admin: false, part: !!d.part && !client, exact: r.exact, size: tokens(d.label).length });
  }
  for (const n of NOT_SETTINGS) {
    const r = rank(ws, { label: n.label, words: n.keywords });
    if (r) push({ id: `answer:${n.id}`, kind: "answer", label: n.label, where: n.where ?? "Not in Settings", matched: null, answer: n.text, ...(n.href ? { href: n.href } : {}), ...(n.section ? { section: n.section, setting: n.setting ?? null } : {}), tier: r.tier, admin: false, part: false, exact: r.exact, size: tokens(n.label).length });
  }
  if (o.admin) for (const a of adminItems()) {
    const r = rank(ws, a.match, a.asPlace);
    if (r) push({ id: `admin:${a.id}`, kind: "admin", label: a.match.label, where: a.where, matched: r.matched, href: a.href, tier: r.tier, admin: true, part: false, exact: r.exact, size: tokens(a.match.label).length });
  }
  return out;
}

/** The best first, by the tiers and the order within a tier at the top of this file. */
// Admin's results come under all of the person's own, except an Admin part named by the words ("audit", "health").
const under = (x: Scored) => (x.admin && !(x.tier === 0 && /^admin:(part|place):/.test(x.id)) ? 1 : 0);
const byRank = (a: Scored, b: Scored) => under(a) - under(b) || a.tier - b.tier || +a.admin - +b.admin || +a.part - +b.part || +b.exact - +a.exact || a.size - b.size || a.order - b.order;
const strip = ({ admin: _a, part: _p, exact: _e, size: _s, order: _o, ...r }: Scored): SearchResult => r;

/** Settings' search: everything that matches, best first. Nothing typed is nothing found. */
export function search(q: string, o: SearchOpts = {}): SearchResult[] {
  const ws = wordsOf(q);
  if (!ws.length) return [];
  return candidates(ws, o).sort(byRank).slice(0, o.limit ?? 12).map(strip);
}

/** Small edits between two words (a typo or two), up to `max`; more than that is max + 1. */
function edits(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * When nothing matches: up to three nearest settings, by any one word typed (a word close to one of theirs, a typo
 * or two away, or one word of several). Admin's only for an admin, as in the search itself.
 */
export function nearest(q: string, o: SearchOpts = {}): SearchResult[] {
  const ws = wordsOf(q).filter((w) => w.length >= 3);
  if (!ws.length) return [];
  const scored: { r: SearchResult; d: number; order: number }[] = [];
  let order = 0;
  const near = (name: Matchable) => {
    const ts = [...tokens(name.label), ...(name.old ?? []).flatMap(tokens), ...(name.words ?? []).flatMap(tokens)].filter((t) => t.length >= 3);
    let best = 99;
    for (const w of ws) for (const t of ts) best = Math.min(best, t.startsWith(w) || w.startsWith(t) ? 1 : edits(w, t, 2));
    return best;
  };
  for (const s of SECTIONS) {
    if (!shownSection(s, o) || s.parent) continue;
    const d = near({ label: s.label, old: s.old, words: s.keywords });
    if (d <= 2) scored.push({ r: { id: `section:${s.id}`, kind: "section", label: s.label, where: "Settings", matched: null, section: s.id, setting: null, tier: 5 }, d, order: order++ });
  }
  for (const def of SETTINGS) {
    const s = sectionOf(def.section);
    if (!shownSection(s, o) || !shownSetting(def, o) || def.part) continue;
    const d = near({ label: def.label, old: def.old, words: def.keywords });
    const client = def.section === "client";
    if (d <= 2) scored.push({ r: { id: `${client ? "client" : "setting"}:${def.id}`, kind: client ? "client" : "setting", label: def.label, where: client ? "A client's page" : whereOf(def), matched: null, section: def.section, setting: def.id, tier: 5 }, d, order: order++ });
  }
  if (o.admin)
    for (const a of adminItems()) {
      const d = near(a.match);
      if (d <= 2) scored.push({ r: { id: `admin:${a.id}`, kind: "admin", label: a.match.label, where: a.where, matched: null, href: a.href, tier: 5 }, d, order: order++ + 10_000 });
    }
  return scored.sort((a, b) => a.d - b.d || a.order - b.order).slice(0, 3).map((x) => x.r);
}

// ---- Admin's places and settings, for admins only ----

/** `local` is where inside Admin, as Search Admin says it ("Team defaults › AI"); `where` is that from Settings ("Admin › Team defaults › AI"). */
type AdminItem = { id: string; match: Matchable; where: string; local: string; href: string; asPlace: false | "section" | "tab" };
const item = (id: string, match: Matchable, local: string, href: string, asPlace: false | "section" | "tab", clients = false): AdminItem => ({ id, match, local, where: local === "Admin" ? "Admin" : `Admin › ${clients ? "Clients › " : ""}${local}`, href, asPlace });

/** Admin itself, its parts, its tabs and its settings on screen, as search sees them. */
export function adminItems(client: string | null = null): AdminItem[] {
  const items: AdminItem[] = [item("place:admin", { label: "Admin", words: ["admin console", "team settings"] }, "Admin", "#/admin", "section")];
  for (const [p, name] of ADMIN_PARTS) items.push(item(`part:${p}`, { label: name }, "Admin", adminHref({ part: p }), "section"));
  for (const p of Object.keys(PART_TABS) as TabbedPart[])
    for (const [t, name] of PART_TABS[p]) if (norm(name) !== norm(PART_NAME[p])) items.push(item(`tab:${p}/${t}`, { label: name, place: PART_NAME[p], words: TAB_WORDS[`${p}/${t}`] }, PART_NAME[p], adminHref({ part: p, tab: t }), "tab"));
  for (const [t, name] of CLIENT_TABS) items.push(item(`tab:client/${t}`, { label: name, place: "client" }, client ? `${client}'s page` : "A client's page", client ? adminHref({ part: "clients", client, tab: t }) : adminHref({ part: "clients" }), "tab", true));
  for (const x of SETTINGS_ON_SCREEN) items.push(adminSettingItem(x, client));
  return items;
}

function adminSettingItem(x: AdminSetting, client: string | null): AdminItem {
  const match: Matchable = { label: x.label, words: x.words };
  if (x.scope === "client" && x.part === "clients") {
    const tabLabel = CLIENT_TABS.find(([t]) => t === x.tab)?.[1];
    return tabLabel
      ? item(`setting:client/${x.key}`, { ...match, place: "client" }, `${client ?? "Each client"} › ${tabLabel}`, client && x.tab ? adminHref({ part: "clients", client, tab: x.tab }) : adminHref({ part: "clients" }), false, true)
      : item(`setting:client/${x.key}`, { ...match, place: "client" }, "Clients › All accounts", adminHref({ part: "clients" }), false);
  }
  const tabLabel = x.tab && x.part !== "clients" ? PART_TABS[x.part as TabbedPart]?.find(([t]) => t === x.tab)?.[1] : null;
  return item(`setting:${x.scope}/${x.key}`, { ...match, place: PART_NAME[x.part!] }, [PART_NAME[x.part!], tabLabel].filter(Boolean).join(" › "), adminHref({ part: x.part!, tab: x.tab }), false);
}

/** A result's address: a Settings place, Admin's, or an answer's own link (null: an answer with nowhere to go). */
export function resultHref(r: SearchResult): string | null {
  if (r.href) return r.href;
  // A client's page needs its client: the result asks which, from Clients.
  if (r.kind === "client") return "#/settings/clients";
  if (r.section) return `#/settings/${r.section}${r.setting ? `/${r.setting}` : ""}`;
  return null;
}

export type { NotSetting };
