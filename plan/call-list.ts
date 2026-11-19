// MC-3: Calls is one list. Every call a person can see (a registered client call's occurrences, the calls they or
// someone on the call asked FocusTime to review, the calls they added, and the calls on their own calendar nobody has
// read yet) as one row each, with its state in words. MC-4 makes it something to work through:
//   - Open: Needs you first (every kept call that needs me, newest first, whatever its day), then each week (This week,
//     Last week, Earlier) with how many of its calls are closed and, for a past week, how many are still open; under a
//     week the calls that can be reviewed (a transcript in Teams, a Pocket recording), the calls waiting on someone
//     else, and the ones not checked yet; a meeting that repeats is one row for the week. Last, folded, the calls with
//     no transcript.
//   - Closed: every kept call with nothing left undecided, with what came of it.
//   - Hidden: the calendar calls I hid.
// Pure: no I/O, no clock (the day and the zone are handed in). Nothing here reads or keeps anything: it only arranges
// what meeting.mine, meeting.calls, meeting.calls_check and my hides already returned.
import type { CallOutcome, OccurrenceView, OtherCallView, SeriesView } from "./meeting-views.ts";
import { OTHER_CALL_DAYS } from "./calls.ts";
import { CALL_LIST, CALL_STATE, callLabel, CALLS_TEXT, CLOSE_TEXT, LIST_TEXT, MARK_TEXT } from "./call-words.ts";
import { LIST_FILTERS, type ListFilter } from "./call-filters.ts";
import { toReview, type Proposal } from "./meetings.ts";

export { LIST_FILTERS, type ListFilter };

/**
 * MC-2b: one of my own Pocket recordings as the page holds it (meeting.pocket_list's answer, in the page's memory only
 * while Calls is open): never who recorded it or any of its words.
 */
export type ListedRecording = { id: string; startAt: string; endAt: string; minutes: number; title: string };

/** MC-4: where a call's transcript is: in Teams, a Pocket recording of mine, both, or neither (null). */
export type CallMarkKind = "teams" | "pocket" | "both" | null;
/** MC-4: what Calls' check said of a calendar call: yes, no, the tenant's setting off, not checked, or being asked now. */
export type CheckState = "yes" | "no" | "off" | "unchecked" | "checking";
/** MC-4: where an open row goes: Needs you, under its week, or the no-transcript fold at the foot. */
export type Place = "needs" | "week" | "fold";

export type CallRow = {
  /** "o<occurrence id>" for a call FocusTime keeps, "c<its calendar key>" for a calendar call nobody has read (in memory and the page only). */
  key: string;
  occurrenceId: number | null;
  /** A calendar call nobody has read: what its setup needs. */
  other: OtherCallView | null;
  name: string;
  startAt: string;
  endAt: string;
  /** The call's local day (YYYY-MM-DD). */
  day: string;
  minutes: number;
  /** Everyone on it, me included, where my calendar said (null: not known here). */
  people: number | null;
  clientKey: string | null;
  clientName: string | null;
  /** Where its transcript came from, or will. */
  source: string;
  /** A registered weekly call: its type ("Weekly status call", "Planning"). */
  weekly: string | null;
  state: { label: string; needsMe: boolean };
  bucket: ListFilter;
  /** MC-4: an open row's section. */
  place: Place;
  /** I review it (I can act on it), else I look. */
  review: boolean;
  /** MC-2b: my Pocket recordings that go with this call, the longer overlap first (only while it has no transcript). */
  pocket: ListedRecording[];
  /** MC-2b: a recording that goes with no call is its own row (no occurrence, no calendar call). */
  recording: ListedRecording | null;
  /** MC-4: a transcript in Teams, a Pocket recording, both, or none (null). */
  mark: CallMarkKind;
  /** MC-4: a calendar call's check (null for a call FocusTime keeps or a recording's own row). */
  check: CheckState | null;
  /** MC-4: a kept call's proposals: how many still to decide, of how many. */
  left: { open: number; all: number } | null;
  /** MC-4: a kept call with nothing left undecided, and what came of it. */
  closed: { at: string | null; done: CallOutcome | null; noTranscript: boolean } | null;
  /** MC-4: the series a calendar call is one of on my calendar. */
  seriesKey: string | null;
  /** MC-4: the client FocusTime suggests for a calendar call (the person decides), or null: "Which client?". */
  suggested: string | null;
};

