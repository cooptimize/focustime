// AH-6: Ahead's one toolbar, pure. One filter state for Grid, Gantt, Readiness and Backlog (the filters, the level and
// Show callouts): the Dates filter's quick picks read against today, the address's query (so a link opens the same
// view), which control can't apply in a mode and why (shown disabled with that reason, never removed), and the
// summary line under the toolbar with a removable chip per non-default filter.
import type { AheadFilters, AheadGapKind, AheadOwner, AheadRange } from "./ahead-edit.ts";
import type { Tier } from "./ahead-model.ts";

export type AheadModeKey = "grid" | "gantt" | "fix" | "backlog";
export const RANGES: readonly AheadRange[] = ["next2", "next4", "quarter"];
export const RANGE_WORDS: Record<AheadRange, string> = { next2: "Next 2 weeks", next4: "Next 4 weeks", quarter: "This quarter" };
export const KINDS: readonly AheadGapKind[] = ["needs_stories", "no_dates", "unassigned", "unsized"];
export const KIND_WORDS: Record<AheadGapKind, string> = { needs_stories: "Needs stories", no_dates: "No target date", unassigned: "Unassigned", unsized: "Unsized" };
export const PEOPLE_WORDS: Record<AheadOwner, string> = { mine: "Mine", contributing: "Contributing", all: "Everyone" };
const TIERS: readonly Tier[] = ["epic", "feature", "story"];
const OWNERS: readonly AheadOwner[] = ["mine", "contributing", "all"];

const day = (d: string) => Temporal.PlainDate.from(d);
const short = (d: string, today: string) =>
  day(d).toLocaleString("en-US", day(d).year === day(today).year ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });

/** The dates a Dates filter covers (both ends included), or null for Any time. A quick pick wins over from and to. */
export function rangeDates(f: Pick<AheadFilters, "range" | "from" | "to">, today: string): { from: string | null; to: string | null } | null {
  if (f.range) {
    const t = day(today);
    if (f.range === "next2") return { from: today, to: t.add({ days: 13 }).toString() };
    if (f.range === "next4") return { from: today, to: t.add({ days: 27 }).toString() };
    const first = Temporal.PlainDate.from({ year: t.year, month: Math.floor((t.month - 1) / 3) * 3 + 1, day: 1 });
    return { from: first.toString(), to: first.add({ months: 3 }).subtract({ days: 1 }).toString() };
  }
  return f.from || f.to ? { from: f.from, to: f.to } : null;
}

/** "Any time", "Next 4 weeks", "Nov 9 to Dec 4", "From Nov 9", "Until Dec 4". */
export function dateWords(f: Pick<AheadFilters, "range" | "from" | "to">, today: string): string {
  if (f.range) return RANGE_WORDS[f.range];
  if (f.from && f.to) return `${short(f.from, today)} to ${short(f.to, today)}`;
  if (f.from) return `From ${short(f.from, today)}`;
  if (f.to) return `Until ${short(f.to, today)}`;
  return "Any time";
}

/** Not ready only: Has gaps, or a kind chosen (a kind implies it). */
export const notReadyOnly = (f: Pick<AheadFilters, "gaps" | "kinds">) => f.gaps || (f.kinds?.length ?? 0) > 0;

/** "Any", "Not ready", "Not ready: Needs stories, Unsized". */
export function readinessWords(f: Pick<AheadFilters, "gaps" | "kinds">): string {
  if (!notReadyOnly(f)) return "Any";
  const k = f.kinds ?? [];
  return k.length && k.length < KINDS.length ? `Not ready: ${KINDS.filter((x) => k.includes(x)).map((x) => KIND_WORDS[x]).join(", ")}` : "Not ready";
}

// ---- Where a control applies ----

export type Control = "clients" | "people" | "epic" | "dates" | "readiness" | "kinds" | "stale" | "search" | "level" | "callouts" | "whole";

