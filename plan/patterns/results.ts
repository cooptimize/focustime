// WP-1: what a classification shows, per client: request types, layers, readiness, what is missing most by request
// type, confidence, the feature shapes (no AI: the layers a parent's classified children touch) and agreement. Counts
// only; the page sums clients (and splits them by platform) itself. Pure.
import { agreementOf, commonShapes, eligible, shapeOf, type Agreement } from "./labels.ts";
import { levelsOf } from "./levels.ts";
import type { Labels, Level, PatternItem } from "./types.ts";

export type ClientResults = {
  /** Items the list version applies to, and how many have labels. */
  eligible: number;
  labeled: number;
  requestTypes: Record<string, number>;
  layers: Record<string, number>;
  readiness: Record<string, number>;
  confidence: Record<string, number>;
  /** missing[requestType][what] = count. */
  missing: Record<string, Record<string, number>>;
  /** Each classified parent's shape with its request type (the page counts the common ones across clients). */
  shapes: { requestType: string; shape: string[]; count: number }[];
  /** The raw pairs' agreement for this client (pairs counted, so the page can weigh clients). */
  agreement: Agreement;
};

const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);

export function resultsOf(items: readonly PatternItem[], labels: ReadonlyMap<number, { labels: Labels; labelsB: Labels | null }>): ClientResults {
  const levels = levelsOf(items);
  const levelOf = (t: string): Level => levels.get(t) ?? "other";
  const el = eligible(items, levelOf);
  const r: ClientResults = { eligible: el.length, labeled: 0, requestTypes: {}, layers: {}, readiness: {}, confidence: {}, missing: {}, shapes: [], agreement: agreementOf([]) };
  const pairs: [Labels, Labels][] = [];
  for (const i of el) {
    const row = labels.get(i.id);
    if (!row) continue;
    const l = row.labels;
    r.labeled++;
    bump(r.requestTypes, l.requestType);
    for (const x of l.layers) bump(r.layers, x);
    bump(r.readiness, l.readiness);
    bump(r.confidence, l.confidence);
    const m = (r.missing[l.requestType] ??= {});
    for (const x of l.missing) bump(m, x);
    if (row.labelsB) pairs.push([l, row.labelsB]);
  }
  r.agreement = agreementOf(pairs);
  // Shapes: each classified top or middle item with classified children.
  const kids = new Map<number, Labels[]>();
  for (const i of el) {
    const l = labels.get(i.id)?.labels;
    if (l && i.parentId !== null) (kids.get(i.parentId) ?? kids.set(i.parentId, []).get(i.parentId)!).push(l);
  }
  const parents = el.filter((i) => (levelOf(i.type) === "top" || levelOf(i.type) === "middle") && labels.has(i.id) && kids.has(i.id));
  r.shapes = commonShapes(parents.map((p) => ({ type: labels.get(p.id)!.labels.requestType, shape: shapeOf(kids.get(p.id)!) })), 50);
  return r;
}

/** Sums clients' results (the page's total, or one platform's). Agreement is weighed by each client's pairs. */
export function sumResults(list: readonly ClientResults[]): ClientResults {
  const out: ClientResults = { eligible: 0, labeled: 0, requestTypes: {}, layers: {}, readiness: {}, confidence: {}, missing: {}, shapes: [], agreement: agreementOf([]) };
  const add = (a: Record<string, number>, b: Record<string, number>) => {
    for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v;
  };
  const shapes = new Map<string, { requestType: string; shape: string[]; count: number }>();
  let pairs = 0;
  const agree = { requestType: 0, layers: 0, readiness: 0, missing: 0, confidence: 0 };
  for (const r of list) {
    out.eligible += r.eligible;
    out.labeled += r.labeled;
    add(out.requestTypes, r.requestTypes);
    add(out.layers, r.layers);
    add(out.readiness, r.readiness);
    add(out.confidence, r.confidence);
    for (const [t, m] of Object.entries(r.missing)) add((out.missing[t] ??= {}), m);
    for (const s of r.shapes) {
      const k = `${s.requestType}\u0000${s.shape.join("|")}`;
      const hit = shapes.get(k);
      if (hit) hit.count += s.count;
      else shapes.set(k, { ...s, shape: [...s.shape] });
    }
    pairs += r.agreement.pairs;
    for (const k of Object.keys(agree) as (keyof typeof agree)[]) agree[k] += (r.agreement[k] ?? 0) * r.agreement.pairs;
  }
  const per = new Map<string, number>();
  out.shapes = [...shapes.values()].sort((a, b) => b.count - a.count || a.requestType.localeCompare(b.requestType)).filter((x) => (per.set(x.requestType, (per.get(x.requestType) ?? 0) + 1).get(x.requestType)! <= 5));
  const r3 = (v: number) => (pairs ? Math.round((v / pairs) * 1000) / 1000 : null);
  out.agreement = { pairs, requestType: r3(agree.requestType), layers: r3(agree.layers), readiness: r3(agree.readiness), missing: r3(agree.missing), confidence: r3(agree.confidence) };
  return out;
}

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
