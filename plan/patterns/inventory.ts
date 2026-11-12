// WP-1, WP-2: the inventory, no AI. From one client's items in scope (created in the last 24 months, plus their parents)
// it works out the shape (types, levels from links, how they nest), the breakdown (WP-2: one row per parent and child
// type pair the data shows, and leaf items with no parent per type), how much is written, titles, timing and what was
// written after the fact. Counts and shares only: no text, no person. Pure.
import { htmlToText } from "../../sources/devops/normalize.ts";
import { depthOf, levelsOf, typeEdges, type Nest } from "./levels.ts";
import { LEVELS, type Facts, type Level, type PatternItem } from "./types.ts";
import type { AnalysisScope, AreaRule } from "./scope.ts";
import type { Kind } from "./kinds.ts";

// ---------- reading an item ----------

/** The standard fields every process has (System and Microsoft.VSTS.Common); the estimate fields come from the process. */
export const F = {
  id: "System.Id",
  rev: "System.Rev",
  type: "System.WorkItemType",
  state: "System.State",
  title: "System.Title",
  parent: "System.Parent",
  tags: "System.Tags",
  created: "System.CreatedDate",
  activated: "Microsoft.VSTS.Common.ActivatedDate",
  closed: "Microsoft.VSTS.Common.ClosedDate",
  comments: "System.CommentCount",
  description: "System.Description",
  acceptance: "Microsoft.VSTS.Common.AcceptanceCriteria",
  area: "System.AreaPath",
  project: "System.TeamProject",
} as const;

/** WP-2: what the layout reads of every item in the window: never a title or text. */
export const LAYOUT_FIELDS = [F.id, F.type, F.area, F.project, F.created] as const;
/** WP-2: what is read of a parent outside the run's items (outside scope or older): its title and type, and its links. */
export const PARENT_FIELDS = [F.id, F.rev, F.type, F.state, F.title, F.parent, F.created, F.area] as const;

/** The fields an inventory read asks for: the standard ones and the process's estimate fields. */
export const readFields = (estimateFields: readonly string[]): string[] => [...new Set([...Object.values(F), ...estimateFields])];

/** What the run knows of the client's process: which states are closed or not started, and its estimate fields. */
export type ProcessFacts = { closed(type: string, state: string): boolean; proposed(type: string, state: string): boolean; estimateFields: readonly string[] };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const date = (v: unknown) => (typeof v === "string" && v ? v : null);
/** Text length after HTML is stripped and white space folded: a number, never the text. */
/**
 * DevOps HTML as text. The shared `htmlToText` throws on a numeric entity past U+10FFFF (`&#99999999;`); one such item
 * must never stop a client, so here it falls back to the tags stripped and every entity left as written.
 */
export function safeText(html: string): string {
  try {
    return htmlToText(html);
  } catch {
    return html.replace(/<[^>]*>/g, " ").slice(0, 4000);
  }
}
export const textLength = (v: unknown): number => (typeof v === "string" && v ? safeText(v).replace(/\s+/g, " ").trim().length : 0);

/** One raw batch value into what this page keeps: the text fields become lengths here and go no further. */
export function itemOf(v: { id: number; fields: Readonly<Record<string, unknown>> }, p: ProcessFacts, inWindow: boolean): PatternItem {
  const f = v.fields;
  const type = str(f[F.type]);
  const state = str(f[F.state]);
  const facts: Facts = {
    descLen: textLength(f[F.description]),
    acLen: textLength(f[F.acceptance]),
    tags: str(f[F.tags]).split(";").map((t) => t.trim()).filter(Boolean).length,
    estimate: p.estimateFields.some((k) => typeof f[k] === "number" || (typeof f[k] === "string" && (f[k] as string).trim() !== "")),
    comments: typeof f[F.comments] === "number" ? (f[F.comments] as number) : 0,
    closed: p.closed(type, state),
  };
  return {
    id: v.id,
    rev: typeof f[F.rev] === "number" ? (f[F.rev] as number) : 0,
    type,
    state,
    createdAt: date(f[F.created]),
    activatedAt: date(f[F.activated]),
    closedAt: date(f[F.closed]),
    parentId: typeof f[F.parent] === "number" ? (f[F.parent] as number) : null,
    title: str(f[F.title]).slice(0, 400),
    facts,
    inWindow,
  };
}

