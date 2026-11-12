// WP-1, WP-2: what a classification shows, per client, for Build work and for Tickets and support: request types,
// layers, readiness, what is missing most by request type, confidence, the most suggested "other" names, the feature
// shapes (no AI: the layers a parent's classified children touch, as a set, only for parents with at least two
// classified children) and agreement. WP-2 adds coverage: items in scope, labeled, and not labeled by reason, adding up.
// WP-3: agreement per missing fact and per layer, readiness by request type, the list each label was made on, labels
// that need labeling again, and the per-client tables (a column per client beside all clients and without the
// largest). Counts only; the page sums clients (and splits them by platform) itself. Pure.
import { FEW, FEW_WORDS, tooFew } from "./analysis.ts";
import { OTHER, SHAPE_MIN_CHILDREN, SHAPES_SHOWN, agreementOf, commonShapes, sampleSize, shapeOf, toClassify, type Agreement, type FactAgree } from "./labels.ts";
import type { Stale } from "./owned.ts";
import { kindOfType, type Kind } from "./kinds.ts";
import type { Labels, PatternItem } from "./types.ts";

export type Shape = { requestType: string; shape: string[]; count: number };
export type Results = {
  labeled: number;
  requestTypes: Record<string, number>;
  layers: Record<string, number>;
  readiness: Record<string, number>;
  confidence: Record<string, number>;
  /** missing[requestType][what] = count. */
  missing: Record<string, Record<string, number>>;
  /** WP-3: readinessByType[requestType][readiness] = count. */
  readinessByType: Record<string, Record<string, number>>;
  /** WP-2: the names suggested for "other", with counts (names only). */
  otherNames: Record<string, number>;
  /** Shapes of parents with at least two classified children, as a set (WP-3: the ten most common); how many parents. */
  shapes: { parents: number; sets: Shape[] };
  /** The raw pairs' agreement (pairs counted, so the page can weigh clients). */
  agreement: Agreement;
  /** WP-3: agreement sample items whose second answer failed its check. */
  agreeFailed: number;
  /** WP-3: labels by the list version they were made on, and those that need labeling again, by reason. */
  from: Record<string, number>;
  rerun: Partial<Record<Stale, number>>;
};

/** WP-2: where every item read went. In scope = left out + to classify; to classify = labeled + the reasons. */
export type Coverage = {
  /** Items the layout read in the window (all of the client's), and those outside scope; null before WP-2. */
  read: number | null;
  outside: number | null;
  inScope: number;
  leftOut: number;
  toClassify: number;
  labeled: number;
  /** Not labeled: AI not allowed for this client, the answer failed its check, not reached (the run stopped or hasn't run). */
  aiOff: number;
  failed: number;
  notReached: number;
  /** WP-3: not labeled on the list in use: its label is on an earlier list that can't be carried (a run is needed). */
  earlier?: number;
};

export type ClientResults = { coverage: Coverage; build: Results; tickets: Results };

export type CoverageInput = {
  read: number | null;
  outside: number | null;
  /** The classification that made these labels skipped this client for Allow AI (or AI isn't allowed for it now). */
  skippedForAi: boolean;
  /** Items whose answer failed its check in that classification. */
  failed: ReadonlySet<number>;
  /** Items found outside the scope when their text was read (moved since the inventory): counted outside, not in scope. */
  movedOut?: ReadonlySet<number>;
  /** WP-3: items whose label is on an earlier list that can't be carried to the list in use. */
  earlier?: ReadonlySet<number>;
};

const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);
const empty = (): Results => ({ labeled: 0, requestTypes: {}, layers: {}, readiness: {}, confidence: {}, missing: {}, readinessByType: {}, otherNames: {}, shapes: { parents: 0, sets: [] }, agreement: agreementOf([]), agreeFailed: 0, from: {}, rerun: {} });

