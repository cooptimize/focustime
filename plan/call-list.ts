// MC-3: Calls is one list by day. Every call a person can see (a registered client call's occurrences, the calls they
// or someone on the call asked FocusTime to review, the calls they added, and the calls on their own calendar nobody
// has read yet) as one row each, newest first, under a heading per day, with its state in words and the bucket its
// filter puts it in. Pure: no I/O, no clock (the day and the zone are handed in). Nothing here reads or keeps anything:
// it only arranges what meeting.mine and meeting.calls already returned.
import type { OccurrenceView, OtherCallView, SeriesView } from "./meeting-views.ts";
import { OTHER_CALL_DAYS } from "./calls.ts";
import { CALL_LIST, callLabel, CALLS_TEXT, POCKET_ROW } from "./call-words.ts";
import { forCall, withNoCall } from "./pocket-match.ts";

/**
 * MC-2b: one of my own Pocket recordings as the page holds it (meeting.pocket_list's answer, in the page's memory only
 * while Calls is open): never who recorded it or any of its words.
 */
export type ListedRecording = { id: string; startAt: string; endAt: string; minutes: number; title: string };

/** The list's filters, in order. Their counts add up to All: every row is in exactly one of the other three. */
export const LIST_FILTERS = ["all", "review", "open", "done"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];
/** What a row is waiting for: me (To review), someone or something else (Not reviewed), nothing (Done). */
export type Bucket = Exclude<ListFilter, "all">;

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
  bucket: Bucket;
  /** I review it (I can act on it), else I look. */
  review: boolean;
  /** MC-2b: my Pocket recordings that go with this call, the longer overlap first (only while it has no transcript). */
  pocket: ListedRecording[];
  /** MC-2b: a recording that goes with no call is its own row (no occurrence, no calendar call). */
  recording: ListedRecording | null;
};

export type CallListInput = {
  meetings: readonly SeriesView[];
  occurrences: readonly OccurrenceView[];
  /** meeting.calls: my calendar's calls in my last OTHER_CALL_DAYS days (null while it is read, or when it failed). */
  others: readonly OtherCallView[] | null;
  /** Today in my zone, and the zone (for each call's own day). */
  today: string;
  zone: string;
  /** MC-2b: my Pocket recordings from my last press (null: not asked on this visit). */
  pocket?: readonly ListedRecording[] | null;
};

const dayOf = (iso: string, zone: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(zone).toPlainDate().toString();
const daysBetween = (a: string, b: string) => Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: "days" }).days;

/** A calendar call's row: by its own calendar key (in memory and the page only), so a refetch keeps the same row. */
export const otherRowKey = (c: { key: string }) => `c${c.key}`;

/** Which filter a row is in, from its state. */
export function bucketOf(o: { state: OccurrenceView["state"]; open: number }, needsMe: boolean): Bucket {
  if (needsMe) return "review";
  if (o.state === "reviewed" || o.state === "no_transcript" || (o.state === "ready" && !o.open)) return "done";
  return "open";
}

/** Where a kept call's transcript came from, or how it will come. */
function sourceOf(o: OccurrenceView, s: SeriesView): string {
  if (o.hasTranscript || o.transcriptFrom) return o.transcriptFrom === "automatic" ? CALL_LIST.fromTeams : CALL_LIST.uploaded;
  if (!s.call) return s.source === "automatic" ? CALL_LIST.readAfter : CALL_LIST.uploadedByReviewer;
  return s.teams ? CALL_LIST.teamsOrFile : CALL_LIST.fileOnly;
}

/**
 * Every call as one row, newest first. A calendar call someone already asked FocusTime to review is listed once, as the
 * call FocusTime keeps (with its people from my calendar). Calls older than the list's OTHER_CALL_DAYS days are left
 * out unless they need me (kept until their transcript is dropped, 30 days); `older` has the rest, for the fold.
 */
