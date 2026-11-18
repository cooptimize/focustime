// MC-2: calls that aren't registered, in the store's own checks. Who sees: the presser and the Cooptimizers on their
// invite (a hand-added call: its adder only). Who acts: only the presser. The registered calls' lists, the Graph gate's
// lookup and the job's due checks and retries never include one. The transcript and the summary go at 30 days.
import { expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { createMeetingStore, type NewCall, type NewSeries } from "./meeting-store.ts";
import { purgeRetention } from "./retention.ts";

const NOW = Temporal.Instant.from("2026-11-10T18:00:00Z");
const LINK = "https://teams.microsoft.com/l/meetup-join/19%3acall-a%40thread.v2/0";
const registered = (p: Partial<NewSeries> = {}): NewSeries => ({
  clientKey: "contoso", name: "Contoso sync", role: "status", source: "automatic", detected: "automatic", organizer: "home", joinUrl: "https://teams.microsoft.com/l/meetup-join/c", eventId: "E1", registrantId: "rev-1",
  weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, reviewers: ["rev-1"], attendees: [], ...p,
});
const aCall = (p: Partial<NewCall> = {}): NewCall => ({
  callKind: "calendar", clientKey: "contoso", name: "Contoso data review", organizer: "home", joinUrl: LINK, eventId: "ical-a", registrantId: "Presser",
  start: "09:00", minutes: 45, zone: "America/New_York", attendees: ["mate-1", "presser"], day: "2026-11-09", startAt: "2026-11-09T14:00:00Z", endAt: "2026-11-09T14:45:00Z", ...p,
});
const lines = [{ n: 1, speaker: "Dana", at: 10, text: "We need a CSV export." }];

await forEachDriver("meeting store: calls (MC-2)", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    const store = createMeetingStore(db, () => NOW);
    const reg = await store.addSeries(registered());
    const c = await store.addCall(aCall());
    return { db, store, reg, c };
  }

  it("keeps a call with one occurrence, Upload, the presser its one reviewer, never twice for one meeting", async () => {
    const { store, c } = await setup();
    expect(c.existed).toBe(false);
    expect(c.series).toMatchObject({ callKind: "calendar", source: "upload", reviewers: ["presser"], attendees: ["mate-1"], registrantId: "presser" });
    expect(c.occurrence).toMatchObject({ state: "needs_upload", nextCheckAt: null, date: "2026-11-09" });
    // Someone else on it pressing later gets the same call back, not a second one.
    const again = await store.addCall(aCall({ registrantId: "mate-1" }));
    expect(again.existed).toBe(true);
    expect(again.series.id).toBe(c.series.id);
    expect((await store.callByKey("ical-a"))?.occurrence.id).toBe(c.occurrence.id);
  });

  it("shows it to the presser and the Cooptimizers on the invite; only the presser acts", async () => {
    const { store, c } = await setup();
    await store.saveTranscript(c.occurrence.id, lines, "automatic", null);
    await store.replaceProposals(c.occurrence.id, [{ body: { kind: "comment", itemId: 1201, itemTitle: "Rates export", itemType: "User Story", note: "decision", text: "CSV first", inReport: false, lines: [1] }, quotes: [] }]);
    const [p] = await store.proposals(c.occurrence.id);
    for (const who of ["presser", "MATE-1"]) {
      expect((await store.viewer(who).calls("2026-11-01")).map((x) => x.id)).toEqual([c.series.id]);
      expect(await store.viewer(who).transcript(c.occurrence.id)).toEqual(lines);
    }
    const mate = store.viewer("mate-1");
    await expect(mate.updateProposal(p!.id, { state: "skipped" })).rejects.toThrow("Only this meeting's reviewers");
    await expect(mate.saveTranscript(c.occurrence.id, lines)).rejects.toThrow("Only this meeting's reviewers");
    await expect(mate.updateOccurrence(c.occurrence.id, { state: "no_transcript" })).rejects.toThrow("Only this meeting's reviewers");
    expect((await store.viewer("presser").updateProposal(p!.id, { state: "skipped" })).state).toBe("skipped");
    const outsider = store.viewer("someone-else");
    expect(await outsider.calls("2026-11-01")).toEqual([]);
    expect(await outsider.occurrence(c.occurrence.id)).toBeNull();
    await expect(outsider.transcript(c.occurrence.id)).rejects.toThrow("No such meeting");
  });

  it("shows a hand-added call to its adder only", async () => {
    const { store } = await setup();
    const h = await store.addCall(aCall({ callKind: "hand", eventId: null, joinUrl: "hand:1", attendees: ["mate-1"], registrantId: "adder" }));
    // Whatever is passed, a hand-added call is saved with the attendees given; the action passes none (actions test).
    expect(h.series.reviewers).toEqual(["adder"]);
    const solo = await store.addCall(aCall({ callKind: "hand", eventId: null, joinUrl: "hand:2", attendees: [], registrantId: "adder" }));
    expect((await store.viewer("adder").calls("2026-11-01")).map((x) => x.id)).toContain(solo.series.id);
    expect((await store.viewer("mate-1").calls("2026-11-01")).map((x) => x.id)).not.toContain(solo.series.id);
    expect(await store.viewer("mate-1").occurrence(solo.occurrence.id)).toBeNull();
  });

  // Test 11: the registered client calls are unchanged; no list of them ever has a call in it.
  it("leaves calls out of every list of registered calls, the gate's lookup and the job's checks", async () => {
    const { store, reg, c } = await setup();
    expect((await store.allSeries()).map((x) => x.id)).toEqual([reg.id]);
    expect((await store.seriesOf("contoso")).map((x) => x.id)).toEqual([reg.id]);
    expect((await store.viewer("presser").series()).map((x) => x.id)).toEqual([]);
    expect(await store.registered({ joinUrl: LINK })).toBeNull();
    await store.updateSeries(c.series.id, { onlineMeetingId: "om-a" });
    expect(await store.registered({ onlineMeetingId: "om-a" })).toBeNull();
    expect((await store.registered({ joinUrl: reg.joinUrl }))?.id).toBe(reg.id);
    // Even an occurrence of a call set to look like a due check or a retry is never the job's.
    await store.updateOccurrence(c.occurrence.id, { state: "waiting", nextCheckAt: "2026-11-09T15:00:00Z" });
    expect(await store.dueChecks("2026-11-10T18:00:00Z")).toEqual([]);
    expect(await store.nextDue()).toBeNull();
    await store.updateOccurrence(c.occurrence.id, { state: "failed", nextCheckAt: "2026-11-09T15:00:00Z" });
    expect(await store.dueRetries("2026-11-10T18:00:00Z")).toEqual([]);
    // Registration's duplicate check is about registered calls only; an admin's remove never touches a call.
    await expect(store.addSeries(registered({ joinUrl: LINK, eventId: "E2" }))).resolves.toMatchObject({ callKind: null });
    await store.removeSeries(c.series.id);
    expect((await store.series(c.series.id))?.removedAt).toBeNull();
  });

  it("keeps a summary of at most 5 lines beside the transcript, gone with it at 30 days; none before MC-2", async () => {
    const { db, store, c } = await setup();
    expect(await store.summary(c.occurrence.id)).toBeNull();
    await store.saveTranscript(c.occurrence.id, lines, "automatic", null);
    expect(await store.summary(c.occurrence.id)).toBeNull();
    await store.saveSummary(c.occurrence.id, ["one", "two", "three", "four", "five", "six"]);
    expect(await store.summary(c.occurrence.id)).toEqual(["one", "two", "three", "four", "five"]);
    await purgeRetention(db, NOW.add({ hours: 24 * 31 }));
    expect(await store.transcript(c.occurrence.id)).toBeNull();
    expect(await store.summary(c.occurrence.id)).toBeNull();
    expect(await db.get("SELECT COUNT(*) AS n FROM meeting_transcripts")).toMatchObject({ n: 0 });
  });
});