/** An item's labels on the list in use (WP-3: carried from the list they were made on, stale when they need labeling again). */
export type LabelMap = ReadonlyMap<number, { labels: Labels; labelsB: Labels | null; from?: string; stale?: Stale | null; failedB?: boolean }>;

function resultsFor(items: readonly PatternItem[], labels: LabelMap): Results {
  const r = empty();
  const pairs: [Labels, Labels][] = [];
  for (const i of items) {
    const row = labels.get(i.id);
    if (!row) continue;
    const l = row.labels;
    r.labeled++;
    bump(r.requestTypes, l.requestType);
    for (const x of l.layers) bump(r.layers, x);
    bump(r.readiness, l.readiness);
    bump(r.confidence, l.confidence);
    bump((r.readinessByType[l.requestType] ??= {}), l.readiness);
    if (l.requestType === OTHER && l.otherName) bump(r.otherNames, l.otherName.toLowerCase());
    const m = (r.missing[l.requestType] ??= {});
    for (const x of l.missing) bump(m, x);
    if (row.labelsB) pairs.push([l, row.labelsB]);
    if (row.failedB) r.agreeFailed++;
    if (row.from) bump(r.from, row.from);
    if (row.stale) r.rerun[row.stale] = (r.rerun[row.stale] ?? 0) + 1;
  }
  r.agreement = agreementOf(pairs);
  // Shapes: each classified item with at least two classified children (any level: the data decides what a parent is).
  const kids = new Map<number, Labels[]>();
  for (const i of items) {
    const l = labels.get(i.id)?.labels;
    if (l && i.parentId !== null) (kids.get(i.parentId) ?? kids.set(i.parentId, []).get(i.parentId)!).push(l);
  }
  const parents = items.filter((i) => labels.has(i.id) && (kids.get(i.id)?.length ?? 0) >= SHAPE_MIN_CHILDREN);
  r.shapes = { parents: parents.length, sets: commonShapes(parents.map((p) => ({ type: labels.get(p.id)!.labels.requestType, shape: shapeOf(kids.get(p.id)!) })), 50) };
  return r;
}

/** One client's results. `items`: its items as of the newest inventory (in scope, plus parents read for structure). */
export function resultsOf(items: readonly PatternItem[], labels: LabelMap, kinds: Readonly<Record<string, Kind>>, cov: CoverageInput): ClientResults {
  const kindOf = (t: string) => kindOfType(kinds, t);
  const moved = cov.movedOut ?? new Set<number>();
  const inScope = items.filter((i) => i.inWindow && !moved.has(i.id));
  const movedHere = items.filter((i) => i.inWindow && moved.has(i.id)).length;
  const todo = toClassify(inScope, kindOf);
  const labeled = todo.filter((i) => labels.has(i.id)).length;
  const unlabeled = todo.filter((i) => !labels.has(i.id));
  const earlierSet = cov.earlier ?? new Set<number>();
  const earlier = unlabeled.filter((i) => earlierSet.has(i.id)).length;
  const rest = unlabeled.filter((i) => !earlierSet.has(i.id));
  const aiOff = cov.skippedForAi ? rest.length : 0;
  const failed = cov.skippedForAi ? 0 : rest.filter((i) => cov.failed.has(i.id)).length;
  return {
    coverage: { read: cov.read, outside: cov.outside === null ? null : cov.outside + movedHere, inScope: inScope.length, leftOut: inScope.length - todo.length, toClassify: todo.length, labeled, aiOff, failed, notReached: rest.length - aiOff - failed, earlier },
    build: resultsFor(todo.filter((i) => kindOf(i.type) === "build"), labels),
    tickets: resultsFor(todo.filter((i) => kindOf(i.type) === "tickets"), labels),
  };
}

