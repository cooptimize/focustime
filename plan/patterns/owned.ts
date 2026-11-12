// WP-3: the request types list a person owns. One list is "in use": the newest version a person made ("own-<n>"),
// else the first one (own-1, below, until it is saved). Classification runs against it and never changes it; no AI
// request writes a list. A person adds, renames, merges or removes a type, or edits a meaning or example; each save is a
// new version with who, when, the version it came from and one line of why. "can't tell" and "other" never change.
//
// Labels follow the type, not its wording: a label is kept on the version it was made on and carried to the list in use
// through the stored changes (a rename or a merge carries it; a removed type, or "other" and "can't tell" after an add,
// need labeling again). Labels made on WP-2's AI-written list carry to own-1 where its changes show a type is the same
// type under another name; a type with no counterpart becomes "other" with its old name as the suggestion. A list
// whose changes don't explain its types can't be carried: its labels stay on it, shown as such. Pure; no AI.
import { CANT_TELL, OTHER, STARTING_LIST, STARTING_TYPES, WP1_START, isUnclearName, norm } from "./labels.ts";
import type { Labels, RequestType, TypeChange, TypeList } from "./types.ts";

export const FIXED_NAMES: readonly string[] = [CANT_TELL, OTHER];
const isFixed = (n: string) => FIXED_NAMES.includes(norm(n));
const start = (name: string): RequestType => ({ ...STARTING_TYPES.find((t) => t.name === name)! });
const renamed = (from: string, to: string): RequestType => ({ ...start(from), name: to });

/** The first list in use (WP-3): the starting list's types, two shorter names, and data migration. */
export const OWN_START: TypeList = {
  version: "own-1",
  createdAt: "2026-11-12T00:00:00Z",
  types: [
    start("foundation build"),
    renamed("new KPI or measure on an existing model", "new measure"),
    start("new report"),
    start("small change"),
    renamed("new data with no home yet", "new data source"),
    start("exploration"),
    start("data anomaly"),
    start("rerun or data fix"),
    start("deployment"),
    start("pipeline failure"),
    start("access or admin"),
    start("performance"),
    start("meeting or ongoing"),
    { name: "data migration", meaning: "Moving existing data, models or reports from one platform or system to another", example: "Move the finance tables from the old warehouse to the new lakehouse" },
    start(CANT_TELL),
    start(OTHER),
  ],
  changes: [
    { kind: "rename", from: ["new KPI or measure on an existing model"], to: ["new measure"], reason: "A shorter name for the same type", count: 0 },
    { kind: "rename", from: ["new data with no home yet"], to: ["new data source"], reason: "A shorter name for the same type", count: 0 },
    { kind: "add", from: [], to: ["data migration"], reason: "Moving data between platforms is its own kind of work", count: 0 },
  ],
  fingerprint: "own",
  by: null,
  why: "The first list in use (WP-3): the starting list's types with two shorter names, and data migration.",
  base: STARTING_LIST.version,
  relabel: null,
};

export const isOwned = (v: string): boolean => /^own-\d+$/.test(v);
export const ownNumber = (v: string): number => Number(/^own-(\d+)$/.exec(v)?.[1] ?? 0);
/** WP-2's AI-written second list (made by a classification run's merge). */
export const isAiList = (v: string): boolean => /^v2-r\d+$/.test(v);

/** Every list, with the first list in use when it isn't saved yet. */
export const withOwnStart = (lists: readonly TypeList[]): TypeList[] => (lists.some((l) => l.version === OWN_START.version) ? [...lists] : [...lists, OWN_START]);

/** The list in use: the newest version a person made, else the first one. */
export function inUseOf(lists: readonly TypeList[]): TypeList {
  return [...withOwnStart(lists)].filter((l) => isOwned(l.version)).sort((a, b) => ownNumber(b.version) - ownNumber(a.version))[0]!;
}

