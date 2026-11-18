// MC-1: the registered client calls I review or attend, as Day, Week, the block panel and the phone mark them. MC-1d:
// the one place that says, for a meeting drawn anywhere, whether it is a registered call's occurrence I may see
// (`callForEvent`), its state and its mark's words (plan/call-words.ts). The server decides what I may see
// (meeting.mine returns only calls I review or attend); a meeting that isn't one of them gets nothing here and stays an
// ordinary meeting. Loaded once for the app (meeting.mine) and again every 5 minutes, and after a change to a call.
// MC-2: a call that isn't registered that I reviewed (or was on and someone on it reviewed) carries the same mark; a
// meeting I was on that nobody reviewed yet offers Review this call (`reviewableMeeting`), which opens Calls on its
// setup. My other calls themselves are read only when Calls opens (meeting.calls), never here.
// WK-6: a drawn meeting is a call's when it is that call's own meeting (its iCalUId, `eventKey`), wherever it moved;
// a call with no key falls back to the same start and end, only when exactly one meeting fits (`tieCalls`). One tie for
// the week on screen, shared by Week, Day, the block panel, the phone and the meeting's menu.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { call } from "../api.ts";
import type { OccurrenceView, SeriesView, MeetingNudgeView } from "../../plan/meeting-views.ts";
import type { CallKind, OccurrenceState } from "../../plan/meetings.ts";
import { OTHER_CALL_DAYS } from "../../plan/calls.ts";
import { callLabel } from "../../plan/call-words.ts";
import { LIST_FILTERS, type ListFilter } from "../../plan/call-list.ts";

/**
 * MC-3: what this browser keeps for Calls' list: its filter and client (never a call). Read when Calls opens from a
 * tab, a key or the command menu, so the address carries them from the start (and Back never meets a second step).
 */
const LIST_KEY = "focustime.calls.list";
export function rememberedCallsList(): { show?: ListFilter; client?: string } {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? "{}") as { show?: unknown; client?: unknown };
    return { ...(typeof v.show === "string" && (LIST_FILTERS as readonly string[]).includes(v.show) && v.show !== "all" ? { show: v.show as ListFilter } : {}), ...(typeof v.client === "string" && v.client.length <= 100 ? { client: v.client } : {}) };
  } catch {
    return {};
  }
}
export function rememberCallsList(show: ListFilter | undefined, client: string | undefined) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify({ ...(show && show !== "all" ? { show } : {}), ...(client !== undefined ? { client } : {}) }));
  } catch {
    /* a convenience only */
  }
}

export type MineData = { meetings: SeriesView[]; occurrences: OccurrenceView[]; nudges: MeetingNudgeView[] };
export type CallMark = {
  occurrenceId: number;
  name: string;
  role: string;
  clientKey: string;
  startAt: string;
  endAt: string;
  label: string;
  needsMe: boolean;
  /** MC-1d: I review it (Propose again, Upload); otherwise I attend and can look. */
  review: boolean;
  state: OccurrenceState;
  open: number;
  hasTranscript: boolean;
  /** MC-2: null for a registered client call; "calendar" or "hand" for a call that isn't registered. */
  kind: CallKind | null;
  /** WK-6: its meeting's iCalUId, when known: the tie to its meeting by the meeting itself. */
  eventKey: string | null;
};

/** What an occurrence needs, in words (MC-1d: one place for the mark, the list and the page, plan/call-words.ts). */
export { callLabel };

export function callMarks(d: MineData | null): CallMark[] {
  if (!d) return [];
  return d.occurrences.flatMap((o) => {
    const s = d.meetings.find((m) => m.id === o.seriesId);
    return s ? [{ occurrenceId: o.id, name: s.name, role: s.roleLabel, clientKey: s.clientKey, startAt: o.startAt, endAt: o.endAt, review: s.mine.review, state: o.state, open: o.open, hasTranscript: o.hasTranscript, kind: s.call ?? null, eventKey: o.eventKey ?? null, ...callLabel(o, s.mine.review) }] : [];
  });
}

/** The calls that start inside a card's hours (start inclusive, end exclusive). */
export function callsIn(marks: readonly CallMark[], start: string, end: string): CallMark[] {
  const a = Date.parse(start);
  const b = Date.parse(end);
  return marks.filter((m) => {
    const t = Date.parse(m.startAt);
    return t >= a && t < b;
  });
}

/** What a drawn meeting needs to be matched: which meeting it is, when it starts, and whether it is a meeting at all. */
export type DrawnMeeting = { id: string; key?: string | undefined; start: string; end: string; allDay?: boolean; isPersonal?: boolean; unavailable?: unknown; notMeeting?: string; source?: string };

/**
 * A meeting a call can be: on my Outlook calendar with other people on it. A personal event, an all-day one, unavailable
 * time, a timebox, my own hold with nobody else on it or a calendar added by link never is.
 */
const callable = (e: DrawnMeeting) => e.source === "outlook" && !e.allDay && !e.isPersonal && !e.unavailable && !e.notMeeting;

