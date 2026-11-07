// AH-6: Ahead's tree for the Gantt and the Grid, pure. The rows of one client as a tree (parent › children, siblings in
// a given order), which rows are open (a level for the whole tree, "Show: Epics · Features · Stories", with per-row
// carets on top of it), the rows on screen, a collapsed row's roll-up (the span of what's under it) and the level
// names from the process model (the types at each level, never hard-coded words).
import type { Tier } from "./ahead-model.ts";

export const LEVELS: readonly Tier[] = ["epic", "feature", "story"];
const RANK: Record<Tier, number> = { epic: 0, feature: 1, story: 2 };
export const levelRank = (t: Tier): number => RANK[t];

/** The level the tree shows down to, and the rows opened or closed by hand on top of it. */
export type Fold = { level: Tier; rows: Record<string, boolean> };
export const isFold = (v: unknown): v is Fold => {
  if (!v || typeof v !== "object") return false;
  const f = v as Partial<Fold>;
  return typeof f.level === "string" && (LEVELS as readonly string[]).includes(f.level) && !!f.rows && typeof f.rows === "object";
};

/** A row is open when its level is above the chosen one, unless its caret said otherwise. */
export const isOpenRow = (fold: Fold, r: { key: string; tier: Tier }): boolean => fold.rows[r.key] ?? RANK[r.tier] < RANK[fold.level];
/** A level for the whole tree: the carets start over. */
export const atLevel = (level: Tier): Fold => ({ level, rows: {} });
export const expandAll = (): Fold => atLevel("story");
export const collapseAll = (): Fold => atLevel("epic");
/** One caret on top of the level. */
export function setRow(fold: Fold, r: { key: string; tier: Tier }, open: boolean): Fold {
  const rows = { ...fold.rows };
  if (open === RANK[r.tier] < RANK[fold.level]) delete rows[r.key];
  else rows[r.key] = open;
  return { level: fold.level, rows };
}

export type TreeRow = { key: string; tier: Tier; item: { id: number; parentId: number | null } };
export type Node<T> = { row: T; children: Node<T>[] };

/** The rows as a tree: a row whose parent isn't among them is a root. Siblings in `order` (stable otherwise). */
export function tree<T extends TreeRow>(rows: readonly T[], order?: (a: T, b: T) => number): Node<T>[] {
  const ids = new Set(rows.map((r) => r.item.id));
  const nodes = new Map(rows.map((r) => [r.item.id, { row: r, children: [] as Node<T>[] }]));
  const roots: Node<T>[] = [];
  for (const r of rows) {
    const n = nodes.get(r.item.id)!;
    if (r.item.parentId !== null && ids.has(r.item.parentId) && r.item.parentId !== r.item.id) nodes.get(r.item.parentId)!.children.push(n);
    else roots.push(n);
  }
  if (order) {
    const sort = (ns: Node<T>[]) => {
      ns.sort((a, b) => order(a.row, b.row));
      for (const n of ns) sort(n.children);
    };
    sort(roots);
  }
  return roots;
}

export type Shown<T> = { node: Node<T>; open: boolean; /** Children in the tree (a caret only when there are some). */ kids: number };
/** The rows on screen, in tree order; a closed row hides everything under it. */
export function visible<T extends TreeRow>(roots: readonly Node<T>[], fold: Fold): Shown<T>[] {
  const out: Shown<T>[] = [];
  const walk = (n: Node<T>) => {
    const open = n.children.length > 0 && isOpenRow(fold, n.row);
    out.push({ node: n, open, kids: n.children.length });
    if (open) for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

export type Span = { start: string; end: string };
/**
 * A collapsed row's roll-up: from its children's earliest start to their latest end. A child with no span of its own
 * counts with its own roll-up. Null when nothing under the row has dates.
 */
export function rollup<T>(n: Node<T>, spanOf: (row: T) => Span | null): Span | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const c of n.children) {
    const s = spanOf(c.row) ?? rollup(c, spanOf);
    if (!s) continue;
    if (start === null || s.start < start) start = s.start;
    if (end === null || s.end > end) end = s.end;
  }
  return start !== null && end !== null ? { start, end } : null;
}

/** Everything under a row, depth first. */
export function descendants<T>(n: Node<T>): T[] {
  return n.children.flatMap((c) => [c.row, ...descendants(c)]);
}

/** "Stories" from "User Story", "Backlog items" from "Product Backlog Item", "Epics" from "Epic". */
export function pluralType(type: string): string {
  const t = type.trim();
  if (/^user story$/i.test(t)) return "Stories";
  if (/^product backlog item$/i.test(t)) return "Backlog items";
  const last = t.split(/\s+/).at(-1) ?? t;
  const plural = /[^aeiou]y$/i.test(last) ? `${last.slice(0, -1)}ies` : /(s|x|ch|sh)$/i.test(last) ? `${last}es` : `${last}s`;
  return t.slice(0, t.length - last.length) + plural;
}
const DEFAULT_NAMES: Record<Tier, string> = { epic: "Epics", feature: "Features", story: "Stories" };

/**
 * Each level's name from the types the rows have at it (the process model's level, through the row's tier): the most
 * common type's plural, and when the clients shown name a level differently, both ("Stories / Backlog items").
 */
export function levelNames(groups: readonly { rows: readonly { tier: Tier; item: { type: string } }[] }[]): Record<Tier, string> {
  const out = { ...DEFAULT_NAMES };
  for (const tier of LEVELS) {
    const names: string[] = [];
    for (const g of groups) {
      const count = new Map<string, number>();
      for (const r of g.rows) if (r.tier === tier) count.set(r.item.type, (count.get(r.item.type) ?? 0) + 1);
      const top = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      if (top && !names.includes(pluralType(top))) names.push(pluralType(top));
    }
    if (names.length) out[tier] = names.join(" / ");
  }
  return out;
}

/** "4 features", "1 story": a collapsed row's count, in its children's level words. */
export function countText(n: number, plural: string): string {
  const lower = plural.toLowerCase();
  if (n !== 1) return `${n} ${lower}`;
  const one = lower.endsWith("ies") ? `${lower.slice(0, -3)}y` : lower.endsWith("ses") || lower.endsWith("xes") ? lower.slice(0, -2) : lower.replace(/s$/, "");
  return `1 ${one}`;
}
