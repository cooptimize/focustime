// MC-1d: a drawn meeting is a registered call only when it is a work meeting starting at the same instant as an
// occurrence of a call I review or attend (what meeting.mine returned); anything else stays an ordinary meeting. The
// call's addresses, and its menu, lead with the call. Fictional data only.
import { describe, expect, it } from "vitest";
import type { CalEvent } from "../../week/types.ts";
import { hashOf, parseHash } from "../nav.ts";
import { callForEvent, callHref, callMarks, callsNeedingMe, type MineData } from "./calls.ts";

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
  it("the count in More is what needs me: a reviewer's review, never an attendee's", () => {
    expect(callsNeedingMe(callMarks(mine("ready", 6, true)))).toBe(1);
    expect(callsNeedingMe(callMarks(mine("ready", 6, false)))).toBe(0);
    expect(callsNeedingMe(callMarks(mine("failed", 0, true)))).toBe(1);
  });
  it("the call's page, its Transcript view (at a line) and its upload are addresses that round-trip", () => {
    for (const h of [callHref(7), callHref(7, "transcript"), callHref(7, "transcript", 12), callHref(7, "upload")]) expect(hashOf(parseHash(h)!), h).toBe(h);
    expect(parseHash("#/meetings/7/transcript/12")?.overlay).toEqual({ kind: "meeting", occurrence: 7, view: "transcript", line: 12 });
    for (const bad of ["#/meetings/7/nope", "#/meetings/7/transcript/x", "#/meetings/7/upload/3", "#/meetings/7/transcript/1/2"]) expect(parseHash(bad), bad).toBeNull();
  });
});
