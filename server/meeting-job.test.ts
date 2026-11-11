// MC-1: the job lays out an Automatic call's occurrences from the registrant's calendar, looks for the transcript on
// schedule with the registrant's token first and then the other reviewers', runs the AI pass once it's found, and
// asks for an upload after 12 hours. An Upload call is never asked of Graph.
import { describe, expect, it } from "vitest";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { MeetingsClient, SeriesInstance, TranscriptRef } from "../sources/graph/meetings.ts";
import { createMeetingStore, type NewSeries } from "../store/meeting-store.ts";
import { sqliteDb } from "../test/db.ts";
import { meetingJob } from "./meeting-job.ts";

const REG = "11111111-1111-4111-8111-111111111111";
const REV = "22222222-2222-4222-8222-222222222222";
const series = (p: Partial<NewSeries> = {}): NewSeries => ({
  clientKey: "contoso", name: "Contoso sync", role: "status", source: "automatic", detected: "automatic", organizer: "home", joinUrl: "https://teams.microsoft.com/l/meetup-join/c", eventId: "E1", registrantId: REG,
  weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, reviewers: [REG, REV], attendees: [], ...p,
});

function setup() {
  let now = Temporal.Instant.from("2026-11-10T15:30:00Z");
  const db = sqliteDb();
  const store = createMeetingStore(db.conn, () => now);
  const calls: { who: string; op: string }[] = [];
  let transcripts: TranscriptRef[] = [];
  const instances: SeriesInstance[] = [{ startAt: "2026-11-10T15:00:00Z", endAt: "2026-11-10T16:00:00Z", cancelled: false, homeAttendees: ["lee@cooptimize.example"] }];
  const signedOut = new Set<string>();
  const calendarOut = new Set<string>();
  let transcriptsFail: Error | null = null;
  let calendarFail: Error | null = null;
  const refusedBy = new Map<string, Error>();
  const graphFor = (who: string) =>
    ({
      instances: async () => {
        calls.push({ who, op: "instances" });
        if (calendarOut.has(who)) throw calendarFail ?? new HttpError(401);
        return instances;
      },
      onlineMeetingId: async () => {
        calls.push({ who, op: "onlineMeetingId" });
        if (signedOut.has(who)) throw new HttpError(401);
        if (refusedBy.has(who)) throw refusedBy.get(who)!;
        return "om-1";
      },
      transcripts: async () => {
        calls.push({ who, op: "transcripts" });
        if (signedOut.has(who)) throw new HttpError(401);
        if (transcriptsFail) throw transcriptsFail;
        return transcripts;
      },
      transcriptVtt: async () => (calls.push({ who, op: "transcriptVtt" }), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Lee Mate>I'll send it Friday.</v>\n"),
    }) as unknown as MeetingsClient;
  const job = meetingJob({
    store,
    now: () => now,
    log: () => {},
    person: async (uid) => ({ graph: graphFor(uid), ai: async () => null, capture: async () => null }),
    users: async () => [{ id: "33333333-3333-4333-8333-333333333333", name: "Lee Mate", emails: ["lee@cooptimize.example"] }],
  });
  return { store, job, calls, signedOut, calendarOut, failTranscripts: (e: Error | null) => (transcriptsFail = e), failCalendar: (e: Error) => (calendarFail = e), refusedBy, setNow: (t: string) => (now = Temporal.Instant.from(t)), setTranscripts: (t: TranscriptRef[]) => (transcripts = t) };
}

describe("meeting capture job (MC-1)", () => {
  it("lays out occurrences from the registrant's calendar, refreshes attendees, and finds the transcript", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    await t.job.run();
    const [occ] = await t.store.occurrencesOf(s.id);
    expect(occ).toMatchObject({ date: "2026-11-10", state: "waiting", nextCheckAt: "2026-11-10T16:05:00.000Z" });
    expect((await t.store.series(s.id))!.attendees).toEqual(["33333333-3333-4333-8333-333333333333"]);
    expect(await t.job.wake()).toEqual(Temporal.Instant.from("2026-11-10T16:05:00Z"));
    // Due, not ready yet: checked again in 15 minutes.
    t.setNow("2026-11-10T16:06:00Z");
    await t.job.run();
    expect((await t.store.occurrence(occ!.id))).toMatchObject({ state: "waiting", nextCheckAt: "2026-11-10T16:21:00.000Z", checks: 1 });
    // Ready: read, stored, the pass runs (AI not set up here: ready with that outcome).
    t.setTranscripts([{ id: "tr-1", createdAt: "2026-11-10T16:02:00Z", endAt: null }]);
    t.setNow("2026-11-10T16:22:00Z");
    await t.job.run();
    expect(await t.store.occurrence(occ!.id)).toMatchObject({ state: "ready", transcriptFrom: "automatic", aiOutcome: "not_set_up" });
    expect((await t.store.transcript(occ!.id))?.[0]?.speaker).toBe("Lee Mate");
  });

  it("tries the registrant's token first, then another reviewer's", async () => {
    const t = setup();
    await t.store.addSeries(series());
    await t.job.run();
    t.signedOut.add(REG);
    t.setTranscripts([{ id: "tr-1", createdAt: "2026-11-10T16:02:00Z", endAt: null }]);
    t.setNow("2026-11-10T16:06:00Z");
    await t.job.run();
    const graphOps = t.calls.filter((c) => c.op !== "instances");
    expect(graphOps.map((c) => `${c.who === REG ? "reg" : "rev"}:${c.op}`)).toEqual(["reg:onlineMeetingId", "rev:onlineMeetingId", "rev:transcripts", "rev:transcriptVtt"]);
  });

  it("asks for an upload after 12 hours without a transcript", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    await t.job.run();
    t.setNow("2026-11-11T04:30:00Z");
    await t.job.run();
    expect((await t.store.occurrencesOf(s.id))[0]).toMatchObject({ state: "needs_upload", nextCheckAt: null });
  });

  it("never asks Graph about an Upload call; its past occurrence asks for the transcript", async () => {
    const t = setup();
    const s = await t.store.addSeries(series({ source: "upload", detected: "upload", organizer: "other", eventId: null }));
    t.setNow("2026-11-10T17:00:00Z");
    await t.job.run();
    expect(t.calls).toEqual([]);
    expect((await t.store.occurrencesOf(s.id))[0]).toMatchObject({ date: "2026-11-10", state: "needs_upload" });
  });

  // MC-1c: Microsoft's docs (calltranscript-get, checked Nov 11, 2026) say a transcript can be read by "users who are
  // part of the meeting calendar invite", so a registrant who attends but doesn't organize reads it like the organizer.
  it("reads a teammate-organized call through a registrant who only attends, and records whose sign-in read it", async () => {
    const t = setup();
    const s = await t.store.addSeries(series({ organizer: "home" }));
    await t.job.run();
    t.setTranscripts([{ id: "tr-1", createdAt: "2026-11-10T16:02:00Z", endAt: null }]);
    t.setNow("2026-11-10T16:06:00Z");
    await t.job.run();
    const [occ] = await t.store.occurrencesOf(s.id);
    expect(occ).toMatchObject({ transcriptFrom: "automatic", lastRead: { kind: "found", by: REG } });
    expect(t.calls.filter((c) => c.op !== "instances").every((c) => c.who === REG)).toBe(true);
  });

  it("records the reviewer whose sign-in read it when the registrant's can't, and who must sign in when nobody's can", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    await t.job.run();
    t.signedOut.add(REG);
    t.setTranscripts([{ id: "tr-1", createdAt: "2026-11-10T16:02:00Z", endAt: null }]);
    t.setNow("2026-11-10T16:06:00Z");
    await t.job.run();
    expect((await t.store.occurrencesOf(s.id))[0]!.lastRead).toMatchObject({ kind: "found", by: REV });

    const u = setup();
    const s2 = await u.store.addSeries(series());
    await u.job.run();
    u.signedOut.add(REG).add(REV);
    u.setNow("2026-11-10T16:06:00Z");
    await u.job.run();
    expect((await u.store.occurrencesOf(s2.id))[0]).toMatchObject({ state: "waiting", lastRead: { kind: "no_token", by: REG } });
  });

  it("calls a throttled or unreachable Microsoft busy and keeps looking", async () => {
    for (const err of [new HttpError(429), new HttpError(503), new NetworkError("network")]) {
      const t = setup();
      const s = await t.store.addSeries(series());
      await t.job.run();
      t.failTranscripts(err);
      t.setNow("2026-11-10T16:06:00Z");
      await t.job.run();
      expect((await t.store.occurrencesOf(s.id))[0]).toMatchObject({ state: "waiting", nextCheckAt: "2026-11-10T16:21:00.000Z", lastRead: { kind: "busy" } });
    }
  });

  it("lays out from the stored pattern when the registrant's calendar can't be read, so the reviewers' sign-ins are tried", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    t.calendarOut.add(REG);
    t.signedOut.add(REG);
    t.setTranscripts([{ id: "tr-1", createdAt: "2026-11-10T16:02:00Z", endAt: null }]);
    await t.job.run();
    expect((await t.store.occurrencesOf(s.id))[0]).toMatchObject({ date: "2026-11-10", state: "waiting" });
    t.setNow("2026-11-10T16:06:00Z");
    await t.job.run();
    expect((await t.store.occurrencesOf(s.id))[0]).toMatchObject({ transcriptFrom: "automatic", lastRead: { kind: "found", by: REV } });
  });

  it("records why the first person's sign-in couldn't read it: consent or not found, not just sign in again", async () => {
    for (const [err, kind] of [[new HttpError(403), "consent"], [new HttpError(404), "missing"]] as const) {
      const t = setup();
      const s = await t.store.addSeries(series());
      await t.job.run();
      t.refusedBy.set(REG, err).set(REV, new HttpError(401));
      t.setNow("2026-11-10T16:06:00Z");
      await t.job.run();
      expect((await t.store.occurrencesOf(s.id))[0]!.lastRead).toMatchObject({ kind, by: REG });
    }
  });

  it("never lays a call out from its pattern when its series is gone (404)", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    t.calendarOut.add(REG);
    t.failCalendar(new HttpError(404));
    await t.job.run();
    expect(await t.store.occurrencesOf(s.id)).toEqual([]);
  });
});

