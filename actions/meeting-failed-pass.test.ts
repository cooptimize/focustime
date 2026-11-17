// MC-1d: a failed AI pass is a state of its own, never "ready with nothing". The review says the AI step failed and
// why, in the app's words for that failure; "Nothing to propose from this call" is only for a pass that ran and
// proposed nothing. A long call is sent in parts: one failed part fails the whole pass (nothing is proposed from half a
// call) and the review says so. Fictional data only.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall, ProviderReply } from "../ai/types.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { buildProcessModel } from "../plan/process.ts";
import type { TranscriptLine } from "../plan/transcript.ts";
import { createMeetingStore, type NewSeries } from "../store/meeting-store.ts";
import { aClientEntry, aClientProcess, anAiApp, anAiRules, aWorkItem } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { meetingAction, runPass, type MeetingContext } from "./meeting-actions.ts";

const REVIEWER = "11111111-1111-4111-8111-111111111111";
const ATTENDEE = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-11-10T17:00:00Z";
const series = (p: Partial<NewSeries> = {}): NewSeries => ({
  clientKey: "contoso", name: "Contoso sync", role: "status", source: "upload", detected: "upload", organizer: "unknown", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3afailed%40thread.v2/0", eventId: null, registrantId: REVIEWER,
  weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, reviewers: [REVIEWER], attendees: [ATTENDEE], ...p,
});
const lines = (n: number, words = "We talked about the rates export and what comes next for it."): TranscriptLine[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, speaker: i % 2 ? "Dana Client" : "Sam Reviewer", at: i * 20, text: `${words} (${i + 1})` }));
const EMPTY = JSON.stringify({ gaps: [], commitments: [], comments: [] });

async function setup(respond: (c: ProviderCall, i: number) => string | ProviderReply) {
  const db = sqliteDb();
  await addUsers(db.conn, REVIEWER, ATTENDEE);
  const store = createMeetingStore(db.conn, () => Temporal.Instant.from(NOW));
  let i = 0;
  const ai = createAi({
    provider: async () => stubProvider({ respond: (c) => respond(c, i++) }),
    app: anAiApp(),
    rules: async () => anAiRules({ allowedClients: ["contoso"] }),
    guard: async () => ({ directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] })], homeDomains: ["cooptimize.example"], forbidden: [] }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => NOW,
    sleep: async () => {},
  });
  const capture = async () => ({ clientName: "Contoso", internal: false, items: [aWorkItem({ id: 1201, title: "Rates export", type: "Feature", tier: "feature" })], model: buildProcessModel(aClientProcess()), directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] })] });
  const deps = { store, ai: async () => ai, capture, users: async () => [], log: () => {}, now: () => NOW };
  const s = await store.addSeries(series());
  const occ = await store.ensureOccurrence(s.id, "2026-11-10", "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z", "needs_upload", null);
  const cfg = parseConfig(`${STARTER_TOML.replace('my_email = ""', 'my_email = "sam@cooptimize.example"')}\n[clients.contoso]\nname = "Contoso"\n`);
  if (!cfg.ok) throw new Error("config");
  const ctxAs = (me: string): MeetingContext => ({
    meetings: store, conversations: undefined, plan: undefined, me: async () => me, isAdmin: async () => false, config: async () => cfg.config, now: () => NOW, homeDomains: async () => [], graph: () => null,
    users: async () => [{ id: REVIEWER, name: "Sam Reviewer", emails: [] }, { id: ATTENDEE, name: "Lee Attendee", emails: [] }], client: async (k) => ({ key: k, name: "Contoso" }), leads: async () => [], capture: async () => capture(), ai: async () => ai,
    devops: async () => ({ ok: false, status: 500, error: "not here" }), canWrite: async () => false, log: () => {},
  });
  return { store, s, occ, deps, ctxAs };
}

type Review = { occurrence: { state: string; aiOutcome: string | null; aiMessage: string | null; proposals: number }; proposals: unknown[] };

