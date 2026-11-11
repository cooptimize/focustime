import { describe, expect, it } from "vitest";
import { lastReadLine, attendeeIds, canConfirm, canView, defaultReviewers, detectSource, graphReadable, mayRead, nextCheck, nudgesFor, occurrencesBetween, type MeetingSeries, type Occurrence } from "./meetings.ts";

const series = (p: Partial<MeetingSeries> = {}): MeetingSeries => ({
  id: 1, clientKey: "contoso", name: "Contoso sync", role: "status", source: "automatic", detected: "automatic", organizer: "home", joinUrl: "https://teams.microsoft.com/l/meetup-join/x", eventId: "AAA", registrantId: "u1",
  weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, reviewers: ["u1", "u2"], attendees: ["u3"], onlineMeetingId: null, createdAt: "2026-11-02T15:00:00Z", removedAt: null, ...p,
});
const occ = (p: Partial<Occurrence> = {}): Occurrence => ({ id: 10, seriesId: 1, date: "2026-11-10", startAt: "2026-11-10T15:00:00Z", endAt: "2026-11-10T16:00:00Z", state: "ready", nextCheckAt: null, checks: 0, transcriptFrom: "automatic", transcriptAt: null, aiOutcome: "done", dismissedBy: null, reviewedBy: null, updatedAt: "2026-11-10T16:00:00Z", ...p });

describe("meeting capture rules (MC-1)", () => {
  it("reads only registered (not removed) or FocusTime-scheduled meetings", () => {
    expect(mayRead({ registered: series() })).toBe(true);
    expect(mayRead({ registered: null, scheduledByFocusTime: true })).toBe(true);
    expect(mayRead({ registered: null })).toBe(false);
    expect(mayRead({ registered: series({ removedAt: "2026-11-05T00:00:00Z" }) })).toBe(false);
  });

  it("detects Automatic for Cooptimize's tenant and Upload for anyone else's", () => {
    expect(detectSource("kat@cooptimize.example", ["cooptimize.example"])).toEqual({ organizer: "home", source: "automatic" });
    expect(detectSource("pm@fabrikam.example", ["cooptimize.example"])).toEqual({ organizer: "other", source: "upload" });
    expect(detectSource(null, ["cooptimize.example"])).toEqual({ organizer: "unknown", source: "upload" });
  });

  it("never asks Graph about a client-hosted meeting, even with Automatic forced on", () => {
    expect(graphReadable(series())).toBe(true);
    expect(graphReadable(series({ organizer: "other", source: "automatic" }))).toBe(false);
    expect(graphReadable(series({ source: "upload" }))).toBe(false);
  });

  it("lets reviewers confirm and attendees only view", () => {
    const s = series();
    expect(canConfirm(s, "U1")).toBe(true);
    expect(canView(s, "u3")).toBe(true);
    expect(canConfirm(s, "u3")).toBe(false);
    expect(canView(s, "u9")).toBe(false);
  });

  it("defaults reviewers to the registrant plus the client's leads, once each", () => {
    expect(defaultReviewers("U1", ["u2", "u1", "u3"])).toEqual(["u1", "u2", "u3"]);
  });

  it("keeps only FocusTime users of the invite, by id", () => {
    expect(attendeeIds([{ email: "a@cooptimize.example" }, { email: "x@fabrikam.example" }, { email: null }], [{ id: "U-A", emails: ["A@cooptimize.example"] }])).toEqual(["u-a"]);
  });

  it("looks every 15 minutes for 3 hours after the end, then hourly, then stops at 12 hours", () => {
    const end = "2026-11-10T16:00:00Z";
    expect(nextCheck(end, "2026-11-10T15:30:00Z")).toBe("2026-11-10T16:05:00.000Z");
    expect(nextCheck(end, "2026-11-10T16:10:00Z")).toBe("2026-11-10T16:25:00.000Z");
    expect(nextCheck(end, "2026-11-10T20:00:00Z")).toBe("2026-11-10T21:00:00.000Z");
    expect(nextCheck(end, "2026-11-11T04:00:00Z")).toBeNull();
  });

  it("lays out a weekly pattern in the series' zone", () => {
    expect(occurrencesBetween(series(), "2026-11-02", "2026-11-17")).toEqual([
      { date: "2026-11-03", startAt: "2026-11-03T15:00:00Z", endAt: "2026-11-03T16:00:00Z" },
      { date: "2026-11-10", startAt: "2026-11-10T15:00:00Z", endAt: "2026-11-10T16:00:00Z" },
      { date: "2026-11-17", startAt: "2026-11-17T15:00:00Z", endAt: "2026-11-17T16:00:00Z" },
    ]);
    expect(occurrencesBetween(series({ interval: 2 }), "2026-11-02", "2026-11-17").map((o) => o.date)).toEqual(["2026-11-03", "2026-11-17"]);
  });

  it("nudges reviewers once per occurrence: review when ready, upload when needed, nothing once dismissed", () => {
    const s = [series()];
    expect(nudgesFor("u1", s, [occ()]).map((n) => n.key)).toEqual(["meeting_review:10"]);
    expect(nudgesFor("u1", s, [occ({ state: "needs_upload" })]).map((n) => n.kind)).toEqual(["upload"]);
    expect(nudgesFor("u3", s, [occ()])).toEqual([]);
    expect(nudgesFor("u1", s, [occ({ state: "needs_upload", dismissedBy: "u2" })])).toEqual([]);
    expect(nudgesFor("u1", s, [occ({ state: "reviewed" })])).toEqual([]);
  });
});