export function callRows(x: CallListInput): { rows: CallRow[]; older: CallRow[] } {
  const peopleOf = new Map<number, number>();
  for (const c of x.others ?? []) if (c.occurrenceId) peopleOf.set(c.occurrenceId, c.people);
  const all: CallRow[] = [];
  /** MC-2b: the rows a recording may go on: no transcript yet and I can act on it. */
  const takes = new Set<CallRow>();
  for (const o of x.occurrences) {
    const s = x.meetings.find((m) => m.id === o.seriesId);
    if (!s) continue;
    const state = callLabel(o, s.mine.review);
    const row: CallRow = {
      key: `o${o.id}`,
      occurrenceId: o.id,
      other: null,
      name: s.name,
      startAt: o.startAt,
      endAt: o.endAt,
      day: dayOf(o.startAt, x.zone),
      minutes: Math.max(0, Math.round((Date.parse(o.endAt) - Date.parse(o.startAt)) / 60_000)),
      people: peopleOf.get(o.id) ?? null,
      clientKey: s.clientKey,
      clientName: s.clientName,
      source: sourceOf(o, s),
      weekly: s.call ? null : s.roleLabel,
      state,
      bucket: bucketOf(o, state.needsMe),
      review: s.mine.review,
      pocket: [],
      recording: null,
    };
    all.push(row);
    if (s.mine.review && !o.hasTranscript && o.state !== "reviewed") takes.add(row);
  }
  const kept = new Set(all.map((r) => r.occurrenceId));
  (x.others ?? []).forEach((c) => {
    if (c.occurrenceId && kept.has(c.occurrenceId)) return;
    const row: CallRow = {
      key: otherRowKey(c),
      occurrenceId: c.occurrenceId,
      other: c,
      name: c.name,
      startAt: c.startAt,
      endAt: c.endAt,
      day: dayOf(c.startAt, x.zone),
      minutes: c.minutes,
      people: c.people,
      clientKey: null,
      clientName: null,
      source: c.teams ? CALL_LIST.teamsOrFile : CALL_LIST.fileOnly,
      weekly: null,
      state: { label: CALLS_TEXT.notReviewed, needsMe: false },
      bucket: "open",
      review: true,
      pocket: [],
      recording: null,
    };
    all.push(row);
    takes.add(row);
  });
  // MC-2b: each of my recordings goes on the calls it overlaps for at least half their length; one that goes with none
  // is a row of its own, counted under Not reviewed.
  const recs = x.pocket ?? [];
  if (recs.length) {
    const spans = recs.map((r) => ({ ...r, seconds: (Date.parse(r.endAt) - Date.parse(r.startAt)) / 1000 }));
    for (const row of all) {
      if (!takes.has(row)) continue;
      row.pocket = forCall(spans, row).map(({ seconds: _s, ...r }) => r);
      if (row.pocket.length) row.state = { ...row.state, label: POCKET_ROW.found };
    }
    for (const r of withNoCall(spans, all)) {
      const { seconds: _s, ...rec } = r;
      all.push({
        key: `p${rec.id}`, occurrenceId: null, other: null, name: rec.title || POCKET_ROW.kind, startAt: rec.startAt, endAt: rec.endAt,
        day: dayOf(rec.startAt, x.zone), minutes: rec.minutes, people: null, clientKey: null, clientName: null, source: POCKET_ROW.kind, weekly: null,
        state: { label: POCKET_ROW.kind, needsMe: false }, bucket: "open", review: true, pocket: [], recording: rec,
      });
    }
  }
  all.sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt) || a.name.localeCompare(b.name));
  const rows: CallRow[] = [];
  const older: CallRow[] = [];
  for (const r of all) {
    const age = daysBetween(r.day, x.today);
    // A call that needs me is always listed (its transcript and proposals go at TRANSCRIPT_DAYS on the server), so the
    // tab's count and To review never differ.
    if (age < OTHER_CALL_DAYS || r.state.needsMe) rows.push(r);
    else older.push(r);
  }
  return { rows, older };
}

/** The rows a filter and a client choice show (client null: every client; "" : no client said yet). */
export function filterRows(rows: readonly CallRow[], filter: ListFilter, client: string | null): CallRow[] {
  return rows.filter((r) => (filter === "all" || r.bucket === filter) && (client === null || (r.clientKey ?? "") === client));
}

/** Each filter's count for a client choice: All is the sum of the other three. */
export function filterCounts(rows: readonly CallRow[], client: string | null): Record<ListFilter, number> {
  const out: Record<ListFilter, number> = { all: 0, review: 0, open: 0, done: 0 };
  for (const r of filterRows(rows, "all", client)) {
    out.all++;
    out[r.bucket]++;
  }
  return out;
}

/** The rows under a heading per day, newest day first. */
export function byDay(rows: readonly CallRow[]): { day: string; rows: CallRow[] }[] {
  const out: { day: string; rows: CallRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last?.day === r.day) last.rows.push(r);
    else out.push({ day: r.day, rows: [r] });
  }
  return out;
}

/** A day's heading: Today, Yesterday, then the weekday and date as the app writes them ("Mon, Nov 2"). */
export function dayHeading(day: string, today: string): string {
  const d = daysBetween(day, today);
  if (d === 0) return CALL_LIST.today;
  if (d === 1) return CALL_LIST.yesterday;
  return Temporal.PlainDate.from(day).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * What opens beside the list when no call is named: the newest call that needs me, else the newest call that FocusTime
 * keeps or that can be set up, else nothing.
 */
export function firstToOpen(rows: readonly CallRow[]): CallRow | null {
  return rows.find((r) => r.state.needsMe) ?? rows[0] ?? null;
}

/** The clients the chips offer: every client a listed call is about, by name; "" when a call has no client yet. */
export function chipClients(rows: readonly CallRow[]): { key: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.clientKey ?? "")) seen.set(r.clientKey ?? "", r.clientName ?? CALL_LIST.noClient);
  return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => Number(a.key === "") - Number(b.key === "") || a.name.localeCompare(b.name));
}