/** Newest first for one item's labels: a person's versions, then AI lists by run, then the starting lists. */
export function rankOf(version: string): number {
  if (isOwned(version)) return 3_000_000 + ownNumber(version);
  if (isAiList(version)) return 2_000_000 + Number(version.slice(4));
  if (version === STARTING_LIST.version) return 1_000_000;
  if (version === WP1_START) return 0;
  return -1;
}

// ---------- a person's changes ----------

export type ListEdit =
  | { kind: "add"; name: string; meaning: string; example: string; relabel: "all" | "other" }
  | { kind: "rename"; from: string; to: string }
  | { kind: "merge"; from: string; into: string }
  | { kind: "remove"; name: string }
  | { kind: "edit"; name: string; meaning: string; example: string };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : null;
};
const has = (list: TypeList, name: string) => list.types.some((t) => norm(t.name) === norm(name));

/** Whether a text names a client: any client's key, names or aliases as whole words (an ordinary-word name only as written). */
export function clientNamer(entries: readonly { key: string; names: readonly string[]; aliases?: readonly string[]; projects?: readonly string[]; exactCase?: boolean }[]): (text: string) => boolean {
  const words = (t: string, exact: boolean) => ` ${(exact ? t : t.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const list = entries.flatMap((e) => [e.key, ...e.names, ...(e.aliases ?? []), ...(e.projects ?? [])].map((w) => ({ w: words(w, !!e.exactCase).trim(), exact: !!e.exactCase }))).filter((x) => x.w.length >= 2);
  return (text: string) => list.some((x) => words(text, x.exact).includes(` ${x.w} `));
}

/**
 * Why a name can't be a type, or null. Never "can't tell" or "other", never a word about how unclear an item is, never
 * a client's name, never an email, two to sixty characters.
 */
export function nameProblem(name: string, namesClient: (text: string) => boolean): string | null {
  const n = norm(name);
  if (n.length < 2 || name.length > 60) return "A name is 2 to 60 characters";
  if (isFixed(n)) return `"${n}" is fixed and can't be added, renamed or removed`;
  if (isUnclearName(n)) return "A type names the kind of work asked for. How unclear an item is goes in readiness, never in a type";
  if (EMAIL.test(name)) return "A type can't hold an email address";
  if (namesClient(name)) return "A type uses generic words only: no client's name";
  return null;
}

/** The edit as sent (shape and lengths), or why it can't be read. */
export function parseEdit(v: unknown): ListEdit | string {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!o) return "edit must be an object";
  const name = (k: string) => clean(o[k], 60);
  const text = (k: string) => clean(o[k] ?? "", 200);
  const only = (keys: string[]) => Object.keys(o).every((k) => k === "kind" || keys.includes(k));
  switch (o.kind) {
    case "add": {
      const n = name("name");
      const m = text("meaning");
      const e = text("example");
      if (!only(["name", "meaning", "example", "relabel"]) || n === null || !m || e === null || (o.relabel !== "all" && o.relabel !== "other")) return "add takes { name, meaning, example, relabel: all | other }";
      return { kind: "add", name: n, meaning: m, example: e, relabel: o.relabel };
    }
    case "rename": {
      const f = name("from");
      const t = name("to");
      if (!only(["from", "to"]) || f === null || t === null) return "rename takes { from, to }";
      return { kind: "rename", from: f, to: t };
    }
    case "merge": {
      const f = name("from");
      const t = name("into");
      if (!only(["from", "into"]) || f === null || t === null) return "merge takes { from, into }";
      return { kind: "merge", from: f, into: t };
    }
    case "remove": {
      const n = name("name");
      if (!only(["name"]) || n === null) return "remove takes { name }";
      return { kind: "remove", name: n };
    }
    case "edit": {
      const n = name("name");
      const m = text("meaning");
      const e = text("example");
      if (!only(["name", "meaning", "example"]) || n === null || !m || e === null) return "edit takes { name, meaning, example }";
      return { kind: "edit", name: n, meaning: m, example: e };
    }
    default:
      return "kind is add, rename, merge, remove or edit";
  }
}