// ---------- the history sample ----------

/** One entry of an item's updates, as DevOps returns it (only what is read here). */
export type RawUpdate = { rev?: unknown; revisedDate?: unknown; fields?: Record<string, { oldValue?: unknown; newValue?: unknown } | undefined> | null };

/**
 * From a closed item's updates, oldest first: whether its description or acceptance criteria changed after work started
 * (the first move out of a not-started state), and whether both were still empty when it closed. Booleans only.
 */
export function historyOf(updates: readonly RawUpdate[], type: string, p: ProcessFacts): { changedAfterStart: boolean; emptyAtClose: boolean } {
  let started = false;
  let changedAfterStart = false;
  let desc = false;
  let ac = false;
  let emptyAtClose: boolean | null = null;
  for (const u of updates) {
    const fields = u.fields ?? {};
    const st = fields[F.state];
    const touched = F.description in fields || F.acceptance in fields;
    if (fields[F.description]) desc = textLength(fields[F.description]!.newValue) > 0;
    if (fields[F.acceptance]) ac = textLength(fields[F.acceptance]!.newValue) > 0;
    // A text change in the same update that starts the work counts as written before it.
    if (touched && started) changedAfterStart = true;
    if (st && typeof st.newValue === "string") {
      if (!started && !p.proposed(type, st.newValue)) started = true;
      if (p.closed(type, st.newValue) && emptyAtClose === null) emptyAtClose = !desc && !ac;
    }
  }
  return { changedAfterStart, emptyAtClose: emptyAtClose ?? (!desc && !ac) };
}

// ---------- titles ----------

/** Common imperative verbs a title may start with ("Add", "Fix"); lower case. Words, not names of anything. */
const VERBS = new Set(
  "add adjust allow analyze automate build calculate change check clean configure connect convert create define delete deploy design document enable ensure explore export extend fix generate handle implement import improve include integrate investigate load make map merge migrate model move optimize prepare publish rebuild refactor refresh reload remove rename replace research resolve restore review rework run schedule set setup show split support test track troubleshoot update upgrade validate verify write"
    .split(" "),
);
export type TitlePattern = "verb" | "as_a" | "question" | "bare_noun" | "other";
export const TITLE_PATTERNS: readonly TitlePattern[] = ["verb", "as_a", "question", "bare_noun", "other"];

export function titlePattern(title: string): TitlePattern {
  const t = title.trim();
  if (/^as an?\s/i.test(t)) return "as_a";
  if (/\?\s*$/.test(t) || /^(how|why|what|can|should|is|are|does|do|which|where|when)\b/i.test(t)) return "question";
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length && VERBS.has(words[0]!.toLowerCase().replace(/[^a-z]/g, ""))) return "verb";
  if (words.length && words.length <= 3) return "bare_noun";
  return "other";
}

// ---------- the numbers ----------

export type Spread = { n: number; min: number | null; median: number | null; p75: number | null; p90: number | null; max: number | null; bands: Record<string, number> };
export type Writing = { n: number; description: number | null; acceptance: number | null; tags: number | null; estimate: number | null; descBands: Record<string, number>; commentBands: Record<string, number> };
export type Timing = { n: number; median: number | null; p90: number | null };

/** WP-2: one parent and child type pair: how many of the parent type's items have none of the child type under them. */
export type Pair = { parent: string; child: string; without: number; of: number; children: Spread };

