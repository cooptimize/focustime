// MC-1: the registered client calls I review or attend, as Day, Week, the block panel and the phone mark them. MC-1d:
// the one place that says, for a meeting drawn anywhere, whether it is a registered call's occurrence I may see
// (`callForEvent`), its state and its mark's words (plan/call-words.ts). The server decides what I may see
// (meeting.mine returns only calls I review or attend); a meeting that isn't one of them gets nothing here and stays an
// ordinary meeting. Loaded once for the app (meeting.mine) and again every 5 minutes, and after a change to a call.
// MC-2: a call that isn't registered that I reviewed (or was on and someone on it reviewed) carries the same mark; a
// meeting I was on that nobody reviewed yet offers Review this call (`reviewableMeeting`), which opens Calls on its
// setup. My other calls themselves are read only when Calls opens (meeting.calls), never here.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { call } from "../api.ts";
import type { OccurrenceView, SeriesView, MeetingNudgeView } from "../../plan/meeting-views.ts";
import type { CallKind, OccurrenceState } from "../../plan/meetings.ts";
import { OTHER_CALL_DAYS } from "../../plan/calls.ts";
import { callLabel } from "../../plan/call-words.ts";

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
};

/** What an occurrence needs, in words (MC-1d: one place for the mark, the list and the page, plan/call-words.ts). */
export { callLabel };

export function callMarks(d: MineData | null): CallMark[] {
  if (!d) return [];
  return d.occurrences.flatMap((o) => {
    const s = d.meetings.find((m) => m.id === o.seriesId);
    return s ? [{ occurrenceId: o.id, name: s.name, role: s.roleLabel, clientKey: s.clientKey, startAt: o.startAt, endAt: o.endAt, review: s.mine.review, state: o.state, open: o.open, hasTranscript: o.hasTranscript, kind: s.call ?? null, ...callLabel(o, s.mine.review) }] : [];
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

/** What a drawn meeting needs to be matched: when it starts, and whether it is a meeting at all. */
export type DrawnMeeting = { start: string; end: string; allDay?: boolean; isPersonal?: boolean; unavailable?: unknown; notMeeting?: string; source?: string };

/**
 * MC-1d: the registered call (one I review or attend) a drawn meeting is an occurrence of, or null. A meeting on my
 * Outlook calendar with other people on it that starts and ends at the same instants as an occurrence of a call I can see
 * is that call; a personal event, an all-day one, unavailable time, a timebox, my own hold with nobody else on it or a
 * calendar added by link never is. Nothing about the meeting is sent anywhere: the match is made here, against what
 * meeting.mine already returned. (The events FocusTime reads carry no join link to match on; open questions.)
 */
export function callForEvent(marks: readonly CallMark[], e: DrawnMeeting): CallMark | null {
  if (e.source !== "outlook" || e.allDay || e.isPersonal || e.unavailable || e.notMeeting) return null;
  const a = Date.parse(e.start);
  const b = Date.parse(e.end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return marks.find((m) => Date.parse(m.startAt) === a && Date.parse(m.endAt) === b) ?? null;
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
let reviewWanted: { start: string; end: string } | null = null;
export const requestReviewCall = (e: { start: string; end: string }) => {
  reviewWanted = { start: e.start, end: e.end };
  location.hash = "#/meetings";
};
export const takeReviewCall = (): { start: string; end: string } | null => {
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

/** "#/meetings/<occurrence>", or its Transcript view, or a line in it. */
export const callHref = (occurrenceId: number, view?: "transcript" | "upload", line?: number) => `#/meetings/${occurrenceId}${view ? `/${view}` : ""}${view === "transcript" && line ? `/${line}` : ""}`;
/**
 * MC-1e: where a call was opened from (Day, Week, Calls), so its Back returns there rather than always to Week.
 * Kept in memory only, for this page; after a reload Back goes to Calls.
 */
let cameFrom: { occurrenceId: number; hash: string } | null = null;
export const rememberCallFrom = (occurrenceId: number, hash: string) => void (cameFrom = { occurrenceId, hash });
export const callFrom = (occurrenceId: number): string | null => (cameFrom?.occurrenceId === occurrenceId ? cameFrom.hash : null);
export const openCall = (occurrenceId: number, view?: "transcript" | "upload", line?: number) => void (location.hash = callHref(occurrenceId, view, line));
// Any way in (a mark's link, a button, a typed address) passes through a hash change: the place before it is kept.
if (typeof window !== "undefined")
  window.addEventListener("hashchange", (e) => {
    const to = /^#\/meetings\/(\d+)(\/|$)/.exec(new URL(e.newURL).hash);
    const from = new URL(e.oldURL).hash;
    if (to && !new RegExp(`^#/meetings/${to[1]}(/|$)`).test(from)) rememberCallFrom(Number(to[1]), from || "#/today");
  });

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

type Calls = { marks: readonly CallMark[]; reload: () => void };
export const MeetingCalls = createContext<Calls>({ marks: [], reload: () => undefined });
export const useCallMarks = () => useContext(MeetingCalls).marks;
export const useCallsReload = () => useContext(MeetingCalls).reload;
/** MC-1d: the call a drawn meeting is, for the mark and the menu (null: an ordinary meeting). */
export const useCallFor = (e: DrawnMeeting): CallMark | null => callForEvent(useCallMarks(), e);

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

/** MC-1d: the calls for the whole app (Day, Week, the block panel, the phone, the More menu's count). */
export function CallsProvider({ mine, children }: { mine: { data: MineData | null; reload: () => void }; children: ReactNode }) {
  const marks = useMemo(() => callMarks(mine.data), [mine.data]);
  const value = useMemo(() => ({ marks, reload: mine.reload }), [marks, mine.reload]);
  return createElement(MeetingCalls.Provider, { value }, children);
}

/** How many calls need me now (a reviewer's: proposals to review, a transcript to upload, a failed step to look at). */
export const callsNeedingMe = (marks: readonly CallMark[]) => marks.filter((m) => m.needsMe).length;