/** MC-4: my hides: single meetings by their calendar key, and series ("every one") by their series key. */
export type CallHides = { keys: ReadonlySet<string>; series: ReadonlySet<string> };

export type CallListInput = {
  meetings: readonly SeriesView[];
  occurrences: readonly OccurrenceView[];
  /** meeting.calls: my calendar's calls in my last OTHER_CALL_DAYS days (null while it is read, or when it failed). */
  others: readonly OtherCallView[] | null;
  /** Today in my zone, and the zone (for each call's own day). */
  today: string;
  zone: string;
  /** MC-2b: adds my Pocket recordings to the rows (`pocketRows` in plan/call-list-pocket.ts); `takes` are the rows a recording may go on. */
  addPocket?: ((all: CallRow[], takes: ReadonlySet<CallRow>, hides: CallHides | null) => void) | undefined;
  /** MC-4: the check's answers by calendar key (null: not asked yet on this visit, every Teams call "checking"). */
  check?: Readonly<Record<string, CheckState>> | null;
  /** MC-4: my hides (null: not read yet, nothing is hidden). */
  hides?: CallHides | null;
  /** MC-4: the client FocusTime suggests for a calendar call (plan/calls.ts suggestClient), or null. */
  suggest?: (c: OtherCallView) => string | null;
};

export const dayOf = (iso: string, zone: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(zone).toPlainDate().toString();
const daysBetween = (a: string, b: string) => Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: "days" }).days;

/** A calendar call's row: by its own calendar key (in memory and the page only), so a refetch keeps the same row. */
export const otherRowKey = (c: { key: string }) => `c${c.key}`;

/** MC-4: a kept call is closed when nothing on it is left to decide (no proposal open or failed), counted from its proposals. */
export function isClosed(o: Pick<OccurrenceView, "state" | "open">): boolean {
  return (o.state === "ready" || o.state === "reviewed" || o.state === "no_transcript") && o.open === 0;
}

/** Where a kept call's transcript came from, or how it will come. */
function sourceOf(o: OccurrenceView, s: SeriesView): string {
  if (o.hasTranscript || o.transcriptFrom) return o.transcriptFrom === "automatic" ? CALL_LIST.fromTeams : CALL_LIST.uploaded;
  if (!s.call) return s.source === "automatic" ? CALL_LIST.readAfter : CALL_LIST.uploadedByReviewer;
  return s.teams ? CALL_LIST.teamsOrFile : CALL_LIST.fileOnly;
}

/** MC-4: what came of a call's proposals: created in DevOps, kept as promises, comments added, skipped. */
export function outcomeOfCall(ps: readonly Pick<Proposal, "kind" | "state">[]): CallOutcome {
  const ok = (k: Proposal["kind"]) => ps.filter((p) => p.state === "confirmed" && p.kind === k).length;
  return { created: ok("gap"), promises: ok("commitment"), comments: ok("comment"), skipped: ps.filter((p) => p.state === "skipped").length };
}
/** MC-4: when the call closed: its latest decision, once nothing is undecided (null while something is, or with no proposals). */
export function closedAtOf(ps: readonly Pick<Proposal, "state" | "decidedAt">[]): string | null {
  if (!ps.length || ps.some(toReview)) return null;
  return ps.map((p) => p.decidedAt ?? "").sort().at(-1) || null;
}

/** MC-4: a mark from a Teams answer and my recordings. */
export const markOf = (teams: boolean, pocket: boolean): CallMarkKind => (teams && pocket ? "both" : teams ? "teams" : pocket ? "pocket" : null);

/**
 * Every call as one row, newest first. A calendar call someone already asked FocusTime to review is listed once, as the
 * call FocusTime keeps (with its people from my calendar). A closed call older than the list's OTHER_CALL_DAYS days drops
 * off (it opens from its meeting and by its address); an open one stays until its transcript goes (30 days).
 */