describe("the last-read line (MC-1c)", () => {
  const S = { source: "automatic" as const, registrantId: "reg", weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, createdAt: "2026-11-01T12:00:00Z" };
  const occ = (p: Partial<Occurrence> = {}): Occurrence => ({ id: 1, seriesId: 1, date: "2026-11-10", startAt: "2026-11-10T15:00:00Z", endAt: "2026-11-10T16:00:00Z", state: "waiting", nextCheckAt: null, checks: 0, transcriptFrom: null, transcriptAt: null, aiOutcome: null, dismissedBy: null, reviewedBy: null, lastRead: null, updatedAt: "2026-11-10T15:00:00Z", ...p });
  const names = (id: string) => ({ reg: "Sam Admin", rev: "Kim Lead" })[id] ?? "A former teammate";
  const line = (o: Occurrence[], now: string, s: Partial<typeof S> = {}) => lastReadLine({ ...S, ...s }, o, now, "America/New_York", names);

  it("says when and through whose sign-in a transcript was read", () => {
    expect(line([occ({ state: "ready", transcriptFrom: "automatic", transcriptAt: "2026-11-10T19:15:00Z", lastRead: { kind: "found", by: "rev", at: "2026-11-10T19:15:00Z" } })], "2026-11-11T12:00:00Z")).toBe("Transcript read Nov 10, 2:15 PM through Kim Lead's sign-in");
    expect(line([occ({ state: "ready", transcriptFrom: "upload", transcriptAt: "2026-11-10T19:15:00Z" })], "2026-11-11T12:00:00Z")).toBe("Transcript uploaded Nov 10, 2:15 PM");
  });

  it("says plainly why not", () => {
    expect(line([occ()], "2026-11-10T15:30:00Z")).toBe("Nov 10 call: waiting for the call to end");
    expect(line([occ({ lastRead: { kind: "no_token", by: "reg", at: "x" } })], "2026-11-10T16:30:00Z")).toBe("Nov 10 call: Sam Admin needs to sign in with Microsoft again");
    expect(line([occ({ state: "needs_upload", checks: 9, lastRead: { kind: "not_yet", by: "reg", at: "x" } })], "2026-11-11T12:00:00Z")).toBe("Nov 10 call: no transcript was recorded. A reviewer can upload one");
    expect(line([occ({ state: "needs_upload" })], "2026-11-11T12:00:00Z", { source: "upload" })).toBe("Nov 10 call: waiting for a reviewer to upload the transcript");
    expect(line([occ({ lastRead: { kind: "busy", by: "reg", at: "x" } })], "2026-11-10T16:30:00Z")).toMatch(/Microsoft wasn't answering/);
    expect(line([occ({ state: "no_transcript" })], "2026-11-11T12:00:00Z")).toBe("Nov 10 call: no transcript this week");
  });

  it("before the first call, names its day", () => {
    expect(line([], "2026-11-11T12:00:00Z")).toBe("Not read yet: the first call is Tue, Nov 17");
  });
});