describe("MC-1d: a failed AI pass says so", () => {
  it("is the failed state with the kind, never ready with nothing; the review says why", async () => {
    const t = await setup(() => ({ ok: false, kind: "provider", status: 400 }));
    const r = await runPass(t.deps, t.s, t.occ, lines(4));
    expect(r.outcome).toBe("provider");
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "failed", aiOutcome: "provider" });
    const review = (await meetingAction(t.ctxAs(REVIEWER), "meeting.review", { occurrenceId: t.occ.id })) as { ok: true; data: Review };
    expect(review.data.occurrence.state).toBe("failed");
    expect(review.data.occurrence.aiMessage).toMatch(/^The AI step failed: /);
    expect(review.data.occurrence.aiMessage).not.toContain("Nothing to propose");
  });

  it("is ready only when the pass ran: nothing proposed is ready with no proposals", async () => {
    const t = await setup(() => EMPTY);
    const r = await runPass(t.deps, t.s, t.occ, lines(4));
    expect(r).toMatchObject({ outcome: "done", proposals: 0 });
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "ready", aiOutcome: "done" });
  });

  it("a call sent in parts with one part failing proposes nothing and says which part", async () => {
    // Long enough for several requests; the second fails.
    const t = await setup((_c, i) => (i === 1 ? { ok: false, kind: "provider", status: 403 } : EMPTY));
    const long = lines(1600, "A long stretch of the call about the rates export, the holiday calendar import, the sample rates Dana sends and the export spec.");
    const r = await runPass(t.deps, t.s, t.occ, long);
    expect(r.outcome).toMatch(/^provider@2\/\d+$/);
    const o = (await t.store.occurrence(t.occ.id))!;
    expect(o.state).toBe("failed");
    expect(await t.store.proposals(t.occ.id)).toEqual([]);
    const review = (await meetingAction(t.ctxAs(REVIEWER), "meeting.review", { occurrenceId: t.occ.id })) as { ok: true; data: Review };
    expect(review.data.occurrence.aiMessage).toMatch(/sent in \d+ parts and part 2 failed, so nothing was proposed/);
  });

  it("a reviewer's Propose again runs the step once more; an attendee can look but not Propose again", async () => {
    let fail = true;
    const t = await setup(() => (fail ? { ok: false, kind: "provider", status: 403 } : EMPTY));
    await t.store.saveTranscript(t.occ.id, lines(4), "upload", REVIEWER);
    await runPass(t.deps, t.s, t.occ, lines(4));
    expect((await t.store.occurrence(t.occ.id))!.state).toBe("failed");
    expect(await meetingAction(t.ctxAs(ATTENDEE), "meeting.rerun", { occurrenceId: t.occ.id })).toMatchObject({ ok: false, status: 403 });
    const seen = (await meetingAction(t.ctxAs(ATTENDEE), "meeting.review", { occurrenceId: t.occ.id })) as { ok: true; data: Review & { canConfirm: boolean } };
    expect(seen.data).toMatchObject({ canConfirm: false, occurrence: { state: "failed" } });
    fail = false;
    expect(await meetingAction(t.ctxAs(REVIEWER), "meeting.rerun", { occurrenceId: t.occ.id })).toMatchObject({ ok: true, data: { outcome: "done", proposals: 0 } });
    expect(await t.store.occurrence(t.occ.id)).toMatchObject({ state: "ready", aiOutcome: "done", nextCheckAt: null });
  });

  it("FocusTime's own missing context is said as such, not as the AI service", async () => {
    const t = await setup(() => EMPTY);
    const r = await runPass({ ...t.deps, capture: async () => null }, t.s, t.occ, lines(4));
    expect(r.outcome).toBe("no_context");
    const review = (await meetingAction(t.ctxAs(REVIEWER), "meeting.review", { occurrenceId: t.occ.id })) as { ok: true; data: Review };
    expect(review.data.occurrence.aiMessage).not.toContain("The AI service couldn't answer");
  });
});