export function callRows(x: CallListInput): CallRow[] {
  const peopleOf = new Map<number, number>();
  for (const c of x.others ?? []) if (c.occurrenceId) peopleOf.set(c.occurrenceId, c.people);
  const all: CallRow[] = [];
  /** MC-2b: the rows a recording may go on: no transcript yet and I can act on it. */
  const takes = new Set<CallRow>();
  for (const o of x.occurrences) {
    const s = x.meetings.find((m) => m.id === o.seriesId);
    if (!s) continue;
    const state = callLabel(o, s.mine.review);
    const closed = isClosed(o);
    const row: CallRow = {
      key: `o${o.id}`, occurrenceId: o.id, other: null, name: s.name, startAt: o.startAt, endAt: o.endAt, day: dayOf(o.startAt, x.zone),
      minutes: Math.max(0, Math.round((Date.parse(o.endAt) - Date.parse(o.startAt)) / 60_000)), people: peopleOf.get(o.id) ?? null,
      clientKey: s.clientKey, clientName: s.clientName, source: sourceOf(o, s), weekly: s.call ? null : s.roleLabel, state,
      bucket: closed ? "closed" : "open", place: state.needsMe ? "needs" : "week", review: s.mine.review, pocket: [], recording: null,
      mark: null, check: null, left: o.proposals ? { open: o.open, all: o.proposals } : null,
      closed: closed ? { at: o.closedAt ?? null, done: o.done ?? null, noTranscript: o.state === "no_transcript" } : null, seriesKey: null, suggested: null,
    };
    all.push(row);
    if (s.mine.review && !o.hasTranscript && o.state !== "reviewed") takes.add(row);
  }
  const kept = new Set(all.map((r) => r.occurrenceId));
  const hides = x.hides ?? null;
  for (const c of x.others ?? []) {
    if (c.occurrenceId && kept.has(c.occurrenceId)) continue;
    const hidden = !!hides && (hides.keys.has(c.key) || (!!c.seriesKey && hides.series.has(c.seriesKey)));
    // A call Teams can't be asked about (not a Teams meeting, organized outside Cooptimize) counts as no transcript.
    // MC-2c: a chat call is listed only once Teams said its transcript is ready (its event), so it is never asked about.
    const check: CheckState = c.chat ? "yes" : !c.teams || c.outside ? "no" : x.check ? (x.check[c.key] ?? "unchecked") : "checking";
    const row: CallRow = {
      key: otherRowKey(c), occurrenceId: c.occurrenceId, other: c, name: c.name, startAt: c.startAt, endAt: c.endAt, day: dayOf(c.startAt, x.zone),
      minutes: c.minutes, people: c.chat ? null : c.people, clientKey: null, clientName: null, source: c.chat ? CALL_LIST.fromChat : c.teams ? CALL_LIST.teamsOrFile : CALL_LIST.fileOnly, weekly: null,
      state: { label: CALLS_TEXT.notReviewed, needsMe: false }, bucket: hidden ? "hidden" : "open", place: "week", review: true, pocket: [], recording: null,
      mark: null, check, left: null, closed: null, seriesKey: c.seriesKey,
      // MC-2c: a chat call's client is its chat's registration's: a suggestion, confirmed by pressing Review.
      suggested: c.chat ? c.chat.clientKey : x.suggest ? x.suggest(c) : null,
    };
    all.push(row);
    // A hidden meeting shows nowhere as a call that could be reviewed: no recording goes on it.
    if (!hidden) takes.add(row);
  }
  // MC-2b: my Pocket recordings, matched by plan/call-list-pocket.ts (loaded with Calls, not in the first download).
  x.addPocket?.(all, takes, hides);
  for (const r of all) {
    r.mark = r.recording ? "pocket" : markOf(r.check === "yes", r.pocket.length > 0);
    // MC-5: a call that closed with no transcript stays closed when my Pocket recording later goes with it: it gains the
    // mark and can be reviewed from Closed (it opens again only once its transcript brings proposals).
    // An open calendar call with nothing to read goes in the fold; one being checked or not checked stays in its week.
    if (r.bucket === "open" && r.other && !r.mark && (r.check === "no" || r.check === "off")) r.place = "fold";
  }
  all.sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt) || a.name.localeCompare(b.name));
  // A closed call drops off once it is older than the list's days; everything open stays (its transcript goes at 30 days).
  return all.filter((r) => r.bucket !== "closed" || daysBetween(r.day, x.today) < OTHER_CALL_DAYS);
}