/** The next version from one edit of `list` (the list in use), or why it can't be made. */
export function applyEdit(list: TypeList, e: ListEdit, o: { why: string; by: string; at: string; namesClient: (text: string) => boolean }): TypeList | string {
  const why = o.why.replace(/\s+/g, " ").trim();
  if (why.length < 3 || why.length > 200) return "Say why in one line (3 to 200 characters)";
  if (EMAIL.test(why)) return "The why can't hold an email address";
  if (e.kind === "add" || e.kind === "edit") {
    if (EMAIL.test(e.meaning) || EMAIL.test(e.example)) return "A meaning or example can't hold an email address";
    if (o.namesClient(e.meaning) || o.namesClient(e.example)) return "A meaning or example uses generic words only: no client's name";
  }
  const fixedRefused = (n: string) => (isFixed(n) ? `"${norm(n)}" is fixed and can't be changed` : null);
  const missing = (n: string) => (has(list, n) ? null : `There is no type "${n}" in the list in use`);
  const real = list.types.filter((t) => !isFixed(t.name));
  const keepFixedLast = (types: RequestType[]) => [...types.filter((t) => !isFixed(t.name)), ...list.types.filter((t) => isFixed(t.name))];
  let types: RequestType[];
  let change: TypeChange;
  switch (e.kind) {
    case "add": {
      const p = nameProblem(e.name, o.namesClient) ?? (has(list, e.name) ? `"${e.name}" is in the list already` : null);
      if (p) return p;
      types = keepFixedLast([...real, { name: e.name, meaning: e.meaning, example: e.example }]);
      change = { kind: "add", from: [], to: [e.name], reason: why, count: 0 };
      break;
    }
    case "rename": {
      const p = fixedRefused(e.from) ?? missing(e.from) ?? nameProblem(e.to, o.namesClient) ?? (norm(e.from) !== norm(e.to) && has(list, e.to) ? `"${e.to}" is in the list already` : null) ?? (e.from === e.to ? "The new name is the same" : null);
      if (p) return p;
      types = list.types.map((t) => (norm(t.name) === norm(e.from) ? { ...t, name: e.to } : t));
      change = { kind: "rename", from: [list.types.find((t) => norm(t.name) === norm(e.from))!.name], to: [e.to], reason: why, count: 0 };
      break;
    }
    case "merge": {
      const p = fixedRefused(e.from) ?? fixedRefused(e.into) ?? missing(e.from) ?? missing(e.into) ?? (norm(e.from) === norm(e.into) ? "Choose two different types" : null) ?? (real.length <= 2 ? "The list keeps at least two types besides can't tell and other" : null);
      if (p) return p;
      types = list.types.filter((t) => norm(t.name) !== norm(e.from));
      change = { kind: "merge", from: [list.types.find((t) => norm(t.name) === norm(e.from))!.name], to: [list.types.find((t) => norm(t.name) === norm(e.into))!.name], reason: why, count: 0 };
      break;
    }
    case "remove": {
      const p = fixedRefused(e.name) ?? missing(e.name) ?? (real.length <= 2 ? "The list keeps at least two types besides can't tell and other" : null);
      if (p) return p;
      types = list.types.filter((t) => norm(t.name) !== norm(e.name));
      change = { kind: "remove", from: [list.types.find((t) => norm(t.name) === norm(e.name))!.name], to: [], reason: why, count: 0 };
      break;
    }
    case "edit": {
      const p = fixedRefused(e.name) ?? missing(e.name);
      if (p) return p;
      types = list.types.map((t) => (norm(t.name) === norm(e.name) ? { ...t, meaning: e.meaning, example: e.example } : t));
      change = { kind: "edit", from: [list.types.find((t) => norm(t.name) === norm(e.name))!.name], to: [list.types.find((t) => norm(t.name) === norm(e.name))!.name], reason: why, count: 0 };
      break;
    }
  }
  return { version: `own-${ownNumber(list.version) + 1}`, createdAt: o.at, types, changes: [change], fingerprint: "own", by: o.by, why, base: list.version, relabel: e.kind === "add" ? e.relabel : null };
}

