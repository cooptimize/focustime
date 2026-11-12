// WP-1, WP-2: what a classification shows, per client, for Build work and for Tickets and support: request types,
// layers, readiness, what is missing most by request type, confidence, the five most suggested "other" names, the
// feature shapes (no AI: the layers a parent's classified children touch, as a set and as an ordered chain, only for
// parents with at least two classified children) and agreement. WP-2 adds coverage: items in scope, labeled, and not
// labeled by reason, adding up. Counts only; the page sums clients (and splits them by platform) itself. Pure.
import { OTHER, SHAPE_MIN_CHILDREN, agreementOf, chainOf, commonShapes, shapeOf, toClassify, type Agreement } from "./labels.ts";
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
  /** WP-2: the names suggested for "other", with counts (names only). */
  otherNames: Record<string, number>;
  /** Shapes of parents with at least two classified children: as a set and as an ordered chain; how many parents. */
  shapes: { parents: number; sets: Shape[]; chains: Shape[] };
  /** The raw pairs' agreement (pairs counted, so the page can weigh clients). */
  agreement: Agreement;
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
};

const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);
const empty = (): Results => ({ labeled: 0, requestTypes: {}, layers: {}, readiness: {}, confidence: {}, missing: {}, otherNames: {}, shapes: { parents: 0, sets: [], chains: [] }, agreement: agreementOf([]) });

type LabelMap = ReadonlyMap<number, { labels: Labels; labelsB: Labels | null }>;

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
    if (l.requestType === OTHER && l.otherName) bump(r.otherNames, l.otherName.toLowerCase());
    const m = (r.missing[l.requestType] ??= {});
    for (const x of l.missing) bump(m, x);
    if (row.labelsB) pairs.push([l, row.labelsB]);
  }
  r.agreement = agreementOf(pairs);
  // Shapes: each classified item with at least two classified children (any level: the data decides what a parent is).
  const kids = new Map<number, { createdAt: string | null; id: number; labels: Labels }[]>();
  for (const i of items) {
    const l = labels.get(i.id)?.labels;
    if (l && i.parentId !== null) (kids.get(i.parentId) ?? kids.set(i.parentId, []).get(i.parentId)!).push({ createdAt: i.createdAt, id: i.id, labels: l });
  }
  const parents = items.filter((i) => labels.has(i.id) && (kids.get(i.id)?.length ?? 0) >= SHAPE_MIN_CHILDREN);
  r.shapes = {
    parents: parents.length,
    sets: commonShapes(parents.map((p) => ({ type: labels.get(p.id)!.labels.requestType, shape: shapeOf(kids.get(p.id)!.map((k) => k.labels)) })), 50),
    chains: commonShapes(parents.map((p) => ({ type: labels.get(p.id)!.labels.requestType, shape: chainOf(kids.get(p.id)!) })), 50),
  };
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
  const aiOff = cov.skippedForAi ? unlabeled.length : 0;
  const failed = cov.skippedForAi ? 0 : unlabeled.filter((i) => cov.failed.has(i.id)).length;
  return {
    coverage: { read: cov.read, outside: cov.outside === null ? null : cov.outside + movedHere, inScope: inScope.length, leftOut: inScope.length - todo.length, toClassify: todo.length, labeled, aiOff, failed, notReached: unlabeled.length - aiOff - failed },
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
  const per = new Map<string, number>();
  return [...m.values()].sort((a, b) => b.count - a.count || a.requestType.localeCompare(b.requestType)).filter((x) => (per.set(x.requestType, (per.get(x.requestType) ?? 0) + 1).get(x.requestType)! <= 5));
}

/** Sums clients' results (the page's total, or one platform's). Agreement is weighed by each client's pairs. */
export function sumResults(list: readonly Results[]): Results {
  const out = empty();
  let pairs = 0;
  const agree = { requestType: 0, layers: 0, readiness: 0, missing: 0, confidence: 0 };
  for (const r of list) {
    out.labeled += r.labeled;
    add(out.requestTypes, r.requestTypes);
    add(out.layers, r.layers);
    add(out.readiness, r.readiness);
    add(out.confidence, r.confidence);
    add(out.otherNames, r.otherNames ?? {});
    for (const [t, m] of Object.entries(r.missing)) add((out.missing[t] ??= {}), m);
    out.shapes.parents += r.shapes?.parents ?? 0;
    pairs += r.agreement.pairs;
    for (const k of Object.keys(agree) as (keyof typeof agree)[]) agree[k] += (r.agreement[k] ?? 0) * r.agreement.pairs;
  }
  out.shapes.sets = sumShapes(list.map((r) => r.shapes?.sets ?? []));
  out.shapes.chains = sumShapes(list.map((r) => r.shapes?.chains ?? []));
  const r3 = (v: number) => (pairs ? Math.round((v / pairs) * 1000) / 1000 : null);
  out.agreement = { pairs, requestType: r3(agree.requestType), layers: r3(agree.layers), readiness: r3(agree.readiness), missing: r3(agree.missing), confidence: r3(agree.confidence) };
  return out;
}

export function sumCoverage(list: readonly Coverage[]): Coverage {
  const n = (f: (c: Coverage) => number | null) => (list.some((c) => f(c) === null) ? null : list.reduce((s, c) => s + (f(c) ?? 0), 0));
  const s = (f: (c: Coverage) => number) => list.reduce((t, c) => t + f(c), 0);
  return { read: n((c) => c.read), outside: n((c) => c.outside), inScope: s((c) => c.inScope), leftOut: s((c) => c.leftOut), toClassify: s((c) => c.toClassify), labeled: s((c) => c.labeled), aiOff: s((c) => c.aiOff), failed: s((c) => c.failed), notReached: s((c) => c.notReached) };
}

/** The five most suggested "other" names, most first. Names only. */
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
