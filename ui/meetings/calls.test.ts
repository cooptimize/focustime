// MC-1d: a drawn meeting is a registered call only when it is a work meeting starting at the same instant as an
// occurrence of a call I review or attend (what meeting.mine returned); anything else stays an ordinary meeting. The
// call's addresses, and its menu, lead with the call. Fictional data only.
import { describe, expect, it } from "vitest";
import type { CalEvent } from "../../week/types.ts";
import { hashOf, parseHash } from "../nav.ts";
import { blockCalls, callForEvent, callHref, callMarks, callsNeedingMe, tieCalls, type MineData } from "./calls.ts";
import { anOccurrenceView, aSeriesView, ZONE } from "../../test/builders/index.ts";
import { callRows, openList } from "../../plan/call-list.ts";
import { callsToClose, weekCallsToClose } from "./CallsToClose.tsx";

const mine = (state: string, open: number, review: boolean): MineData => ({
  meetings: [{ id: 1, clientKey: "contoso", clientName: "Contoso", name: "Contoso weekly status call", roleLabel: "Weekly status call", mine: { review } } as never],
  occurrences: [{ id: 7, seriesId: 1, date: "2026-11-02", startAt: "2026-11-02T18:00:00Z", endAt: "2026-11-02T18:30:00Z", state, open, proposals: open, hasTranscript: true, retryAt: null } as never],
  nudges: [],
});
const ev = (p: Partial<CalEvent> = {}): CalEvent => ({ id: "outlook:x", source: "outlook", title: "Contoso weekly status", start: "2026-11-02T13:00:00-05:00", end: "2026-11-02T13:30:00-05:00", allDay: false, showAs: "busy", isPersonal: false, ...p });

describe("MC-1d: which drawn meeting is a call", () => {
  const marks = callMarks(mine("ready", 6, true));
  it("a work meeting at the occurrence's start is the call, whatever its title", () => {
    expect(callForEvent(marks, ev())?.occurrenceId).toBe(7);
    expect(callForEvent(marks, ev({ title: "Renamed in Outlook" }))?.label).toBe("Review 6 proposals");
  });
  it("anything else stays an ordinary meeting", () => {
    expect(callForEvent(marks, ev({ start: "2026-11-02T13:05:00-05:00" }))).toBeNull();
    // Another meeting at the same start (a standup) isn't the call; nor my own hold, nor a calendar added by link.
    expect(callForEvent(marks, ev({ end: "2026-11-02T13:15:00-05:00" }))).toBeNull();
    expect(callForEvent(marks, ev({ notMeeting: "solo" }))).toBeNull();
    expect(callForEvent(marks, ev({ source: "ics" }))).toBeNull();
    expect(callForEvent(marks, ev({ isPersonal: true }))).toBeNull();
    expect(callForEvent(marks, ev({ allDay: true }))).toBeNull();
    expect(callForEvent(marks, ev({ source: "google" }))).toBeNull();
    expect(callForEvent(marks, ev({ source: "focustime" }))).toBeNull();
    // An outsider gets nothing from meeting.mine, so nothing matches.
    expect(callForEvent(callMarks(null), ev())).toBeNull();
    expect(callForEvent(callMarks({ meetings: [], occurrences: [], nudges: [] }), ev())).toBeNull();
  });
  it("MC-2: a reviewed call that isn't registered gets the same mark, and its menu says Call", () => {
    const d = mine("ready", 2, true);
    (d.meetings[0] as unknown as { call: string; roleLabel: string }).call = "calendar";
    (d.meetings[0] as unknown as { roleLabel: string }).roleLabel = "Call";
    const m = callForEvent(callMarks(d), ev({ title: "Design review" }));
    expect(m).toMatchObject({ occurrenceId: 7, kind: "calendar", role: "Call", label: "Review 2 proposals" });
  });
  it("the count in More is what needs me: a reviewer's review, never an attendee's", () => {
    expect(callsNeedingMe(callMarks(mine("ready", 6, true)))).toBe(1);
    expect(callsNeedingMe(callMarks(mine("ready", 6, false)))).toBe(0);
    expect(callsNeedingMe(callMarks(mine("failed", 0, true)))).toBe(1);
  });
  it("the call's page, its Transcript view (at a line) and its upload are addresses that round-trip", () => {
    for (const h of [callHref(7), callHref(7, "transcript"), callHref(7, "transcript", 12), callHref(7, "upload")]) expect(hashOf(parseHash(h)!), h).toBe(h);
    expect(callHref(7, "transcript", 12)).toBe("#/calls/7/transcript/12");
    // MC-3: the address before Calls was a tab lands on the same call, view and line, on the Calls tab.
    expect(parseHash("#/meetings/7/transcript/12")).toEqual({ nav: { tab: "calls", occurrence: 7, view: "transcript", line: 12 }, overlay: null });
    for (const bad of ["#/meetings/7/nope", "#/meetings/7/transcript/x", "#/meetings/7/upload/3", "#/meetings/7/transcript/1/2", "#/calls/7/nope", "#/calls/x"]) expect(parseHash(bad), bad).toBeNull();
  });
});

