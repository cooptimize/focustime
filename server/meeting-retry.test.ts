// MC-1d: after a failed AI pass the meeting job tries again by itself: up to three more times, 15 minutes apart, then
// stops and leaves the state for a person; it stops on the first success; it never retries a failure a retry can't
// fix; a restart in between neither loses a try nor runs one twice. The job is production only (ENV-1), so outside
// production no retry runs. Logs carry the kind and the try's number only. Fictional data only.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderReply } from "../ai/types.ts";
import { runPass } from "../actions/meeting-actions.ts";
import { backgroundPolicy, policyJobs } from "../config/background-policy.ts";
import type { LogRecord } from "../log/logger.ts";
import { buildProcessModel } from "../plan/process.ts";
import { createMeetingStore, type NewSeries } from "../store/meeting-store.ts";
import { aClientEntry, aClientProcess, anAiApp, anAiRules } from "../test/builders/index.ts";
import { sqliteDb } from "../test/db.ts";
import { MEETING_JOB, meetingJob } from "./meeting-job.ts";

const REG = "11111111-1111-4111-8111-111111111111";
const series = (p: Partial<NewSeries> = {}): NewSeries => ({
  clientKey: "contoso", name: "Contoso sync", role: "status", source: "upload", detected: "upload", organizer: "unknown", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3aretry%40thread.v2/0", eventId: null, registrantId: REG,
  weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, reviewers: [REG], attendees: [], ...p,
});
const LINES = [{ n: 1, speaker: "Sam Reviewer", at: 0, text: "We talked about the rates export." }, { n: 2, speaker: "Dana Client", at: 20, text: "CSV only for now." }];
const EMPTY = JSON.stringify({ gaps: [], commitments: [], comments: [] });

async function setup(reply: () => string | ProviderReply) {
  let now = Temporal.Instant.from("2026-11-10T17:00:00Z");
  const db = sqliteDb();
  const store = createMeetingStore(db.conn, () => now);
  const calls: number[] = [];
  const logs: LogRecord[] = [];
  const ai = createAi({
    provider: async () => stubProvider({ respond: () => (calls.push(now.epochMilliseconds), reply()) }),
    app: anAiApp(), rules: async () => anAiRules({ allowedClients: ["contoso"] }),
    guard: async () => ({ directory: [aClientEntry({ key: "contoso", names: ["Contoso"] })], homeDomains: [], forbidden: [] }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] }, appSpend: { get: async () => 0, add: async () => {} }, now: () => now.toString(), sleep: async () => {},
  });
  const person = { graph: null, ai: async () => ai, capture: async () => ({ clientName: "Contoso", internal: false, items: [], model: buildProcessModel(aClientProcess()), directory: [aClientEntry({ key: "contoso", names: ["Contoso"] })] }) };
  const newJob = () => meetingJob({ store, now: () => now, log: (r) => logs.push(r), person: async () => person, users: async () => [] });
  const s = await store.addSeries(series());
  const occ = await store.ensureOccurrence(s.id, "2026-11-10", "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z", "needs_upload", null);
  await store.saveTranscript(occ.id, LINES, "upload", REG);
  // The first pass (an upload's): it fails, and the next try by itself is set.
  await runPass({ store, ai: person.ai, capture: person.capture, users: async () => [], log: (r) => logs.push(r), now: () => now.toString(), retriesHere: true }, s, (await store.occurrence(occ.id))!, LINES);
  return { store, occ, calls, logs, newJob, at: (iso: string) => (now = Temporal.Instant.from(iso)) };
}