// ---------- carrying labels to the list in use ----------

/** Why a carried label needs labeling again: its type was removed, a type was added since, or it had no counterpart. */
export type Stale = "removed" | "added" | "no counterpart";
type Step = { to: string; stale: Stale | null; /** No counterpart: the old type's own name and meaning, kept as the "other" suggestion. */ was?: { name: string; meaning: string } };
/** From a list's names (case folded) to the list in use's, or null when the list can't be carried safely. */
export type CarryMap = Map<string, Step>;

/** A WP-2 AI list or the starting list onto own-1, or null when its changes don't explain its types. */
function toOwnStart(from: TypeList): CarryMap | null {
  const own = new Map(OWN_START.types.map((t) => [norm(t.name), t.name]));
  // The starting list's names onto own-1's (own-1's own renames).
  const startTo = new Map<string, string>();
  for (const t of STARTING_LIST.types) {
    const r = OWN_START.changes.find((c) => c.kind === "rename" && norm(c.from[0]) === norm(t.name));
    startTo.set(norm(t.name), r ? r.to[0]! : t.name);
  }
  const m: CarryMap = new Map();
  if (from.version === STARTING_LIST.version) {
    for (const [k, v] of startTo) m.set(k, { to: v, stale: null });
    return m;
  }
  if (!isAiList(from.version)) return null;
  for (const t of from.types) {
    const n = norm(t.name);
    if (own.has(n)) {
      m.set(n, { to: own.get(n)!, stale: null });
      continue;
    }
    if (startTo.has(n)) {
      m.set(n, { to: startTo.get(n)!, stale: null });
      continue;
    }
    const why = from.changes.filter((c) => c.to.some((x) => norm(x) === n));
    // A type no change explains: the list can't be carried safely.
    if (!why.length) return null;
    const sameType = why.every((c) => (c.kind === "rename" || c.kind === "keep" || c.kind === "split") && c.from.length === 1 && startTo.has(norm(c.from[0])));
    const origins = new Set(why.flatMap((c) => c.from.map((f) => startTo.get(norm(f)) ?? "")));
    if (sameType && origins.size === 1) m.set(n, { to: [...origins][0]!, stale: null });
    else m.set(n, { to: OTHER, stale: "no counterpart", was: { name: t.name, meaning: t.meaning } });
  }
  for (const f of FIXED_NAMES) m.set(f, { to: f, stale: null });
  return m;
}

/** One person's version applied to a map: renames and merges move labels, a removal and an add make them stale. */
function step(m: CarryMap, v: TypeList): void {
  for (const c of v.changes) {
    for (const s of m.values()) {
      const at = norm(s.to);
      // A removed type's labels stay where they were: a later type that reuses the name is another type.
      if (s.stale === "removed") continue;
      if ((c.kind === "rename" || c.kind === "merge") && at === norm(c.from[0])) s.to = c.to[0]!;
      else if (c.kind === "remove" && at === norm(c.from[0])) s.stale = "removed";
      else if (c.kind === "add" && !s.stale && (v.relabel === "all" || at === OTHER || at === CANT_TELL)) s.stale = "added";
    }
  }
}

/** How labels on `from` carry to `inUse`, through every version between, or null when they can't be carried safely. */
export function carryMapOf(from: TypeList, inUse: TypeList, lists: readonly TypeList[]): CarryMap | null {
  const all = withOwnStart(lists);
  let m: CarryMap | null;
  let first: number;
  if (isOwned(from.version)) {
    if (ownNumber(from.version) > ownNumber(inUse.version)) return null;
    m = new Map(from.types.map((t) => [norm(t.name), { to: t.name, stale: null }]));
    first = ownNumber(from.version) + 1;
  } else {
    m = toOwnStart(from);
    first = 2;
  }
  if (!m) return null;
  for (let n = first; n <= ownNumber(inUse.version); n++) {
    const v = all.find((l) => l.version === `own-${n}`);
    if (!v) return null;
    step(m, v);
  }
  return m;
}