// MC-4: the tab's count is the calls in Calls' Needs you, for any mix of calls (TEST 9).
describe("MC-4: the tab's count", () => {
  const TODAY = "2026-11-05";
  const weekly = aSeriesView({ id: 1, name: "Contoso weekly status call", clientKey: "Contoso", clientName: "Contoso" });
  const pressed = aSeriesView({ id: 2, name: "Fabrikam design review", clientKey: "Fabrikam", clientName: "Fabrikam", call: "calendar" });
  const look = aSeriesView({ id: 3, name: "Adatum planning", clientKey: "Adatum", clientName: "Adatum", mine: { review: false, attend: true } });
  const occs = [
    anOccurrenceView({ id: 10, seriesId: 1, startAt: "2026-11-02T18:00:00Z", endAt: "2026-11-02T18:30:00Z", state: "ready", open: 4, proposals: 6 }),
    anOccurrenceView({ id: 11, seriesId: 2, startAt: "2026-11-04T15:00:00Z", endAt: "2026-11-04T16:00:00Z", state: "failed", open: 0, retryAt: null }),
    anOccurrenceView({ id: 12, seriesId: 3, startAt: "2026-11-03T14:00:00Z", endAt: "2026-11-03T15:00:00Z", state: "ready", open: 2, proposals: 2 }),
    anOccurrenceView({ id: 13, seriesId: 1, startAt: "2026-10-26T18:00:00Z", endAt: "2026-10-26T18:30:00Z", state: "reviewed", open: 0, proposals: 8 }),
    anOccurrenceView({ id: 14, seriesId: 2, startAt: "2026-10-27T18:00:00Z", endAt: "2026-10-27T18:30:00Z", state: "needs_upload", open: 0, hasTranscript: false }),
    anOccurrenceView({ id: 20, seriesId: 1, startAt: "2026-10-01T18:00:00Z", endAt: "2026-10-01T18:30:00Z", state: "ready", open: 2, proposals: 2 }),
  ];
  it("equals Needs you, old calls included", () => {
    const mine = { meetings: [weekly, pressed, look], occurrences: occs, nudges: [] } as unknown as MineData;
    const needs = openList(callRows({ meetings: [weekly, pressed, look], occurrences: occs, others: [], today: TODAY, zone: ZONE }), null, TODAY).needs;
    expect(needs.map((r) => r.occurrenceId).sort()).toEqual([10, 11, 14, 20]);
    expect(callsNeedingMe(callMarks(mine))).toBe(needs.length);
  });
});

