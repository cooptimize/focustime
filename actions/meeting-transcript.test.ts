// MC-1d: a call's transcript, read only, for the same people as its review: the call's reviewers and attendees.
// Anyone else is refused as if there were no such call. After the 30-day purge it says it is gone. The log keeps a count,
// never a line. Fictional data only.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../log/logger.ts";
import type { TranscriptLine } from "../plan/transcript.ts";
import { createMeetingStore, type NewSeries } from "../store/meeting-store.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { meetingAction, type MeetingContext } from "./meeting-actions.ts";

const REVIEWER = "11111111-1111-4111-8111-111111111111";
const ATTENDEE = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-11-10T17:00:00Z";
const series = (p: Partial<NewSeries> = {}): NewSeries => ({
  clientKey: "contoso", name: "Contoso sync", role: "status", source: "upload", detected: "upload", organizer: "unknown", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3atranscript%40thread.v2/0", eventId: null, registrantId: REVIEWER,
  weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, reviewers: [REVIEWER], attendees: [ATTENDEE], ...p,
});
const LINES: TranscriptLine[] = [
  { n: 1, speaker: "Sam Reviewer", at: 5, text: "The rates export goes first." },
  { n: 2, speaker: "Dana Client", at: 3725, text: "CSV only for now." },
];

async function setup() {
  const db = sqliteDb();
  await addUsers(db.conn, REVIEWER, ATTENDEE, OUTSIDER);
  const store = createMeetingStore(db.conn, () => Temporal.Instant.from(NOW));
  const logs: LogRecord[] = [];
  const s = await store.addSeries(series());
  const occ = await store.ensureOccurrence(s.id, "2026-11-10", "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z", "needs_upload", null);
  await store.saveTranscript(occ.id, LINES, "upload", REVIEWER);
  const ctxAs = (me: string) => ({ meetings: store, me: async () => me, config: async () => ({}), now: () => NOW, log: (r: LogRecord) => void logs.push(r), users: async () => [], isAdmin: async () => false }) as unknown as MeetingContext;
  return { db, store, occ, logs, ctxAs };
}

describe("MC-1d: a call's transcript", () => {
  it("a reviewer and an attendee read every line with its speaker and time", async () => {
    const t = await setup();
    for (const me of [REVIEWER, ATTENDEE]) {
      const r = await meetingAction(t.ctxAs(me), "meeting.transcript", { occurrenceId: t.occ.id });
      expect(r).toEqual({ ok: true, data: { lines: [{ n: 1, speaker: "Sam Reviewer", at: "0:05", sec: 5, text: "The rates export goes first." }, { n: 2, speaker: "Dana Client", at: "1:02:05", sec: 3725, text: "CSV only for now." }], gone: false, missing: false } });
    }
  });

  it("anyone else is refused, as if there were no such call", async () => {
    const t = await setup();
    const r = await meetingAction(t.ctxAs(OUTSIDER), "meeting.transcript", { occurrenceId: t.occ.id });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(JSON.stringify(r)).not.toMatch(/rates export|CSV only|Dana/);
    // The review refuses them the same way.
    expect(await meetingAction(t.ctxAs(OUTSIDER), "meeting.review", { occurrenceId: t.occ.id })).toMatchObject({ ok: false });
  });

  it("after the 30-day purge it says the transcript is gone; the log keeps a count only", async () => {
    const t = await setup();
    await t.db.conn.run("DELETE FROM meeting_transcripts WHERE occurrence_id = ?", [t.occ.id]);
    expect(await meetingAction(t.ctxAs(REVIEWER), "meeting.transcript", { occurrenceId: t.occ.id })).toEqual({ ok: true, data: { lines: [], gone: true, missing: false } });
    expect(t.logs.every((l) => Object.keys(l).every((k) => ["source", "op", "count"].includes(k)))).toBe(true);
    expect(JSON.stringify(t.logs)).not.toMatch(/rates export|CSV only|Sam Reviewer|Dana/);
  });
});
