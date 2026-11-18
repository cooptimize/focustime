// MC-1: meeting capture on the demo. A registered call and a seeded transcript make proposals (the demo's sample AI)
// with nothing leaving FocusTime; one Confirm makes each kind through the existing writes on the session's in-memory
// DevOps (a create and a comment, read back, audited, undone alone), adds the shared commitments, and writes nothing
// for a skipped one. The nudge goes once per occurrence.
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { Proposal } from "../plan/meetings.ts";
import { DEMO_PEOPLE } from "../sources/demo/data.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-05T15:00:00Z"; // Thursday 10:00 AM in New York; the call was on Monday (MC-1d: the demo calendar's Monday 13:00 meeting)
const PRIYA = DEMO_PEOPLE.find((p) => p.name === "Priya Shah")!;

async function demo() {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  return ctx;
}
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
type Mine = { meetings: { id: number; name: string; source: string }[]; occurrences: { id: number; date: string; state: string; open: number }[]; nudges: { key: string; kind: string }[] };
type Review = { proposals: Proposal[]; canConfirm: boolean; canWrite: boolean; transcript: { lines: number; speakers: number } | null };

describe("meeting capture on the demo (MC-1)", () => {
  const net = useNoOutbound();

  it("a registered call and its transcript make proposals with quotes; nothing leaves FocusTime", async () => {
    const ctx = await demo();
    const mine = await run<Mine>(ctx, "meeting.mine");
    expect(mine.meetings.map((m) => [m.name, m.source])).toEqual([["Northwind weekly status call", "upload"]]);
    const occ = mine.occurrences[0]!;
    expect(occ).toMatchObject({ date: "2026-11-02", state: "ready", open: 11 });
    // MC-2b: the week before, the same call waits for its transcript (a Pocket recording of it can be brought in).
    const waiting = mine.occurrences.find((o) => o.date === "2026-10-26")!;
    expect(waiting).toMatchObject({ state: "needs_upload" });
    const keys = mine.nudges.map((n) => n.key);
    expect(keys).toHaveLength(2);
    expect(keys).toContain(`meeting_review:${occ.id}`);
    expect(keys.some((k) => k.endsWith(`:${waiting.id}`))).toBe(true);
    const r = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
    expect(r.transcript).toEqual({ lines: 12, speakers: 3 });
    expect(r.proposals.map((p) => p.body.kind)).toEqual(["gap", "gap", "gap", "commitment", "commitment", "commitment", "commitment", "comment", "comment", "comment", "comment"]);
    const gap = r.proposals[0]!;
    expect(gap.body).toMatchObject({ parentId: 1110, title: "Monthly statement as a PDF" });
    expect(gap.quotes![0]).toMatchObject({ speaker: "Dana Brooks" });
    // Priya is a Cooptimize attendee (her own Promises), Dana is the client (my Waiting on).
    const sides = r.proposals.filter((p) => p.body.kind === "commitment").map((p) => p.body.kind === "commitment" && [p.body.who, p.body.side, p.body.whoId]);
    expect(sides).toEqual([["Alex Rivera", "cooptimize", expect.any(String)], ["Dana Brooks", "client", null], ["Priya Shah", "cooptimize", PRIYA.aadId.toLowerCase()], ["Alex Rivera", "cooptimize", expect.any(String)]]);
    net.expectNone();
  });

  it("each row goes its own way: DevOps changes through the one preview, a promise at once; a skipped one writes nothing; Undo puts it back (MC-1e)", async () => {
    const ctx = await demo();
    const occ = (await run<Mine>(ctx, "meeting.mine")).occurrences[0]!;
    const { proposals, checks } = await run<Review & { checks: Record<string, { needs?: { fill: string }[]; blocked?: string }> }>(ctx, "meeting.review", { occurrenceId: occ.id });
    const gap = proposals.find((p) => p.body.kind === "gap" && p.body.parentId === 1110)!;
    const decision = proposals.find((p) => p.body.kind === "comment" && p.body.note === "decision")!;
    const status = proposals.find((p) => p.body.kind === "comment" && p.body.itemId === 1113)!;
    const onFeature = proposals.find((p) => p.body.kind === "comment" && p.body.itemId === 1110)!;
    const mine = proposals.find((p) => p.body.kind === "commitment" && p.body.what === "Send the date range filter for review")!;
    // The checks: Northwind's Epic needs a target date; the older comment on the feature won't be sent.
    const epic = proposals.find((p) => p.body.kind === "gap" && p.body.type === "Epic")!;
    expect(checks[epic.id]?.needs).toEqual([{ fill: "date", name: "Target Date" }]);
    expect(checks[onFeature.id]?.blocked).toMatch(/above story level/);
    expect(checks[gap.id]).toBeUndefined();
    // Two DevOps changes, ticked together, in one preview.
    const before = (await run<{ entries: unknown[] }>(ctx, "devops.log")).entries.length;
    const prep = await run<{ previews: { previewId: string; key: string; op: string }[]; refused: unknown[] }>(ctx, "devops.preview", { clientKey: "Northwind", changes: [{ kind: "meeting_create", proposalId: gap.id, key: `p${gap.id}` }, { kind: "meeting_comment", proposalId: decision.id, key: `p${decision.id}` }] });
    expect(prep.previews.map((p) => p.op)).toEqual(["create", "comment"]);
    const done = await run<{ results: { confirmed: boolean }[] }>(ctx, "devops.confirm", { previewIds: prep.previews.map((p) => p.previewId) });
    expect(done.results.every((x) => x.confirmed)).toBe(true);
    // The promise at once, from its row.
    await run(ctx, "meeting.keep", { proposalId: mine.id });
    // Skip the status; it writes nothing.
    await run(ctx, "meeting.edit", { proposalId: status.id, skip: true });
    const log = (await run<{ entries: { id: number; op: string; itemId: number | null; status: string }[] }>(ctx, "devops.log")).entries;
    expect(log.length - before).toBe(2);
    expect(log.filter((e) => e.itemId === 1113 && e.op === "comment")).toEqual([]);
    // A row skipped after its preview isn't sent at Confirm, and stays skipped (MC-1e, the diff review).
    const promised = proposals.find((p) => p.body.kind === "comment" && p.body.note === "status" && p.body.itemId === 1111)!;
    const late = (await run<{ preview: { previewId: string } }>(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "meeting_comment", proposalId: promised.id } })).preview;
    await run(ctx, "meeting.edit", { proposalId: promised.id, skip: true });
    expect(await dispatch(ctx, { action: "devops.confirm", input: { previewId: late.previewId } })).toMatchObject({ ok: false, code: "proposal_changed" });
    expect((await run<{ entries: unknown[] }>(ctx, "devops.log")).entries.length - before).toBe(2);
    // The server refuses a call's comment on the feature, whatever sends it.
    expect(await dispatch(ctx, { action: "devops.preview", input: { clientKey: "Northwind", change: { kind: "meeting_comment", proposalId: onFeature.id } } })).toMatchObject({ ok: false, code: "above_story" });
    const after = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
    expect(after.proposals.find((p) => p.id === status.id)!.state).toBe("skipped");
    expect(after.proposals.find((p) => p.id === gap.id)).toMatchObject({ state: "confirmed", result: { itemId: expect.any(Number), writeId: expect.any(Number) } });
    // My commitment is in my Promises.
    expect(JSON.stringify(await run(ctx, "my_promises.list"))).toContain("Send the date range filter for review");
    // Undo the comment through the write log: the framework's own undo.
    const comment = after.proposals.find((p) => p.id === decision.id)!;
    expect(comment.state).toBe("confirmed");
    const p = (await run<{ preview: { previewId: string } }>(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "undo", writeId: comment.result!.writeId } })).preview;
    expect(await run(ctx, "devops.confirm", { previewId: p.previewId })).toMatchObject({ confirmed: true });
    net.expectNone();
  });

  it("Propose again leaves out what's done, skipped or failed, and says how many are new; the status report shows no call comment (MC-1e)", async () => {
    const ctx = await demo();
    const occ = (await run<Mine>(ctx, "meeting.mine")).occurrences[0]!;
    const { proposals } = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
    const decision = proposals.find((p) => p.body.kind === "comment" && p.body.note === "decision")!;
    const mine = proposals.find((p) => p.body.kind === "commitment" && p.body.what === "Send the date range filter for review")!;
    const epic = proposals.find((p) => p.body.kind === "gap" && p.body.type === "Epic")!;
    // A comment sent, a promise kept, an epic skipped.
    const prep = await run<{ previews: { previewId: string }[] }>(ctx, "devops.preview", { clientKey: "Northwind", changes: [{ kind: "meeting_comment", proposalId: decision.id, key: `p${decision.id}` }] });
    await run(ctx, "devops.confirm", { previewIds: prep.previews.map((p) => p.previewId) });
    await run(ctx, "meeting.keep", { proposalId: mine.id });
    await run(ctx, "meeting.edit", { proposalId: epic.id, skip: true });
    const again = await run<{ outcome: string; added: number; same: number }>(ctx, "meeting.rerun", { occurrenceId: occ.id });
    // The demo's answer is the same each time: 10 from the AI, 3 of them already decided.
    expect(again).toMatchObject({ outcome: "done", same: 3, added: 7 });
    const after = (await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id })).proposals;
    for (const words of ["Decided with Northwind: CSV only for now; an Excel export waits until next quarter.", "Send the date range filter for review", "Accountant reporting area"]) {
      const same = after.filter((p) => (p.body.kind === "gap" ? p.body.title : p.body.kind === "commitment" ? p.body.what : p.body.text) === words);
      expect(same.length).toBe(1);
    }
    // The comment went on a story, so the Monday report (features' comments) carries none of the call's words.
    const report = JSON.stringify(await run(ctx, "status.report", { clientKey: "Northwind" }));
    expect(report).not.toContain("CSV only for now; an Excel export");
    net.expectNone();
  });

  it("an attendee who isn't a reviewer can look but not confirm", async () => {
    const ctx = await demo();
    const s = ctx.meetings!.store;
    const [series] = await s.allSeries();
    await s.updateSeries(series!.id, { reviewers: [PRIYA.aadId.toLowerCase()] });
    const occ = (await run<Mine>(ctx, "meeting.mine")).occurrences[0]!;
    const r = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
    expect(r.canConfirm).toBe(false);
    expect(await dispatch(ctx, { action: "meeting.keep", input: { proposalId: r.proposals.find((p) => p.body.kind === "commitment")!.id } })).toMatchObject({ ok: false, status: 403 });
    expect(await dispatch(ctx, { action: "devops.preview", input: { clientKey: "Northwind", change: { kind: "meeting_create", proposalId: r.proposals[0]!.id } } })).toMatchObject({ ok: false, status: 409 });
    expect((await run<Mine>(ctx, "meeting.mine")).nudges).toEqual([]);
  });
});