export type Snapshot = {
  /** 2 from WP-2 (pairs, scope, kinds); absent on WP-1's snapshots. */
  rules?: 2;
  /** The client's first item ever (any age), or null when it couldn't be read. */
  firstItemAt: string | null;
  windowFrom: string;
  items: number;
  /** Parents read for the structure that were created before the window. */
  olderParents: number;
  types: { type: string; level: Level; count: number; states: Record<string, number> }[];
  nesting: Nest[];
  months: Record<string, number>;
  breakdown: {
    children: Record<"top" | "middle", Spread>;
    middleNoChildren: { count: number; of: number };
    leafNoParent: { count: number; of: number };
    depth: Record<string, number>;
    /** WP-2: per pair the data shows, and per type that isn't top, its items with no parent. */
    pairs?: Pair[];
    noParent?: { type: string; count: number; of: number }[];
  };
  writing: { all: Writing; byLevel: Record<Level, Writing>; byType: Record<string, Writing> };
  titles: { lengthBands: Record<string, number>; patterns: Record<TitlePattern, number> };
  timing: { createdToStarted: Timing; startedToClosed: Timing; sameDay: { count: number; of: number } };
  afterFact: { sampled: number; changedAfterStart: number; emptyAtClose: number };
  /** WP-2: what the run that saved this snapshot covered: its scope, the items the layout read and those outside, the kinds. */
  run?: { scope: AnalysisScope | null; scopeSource: string | null; read: number; outside: number; inScope: number; kinds: Record<string, Kind>; /** Teams scope: the area rules the teams stood for at the time. */ teamAreas?: AreaRule[]; /** Read in the layout, then gone (deleted) before the full read. */ gone?: number };
  /** The handful of numbers the page's row shows. */
  headline: { items: number; description: number | null; acceptance: number | null; typicalChildren: number | null; /** WP-1 only. */ parentsNoChildren?: number | null; /** WP-2: the pair with the most parents. */ mainPair?: Pair | null; changedAfterStart: number | null };
};

const share = (n: number, of: number): number | null => (of ? Math.round((n / of) * 1000) / 1000 : null);
const pick = (sorted: number[], q: number): number | null => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))]! : null);

export const CHILD_BANDS: readonly [string, number, number][] = [["0", 0, 0], ["1", 1, 1], ["2-3", 2, 3], ["4-7", 4, 7], ["8+", 8, Infinity]];
export const DESC_BANDS: readonly [string, number, number][] = [["empty", 0, 0], ["under 100", 1, 99], ["100-499", 100, 499], ["500-1999", 500, 1999], ["2000+", 2000, Infinity]];
export const COMMENT_BANDS: readonly [string, number, number][] = [["0", 0, 0], ["1-2", 1, 2], ["3-9", 3, 9], ["10+", 10, Infinity]];
export const TITLE_BANDS: readonly [string, number, number][] = [["1-3 words", 1, 3], ["4-8 words", 4, 8], ["9-15 words", 9, 15], ["16+ words", 16, Infinity]];

function banded(values: readonly number[], bands: readonly [string, number, number][]): Record<string, number> {
  const out = Object.fromEntries(bands.map(([k]) => [k, 0])) as Record<string, number>;
  for (const v of values) {
    const b = bands.find(([, lo, hi]) => v >= lo && v <= hi);
    if (b) out[b[0]]!++;
  }
  return out;
}

export function spreadOf(values: readonly number[]): Spread {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, min: s[0] ?? null, median: pick(s, 0.5), p75: pick(s, 0.75), p90: pick(s, 0.9), max: s.at(-1) ?? null, bands: banded(s, CHILD_BANDS) };
}