/** WK-6: the calls tied to drawn meetings (by the meeting's id) and the calls with no meeting among them. */
export type CallTie = { byEvent: ReadonlyMap<string, CallMark>; loose: readonly CallMark[]; scope: ReadonlySet<string> };

/**
 * WK-6 (MC-1d before, by times only): which call each drawn meeting is. A call whose meeting is known (`eventKey`, the
 * meeting's iCalUId) is that meeting's, wherever it moved. A call kept with no key falls back to the same start and end,
 * only when exactly one meeting fits that isn't another call's own. Two meetings never share a call, and a call is tied
 * once. The calls left are `loose`: a call added by hand, or whose meeting isn't among `events`. Nothing about a meeting
 * is sent anywhere: the tie is made here, against what meeting.mine already returned.
 */
export function tieCalls(marks: readonly CallMark[], events: readonly DrawnMeeting[]): CallTie {
  const byEvent = new Map<string, CallMark>();
  const tied = new Set<number>();
  const meetings = events.filter(callable);
  // The one that needs me first, so two calls on one meeting (registered, and asked to review) show the one to act on;
  // the other is that meeting's too and never a second row of its own.
  const keyed = marks.filter((m) => m.eventKey).sort((x, y) => Number(y.needsMe) - Number(x.needsMe));
  for (const m of keyed) {
    const e = meetings.find((x) => x.key === m.eventKey && !byEvent.has(x.id));
    if (e) byEvent.set(e.id, m), tied.add(m.occurrenceId);
    else if (meetings.some((x) => x.key === m.eventKey)) tied.add(m.occurrenceId);
  }
  const owned = new Set(marks.flatMap((m) => (m.eventKey ? [m.eventKey] : [])));
  for (const m of marks) {
    if (m.eventKey || tied.has(m.occurrenceId)) continue;
    const a = Date.parse(m.startAt);
    const b = Date.parse(m.endAt);
    const fits = meetings.filter((e) => !byEvent.has(e.id) && !(e.key && owned.has(e.key)) && Date.parse(e.start) === a && Date.parse(e.end) === b);
    if (fits.length === 1) byEvent.set(fits[0]!.id, m), tied.add(m.occurrenceId);
  }
  return { byEvent, loose: marks.filter((m) => !tied.has(m.occurrenceId)), scope: new Set(events.map((e) => e.id)) };
}

/** The call a drawn meeting is, or null, tied among `among` (the meetings drawn with it; by default only itself). */
export function callForEvent(marks: readonly CallMark[], e: DrawnMeeting, among: readonly DrawnMeeting[] = [e]): CallMark | null {
  return tieCalls(marks, among.some((x) => x.id === e.id) ? among : [...among, e]).byEvent.get(e.id) ?? null;
}

/**
 * WK-6: a block's calls, as its card and the block panel show them: each of its meetings' call, and the calls with no
 * meeting that start in its hours (start inclusive, end exclusive). `needs` are the ones that need me now, in time order:
 * the card's count, the same rule as Calls' own (callsNeedingMe).
 */
export function blockCalls(tie: CallTie, events: readonly DrawnMeeting[], start: string, end: string): { byEvent: ReadonlyMap<string, CallMark>; loose: CallMark[]; needs: CallMark[] } {
  const byEvent = new Map(events.flatMap((e) => (tie.byEvent.has(e.id) ? [[e.id, tie.byEvent.get(e.id)!] as const] : [])));
  const loose = callsIn(tie.loose, start, end);
  const needs = [...new Set([...byEvent.values(), ...loose])].filter((m) => m.needsMe).sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt));
  return { byEvent, loose, needs };
}

/**
 * MC-2: a meeting I was on that isn't a call I can already see, and that could be reviewed: on my Outlook calendar
 * with someone else on it (not my own hold, a timebox, unavailable time, a personal or all-day event or a calendar
 * added by link), not declined, started already, in my last OTHER_CALL_DAYS days. The server checks it all again on the
 * press against my own calendar; this only decides whether the menu offers it.
 */
export function reviewableMeeting(e: DrawnMeeting & { responseStatus?: string }, nowMs: number, todayStartMs: number): boolean {
  if (e.source !== "outlook" || e.allDay || e.isPersonal || e.unavailable || e.notMeeting) return false;
  if (e.responseStatus === "declined") return false;
  const a = Date.parse(e.start);
  return Number.isFinite(a) && a < nowMs && a >= todayStartMs - (OTHER_CALL_DAYS - 1) * 86_400_000;
}

/**
 * MC-2: Review this call from a meeting's menu: Calls opens and finds the meeting among my other calls (by its start
 * and end), then opens its setup. Held in memory only until Calls takes it; nothing about the meeting goes anywhere.
 */