// MC-4 (TEST 8): Close out lists the day's calls still open (mine to review, something undecided); from Thursday,
// Week's header counts this week's.
describe("MC-4: calls to close", () => {
  const NY = "America/New_York";
  const mark = (id: number, startAt: string, open: number, review = true) => ({ occurrenceId: id, name: `Call ${id}`, role: "status", clientKey: "contoso", startAt, endAt: startAt, label: "", needsMe: open > 0, review, state: "ready", open, hasTranscript: true, kind: null }) as never;
  const marks = [
    mark(1, "2026-11-02T18:00:00Z", 3),
    mark(2, "2026-11-05T15:00:00Z", 1),
    mark(3, "2026-11-05T16:00:00Z", 0),
    mark(4, "2026-11-05T17:00:00Z", 2, false),
    // Thursday 11:30 PM in New York is Friday in UTC: still Thursday's.
    mark(5, "2026-11-06T04:30:00Z", 1),
    mark(6, "2026-10-29T18:00:00Z", 4),
  ];
  it("Close out: the day's calls I review with something undecided, by my zone's day", () => {
    expect(callsToClose(marks, NY, "2026-11-05", "2026-11-05").map((m: { occurrenceId: number }) => m.occurrenceId)).toEqual([2, 5]);
    expect(callsToClose(marks, NY, "2026-11-04", "2026-11-04")).toEqual([]);
  });
  it("Week: from Thursday, this week only, up to today", () => {
    expect(weekCallsToClose(marks, NY, "2026-11-05", "2026-11-02")).toBe(3);
    expect(weekCallsToClose(marks, NY, "2026-11-06", "2026-11-02")).toBe(3);
    expect(weekCallsToClose(marks, NY, "2026-11-04", "2026-11-02")).toBe(0);
    expect(weekCallsToClose(marks, NY, "2026-11-05", "2026-10-26")).toBe(0);
  });
});