// ENV-1: Check now (Admin › Clients › <client> › Meetings) looks once for one call, with the presser's sign-in only,
// and schedules nothing; it is how capture is tried on a test site, where the job itself doesn't run.
describe("Check now (ENV-1)", () => {
  it("reads the call once with the presser's sign-in only and leaves the schedule as it was", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    t.setNow("2026-11-10T16:30:00Z"); // the call ended at 16:00
    t.setTranscripts([{ id: "tr-1", createdAt: "2026-11-10T16:02:00Z", endAt: null }]);
    expect(await t.job.checkNow(s.id, REV)).toBe("found");
    expect(new Set(t.calls.map((c) => c.who))).toEqual(new Set([REV]));
    const [occ] = await t.store.occurrencesOf(s.id);
    expect(occ).toMatchObject({ state: "ready", lastRead: { kind: "found", by: REV } });
    // The job's own wake and run were never asked for.
    expect(await t.job.wake()).toBeNull();
  });

  it("not there yet: says so, keeps the next check and the count", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    await t.job.run(); // the schedule laid out the occurrence (next check 16:05, 0 checks)
    t.calls.length = 0;
    t.setNow("2026-11-10T16:30:00Z");
    expect(await t.job.checkNow(s.id, REG)).toBe("not_yet");
    const [occ] = await t.store.occurrencesOf(s.id);
    expect(occ).toMatchObject({ state: "waiting", nextCheckAt: "2026-11-10T16:05:00.000Z", checks: 0 });
    expect(t.calls.every((c) => c.who === REG)).toBe(true);
  });

  it("the presser's sign-in refused: no other reviewer is tried", async () => {
    const t = setup();
    const s = await t.store.addSeries(series());
    t.setNow("2026-11-10T16:30:00Z");
    t.signedOut.add(REV);
    expect(await t.job.checkNow(s.id, REV)).toBe("no_token");
    expect(t.calls.some((c) => c.who === REG && c.op !== "instances")).toBe(false);
  });

  it("an Upload call and a call with nothing ended have nothing to look for", async () => {
    const t = setup();
    const up = await t.store.addSeries(series({ source: "upload", joinUrl: "https://teams.microsoft.com/l/meetup-join/u", eventId: null }));
    expect(await t.job.checkNow(up.id, REG)).toBe("upload");
    const s = await t.store.addSeries(series());
    t.setNow("2026-11-08T12:00:00Z");
    expect(await t.job.checkNow(s.id, REG)).toBe("none");
    expect(await t.job.checkNow(999, REG)).toBe("not_found");
  });
});