const add = (a: Record<string, number>, b: Record<string, number>) => {
  for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v;
};
function sumShapes(list: readonly Shape[][]): Shape[] {
  const m = new Map<string, Shape>();
  for (const s of list.flat()) {
    const k = `${s.requestType}\u0000${s.shape.join("|")}`;
    const hit = m.get(k);
    if (hit) hit.count += s.count;
    else m.set(k, { ...s, shape: [...s.shape] });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.requestType.localeCompare(b.requestType) || a.shape.join().localeCompare(b.shape.join())).slice(0, SHAPES_SHOWN);
}
const addFacts = (a: Record<string, FactAgree>, b: Record<string, FactAgree> | undefined) => {
  for (const [k, v] of Object.entries(b ?? {})) {
    const x = (a[k] ??= { either: 0, both: 0 });
    x.either += v.either;
    x.both += v.both;
  }
};

/** Sums clients' results (the page's total, or one platform's). Agreement adds up the pairs' counts. */
export function sumResults(list: readonly Results[]): Results {
  const out = empty();
  let pairs = 0;
  // Whole-list matches for layers and missing aren't counted per pair any more: weighed from each client's share.
  const whole = { layers: 0, missing: 0 };
  for (const r of list) {
    out.labeled += r.labeled;
    add(out.requestTypes, r.requestTypes);
    add(out.layers, r.layers);
    add(out.readiness, r.readiness);
    add(out.confidence, r.confidence);
    add(out.otherNames, r.otherNames ?? {});
    for (const [t, m] of Object.entries(r.missing)) add((out.missing[t] ??= {}), m);
    for (const [t, m] of Object.entries(r.readinessByType ?? {})) add((out.readinessByType[t] ??= {}), m);
    out.shapes.parents += r.shapes?.parents ?? 0;
    pairs += r.agreement.pairs;
    whole.layers += (r.agreement.layers ?? 0) * r.agreement.pairs;
    whole.missing += (r.agreement.missing ?? 0) * r.agreement.pairs;
    const a = r.agreement;
    out.agreement.same.requestType += a.same?.requestType ?? Math.round((a.requestType ?? 0) * a.pairs);
    out.agreement.same.readiness += a.same?.readiness ?? Math.round((a.readiness ?? 0) * a.pairs);
    out.agreement.same.confidence += a.same?.confidence ?? Math.round((a.confidence ?? 0) * a.pairs);
    addFacts(out.agreement.facts.missing, a.facts?.missing);
    addFacts(out.agreement.facts.layers, a.facts?.layers);
    add(out.agreement.typePairs, a.typePairs ?? {});
    out.agreeFailed += r.agreeFailed ?? 0;
    add(out.from, r.from ?? {});
    for (const [k, v] of Object.entries(r.rerun ?? {}) as [Stale, number][]) out.rerun[k] = (out.rerun[k] ?? 0) + v;
  }
  out.shapes.sets = sumShapes(list.map((r) => r.shapes?.sets ?? []));
  const r3 = (v: number) => (pairs ? Math.round((v / pairs) * 1000) / 1000 : null);
  const s = out.agreement.same;
  out.agreement = { ...out.agreement, pairs, requestType: r3(s.requestType), layers: r3(whole.layers), readiness: r3(s.readiness), missing: r3(whole.missing), confidence: r3(s.confidence) };
  return out;
}

export function sumCoverage(list: readonly Coverage[]): Coverage {
  const n = (f: (c: Coverage) => number | null) => (list.some((c) => f(c) === null) ? null : list.reduce((s, c) => s + (f(c) ?? 0), 0));
  const s = (f: (c: Coverage) => number) => list.reduce((t, c) => t + f(c), 0);
  return { read: n((c) => c.read), outside: n((c) => c.outside), inScope: s((c) => c.inScope), leftOut: s((c) => c.leftOut), toClassify: s((c) => c.toClassify), labeled: s((c) => c.labeled), aiOff: s((c) => c.aiOff), failed: s((c) => c.failed), notReached: s((c) => c.notReached), earlier: s((c) => c.earlier ?? 0) };
}

// ---------- WP-3: the agreement sample, the per-client tables ----------

