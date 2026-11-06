// MC-1: the shared meeting store keeps one copy per client call and lets only that call's reviewers and attendees see
// its transcript and proposals; uploads, edits and confirms need a reviewer; the purge deletes transcripts and quotes
// after 30 days and keeps proposals and results.
import { describe, expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { createMeetingStore, type NewSeries } from "./meeting-store.ts";
import { purgeRetention } from "./retention.ts";

const NOW = Temporal.Instant.from("2026-11-10T18:00:00Z");
const series = (p: Partial<NewSeries> = {}): NewSeries => ({
  clientKey: "contoso", name: "Contoso sync", role: "status", source: "automatic", detected: "automatic", organizer: "home", joinUrl: "https://teams.microsoft.com/l/meetup-join/c", eventId: "E1", registrantId: "Rev-1",
  weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, reviewers: ["rev-1", "rev-2"], attendees: ["att-1"], ...p,
});
const lines = [{ n: 1, speaker: "Dana", at: 10, text: "We need a CSV export." }];

await forEachDriver("meeting store (MC-1)", ({ open }) => {
  async function setup(now = NOW) {
    const db = (await open()).conn;
    const store = createMeetingStore(db, () => now);
    const s = await store.addSeries(series());
    const o = await store.ensureOccurrence(s.id, "2026-11-10", "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z", "waiting", "2026-11-10T16:05:00Z");
    await store.saveTranscript(o.id, lines, "automatic", null);
    await store.replaceProposals(o.id, [{ body: { kind: "comment", itemId: 1201, itemTitle: "Rates export", itemType: "Feature", note: "decision", text: "Ship CSV first", inReport: true, lines: [1] }, quotes: [{ n: 1, speaker: "Dana", at: "0:10", text: "We need a CSV export." }] }]);
    return { db, store, s, o };
  }

  it("shows a call's transcript and proposals only to its reviewers and attendees", async () => {
    const { store, s, o } = await setup();
    for (const who of ["rev-1", "REV-2", "att-1"]) {
      expect((await store.viewer(who).series()).map((x) => x.id)).toEqual([s.id]);
      expect(await store.viewer(who).transcript(o.id)).toEqual(lines);
      expect(await store.viewer(who).proposals(o.id)).toHaveLength(1);
    }
    const outsider = store.viewer("someone-else");
    expect(await outsider.series()).toEqual([]);
    await expect(outsider.transcript(o.id)).rejects.toThrow("No such meeting");
    await expect(outsider.proposals(o.id)).rejects.toThrow("No such meeting");
    expect(await outsider.occurrence(o.id)).toBeNull();
  });

  it("lets only reviewers upload, edit or dismiss", async () => {
    const { store, o } = await setup();
    const p = (await store.proposals(o.id))[0]!;
    await expect(store.viewer("att-1").saveTranscript(o.id, lines)).rejects.toThrow("reviewers");
    await expect(store.viewer("att-1").updateProposal(p.id, { state: "skipped" })).rejects.toThrow("reviewers");
    await expect(store.viewer("att-1").updateOccurrence(o.id, { dismissedBy: "att-1" })).rejects.toThrow("reviewers");
    expect((await store.viewer("rev-2").updateProposal(p.id, { state: "skipped", decidedBy: "rev-2" })).state).toBe("skipped");
  });

  it("gates Graph on a registered, not removed series", async () => {
    const { store, s } = await setup();
    expect((await store.registered({ joinUrl: s.joinUrl }))?.id).toBe(s.id);
    expect(await store.registered({ joinUrl: "https://teams.microsoft.com/l/meetup-join/other" })).toBeNull();
    await store.updateSeries(s.id, { onlineMeetingId: "om-1" });
    expect((await store.registered({ onlineMeetingId: "om-1" }))?.id).toBe(s.id);
    await store.removeSeries(s.id);
    expect(await store.registered({ joinUrl: s.joinUrl })).toBeNull();
    expect(await store.registered({ onlineMeetingId: "om-1" })).toBeNull();
  });

  it("keeps one occurrence a day and finds due checks", async () => {
    const { store, s, o } = await setup();
    expect((await store.ensureOccurrence(s.id, "2026-11-10", "x", "y", "waiting", null)).id).toBe(o.id);
    expect((await store.dueChecks("2026-11-10T16:04:00Z")).map((x) => x.id)).toEqual([]);
    expect((await store.dueChecks("2026-11-10T16:06:00Z")).map((x) => x.id)).toEqual([o.id]);
    expect(await store.nextDue()).toBe("2026-11-10T16:05:00Z");
  });

  it("purges transcripts and quotes after 30 days and keeps proposals and results", async () => {
    const { db, store, o } = await setup();
    const p = (await store.proposals(o.id))[0]!;
    await store.updateProposal(p.id, { state: "confirmed", result: { writeId: 7, itemId: 1201 } });
    expect((await purgeRetention(db, NOW.add({ hours: 24 * 29 }))).counts).toMatchObject({ meeting_transcripts: 0, meeting_quotes: 0 });
    const r = await purgeRetention(db, NOW.add({ hours: 24 * 31 }));
    expect(r.counts).toMatchObject({ meeting_transcripts: 1, meeting_quotes: 1 });
    expect(await store.transcript(o.id)).toBeNull();
    const kept = (await store.proposals(o.id))[0]!;
    expect(kept.quotes).toBeNull();
    expect(kept.state).toBe("confirmed");
    expect(kept.result).toEqual({ writeId: 7, itemId: 1201 });
    expect(kept.body.kind).toBe("comment");
  });
});

describe("meeting store", () => it("runs on every driver", () => expect(true).toBe(true)));