function writingOf(items: readonly PatternItem[]): Writing {
  const n = items.length;
  return {
    n,
    description: share(items.filter((i) => i.facts.descLen > 0).length, n),
    acceptance: share(items.filter((i) => i.facts.acLen > 0).length, n),
    tags: share(items.filter((i) => i.facts.tags > 0).length, n),
    estimate: share(items.filter((i) => i.facts.estimate).length, n),
    descBands: banded(items.map((i) => i.facts.descLen), DESC_BANDS),
    commentBands: banded(items.map((i) => i.facts.comments), COMMENT_BANDS),
  };
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
function timingOf(values: number[]): Timing {
  const s = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const r = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return { n: s.length, median: r(pick(s, 0.5)), p90: r(pick(s, 0.9)) };
}

/** The 24-month window's first instant for a run started at `now` (UTC, the first of the month 24 months back). */
export function windowFrom(now: Temporal.Instant): string {
  const d = now.toZonedDateTimeISO("UTC").toPlainDate().toPlainYearMonth().subtract({ months: 23 }).toPlainDate({ day: 1 });
  return d.toZonedDateTime("UTC").toInstant().toString();
}

/** The month ranges a run queries, oldest first: [from, to) in UTC, each a calendar month, the last one up to now. */
export function monthRanges(now: Temporal.Instant): { from: string; to: string }[] {
  const start = Temporal.PlainYearMonth.from(windowFrom(now).slice(0, 7));
  const out: { from: string; to: string }[] = [];
  for (let m = start, i = 0; i < 24; m = m.add({ months: 1 }), i++) {
    const at = (x: Temporal.PlainYearMonth) => x.toPlainDate({ day: 1 }).toZonedDateTime("UTC").toInstant().toString();
    out.push({ from: at(m), to: at(m.add({ months: 1 })) });
  }
  return out;
}

/** Everything the page shows for one client, from its items. `all` includes the parents read for structure. */
export function inventoryOf(all: readonly PatternItem[], o: { firstItemAt: string | null; windowFrom: string }): Snapshot {
  const levels = levelsOf(all);
  const levelOf = (t: string): Level => levels.get(t) ?? "other";
  const byId = new Map(all.map((i) => [i.id, i]));
  const kids = new Map<number, number>();
  for (const i of all) if (i.parentId !== null && byId.has(i.parentId)) kids.set(i.parentId, (kids.get(i.parentId) ?? 0) + 1);
  const items = all.filter((i) => i.inWindow);

  const types = [...new Set(items.map((i) => i.type))].sort().map((type) => {
    const of = items.filter((i) => i.type === type);
    const states: Record<string, number> = {};
    for (const i of of) states[i.state] = (states[i.state] ?? 0) + 1;
    return { type, level: levelOf(type), count: of.length, states };
  });
  types.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || b.count - a.count);
  const months: Record<string, number> = {};
  for (const i of items) if (i.createdAt) months[i.createdAt.slice(0, 7)] = (months[i.createdAt.slice(0, 7)] ?? 0) + 1;

  const at = (l: Level) => items.filter((i) => levelOf(i.type) === l);
  const childCounts = (l: "top" | "middle") => at(l).map((i) => kids.get(i.id) ?? 0);
  const middle = at("middle");
  const leaves = at("leaf");
  const parents = [...at("top"), ...middle];
  const depth: Record<string, number> = {};
  for (const i of items) {
    const d = String(Math.min(depthOf(i.id, byId), 5));
    depth[d === "5" ? "5+" : d] = (depth[d === "5" ? "5+" : d] ?? 0) + 1;
  }

  const created = items.filter((i) => i.createdAt && i.activatedAt).map((i) => days(i.createdAt!, i.activatedAt!));
  const worked = items.filter((i) => i.activatedAt && i.closedAt && i.facts.closed).map((i) => days(i.activatedAt!, i.closedAt!));
  const closed = items.filter((i) => i.facts.closed && i.closedAt && i.createdAt);
  const sampled = items.filter((i) => i.facts.history);
  const changed = sampled.filter((i) => i.facts.history!.changedAfterStart).length;
  const children = { top: spreadOf(childCounts("top")), middle: spreadOf(childCounts("middle")) };
  const typical = spreadOf(parents.map((i) => kids.get(i.id) ?? 0)).median;
  const pairs = pairsOf(items);
  const noParent = types.filter((t) => t.level !== "top").map((t) => ({ type: t.type, count: items.filter((i) => i.type === t.type && (i.parentId === null || !byId.has(i.parentId) || byId.get(i.parentId)!.type === t.type)).length, of: t.count }));

  const writing = { all: writingOf(items), byLevel: Object.fromEntries(LEVELS.map((l) => [l, writingOf(at(l))])) as Record<Level, Writing>, byType: Object.fromEntries(types.map((t) => [t.type, writingOf(items.filter((i) => i.type === t.type))])) };
  const patterns = Object.fromEntries((["verb", "as_a", "question", "bare_noun", "other"] as const).map((p) => [p, 0])) as Record<TitlePattern, number>;
  for (const i of items) patterns[titlePattern(i.title)]++;

  return {
    rules: 2,
    firstItemAt: o.firstItemAt,
    windowFrom: o.windowFrom,
    items: items.length,
    olderParents: all.length - items.length,
    types,
    nesting: typeEdges(all),
    months,
    breakdown: {
      children,
      middleNoChildren: { count: middle.filter((i) => !kids.get(i.id)).length, of: middle.length },
      leafNoParent: { count: leaves.filter((i) => i.parentId === null || !byId.has(i.parentId)).length, of: leaves.length },
      depth,
      pairs,
      noParent,
    },
    writing,
    titles: { lengthBands: banded(items.map((i) => i.title.trim().split(/\s+/).filter(Boolean).length), TITLE_BANDS), patterns },
    timing: { createdToStarted: timingOf(created), startedToClosed: timingOf(worked), sameDay: { count: closed.filter((i) => i.createdAt!.slice(0, 10) === i.closedAt!.slice(0, 10)).length, of: closed.length } },
    afterFact: { sampled: sampled.length, changedAfterStart: changed, emptyAtClose: sampled.filter((i) => i.facts.history!.emptyAtClose).length },
    headline: {
      items: items.length,
      description: writing.all.description,
      acceptance: writing.all.acceptance,
      typicalChildren: typical,
      mainPair: [...pairs].sort((a, b) => b.of - a.of)[0] ?? null,
      changedAfterStart: share(changed, sampled.length),
    },
  };
}

