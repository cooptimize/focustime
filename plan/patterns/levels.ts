// WP-1, WP-2: each work item type's level, from the real parent and child links between items (never from type names,
// so a process with its own names works the same). Pure.
//
// The type graph: an edge A → B when an item of type A is the parent of an item of type B (A and B different; an item
// under one of its own type says nothing about levels). WP-2: a type's level comes from what most of its items do, not
// from any one item. A type has children when at least PARENT_SHARE of its items have a child of another type, and has
// a parent when at least PARENT_SHARE of its items sit under an item of another type. Then: children and no parent is
// top; both, middle; a parent only, leaf; neither, other (flat work). One story with one task no longer makes every
// story a parent.
import type { Level } from "./types.ts";

export type Nest = { parent: string; child: string; count: number };

/** WP-2: the share of a type's items that must have children (or a parent) for the type to count as having them. */
export const PARENT_SHARE = 0.1;
export const PARENT_SHARE_WORDS = "A type counts as having children when at least 1 in 10 of its items has a child of another type, and as having a parent the same way.";

type Linked = { id: number; type: string; parentId: number | null; inWindow?: boolean };

/** WP-2: shares count only items in the window: parents read for structure were read because they have children. */
const counts = (i: Linked) => i.inWindow !== false;

export function typeEdges(items: readonly Linked[]): Nest[] {
  const typeOf = new Map(items.map((i) => [i.id, i.type]));
  const counts = new Map<string, number>();
  for (const i of items) {
    if (i.parentId === null) continue;
    const p = typeOf.get(i.parentId);
    if (p === undefined || p === i.type) continue;
    const k = `${p}\u0000${i.type}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: Nest[] = [];
  for (const [k, n] of counts) {
    const [parent, child] = k.split("\u0000") as [string, string];
    const back = counts.get(`${child}\u0000${parent}`) ?? 0;
    if (n >= back) out.push({ parent, child, count: n });
  }
  return out.sort((a, b) => b.count - a.count || a.parent.localeCompare(b.parent) || a.child.localeCompare(b.child));
}

/**
 * Per type: its items, how many have a child of another type, and how many sit under an item of another type. Only
 * links along the type graph's edges count (when A → B and B → A both occur, the direction seen more often).
 */
export function typeLinks(items: readonly Linked[], inWindowOnly = true): Map<string, { items: number; withChildren: number; withParent: number }> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const edges = new Set(typeEdges(items).map((e) => `${e.parent}\u0000${e.child}`));
  const along = (p: Linked | undefined, c: Linked): p is Linked => !!p && p.type !== c.type && edges.has(`${p.type}\u0000${c.type}`);
  const parentsWithKids = new Set<number>();
  for (const i of items) {
    const p = i.parentId === null ? undefined : byId.get(i.parentId);
    if (along(p, i)) parentsWithKids.add(p.id);
  }
  const out = new Map<string, { items: number; withChildren: number; withParent: number }>();
  for (const i of items) {
    if (inWindowOnly && !counts(i)) continue;
    const r = out.get(i.type) ?? out.set(i.type, { items: 0, withChildren: 0, withParent: 0 }).get(i.type)!;
    r.items++;
    if (parentsWithKids.has(i.id)) r.withChildren++;
    if (along(i.parentId === null ? undefined : byId.get(i.parentId), i)) r.withParent++;
  }
  return out;
}

/** Whether a share of a type's items is meaningful (the threshold itself counts). */
export const meaningful = (n: number, of: number, share = PARENT_SHARE): boolean => of > 0 && n / of >= share;

/** Every type seen, with its level. */
export function levelsOf(items: readonly Linked[], share = PARENT_SHARE): Map<string, Level> {
  const links = typeLinks(items);
  const out = new Map<string, Level>();
  // A type seen only among parents read for structure: from all its items (there is nothing else to go on).
  const all = typeLinks(items, false);
  for (const t of [...all.keys()].sort()) {
    const l = links.get(t) ?? all.get(t)!;
    const down = meaningful(l.withChildren, l.items, share);
    const up = meaningful(l.withParent, l.items, share);
    out.set(t, down && !up ? "top" : down ? "middle" : up ? "leaf" : "other");
  }
  return out;
}

/** How many links up an item sits from the top of its chain (1: no parent known), following parents in `byId`. */
export function depthOf(id: number, byId: ReadonlyMap<number, { parentId: number | null }>): number {
  let d = 1;
  const seen = new Set<number>([id]);
  for (let p = byId.get(id)?.parentId ?? null; p !== null && byId.has(p) && !seen.has(p); p = byId.get(p)!.parentId) {
    seen.add(p);
    d++;
  }
  return d;
}
