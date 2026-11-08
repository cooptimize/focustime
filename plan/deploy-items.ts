// DP-2: what a deployment moves, by the client's data platform. Pure: the seeded catalog (config/deploy-catalog.ts)
// with a client's own list on top, the defaults, what a client switch keeps, and matching spoken item names. A planned
// deployment keeps a snapshot of its ticked items (`picks.deploy_items`), so nothing here ever changes one already planned.
import { DATA_PLATFORMS, DEPLOY_CATALOG, PLATFORM_LABEL, type CatalogItem, type DataPlatform } from "../config/deploy-catalog.ts";

export type { DataPlatform };
/** One ticked item on a deployment: its key and the name it was planned with. */
export type DeployItem = { key: string; name: string };
/** One row of a client's saved list: a seeded item (by key) or the client's own (with a name). */
export type ItemRow = { key: string; name?: string; on: boolean; hidden?: boolean };
/** A client's saved lists, per platform; a platform it never edited is absent and follows the catalog. */
export type DeployItemsRule = Partial<Record<DataPlatform, ItemRow[]>>;
export type ListItem = { key: string; name: string; on: boolean; hidden: boolean; own: boolean };
export type ItemGroup = { platform: DataPlatform; label: string; items: ListItem[] };
export type ClientDeploy = { dataPlatform?: DataPlatform | null; deployItems?: DeployItemsRule | null };

const MAX_ROWS = 40;
const MAX_NAME = 60;
const KEY = /^[a-z0-9_.-]{1,80}$/;

export class DeployItemsInputError extends Error {}

/** A client's saved lists as sent or stored; throws DeployItemsInputError in plain words. */
export function parseDeployItems(v: unknown): DeployItemsRule {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new DeployItemsInputError("Deployment items must be a list per platform");
  const out: DeployItemsRule = {};
  for (const [p, rows] of Object.entries(v)) {
    if (!(DATA_PLATFORMS as readonly string[]).includes(p)) throw new DeployItemsInputError(`Unknown data platform ${p}`);
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new DeployItemsInputError(`A list of at most ${MAX_ROWS} items`);
    const seeded = new Map(DEPLOY_CATALOG[p as DataPlatform].map((c) => [c.key, c]));
    const keys = new Set<string>();
    const names = new Set<string>();
    out[p as DataPlatform] = rows.map((r: unknown) => {
      const x = (r ?? {}) as Record<string, unknown>;
      if (typeof x.key !== "string" || !KEY.test(x.key)) throw new DeployItemsInputError("An item needs a key");
      if (typeof x.on !== "boolean") throw new DeployItemsInputError("An item's default must be on or off");
      if (x.hidden !== undefined && typeof x.hidden !== "boolean") throw new DeployItemsInputError("Hidden must be yes or no");
      if (keys.has(x.key)) throw new DeployItemsInputError("An item appears twice");
      keys.add(x.key);
      const seed = seeded.get(x.key);
      const name = seed ? seed.name : typeof x.name === "string" ? x.name.trim() : "";
      if (!name || name.length > MAX_NAME) throw new DeployItemsInputError(`An item's name is 1 to ${MAX_NAME} characters`);
      if (names.has(name.toLowerCase())) throw new DeployItemsInputError(`"${name}" is on the list already`);
      names.add(name.toLowerCase());
      return { key: x.key, ...(seed ? {} : { name }), on: x.on, ...(x.hidden ? { hidden: true } : {}) };
    });
  }
  return out;
}

export function parsePlatform(v: unknown): DataPlatform {
  if (typeof v !== "string" || !(DATA_PLATFORMS as readonly string[]).includes(v)) throw new DeployItemsInputError("The data platform is Fabric or Azure");
  return v as DataPlatform;
}

const fromSeed = (c: CatalogItem): ListItem => ({ key: c.key, name: c.name, on: c.on, hidden: false, own: false });

/** One platform's whole list for a client, hidden items included: its saved order, then any seed it hasn't seen. */
export function fullList(platform: DataPlatform, rule: DeployItemsRule | null | undefined): ListItem[] {
  const catalog = DEPLOY_CATALOG[platform];
  const rows = rule?.[platform];
  if (!rows) return catalog.map(fromSeed);
  const seeds = new Map(catalog.map((c) => [c.key, c]));
  const saved = rows.flatMap((r): ListItem[] => {
    const seed = seeds.get(r.key);
    if (seed) return [{ ...fromSeed(seed), on: r.on, hidden: !!r.hidden }];
    return r.name ? [{ key: r.key, name: r.name, on: r.on, hidden: !!r.hidden, own: true }] : [];
  });
  const have = new Set(saved.map((s) => s.key));
  return [...saved, ...catalog.filter((c) => !have.has(c.key)).map(fromSeed)];
}

/** The groups Quick capture shows: the client's platform, or both with nothing pre-ticked when none is set. */
export function groupsFor(c: ClientDeploy | null | undefined): ItemGroup[] {
  const platform = c?.dataPlatform ?? null;
  const group = (p: DataPlatform): ItemGroup => ({
    platform: p,
    label: PLATFORM_LABEL[p],
    items: fullList(p, c?.deployItems).filter((i) => !i.hidden).map((i) => (platform ? i : { ...i, on: false })),
  });
  return platform ? [group(platform)] : DATA_PLATFORMS.map(group);
}