/** The rows a client choice shows (client null: every client; "": no client said yet). A calendar call counts under its suggestion. */
export function forClient(rows: readonly CallRow[], client: string | null): CallRow[] {
  return client === null ? [...rows] : rows.filter((r) => (r.clientKey ?? r.suggested ?? "") === client);
}

/**
 * Each filter's count for a client choice: the calls (a repeating meeting's row counts each of its calls), except that
 * Hidden counts what its list shows: a meeting hidden every one is one, however many of its calls are in the window.
 */
export function filterCounts(rows: readonly CallRow[], client: string | null, hiddenMissing = 0, hiddenSeries: ReadonlySet<string> = new Set()): Record<ListFilter, number> {
  const out: Record<ListFilter, number> = { open: 0, closed: 0, hidden: client === null ? hiddenMissing : 0 };
  const seen = new Set<string>();
  for (const r of forClient(rows, client)) {
    if (r.bucket === "hidden" && r.seriesKey && hiddenSeries.has(r.seriesKey)) {
      if (seen.has(r.seriesKey)) continue;
      seen.add(r.seriesKey);
    }
    out[r.bucket]++;
  }
  return out;
}

/** MC-4: one line under a week or in the fold: a call, or a meeting that repeats ("Team standup · 3 this week"). */
export type SeriesEntry = { kind: "series"; key: string; seriesKey: string; name: string; rows: CallRow[]; mark: CallMarkKind };
export type Entry = { kind: "one"; row: CallRow } | SeriesEntry;

/** MC-4: a calendar call's meetings of one series in one list become one entry; everything else stays one row each. */
export function grouped(rows: readonly CallRow[], scope: string): Entry[] {
  const out: Entry[] = [];
  const at = new Map<string, SeriesEntry>();
  for (const r of rows) {
    const sk = r.other && r.occurrenceId === null ? r.seriesKey : null;
    const g = sk ? at.get(sk) : undefined;
    if (!sk) out.push({ kind: "one", row: r });
    else if (g) (g.rows.push(r), (g.mark = mergeMark(g.mark, r.mark)));
    else {
      const e: SeriesEntry = { kind: "series", key: `s${scope}:${sk}`, seriesKey: sk, name: r.name, rows: [r], mark: r.mark };
      at.set(sk, e);
      out.push(e);
    }
  }
  // A series with one meeting in this list is just that meeting.
  return out.map((e) => (e.kind === "series" && e.rows.length === 1 ? { kind: "one", row: e.rows[0]! } : e));
}
const mergeMark = (a: CallMarkKind, b: CallMarkKind): CallMarkKind => {
  const has = (m: CallMarkKind, k: "teams" | "pocket") => m === k || m === "both";
  return markOf(has(a, "teams") || has(b, "teams"), has(a, "pocket") || has(b, "pocket"));
};

/** MC-4: the weeks of the Open list, newest first. */
export type WeekKey = "this" | "last" | "earlier";
export type WeekPart = { week: WeekKey; label: string; entries: Entry[]; rows: CallRow[]; closed: number; stillOpen: number };
export type OpenList = { needs: CallRow[]; weeks: WeekPart[]; fold: Entry[]; foldCount: number };

const mondayOf = (day: string) => {
  const d = Temporal.PlainDate.from(day);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
};
/** This week, Last week or Earlier, for a day and today (weeks start on Monday). */
export function weekOf(day: string, today: string): WeekKey {
  const m = mondayOf(day);
  const t = mondayOf(today);
  if (m >= t) return "this";
  return m === Temporal.PlainDate.from(t).subtract({ days: 7 }).toString() ? "last" : "earlier";
}