/** One label on the list in use, or null when its type isn't on the map. A removed type shows as "<name> (removed)". */
export function carryLabels(l: Labels, m: CarryMap): { labels: Labels; stale: Stale | null } | null {
  const s = m.get(norm(l.requestType));
  if (!s) return null;
  if (s.was) return { labels: { ...l, requestType: OTHER, otherName: s.was.name, otherMeaning: s.was.meaning }, stale: s.stale };
  const to = s.stale === "removed" ? `${s.to} (removed)` : s.to;
  return { labels: { ...l, requestType: to, otherName: to === OTHER ? l.otherName : null, otherMeaning: to === OTHER ? l.otherMeaning : null }, stale: s.stale };
}

/** One stored label row of a client, on the version it was made on (failed: an answer paid for that failed its check). */
export type VersionRow = { version: string; itemId: number; rev: number; labels: Labels | null; labelsB: Labels | null; failedA: boolean; failedB: boolean };
/** An item's label on the list in use: its newest label, carried; the version it was made on; stale when it needs labeling again. */
export type Resolved = { rev: number; labels: Labels; labelsB: Labels | null; from: string; stale: Stale | null; failedB: boolean };

/**
 * Each item's newest label, carried to the list in use. An item whose newest label is on a list that can't be carried
 * stays out of `carried` and is named in `earlier` (with that list's version); an older label is never used instead.
 */
export function resolveLabels(rows: readonly VersionRow[], lists: readonly TypeList[], inUse: TypeList): { carried: Map<number, Resolved>; earlier: Map<number, string> } {
  const all = withOwnStart(lists);
  const maps = new Map<string, CarryMap | null>();
  const mapOf = (v: string) => {
    if (!maps.has(v)) {
      const l = all.find((x) => x.version === v);
      maps.set(v, l ? carryMapOf(l, inUse, all) : null);
    }
    return maps.get(v)!;
  };
  const newest = new Map<number, VersionRow>();
  for (const r of rows) {
    if (!r.labels) continue;
    const had = newest.get(r.itemId);
    if (!had || rankOf(r.version) > rankOf(had.version)) newest.set(r.itemId, r);
  }
  const carried = new Map<number, Resolved>();
  const earlier = new Map<number, string>();
  for (const [id, r] of newest) {
    const m = mapOf(r.version);
    const a = m ? carryLabels(r.labels!, m) : null;
    const b = m && r.labelsB ? carryLabels(r.labelsB, m) : null;
    if (!a) {
      earlier.set(id, r.version);
      continue;
    }
    carried.set(id, { rev: r.rev, labels: a.labels, labelsB: b?.labels ?? null, from: r.version, stale: a.stale, failedB: r.failedB });
  }
  return { carried, earlier };
}

/** Plain words for a list version: "version 3 (in use)", "the AI list of Nov 12, not in use", "the starting list". */
export function listWords(l: Pick<TypeList, "version" | "createdAt">, inUse: string): string {
  if (isOwned(l.version)) return `version ${ownNumber(l.version)}${l.version === inUse ? " (in use)" : ""}`;
  if (isAiList(l.version)) return `the list written by AI on ${l.createdAt.slice(0, 10)} (${l.version}), not in use`;
  if (l.version === WP1_START) return "WP-1's starting list";
  if (l.version === STARTING_LIST.version) return "WP-2's starting list";
  return l.version;
}

/** What one change would cost, from the labels on the list in use now (every client's). */
/**
 * What one change would cost. `labels` (the labels on the list in use now) give the counts a rename or a merge moves;
 * `priced`, when given, is what Estimate would label again with the change (items in scope of clients with Allow AI on,
 * the same rules the run uses), so the preview and Estimate never disagree.
 */
