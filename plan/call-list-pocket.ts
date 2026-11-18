// MC-2b: my Pocket recordings in Calls' list. Each goes on the calls it overlaps for at least half their length (only
// a call I review with no transcript yet, or one from my calendar nobody has read), which then say Pocket recording
// found; one that goes with no call is a row of its own, under Not reviewed. Pure; loaded with the Calls page only.
import { dayOf, type CallRow, type ListedRecording } from "./call-list.ts";
import { CALLS_TEXT, POCKET_ROW } from "./call-words.ts";
import { forCall, withNoCall } from "./pocket-match.ts";

/** The hook `callRows` takes as `addPocket`, for my recordings from my last press. */
export function pocketRows(recs: readonly ListedRecording[] | null, zone: string): ((all: CallRow[], takes: ReadonlySet<CallRow>) => void) | undefined {
  if (!recs?.length) return undefined;
  return (all, takes) => {
    const spans = recs.map((r) => ({ ...r, seconds: (Date.parse(r.endAt) - Date.parse(r.startAt)) / 1000 }));
    for (const row of all) {
      if (!takes.has(row)) continue;
      row.pocket = forCall(spans, row).map(({ seconds: _s, ...r }) => r);
      if (row.pocket.length) (row.state = { ...row.state, label: POCKET_ROW.found }), (row.source = POCKET_ROW.source);
    }
    for (const r of withNoCall(spans, all)) {
      const { seconds: _s, ...rec } = r;
      all.push({
        key: `p${rec.id}`, occurrenceId: null, other: null, name: rec.title || POCKET_ROW.kind, startAt: rec.startAt, endAt: rec.endAt,
        day: dayOf(rec.startAt, zone), minutes: rec.minutes, people: null, clientKey: null, clientName: null, source: POCKET_ROW.source, weekly: null,
        state: { label: CALLS_TEXT.notReviewed, needsMe: false }, bucket: "open", place: "week", review: true, pocket: [], recording: rec,
        mark: "pocket", check: null, left: null, closed: null, seriesKey: null, suggested: null,
      });
    }
  };
}