/**
 * MC-4: the Open list for a client choice: Needs you (newest first, whatever its day), then each week with its open
 * rows (a meeting that repeats as one entry) and how many of its calls are closed and still open, then the fold.
 */
export function openList(rows: readonly CallRow[], client: string | null, today: string): OpenList {
  const mine = forClient(rows, client);
  const needs = mine.filter((r) => r.bucket === "open" && r.place === "needs");
  const weeks: WeekPart[] = [];
  for (const w of ["this", "last", "earlier"] as const) {
    const inWeek = mine.filter((r) => weekOf(r.day, today) === w);
    const open = inWeek.filter((r) => r.bucket === "open" && r.place === "week");
    const closed = inWeek.filter((r) => r.bucket === "closed").length;
    // Still open: a kept call of a past week with something left (Needs you's included), never a calendar call nobody asked about.
    const stillOpen = w === "this" ? 0 : inWeek.filter((r) => r.bucket === "open" && r.occurrenceId !== null).length;
    if (!open.length && !closed && !stillOpen) continue;
    weeks.push({ week: w, label: CLOSE_TEXT.week[w], entries: grouped(open, w), rows: open, closed, stillOpen });
  }
  const foldRows = mine.filter((r) => r.bucket === "open" && r.place === "fold");
  return { needs, weeks, fold: grouped(foldRows, "fold"), foldCount: foldRows.length };
}

/** MC-4: the Closed list (newest first) and the Hidden list for a client choice. */
export const closedList = (rows: readonly CallRow[], client: string | null) => forClient(rows, client).filter((r) => r.bucket === "closed");
export const hiddenList = (rows: readonly CallRow[], client: string | null) => forClient(rows, client).filter((r) => r.bucket === "hidden");

/** PK-4: a Pocket recording's hide: only its id, as a meeting's hide keeps only the meeting's. */
export const recordingHideKey = (id: string) => `pocket:${id}`;
export const isRecordingHide = (key: string) => key.startsWith("pocket:");
/** MC-4, PK-4: what Hide and Put back send for a row: the meeting's key, or the recording's. */
export const hideKeyOf = (r: CallRow): string | null => (r.recording ? recordingHideKey(r.recording.id) : r.other && r.occurrenceId === null ? r.other.key : null);

/**
 * MC-4: my hides that match no call in the list's window: counted in one line with Put back. A hidden Pocket recording
 * isn't counted (its row comes back with my list from Pocket; its hide goes at 60 days).
 */
export function hiddenMissing(rows: readonly CallRow[], hides: CallHides | null): { keys: string[]; series: string[] } {
  if (!hides) return { keys: [], series: [] };
  const keys = new Set(rows.map(hideKeyOf).filter((k): k is string => !!k));
  const series = new Set(rows.filter((r) => r.other?.seriesKey).map((r) => r.other!.seriesKey!));
  return { keys: [...hides.keys].filter((k) => !keys.has(k) && !isRecordingHide(k)), series: [...hides.series].filter((k) => !series.has(k)) };
}

/** MC-4: a closed call's line: what came of it ("2 created · 1 promise · 5 skipped", or "Nothing taken"). */
export function closedLine(c: NonNullable<CallRow["closed"]>): string {
  if (c.noTranscript) return CLOSE_TEXT.noTranscript;
  const d = c.done ?? { created: 0, promises: 0, comments: 0, skipped: 0 };
  const parts = [d.created ? CLOSE_TEXT.created(d.created) : null, d.promises ? CLOSE_TEXT.promises(d.promises) : null, d.comments ? CLOSE_TEXT.comments(d.comments) : null].filter((x): x is string => !!x);
  // Nothing taken is the whole line: what was skipped is behind See what was skipped.
  if (!parts.length) return CLOSE_TEXT.nothingTaken;
  if (d.skipped) parts.push(CLOSE_TEXT.skipped(d.skipped));
  return parts.join(" · ");
}