describe("WK-6: a call is tied to its meeting by the meeting itself", () => {
  // Three calls I can see: a registered one whose meeting is known (key), a calendar call (key), and one kept before
  // WK-6 with no key. Fictional data only.
  const data = (): MineData => ({
    meetings: [
      { id: 1, clientKey: "contoso", clientName: "Contoso", name: "Contoso weekly status call", roleLabel: "Weekly status call", call: null, mine: { review: true } } as never,
      { id: 2, clientKey: "fabrikam", clientName: "Fabrikam", name: "Fabrikam design review", roleLabel: "Call", call: "calendar", mine: { review: true } } as never,
      { id: 3, clientKey: "contoso", clientName: "Contoso", name: "Contoso planning", roleLabel: "Planning", call: null, mine: { review: true } } as never,
    ],
    occurrences: [
      { id: 7, seriesId: 1, date: "2026-11-02", startAt: "2026-11-02T18:00:00Z", endAt: "2026-11-02T18:30:00Z", state: "ready", open: 8, proposals: 8, hasTranscript: true, retryAt: null, eventKey: "ical-status" } as never,
      { id: 8, seriesId: 2, date: "2026-11-03", startAt: "2026-11-03T15:00:00Z", endAt: "2026-11-03T16:00:00Z", state: "needs_upload", open: 0, proposals: 0, hasTranscript: false, retryAt: null, eventKey: "ical-design" } as never,
      { id: 9, seriesId: 3, date: "2026-11-04", startAt: "2026-11-04T19:00:00Z", endAt: "2026-11-04T20:00:00Z", state: "ready", open: 2, proposals: 2, hasTranscript: true, retryAt: null, eventKey: null } as never,
    ],
    nudges: [],
  });
  const marks = callMarks(data());
  it("a meeting moved to another time keeps its call", () => {
    const moved = ev({ id: "outlook:a", key: "ical-status", start: "2026-11-02T15:00:00-05:00", end: "2026-11-02T15:45:00-05:00" });
    expect(tieCalls(marks, [moved]).byEvent.get("outlook:a")?.occurrenceId).toBe(7);
    // And a meeting now at the call's old time with another key isn't it.
    const there = ev({ id: "outlook:b", key: "ical-other" });
    const t = tieCalls(marks, [moved, there]);
    expect(t.byEvent.get("outlook:b")).toBeUndefined();
    expect(t.loose.map((m) => m.occurrenceId)).toEqual([8, 9]);
  });
  it("two meetings with the same start and end: only the call's own carries it", () => {
    const own = ev({ id: "outlook:own", key: "ical-status" });
    const twin = ev({ id: "outlook:twin", key: "ical-twin" });
    const t = tieCalls(marks, [twin, own]);
    expect(t.byEvent.get("outlook:own")?.occurrenceId).toBe(7);
    expect(t.byEvent.get("outlook:twin")).toBeUndefined();
  });
  it("a call with no key falls back to its start and end, only when exactly one meeting fits", () => {
    const at = { start: "2026-11-04T14:00:00-05:00", end: "2026-11-04T15:00:00-05:00" };
    expect(tieCalls(marks, [ev({ id: "outlook:p", key: "ical-p", ...at })]).byEvent.get("outlook:p")?.occurrenceId).toBe(9);
    // Two meetings fit: neither is the call, and the call stays one with no meeting.
    const two = tieCalls(marks, [ev({ id: "outlook:p", ...at }), ev({ id: "outlook:q", ...at })]);
    expect(two.byEvent.size).toBe(0);
    expect(two.loose.map((m) => m.occurrenceId)).toContain(9);
    // Another call's own meeting at that time never fits.
    const d = data();
    (d.occurrences[1] as unknown as { startAt: string; endAt: string }).startAt = "2026-11-04T19:00:00Z";
    (d.occurrences[1] as unknown as { endAt: string }).endAt = "2026-11-04T20:00:00Z";
    const t = tieCalls(callMarks(d), [ev({ id: "outlook:d", key: "ical-design", ...at }), ev({ id: "outlook:p", ...at })]);
    expect(t.byEvent.get("outlook:d")?.occurrenceId).toBe(8);
    expect(t.byEvent.get("outlook:p")?.occurrenceId).toBe(9);
  });
  it("a personal event, an all-day event, unavailable time, a timebox and a calendar added by link never carry a call", () => {
    const k = { key: "ical-status" };
    for (const e of [ev({ ...k, isPersonal: true, source: "google" }), ev({ ...k, allDay: true }), ev({ ...k, source: "focustime", unavailable: { id: 1, note: null } }), ev({ ...k, notMeeting: "timebox" }), ev({ ...k, source: "ics" }), ev({ ...k, notMeeting: "solo" })]) {
      expect(callForEvent(marks, e)).toBeNull();
    }
  });
  it("a block's calls: its meetings' and the ones with no meeting in its hours; the count is what Calls counts", () => {
    const own = ev({ id: "outlook:own", key: "ical-status" });
    const t = tieCalls(marks, [own]);
    // Monday 12:30 to 17:00 ET: the status call's meeting; Tuesday's design call has no meeting drawn, so it is loose there.
    const mon = blockCalls(t, [own], "2026-11-02T17:30:00Z", "2026-11-02T22:00:00Z");
    expect([...mon.byEvent.values()].map((m) => m.occurrenceId)).toEqual([7]);
    expect(mon.needs.map((m) => m.occurrenceId)).toEqual([7]);
    const tue = blockCalls(t, [], "2026-11-03T14:00:00Z", "2026-11-03T17:30:00Z");
    expect(tue.loose.map((m) => m.occurrenceId)).toEqual([8]);
    expect(tue.needs.map((m) => m.label)).toEqual(["Upload the transcript"]);
    // Across the week the blocks count exactly what Calls counts.
    const wed = blockCalls(t, [], "2026-11-04T13:00:00Z", "2026-11-04T22:00:00Z");
    expect(mon.needs.length + tue.needs.length + wed.needs.length).toBe(callsNeedingMe(marks));
  });
  it("a reviewed call, one waiting for its transcript and one I only attend need nothing and aren't counted", () => {
    const d = data();
    (d.occurrences[0] as unknown as { state: string }).state = "reviewed";
    (d.occurrences[1] as unknown as { state: string }).state = "waiting";
    (d.meetings[2] as unknown as { mine: { review: boolean } }).mine = { review: false };
    const m = callMarks(d);
    expect(m.map((x) => x.needsMe)).toEqual([false, false, false]);
    expect(blockCalls(tieCalls(m, []), [], "2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z").needs).toEqual([]);
    expect(callsNeedingMe(m)).toBe(0);
  });
  it("WK-6: two calls on one meeting tie the one that needs me, and the other is never a row of its own", () => {
    const ev = { id: "outlook:a", key: "k1", start: "2026-11-04T14:30:00Z", end: "2026-11-04T16:30:00Z", source: "outlook" as const };
    const mk = (id: number, needsMe: boolean) => ({ occurrenceId: id, eventKey: "k1", startAt: ev.start, endAt: ev.end, needsMe }) as never;
    const tie = tieCalls([mk(1, false), mk(2, true)], [ev as never]);
    expect((tie.byEvent.get("outlook:a") as unknown as { occurrenceId: number }).occurrenceId).toBe(2);
    expect(tie.loose).toEqual([]);
  });
});
