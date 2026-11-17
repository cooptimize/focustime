// MC-1: the registered client calls I review or attend, as Week's cards mark them: each occurrence on the card whose
// hours it starts in, with what it needs from me in words. Loaded once per Week (meeting.mine) and again every 5
// minutes while the window is open. Pure helpers plus one hook; the server decides what I may see.
import { createContext, useContext, useEffect, useState } from "react";
import { call } from "../api.ts";
import type { OccurrenceView, SeriesView, MeetingNudgeView } from "../../plan/meeting-views.ts";
import { callLabel } from "../../plan/call-words.ts";

export type MineData = { meetings: SeriesView[]; occurrences: OccurrenceView[]; nudges: MeetingNudgeView[] };
export type CallMark = { occurrenceId: number; name: string; role: string; clientKey: string; startAt: string; endAt: string; label: string; needsMe: boolean };

/** What an occurrence needs, in words (MC-1d: one place for the mark, the list and the page, plan/call-words.ts). */
export { callLabel };

export function callMarks(d: MineData | null): CallMark[] {
  if (!d) return [];
  return d.occurrences.flatMap((o) => {
    const s = d.meetings.find((m) => m.id === o.seriesId);
    return s ? [{ occurrenceId: o.id, name: s.name, role: s.roleLabel, clientKey: s.clientKey, startAt: o.startAt, endAt: o.endAt, ...callLabel(o, s.mine.review) }] : [];
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

export const MeetingCalls = createContext<readonly CallMark[]>([]);
export const useCallMarks = () => useContext(MeetingCalls);

/** meeting.mine, now and every 5 minutes; nothing when meetings aren't available here. */
export function useMine(): MineData | null {
  const [data, setData] = useState<MineData | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => call<MineData>("meeting.mine", {}, { background: true }).then((d) => live && setData(d), () => undefined);
    void load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);
  return data;
}