let reviewWanted: { start: string; end: string; key?: string } | null = null;
export const requestReviewCall = (e: { start: string; end: string; key?: string | undefined }) => {
  // WK-6: with the meeting's iCalUId, Calls finds it by the meeting itself (by its start and end when there is none).
  reviewWanted = { start: e.start, end: e.end, ...(e.key ? { key: e.key } : {}) };
  location.hash = "#/calls";
};
export const takeReviewCall = (): { start: string; end: string; key?: string } | null => {
  const x = reviewWanted;
  reviewWanted = null;
  return x;
};
/** MC-2: the setup's Get it from Teams press runs on the call's page (where its result shows), once. In memory only. */
let fetchFor: number | null = null;
export const requestFetch = (occurrenceId: number) => void (fetchFor = occurrenceId);
export const takeFetch = (occurrenceId: number): boolean => {
  if (fetchFor !== occurrenceId) return false;
  fetchFor = null;
  return true;
};

/**
 * "#/calls/<occurrence>", or its Transcript view, or a line in it. MC-3: Calls is a tab, so a call opens there beside
 * the list, and the browser's Back returns to where it was opened from (MC-1e's remembered place is no longer needed).
 */
export const callHref = (occurrenceId: number, view?: "transcript" | "upload", line?: number) => `#/calls/${occurrenceId}${view ? `/${view}` : ""}${view === "transcript" && line ? `/${line}` : ""}`;
export const openCall = (occurrenceId: number, view?: "transcript" | "upload", line?: number) => void (location.hash = callHref(occurrenceId, view, line));

/**
 * MC-1d: Propose again from a meeting's menu opens the call's page, which runs it there (so the person sees it run and
 * its result). The request waits here for that page to pick it up; it is in memory only.
 */
let rerunFor: number | null = null;
export const requestRerun = (occurrenceId: number) => {
  rerunFor = occurrenceId;
  openCall(occurrenceId);
};
export const takeRerun = (occurrenceId: number): boolean => {
  if (rerunFor !== occurrenceId) return false;
  rerunFor = null;
  return true;
};

type Calls = { marks: readonly CallMark[]; reload: () => void; tie: CallTie };
const NO_TIE: CallTie = { byEvent: new Map(), loose: [], scope: new Set() };
export const MeetingCalls = createContext<Calls>({ marks: [], reload: () => undefined, tie: NO_TIE });
export const useCallMarks = () => useContext(MeetingCalls).marks;
export const useCallsReload = () => useContext(MeetingCalls).reload;
/** WK-6: the tie for the week on screen (every drawn meeting's call, and the calls with no meeting). */
export function useCallTie(): CallTie {
  const c = useContext(MeetingCalls);
  return c.tie === NO_TIE ? tieCalls(c.marks, []) : c.tie;
}
/** WK-6: which call a drawn meeting is, from the week's one tie (a meeting from elsewhere is tied on its own). */
export function useCallOf(): (e: DrawnMeeting) => CallMark | null {
  const { marks, tie } = useContext(MeetingCalls);
  return useCallback((e: DrawnMeeting) => (tie.scope.has(e.id) ? (tie.byEvent.get(e.id) ?? null) : callForEvent(marks, e)), [marks, tie]);
}
/** MC-1d, WK-6: the call a drawn meeting is, for the mark and the menu (null: an ordinary meeting). */
export const useCallFor = (e: DrawnMeeting): CallMark | null => useCallOf()(e);
/** WK-6: a block's calls (its meetings' and the calls with no meeting in its hours), from the week's one tie. */
export function useBlockCalls(slot: { start: string; end: string; events: readonly { event: DrawnMeeting }[] }) {
  const { marks, tie } = useContext(MeetingCalls);
  const events = slot.events.map((p) => p.event);
  // A block outside the week on screen (or with no week tied) is tied on its own.
  const inScope = tie !== NO_TIE && events.every((e) => tie.scope.has(e.id));
  return blockCalls(inScope ? tie : tieCalls(marks, events), events, slot.start, slot.end);
}

/** meeting.mine, now and every 5 minutes; nothing when meetings aren't available here. */
export function useMine(on = true): { data: MineData | null; reload: () => void } {
  const [data, setData] = useState<MineData | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!on) return;
    let live = true;
    // Only a change re-renders (the whole app reads these); a hidden tab doesn't ask.
    let last = "";
    const load = () =>
      call<MineData>("meeting.mine", {}, { background: true }).then((d) => {
        const key = JSON.stringify(d);
        if (live && key !== last) (last = key), setData(d);
      }, () => undefined);
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 5 * 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on, n]);
  return { data, reload };
}

/**
 * MC-1d: the calls for the whole app (Day, Week, the block panel, the phone, the More menu's count). WK-6: tied once to
 * the meetings of the week on screen (`events`).
 */
export function CallsProvider({ mine, events, children }: { mine: { data: MineData | null; reload: () => void }; events?: readonly DrawnMeeting[] | undefined; children: ReactNode }) {
  const marks = useMemo(() => callMarks(mine.data), [mine.data]);
  const tie = useMemo(() => (events ? tieCalls(marks, events) : NO_TIE), [marks, events]);
  const value = useMemo(() => ({ marks, reload: mine.reload, tie }), [marks, mine.reload, tie]);
  return createElement(MeetingCalls.Provider, { value }, children);
}

/** How many calls need me now (a reviewer's: proposals to review, a transcript to upload, a failed step to look at). */
export const callsNeedingMe = (marks: readonly CallMark[]) => marks.filter((m) => m.needsMe).length;
