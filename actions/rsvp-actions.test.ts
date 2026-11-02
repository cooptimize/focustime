// Step 16, slice 2: meeting RSVP through the write framework (D283, D284). Fictional people and meetings only.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { fakeGraph, FAKE_WRITE_TOKEN } from "../sources/graph/test-fakes.ts";
import { createGraphWriter } from "../sources/graph/write.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearPreviews } from "./timebox-actions.ts";
import type { WriteLogView, WritePreview, WriteResult } from "./types.ts";

const NOW = "2026-11-02T14:00:00Z";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');
const DANA = { name: "Dana Morales", address: "dana@fabrikam.example" };

function setup() {
  clearPreviews();
  const g = fakeGraph();
  const writer = createGraphWriter({ fetch: g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => {}, log: () => {} });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(base) }),
    makeDataverse: () => { throw new Error("n/a"); },
    makeOutlook: () => ({ id: "outlook", load: async () => { throw new Error("n/a"); }, connect: async () => ({ status: "connected" }), disconnect: async () => {}, write: { access: async () => ({ status: "write" }), writer } }) as never,
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: () => NOW,
    sleep: async () => {},
    plan,
  };
  const run = async <T = unknown>(action: string, input: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const fail = async (action: string, input: unknown) => {
    const r = await dispatch(c, { action, input });
    if (r.ok) throw new Error("expected failure");
    return r;
  };
  const meeting = (x: Record<string, unknown> = {}) =>
    g.seed({ subject: "Sprint review", start: "2026-11-03T20:00:00Z", end: "2026-11-03T21:00:00Z", isOrganizer: false, organizer: DANA, attendees: [DANA, { name: "Me", address: "me@example.com" }], response: "notResponded", ...x });
  const preview = async (rsvp: Record<string, unknown>) => (await run<{ preview: WritePreview }>("write.preview", { rsvp })).preview;
  const confirm = (p: WritePreview) => run<WriteResult>("write.confirm", { previewId: p.previewId });
  /** Every request that could change the meeting itself. */
  const edits = () => g.calls.filter((x) => x.method === "PATCH" || x.method === "DELETE" || x.path.endsWith("/cancel"));
  return { g, plan, run, fail, meeting, preview, confirm, edits };
}