/**
 * WP-2: one row per parent and child type pair the data shows (at least two links): of the parent type's items in the
 * window, how many have no child of that type, and the spread of children of that type per parent.
 */
export function pairsOf(items: readonly PatternItem[]): Pair[] {
  const edges = typeEdges(items).filter((e) => e.count >= 2);
  return edges.map((e) => {
    const parents = items.filter((i) => i.type === e.parent);
    const n = new Map<number, number>();
    for (const i of items) if (i.type === e.child && i.parentId !== null) n.set(i.parentId, (n.get(i.parentId) ?? 0) + 1);
    const counts = parents.map((p) => n.get(p.id) ?? 0);
    return { parent: e.parent, child: e.child, without: counts.filter((c) => !c).length, of: parents.length, children: spreadOf(counts) };
  }).filter((p) => p.of > 0);
}

/** WP-2: Tickets and support, in short: how many, how fast they close, how much is written. */
export type Tickets = { items: number; types: string[]; createdToClosed: Timing; sameDay: { count: number; of: number }; open: number; writing: Writing };
export function ticketsOf(items: readonly PatternItem[]): Tickets {
  const closed = items.filter((i) => i.facts.closed && i.createdAt && i.closedAt);
  return {
    items: items.length,
    types: [...new Set(items.map((i) => i.type))].sort(),
    createdToClosed: timingOf(closed.map((i) => days(i.createdAt!, i.closedAt!))),
    sameDay: { count: closed.filter((i) => i.createdAt!.slice(0, 10) === i.closedAt!.slice(0, 10)).length, of: closed.length },
    open: items.filter((i) => !i.facts.closed).length,
    writing: writingOf(items),
  };
}

/** The history sample: up to `max` closed items in the window, spread over the window (every k-th by id). */
export function historySample(items: readonly PatternItem[], max = 200): number[] {
  const closed = items.filter((i) => i.inWindow && i.facts.closed).map((i) => i.id).sort((a, b) => a - b);
  if (closed.length <= max) return closed;
  const step = closed.length / max;
  return Array.from({ length: max }, (_, k) => closed[Math.floor(k * step)]!);
}