describe("MC-1d: a failed AI pass is tried again by itself", () => {
  it("three more times, 15 minutes apart, then stops and leaves the state for a person", async () => {
    const t = await setup(() => ({ ok: false, kind: "provider" }));
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "failed", checks: 0, nextCheckAt: "2026-11-10T17:15:00Z" });
    const job = t.newJob();
    // Not due yet: nothing runs, and the wake is the next try.
    t.at("2026-11-10T17:10:00Z");
    await job.run();
    expect(t.calls).toHaveLength(1);
    expect(await job.wake()).toEqual(Temporal.Instant.from("2026-11-10T17:15:00Z"));
    for (const [i, at] of ["2026-11-10T17:15:00Z", "2026-11-10T17:30:00Z", "2026-11-10T17:45:00Z"].entries()) {
      t.at(at);
      await job.run();
      expect(t.calls, at).toHaveLength(i + 2);
    }
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "failed", checks: 3, nextCheckAt: null });
    t.at("2026-11-10T19:00:00Z");
    await job.run();
    expect(t.calls).toHaveLength(4);
    // Each try by itself is logged once, by kind and number; never the transcript or the request.
    const tries = t.logs.filter((l) => l.op === "meeting_capture_retry");
    expect(tries.map((l) => [l.kind, l.count])).toEqual([["provider", 1], ["provider", 2], ["provider", 3]]);
    expect(JSON.stringify(t.logs)).not.toMatch(/rates export|CSV only/);
  });

  it("stops at the first try that works: ready, with nothing more scheduled", async () => {
    let fail = true;
    const t = await setup(() => (fail ? { ok: false, kind: "provider" } : EMPTY));
    const job = t.newJob();
    fail = false;
    t.at("2026-11-10T17:15:00Z");
    await job.run();
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "ready", aiOutcome: "done", nextCheckAt: null });
    t.at("2026-11-10T17:30:00Z");
    await job.run();
    expect(t.calls).toHaveLength(2);
  });

  it.each([
    [{ ok: false, kind: "quota", status: 429 } as ProviderReply, "quota"],
    // The provider refusing the request itself (a bad request, a key or a model it won't take) would refuse it again.
    [{ ok: false, kind: "provider", status: 400 } as ProviderReply, "provider_refused"],
    [{ ok: false, kind: "provider", status: 401 } as ProviderReply, "provider_refused"],
  ])("never retries a failure a retry can't fix: %o", async (reply, stored) => {
    const t = await setup(() => reply);
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "failed", aiOutcome: stored, nextCheckAt: null });
    // (A 400 on Flex is asked once more on standard inside the first pass; nothing after it.)
    const first = t.calls.length;
    const job = t.newJob();
    t.at("2026-11-10T18:00:00Z");
    await job.run();
    expect(t.calls).toHaveLength(first);
  });

  it("outside production a failed pass has no next try, so the reviewer hears about it at once", async () => {
    const t = await setup(() => ({ ok: false, kind: "provider" }));
    await t.store.updateOccurrence(t.occ.id, { nextCheckAt: null, checks: 0 });
    const { runPass: again } = await import("../actions/meeting-actions.ts");
    const s = (await t.store.allSeries())[0]!;
    await again({ store: t.store, ai: async () => null, capture: async () => null, users: async () => [], log: () => {} }, s, (await t.store.occurrence(t.occ.id))!, LINES);
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "failed", nextCheckAt: null });
  });

  it("a restart in between neither loses a try nor runs one twice", async () => {
    const t = await setup(() => ({ ok: false, kind: "provider" }));
    t.at("2026-11-10T17:15:00Z");
    await t.newJob().run();
    // A new process: the schedule is in the database, not in memory.
    const again = t.newJob();
    await again.run();
    expect(t.calls).toHaveLength(2);
    expect(await again.wake()).toEqual(Temporal.Instant.from("2026-11-10T17:30:00Z"));
    t.at("2026-11-10T17:30:00Z");
    await again.run();
    await t.newJob().run();
    expect(t.calls).toHaveLength(3);
    expect((await t.store.occurrence(t.occ.id))!.checks).toBe(2);
  });

  it("runs only in production: outside it the job never runs on its own, so no retry does", () => {
    const job = { name: MEETING_JOB, run: async () => {}, wake: async () => null };
    expect(policyJobs(backgroundPolicy({ FOCUSTIME_ENV: "prod" }), [job], () => true).map((j) => j.name)).toEqual([MEETING_JOB]);
    for (const env of ["dev", "", undefined]) expect(policyJobs(backgroundPolicy({ FOCUSTIME_ENV: env }), [job], () => true).map((j) => j.name), String(env)).toEqual([]);
  });
});