export const defaultKeys = (groups: readonly ItemGroup[]): string[] => groups.flatMap((g) => g.items.filter((i) => i.on).map((i) => i.key));

/** A list's saved rows from what the editor shows (seeded names aren't stored). */
export const toRows = (items: readonly ListItem[]): ItemRow[] => items.map((i) => ({ key: i.key, ...(i.own ? { name: i.name } : {}), on: i.on, ...(i.hidden ? { hidden: true } : {}) }));

/** The key for a client's own item, unique on its list. */
export function ownKey(name: string, taken: readonly string[]): string {
  const base = `own.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "item"}`;
  let k = base;
  for (let n = 2; taken.includes(k); n++) k = `${base}_${n}`;
  return k;
}

const lower = (s: string) => s.trim().toLowerCase();

/**
 * The ticks after the client changes: the new client's defaults, plus what I ticked by hand on an item both lists share
 * by name. Anything else resets (an untick too: "resets to that client's defaults").
 */
export function switchTicks(prev: readonly ItemGroup[], manual: ReadonlySet<string>, next: readonly ItemGroup[]): { ticked: string[]; manual: string[] } {
  const names = new Set(prev.flatMap((g) => g.items.filter((i) => manual.has(i.key)).map((i) => lower(i.name))));
  const kept = next.flatMap((g) => g.items.filter((i) => names.has(lower(i.name))).map((i) => i.key));
  return { ticked: [...new Set([...defaultKeys(next), ...kept])], manual: kept };
}

/**
 * The items a save ticks, from keys, in list order, one per name (an unset client shows Reports twice). Keys come from
 * the client's list, hidden items too, or from what the deployment already has (an item since hidden or renamed stays
 * as it was planned). `unknown` is what wasn't found.
 */
export function resolveTicked(keys: readonly string[], c: ClientDeploy | null | undefined, existing: readonly DeployItem[] | null | undefined): { items: DeployItem[]; unknown: string[] } {
  const platforms = c?.dataPlatform ? [c.dataPlatform] : DATA_PLATFORMS;
  const known = platforms.flatMap((p) => fullList(p, c?.deployItems)).map((i) => ({ key: i.key, name: i.name }));
  const old = existing ?? [];
  const want = new Set(keys);
  const unknown = keys.filter((k) => !known.some((i) => i.key === k) && !old.some((i) => i.key === k));
  // What the deployment already has keeps its planned name, and its place on the list.
  const order = [...known.map((i) => old.find((o) => o.key === i.key) ?? i), ...old.filter((o) => !known.some((i) => i.key === o.key))];
  const seen = new Set<string>();
  const items = order.filter((i) => want.has(i.key) && !seen.has(lower(i.name)) && seen.add(lower(i.name)));
  return { items, unknown };
}

/** "4 items"; null with none. */
export const itemsSummary = (items: readonly DeployItem[] | null | undefined): string | null => (items?.length ? `${items.length} ${items.length === 1 ? "item" : "items"}` : null);

const STOP = new Set(["the", "a", "an", "our", "my", "of", "and", "to", "all"]);
const stem = (w: string) => (w.endsWith("ies") && w.length > 4 ? `${w.slice(0, -3)}y` : w.endsWith("s") && !w.endsWith("ss") && w.length > 3 ? w.slice(0, -1) : w);
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);

function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  // One typed letter off: one replaced, added, dropped, or two swapped.
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

function score(said: readonly string[], item: readonly string[]): number {
  if (!said.length || !item.length) return 0;
  if (said.length === item.length && said.every((w, i) => w === item[i])) return 100;
  if (said.every((w) => item.some((t) => near(w, t)))) return 50 + (10 * said.length) / item.length;
  return 0;
}

export type NamedMatch = { items: ListItem[]; unmatched: string[] };

/**
 * Item names as someone said them ("warehouse SQL", "reports") against what the groups list: the best fit for each,
 * exact first, then every word said found in the name, a letter's typo allowed. Two different items that fit equally
 * ("SQL" on a list with two) are unmatched, never a guess.
 */
export function matchNamed(words: readonly string[], groups: readonly ItemGroup[]): NamedMatch {
  const all = groups.flatMap((g) => g.items);
  const picked = new Map<string, ListItem>();
  const unmatched: string[] = [];
  for (const raw of words) {
    const said = tokens(raw);
    const scored = all.map((i) => ({ i, s: score(said, tokens(i.name)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const best = scored.filter((x) => x.s === scored[0]?.s);
    const names = new Set(best.map((x) => lower(x.i.name)));
    if (best.length && names.size === 1) picked.set(lower(best[0]!.i.name), best[0]!.i);
    else unmatched.push(raw.trim());
  }
  return { items: [...picked.values()], unmatched };
}

/** The item words in a request: what follows "with", "including", "moving" and the like, split at commas and "and". */
export function namedInRequest(text: string): string[] {
  const m = /\b(?:with|including|moving|covering|plus)\b(.*)$/i.exec(text);
  return m ? m[1]!.split(/,|&|\+|\band\b/i).map((s) => s.replace(/[.!?]+$/, "").trim()).filter(Boolean) : [];
}
