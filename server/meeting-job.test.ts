// MC-1: the job lays out an Automatic call's occurrences from the registrant's calendar, looks for the transcript on
// schedule with the registrant's token first and then the other reviewers', runs the AI pass once it's found, and
// asks for an upload after 12 hours. An Upload call is never asked of Graph.
import { describe, expect, it } from "vitest";
import { HttpError } from "../sources/calendar/http.ts";
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
  const graphFor = (who: string) =>
    ({
      instances: async () => (calls.push({ who, op: "instances" }), instances),
      onlineMeetingId: async () => {
        calls.push({ who, op: "onlineMeetingId" });
        if (signedOut.has(who)) throw new HttpError(401);
        return "om-1";
      },
      transcripts: async () => {
        calls.push({ who, op: "transcripts" });
        if (signedOut.has(who)) throw new HttpError(401);
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
  return { store, job, calls, signedOut, setNow: (t: string) => (now = Temporal.Instant.from(t)), setTranscripts: (t: TranscriptRef[]) => (transcripts = t) };
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
});