describe("meeting RSVP: preview (D284)", () => {
  it("shows the meeting, who is notified, my response before and after, the note and the proposed time, and writes nothing", async () => {
    const t = setup();
    const id = t.meeting();
    const p = await t.preview({ id, response: "declined", comment: "Out that afternoon", proposedStart: "2026-11-04T15:00:00-05:00", proposedEnd: "2026-11-04T16:00:00-05:00" });
    expect(p).toMatchObject({ kind: "rsvp", summary: "Decline the meeting", visibility: "Dana Morales gets your response by email, with your note. The meeting itself isn't changed." });
    const f = Object.fromEntries(p.fields.map((x) => [x.label, x]));
    expect(f["Meeting"]!.after).toBe("Sprint review");
    expect(f["Notified"]!.after).toBe("Dana Morales");
    expect(f["Your response"]).toMatchObject({ before: "No response yet", after: "Declined", changed: true });
    expect(f["Note"]!.after).toBe("Out that afternoon");
    expect(f["Proposed time"]!.after).toMatch(/^Wed, Nov 4, 3:00 PM to 4:00 PM$/);
    expect(t.g.calls.filter((x) => x.method !== "GET")).toEqual([]);
  });
  it("refuses a meeting I organize, a Coopilot event, one with nobody else, and a proposed time the meeting doesn't allow", async () => {
    const t = setup();
    expect((await t.fail("write.preview", { rsvp: { id: t.meeting({ isOrganizer: true }), response: "accepted" } })).error).toMatch(/You organize/);
    expect((await t.fail("write.preview", { rsvp: { id: t.meeting({ marker: "tb-11111111-1111-4111-8111-111111111111" }), response: "accepted" } })).error).toMatch(/Coopilot's/);
    expect((await t.fail("write.preview", { rsvp: { id: t.meeting({ attendees: [] }), response: "accepted" } })).error).toMatch(/Nobody else/);
    expect((await t.fail("write.preview", { rsvp: { id: t.meeting({ allowNewTimeProposals: false }), response: "tentativelyAccepted", proposedStart: "2026-11-04T15:00:00-05:00", proposedEnd: "2026-11-04T16:00:00-05:00" } })).error).toMatch(/doesn't allow/);
    expect((await t.fail("write.preview", { rsvp: { id: t.meeting(), response: "maybe" } })).status).toBe(400);
  });
});

describe("meeting RSVP: write, read back, log (D284)", () => {
  it("sends exactly one POST to the response endpoint with sendResponse, the note and the proposed time in UTC, then reads my response back", async () => {
    const t = setup();
    const id = t.meeting();
    const r = await t.confirm(await t.preview({ id, response: "tentativelyAccepted", comment: "Might run late", proposedStart: "2026-11-04T15:00:00-05:00", proposedEnd: "2026-11-04T16:00:00-05:00" }));
    expect(r).toMatchObject({ confirmed: true, message: "Tentative. Dana Morales was told" });
    const posts = t.g.calls.filter((x) => x.method === "POST");
    expect(posts.map((x) => x.path.split("?")[0])).toEqual([`/v1.0/me/events/${id}/tentativelyAccept`]);
    expect(posts[0]!.body).toEqual({ sendResponse: true, comment: "Might run late", proposedNewTime: { start: { dateTime: "2026-11-04T20:00:00", timeZone: "UTC" }, end: { dateTime: "2026-11-04T21:00:00", timeZone: "UTC" } } });
    expect(t.g.events.get(id)!.response).toBe("tentativelyAccepted");
    // The meeting itself is never edited.
    expect(t.edits()).toEqual([]);
    const log = await t.run<WriteLogView>("write.log", {});
    expect(log.entries[0]).toMatchObject({ kind: "rsvp", status: "confirmed", undoable: false, before: { response: "notResponded", organizer: "Dana Morales" }, after: { response: "tentativelyAccepted" } });
  });
  it("counts a 404 after a decline as declined (Outlook took it off the calendar)", async () => {
    const t = setup();
    t.g.sw.declineRemoves = true;
    const id = t.meeting({ response: "accepted" });
    expect(await t.confirm(await t.preview({ id, response: "declined" }))).toMatchObject({ confirmed: true, message: "Declined. Outlook took it off your calendar" });
  });
  it("is not confirmed when the response doesn't read back, and a retry checks first without sending it twice", async () => {
    const t = setup();
    t.g.sw.ignoreRsvp = true;
    const id = t.meeting();
    const r = await t.confirm(await t.preview({ id, response: "accepted" }));
    expect(r).toMatchObject({ confirmed: false, entry: { status: "unconfirmed" } });
    t.g.events.get(id)!.response = "accepted"; // it landed late
    const again = await t.run<WriteResult>("write.retry", { id: r.entry.id });
    expect(again.confirmed).toBe(true);
    expect(t.g.calls.filter((x) => x.method === "POST")).toHaveLength(1);
  });
  it("the writer refuses at write time too when the meeting became mine to organize, sending nothing", async () => {
    const t = setup();
    const id = t.meeting();
    const p = await t.preview({ id, response: "accepted" });
    t.g.events.get(id)!.isOrganizer = true;
    expect(await t.confirm(p)).toMatchObject({ confirmed: false, entry: { status: "refused" } });
    expect(t.g.calls.filter((x) => x.method === "POST")).toEqual([]);
  });
});

describe("meeting RSVP: undo is a new response (D284)", () => {
  it("restores the previous response with no note, previews that the organizer hears again, and never edits the meeting", async () => {
    const t = setup();
    const id = t.meeting({ response: "accepted" });
    const r = await t.confirm(await t.preview({ id, response: "declined", comment: "Out that afternoon" }));
    const log = await t.run<WriteLogView>("write.log", {});
    expect(log.entries[0]!.undoable).toBe(true);
    const u = (await t.run<{ preview: WritePreview }>("write.preview", { undo: r.entry.id })).preview;
    expect(u).toMatchObject({ summary: "Undo your response: back to Accepted", visibility: "Dana Morales is notified again: they get your earlier response by email. The meeting itself isn't changed." });
    expect(Object.fromEntries(u.fields.map((x) => [x.label, x.after]))).toMatchObject({ "Your response": "Accepted", Note: "None" });
    const done = await t.confirm(u);
    expect(done).toMatchObject({ confirmed: true, message: "Back to Accepted. Dana Morales was told" });
    const posts = t.g.calls.filter((x) => x.method === "POST");
    expect(posts.map((x) => x.path.split("/").pop())).toEqual(["decline", "accept"]);
    expect(posts[1]!.body).toEqual({ sendResponse: true });
    expect(t.g.events.get(id)!.response).toBe("accepted");
    expect(t.edits()).toEqual([]);
    expect((await t.run<WriteLogView>("write.log", {})).entries.find((e) => e.id === r.entry.id)!.undoneBy).toBe(done.entry.id);
  });
});