/** Why a control can't apply in a mode (it's shown disabled with this), or null where it applies. */
export function notHere(mode: AheadModeKey, c: Control, o: { scoped: boolean; whole: boolean }): string | null {
  if (c === "callouts" && mode !== "gantt") return "Callouts are the markers at the end of the Gantt's bars";
  if (c === "readiness" && mode === "fix") return "Readiness lists only items that aren't ready yet";
  if (c === "whole") {
    if (mode === "fix") return "Readiness lists only Cooptimize's work";
    if (mode === "backlog") return "Backlog ranks only Cooptimize's work";
    if (!o.scoped && !o.whole) return "Every client shown is already the whole project";
  }
  return null;
}

// ---- The address ----

export type AheadView = { f: AheadFilters; level: Tier; callouts: boolean };
export const DEFAULT_LEVEL: Tier = "feature";
const KEY = /^[\w.:@-]{1,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => {
  if (!DATE.test(s)) return false;
  try {
    Temporal.PlainDate.from(s, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
};

/** The view as an address query ("c=northwind&r=next4&l=epic"), only what differs from the defaults; "" for none. */
export function toQuery(v: AheadView): string {
  const p = new URLSearchParams();
  const f = v.f;
  if (f.clients.length) p.set("c", f.clients.join(","));
  const owners = Object.entries(f.owner);
  if (owners.length) p.set("o", owners.map(([k, w]) => `${k}~${w}`).join(","));
  if (f.epic) p.set("e", f.epic);
  if (f.range) p.set("r", f.range);
  else {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  if (f.gaps) p.set("nr", "1");
  if (f.kinds?.length) p.set("k", f.kinds.join(","));
  if (f.stale) p.set("st", "1");
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.whole) p.set("w", "1");
  if (v.level !== DEFAULT_LEVEL) p.set("l", v.level);
  if (!v.callouts) p.set("co", "0");
  return p.toString();
}

/**
 * What an address query sets (anything it doesn't name keeps its value). Wrong values are left out, never an error:
 * a link someone edited by hand still opens Ahead.
 */
export function fromQuery(q: string): { f: Partial<AheadFilters>; level?: Tier; callouts?: boolean } | null {
  const p = new URLSearchParams(q.replace(/^\?/, ""));
  if (![...p.keys()].length) return null;
  const f: Partial<AheadFilters> = {};
  const list = (s: string | null) => (s ? s.split(",").filter((x) => KEY.test(x)).slice(0, 100) : []);
  if (p.has("c")) f.clients = list(p.get("c"));
  if (p.has("o")) {
    const owner: Record<string, AheadOwner> = {};
    for (const pair of (p.get("o") ?? "").split(",")) {
      const [k, w] = pair.split("~");
      if (k && KEY.test(k) && OWNERS.includes(w as AheadOwner)) owner[k] = w as AheadOwner;
    }
    f.owner = owner;
  }
  const e = p.get("e");
  if (e && e.length <= 120) f.epic = e;
  const r = p.get("r");
  if (r && (RANGES as readonly string[]).includes(r)) f.range = r as AheadRange;
  const from = p.get("from"), to = p.get("to");
  if (from && validDate(from)) f.from = from;
  if (to && validDate(to)) f.to = to;
  if (p.get("nr") === "1") f.gaps = true;
  if (p.has("k")) f.kinds = list(p.get("k")).filter((k): k is AheadGapKind => (KINDS as readonly string[]).includes(k));
  if (p.get("st") === "1") f.stale = true;
  const text = p.get("q");
  if (text) f.q = text.slice(0, 200);
  if (p.get("w") === "1") f.whole = true;
  const l = p.get("l");
  const co = p.get("co");
  return { f, ...(l && (TIERS as readonly string[]).includes(l) ? { level: l as Tier } : {}), ...(co === "0" ? { callouts: false } : co === "1" ? { callouts: true } : {}) };
}

/**
 * The filters a link opens: the link's own when it names filters (anything it leaves out reads as the default, so
 * the link shows what its sender saw), else what I had.
 */
export function withQuery(mine: AheadFilters, defaults: AheadFilters, q: ReturnType<typeof fromQuery>): AheadFilters {
  if (!q || !Object.keys(q.f).length) return mine;
  return { ...defaults, ...(mine.tier ? { tier: mine.tier } : {}), ...q.f };
}

// ---- The summary line and its chips ----

export type SummaryClient = { clientKey: string; clientName: string; lead: boolean };
export type Chip = { id: string; label: string; clear: (f: AheadFilters) => AheadFilters };
const ownerDefault = (c: SummaryClient): AheadOwner => (c.lead ? "all" : "mine");

/** The People word for the clients shown: one word when they agree, else "Mixed". */
export function peopleWord(f: AheadFilters, shown: readonly SummaryClient[]): { word: string; owner: AheadOwner | null } {
  const set = new Set(shown.map((c) => f.owner[c.clientKey] ?? ownerDefault(c)));
  const owner = set.size === 1 ? [...set][0]! : null;
  return { word: owner ? PEOPLE_WORDS[owner] : "Mixed", owner };
}

/**
 * "Showing 76 of 132 · Quiddity · Everyone · Next 4 weeks" and a chip for each filter that isn't its default (a client
 * chosen, People not my default for a client shown, an epic, dates, readiness, Stale, a search).
 */
export function summary(clients: readonly SummaryClient[], f: AheadFilters, o: { today: string; shown: number; total: number; epicLabel?: string | null }): { text: string; chips: Chip[] } {
  const shownClients = clients.filter((c) => !f.clients.length || f.clients.includes(c.clientKey));
  const people = peopleWord(f, shownClients);
  const parts = [
    o.shown === o.total ? `Showing all ${o.total}` : `Showing ${o.shown} of ${o.total}`,
    f.clients.length ? shownClients.map((c) => c.clientName).join(", ") || "No clients" : "All clients",
    people.word,
    dateWords(f, o.today),
  ];
  if (f.epic) parts.push(`Epic: ${o.epicLabel ?? "chosen"}`);
  if (notReadyOnly(f)) parts.push(readinessWords(f));
  if (f.stale) parts.push("Stale");
  if (f.q.trim()) parts.push(`“${f.q.trim()}”`);

  const chips: Chip[] = [];
  for (const k of f.clients) {
    const c = clients.find((x) => x.clientKey === k);
    chips.push({ id: `client:${k}`, label: c?.clientName ?? k, clear: (x) => ({ ...x, clients: x.clients.filter((y) => y !== k), epic: null }) });
  }
  const changed = shownClients.filter((c) => f.owner[c.clientKey] && f.owner[c.clientKey] !== ownerDefault(c));
  if (changed.length) {
    chips.push({
      id: "people",
      label: `People: ${people.word}`,
      clear: (x) => ({ ...x, owner: Object.fromEntries(Object.entries(x.owner).filter(([k]) => !changed.some((c) => c.clientKey === k))) }),
    });
  }
  if (f.epic) chips.push({ id: "epic", label: `Epic: ${o.epicLabel ?? "chosen"}`, clear: (x) => ({ ...x, epic: null }) });
  if (rangeDates(f, o.today)) chips.push({ id: "dates", label: dateWords(f, o.today), clear: ({ range: _r, ...x }) => ({ ...x, from: null, to: null }) });
  if (notReadyOnly(f)) chips.push({ id: "readiness", label: readinessWords(f), clear: ({ kinds: _k, ...x }) => ({ ...x, gaps: false }) });
  if (f.stale) chips.push({ id: "stale", label: "Stale", clear: ({ stale: _s, ...x }) => x });
  if (f.q.trim()) chips.push({ id: "search", label: `“${f.q.trim()}”`, clear: (x) => ({ ...x, q: "" }) });
  return { text: parts.join(" · "), chips };
}

/** Clear filters: every filter back to its default; the view settings (Show the whole project, Backlog's old tier) stay. */
export function cleared(f: AheadFilters, defaults: AheadFilters): AheadFilters {
  return { ...defaults, ...(f.whole ? { whole: true } : {}), ...(f.tier ? { tier: f.tier } : {}) };
}