/** MC-4: a mark's words (null: none). */
export const markWords = (m: CallMarkKind): string | null => (m === "teams" ? MARK_TEXT.teams : m === "pocket" ? MARK_TEXT.pocket : m === "both" ? MARK_TEXT.both : null);

/** A day's heading: Today, Yesterday, then the weekday and date as the app writes them ("Mon, Nov 2"). */
export function dayHeading(day: string, today: string): string {
  const d = daysBetween(day, today);
  if (d === 0) return CALL_LIST.today;
  if (d === 1) return CALL_LIST.yesterday;
  return Temporal.PlainDate.from(day).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * What opens beside the list when no call is named: the newest call that needs me, else the newest open call that can be
 * reviewed (a kept call, or a calendar call with a mark), else nothing.
 */
export function firstToOpen(rows: readonly CallRow[]): CallRow | null {
  return rows.find((r) => r.bucket === "open" && r.state.needsMe) ?? rows.find((r) => r.bucket === "open" && (r.occurrenceId !== null || !!r.mark)) ?? null;
}

/** The clients the chips offer: every client a listed call is about (or suggested for), by name; "" when a call has no client yet. */
export function chipClients(rows: readonly CallRow[], nameOf: (key: string) => string = (k) => k): { key: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.bucket === "hidden") continue;
    const k = r.clientKey ?? r.suggested ?? "";
    if (!seen.has(k)) seen.set(k, r.clientName ?? (k ? nameOf(k) : CALL_LIST.noClient));
  }
  return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => Number(a.key === "") - Number(b.key === "") || a.name.localeCompare(b.name));
}

/**
 * MC-5: Needs you's one button by state: what is left to decide ("3 left", no button), else the button: Add transcript,
 * Use Pocket recording (my recording fits), or Try again (a pass failed). Null: nothing to press (waiting on someone else).
 */
export type NeedsAction = { kind: "left"; text: string } | { kind: "upload" | "pocket" | "retry"; text: string } | null;
export function needsAction(r: Pick<CallRow, "left" | "state" | "pocket">): NeedsAction {
  if (r.left?.open) return { kind: "left", text: LIST_TEXT.left(r.left.open) };
  if (r.state.label === CALL_STATE.aiFailed) return { kind: "retry", text: LIST_TEXT.tryAgain };
  if (r.pocket.length) return { kind: "pocket", text: LIST_TEXT.usePocket };
  if (r.state.label === CALL_STATE.upload || r.state.label === CALL_STATE.readFailed) return { kind: "upload", text: LIST_TEXT.addTranscript };
  return null;
}

/**
 * MC-5: a Needs you row's second line, on its right: MC-4's amber note when the call is from before this week (its
 * transcript goes 30 days after the call), else a thin bar once something is decided, else nothing.
 */
export function needsNote(r: Pick<CallRow, "day" | "left" | "occurrenceId">, today: string): { amber: string } | { done: number } | null {
  if (r.occurrenceId !== null && weekOf(r.day, today) !== "this") return { amber: LIST_TEXT.goes(Temporal.PlainDate.from(r.day).add({ days: 30 }).toLocaleString("en-US", { month: "short", day: "numeric" })) };
  if (r.left && r.left.all && r.left.open < r.left.all) return { done: (r.left.all - r.left.open) / r.left.all };
  return null;
}

/** MC-5: when, short: "Tue 1:00 PM" this week and last, "Nov 10, 2:00 PM" before that (in my zone). */
export function shortWhen(iso: string, day: string, today: string, zone: string): string {
  const t = new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  if (weekOf(day, today) !== "earlier") return `${new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: zone })} ${t}`;
  return `${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone })}, ${t}`;
}

/** MC-5: a week row's mark, short ("Teams", "Pocket", "Teams · Pocket"), and its full words for its label and hover. */
export const markShort = (m: CallMarkKind): { short: string; full: string } | null => (m ? { short: LIST_TEXT.mark[m], full: LIST_TEXT.markFull[m] } : null);
