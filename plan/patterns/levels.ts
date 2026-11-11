// WP-1: each work item type's level, from the real parent and child links between items (never from type names, so a
// process with its own names works the same). Pure.
//
// The type graph: an edge A → B when an item of type A is the parent of an item of type B (A and B different; an item
// under one of its own type says nothing about levels). When both A → B and B → A occur, the direction seen more often
// wins (a tie keeps both, so both become middle). Then: a type with children types and no parent types is top; with
// both, middle; with parent types only, leaf; with neither, other (flat work, no links at all).
import type { Level } from "./types.ts";

export type Nest = { parent: string; child: string; count: number };

export function typeEdges(items: readonly { id: number; type: string; parentId: number | null }[]): Nest[] {
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

/** Every type seen, with its level. */
export function levelsOf(items: readonly { id: number; type: string; parentId: number | null }[]): Map<string, Level> {
  const edges = typeEdges(items);
  const down = new Set(edges.map((e) => e.parent));
  const up = new Set(edges.map((e) => e.child));
  const out = new Map<string, Level>();
  for (const t of [...new Set(items.map((i) => i.type))].sort()) out.set(t, down.has(t) && !up.has(t) ? "top" : down.has(t) ? "middle" : up.has(t) ? "leaf" : "other");
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