/** "99 of 100 (1 answer failed its check)": the pairs, of the sample asked for over `labeled` items. */
export function sampleWords(r: Pick<Results, "agreement" | "agreeFailed" | "labeled">): string {
  const pairs = r.agreement.pairs;
  const failed = r.agreeFailed ?? 0;
  const target = Math.max(pairs + failed, sampleSize(r.labeled));
  if (!target) return "No item has been classified twice yet.";
  const notAsked = target - pairs - failed;
  const why = [failed ? `${failed} ${failed === 1 ? "answer" : "answers"} failed its check` : null, notAsked ? `${notAsked} not asked yet` : null].filter(Boolean).join(", ");
  return `${pairs} of ${target}${why ? ` (${why})` : ""}`;
}

/** One cell of a per-client table: a count and its share of the cell's base, "too few to read" under 20. */
export type Cell = { count: number; base: number };
export const cellWords = (c: Cell): string => (tooFew(c.base) ? `${c.count} (${FEW_WORDS})` : `${c.count} (${Math.round((c.count / (c.base || 1)) * 100)}%)`);

/**
 * A table with a column per client beside "All clients" and "Without <largest>" (the largest by labeled items, when
 * there are two or more clients): rows are the values `pick` counts, most first; each cell's base is the column's
 * labeled items.
 */
export function clientTable(clients: readonly { key: string; r: Results }[], pick: (r: Results) => Record<string, number>, o: { rows?: readonly string[]; largest?: string | null } = {}): { columns: string[]; largest: string | null; rows: { value: string; cells: Cell[] }[] } {
  const all = sumResults(clients.map((c) => c.r));
  const largest = o.largest !== undefined ? o.largest : clients.length > 1 ? ([...clients].sort((a, b) => b.r.labeled - a.r.labeled || a.key.localeCompare(b.key))[0]?.key ?? null) : null;
  const rest = largest ? sumResults(clients.filter((c) => c.key !== largest).map((c) => c.r)) : null;
  const cols = [...clients.map((c) => c.r), all, ...(rest ? [rest] : [])];
  const values = o.rows ?? Object.entries(pick(all)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  return {
    columns: [...clients.map((c) => c.key), "All clients", ...(largest ? [`Without ${largest}`] : [])],
    largest,
    rows: values.map((v) => ({ value: v, cells: cols.map((r) => ({ count: pick(r)[v] ?? 0, base: r.labeled })) })),
  };
}

/** Readiness by request type across clients: per type, its items and how many are at each readiness. */
export function readinessByType(r: Results, order: readonly string[]): { type: string; items: number; cells: Cell[] }[] {
  return Object.entries(r.requestTypes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => ({ type: t, items: n, cells: order.map((x) => ({ count: r.readinessByType?.[t]?.[x] ?? 0, base: n })) }));
}

/** The words for a share in a cell under the small numbers rule. */
export const FEW_LINE = `Any cell whose base is under ${FEW} says "${FEW_WORDS}".`;

/** The most suggested "other" names, most first (five by default). Names only. */
export const topOtherNames = (r: Results, n = 5): [string, number][] => Object.entries(r.otherNames ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

/**
 * Check by hand: up to `n` labeled items of one client, across types and confidence (round robin over each
 * type × confidence group, oldest id first in each), so a person can open them in DevOps and judge the labels.
 */
export function handCheck<T extends { id: number; type: string }>(items: readonly T[], labels: ReadonlyMap<number, { labels: Labels }>, n = 30): T[] {
  const groups = new Map<string, T[]>();
  for (const i of [...items].sort((a, b) => a.id - b.id)) {
    const l = labels.get(i.id);
    if (!l) continue;
    const k = `${i.type}\u0000${l.labels.confidence}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }
  const lists = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const out: T[] = [];
  for (let round = 0; out.length < n && lists.some((l) => l.length > round); round++) for (const l of lists) if (l[round] && out.length < n) out.push(l[round]!);
  return out;
}