export function editCost(e: ListEdit, labels: readonly Resolved[], priced?: { relabel: number; small?: number; all?: number }): { relabel: number; relabelSmall: number | null; words: string } {
  const n = (f: (r: Resolved) => boolean) => labels.filter(f).length;
  const ON_TOP = priced ? " The agreement sample's second answers for those in it come on top." : "";
  const is = (r: Resolved, name: string) => norm(r.labels.requestType) === norm(name);
  const items = (k: number) => (k === 1 ? "1 item" : `${k} items`);
  switch (e.kind) {
    case "rename":
    {
      const k = n((r) => is(r, e.from));
      return { relabel: 0, relabelSmall: null, words: `A rename costs nothing: labels follow the type, not its wording. ${k ? `${items(k)} keep their label as "${e.to}".` : "No item carries it yet."}` };
    }
    case "edit":
      return { relabel: 0, relabelSmall: null, words: "Editing a meaning or example costs nothing now. The next classification uses the new words; labels already made stay." };
    case "merge":
      return { relabel: 0, relabelSmall: null, words: `${items(n((r) => is(r, e.from)))} labeled "${e.from}" will count as "${e.into}". Their labels follow, so none needs labeling again and Estimate has nothing new to price.` };
    case "remove": {
      const k = priced?.relabel ?? n((r) => is(r, e.name));
      return { relabel: k, relabelSmall: null, words: `${items(k)} labeled "${e.name}" would need labeling again. Until then they show as "${e.name} (removed)". Estimate will price them.${ON_TOP}` };
    }
    case "add": {
      const all = priced?.all ?? labels.length;
      const small = priced?.small ?? n((r) => is(r, OTHER) || is(r, CANT_TELL));
      return { relabel: e.relabel === "all" ? all : small, relabelSmall: small, words: (e.relabel === "all" ? `Every labeled item (${items(all)}) would need labeling again. Estimate will price it.` : `Only the items now labeled other or can't tell (${items(small)}) would need labeling again. Estimate will price it.`) + ON_TOP };
    }
  }
}

/**
 * The answers that failed their check, per item: the newest revision a first (a) or second (b) answer failed at, on the
 * list in use or any list whose labels carry to it (a rename or an edit never asks for them again). Paid for once.
 */
export function failuresOf(rows: readonly VersionRow[], lists: readonly TypeList[], inUse: TypeList): { a: Map<number, number>; b: Map<number, number> } {
  const all = withOwnStart(lists);
  const carries = new Map<string, boolean>();
  const ok = (v: string) => {
    if (v === inUse.version) return true;
    if (!carries.has(v)) {
      const l = all.find((x) => x.version === v);
      carries.set(v, !!l && carryMapOf(l, inUse, all) !== null);
    }
    return carries.get(v)!;
  };
  const a = new Map<number, number>();
  const b = new Map<number, number>();
  for (const r of rows) {
    if (!(r.failedA || r.failedB) || !ok(r.version)) continue;
    if (r.failedA) a.set(r.itemId, Math.max(a.get(r.itemId) ?? -1, r.rev));
    if (r.failedB) b.set(r.itemId, Math.max(b.get(r.itemId) ?? -1, r.rev));
  }
  return { a, b };
}

/** Which list the labels were made on, so no figure mixes lists without saying so. */
export function fromWords(from: Record<string, number>, inUse: string): string {
  const name = (v: string) => (isOwned(v) ? `version ${ownNumber(v)}` : isAiList(v) ? "the list written by AI" : "a starting list");
  const rows = Object.entries(from).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const here = from[inUse] ?? 0;
  const carried = rows.filter(([v]) => v !== inUse);
  if (!carried.length) return `Every label was made on the list in use (version ${ownNumber(inUse)}).`;
  return `Labels made on the list in use: ${here}. Carried to it from earlier lists (each type matched by its recorded changes): ${carried.map(([v, n]) => `${n} from ${name(v)}`).join(", ")}. The figures and the agreement pairs below count them on the list in use.`;
}
