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

const NOW = "2026-11-05T15:00:00Z"; // Thursday 10:00 AM in New York; the call was on Wednesday
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
type Prepared = { previews: { previewId: string; key: string; op: string }[]; refused: unknown[]; commitments: { proposalId: number; side: string }[]; skip: number[] };

describe("meeting capture on the demo (MC-1)", () => {
  const net = useNoOutbound();

  it("a registered call and its transcript make proposals with quotes; nothing leaves FocusTime", async () => {
    const ctx = await demo();
    const mine = await run<Mine>(ctx, "meeting.mine");
    expect(mine.meetings.map((m) => [m.name, m.source])).toEqual([["Northwind weekly status call", "upload"]]);
    const occ = mine.occurrences[0]!;
    expect(occ).toMatchObject({ date: "2026-11-04", state: "ready", open: 6 });
    expect(mine.nudges.map((n) => n.key)).toEqual([`meeting_review:${occ.id}`]);
    const r = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
    expect(r.transcript).toEqual({ lines: 8, speakers: 3 });
    expect(r.proposals.map((p) => p.body.kind)).toEqual(["gap", "commitment", "commitment", "commitment", "comment", "comment"]);
    const gap = r.proposals[0]!;
    expect(gap.body).toMatchObject({ parentId: 1110, title: "Monthly statement as a PDF" });
    expect(gap.quotes![0]).toMatchObject({ speaker: "Dana Brooks" });
    // Priya is a Cooptimize attendee (her own Promises), Dana is the client (my Waiting on).
    const sides = r.proposals.filter((p) => p.body.kind === "commitment").map((p) => p.body.kind === "commitment" && [p.body.who, p.body.side, p.body.whoId]);
    expect(sides).toEqual([["Alex Rivera", "cooptimize", expect.any(String)], ["Dana Brooks", "client", null], ["Priya Shah", "cooptimize", PRIYA.aadId.toLowerCase()]]);
    net.expectNone();
  });

  it("one Confirm makes the ticked ones through the existing writes; a skipped one writes nothing; Undo puts it back", async () => {
    const ctx = await demo();
    const occ = (await run<Mine>(ctx, "meeting.mine")).occurrences[0]!;
    const { proposals } = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
    const status = proposals.find((p) => p.body.kind === "comment" && p.body.itemId === 1113)!;
    const keep = proposals.filter((p) => p.id !== status.id).map((p) => p.id);
    const prep = await run<Prepared>(ctx, "meeting.prepare", { occurrenceId: occ.id, keep });
    expect(prep.previews.map((p) => p.op).sort()).toEqual(["comment", "create"]);
    expect(prep.skip).toEqual([status.id]);
    const before = (await run<{ entries: unknown[] }>(ctx, "devops.log")).entries.length;
    const previews = prep.previews.map((p) => ({ proposalId: Number(p.key.slice(1)), previewId: p.previewId }));
    const done = await run<{ results: { proposalId: number; ok: boolean }[]; left: number }>(ctx, "meeting.confirm", { occurrenceId: occ.id, keep, previews });
    expect(done.results.every((x) => x.ok)).toBe(true);
    expect(done.left).toBe(0);
    // Two DevOps writes (the create and the decision comment), each in the audit log; none for the skipped status.
    const log = (await run<{ entries: { id: number; op: string; itemId: number | null; status: string }[] }>(ctx, "devops.log")).entries;
    expect(log.length - before).toBe(2);
    expect(log.filter((e) => e.itemId === 1113 && e.op === "comment")).toEqual([]);
    const after = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
    expect(after.proposals.find((p) => p.id === status.id)!.state).toBe("skipped");
    const created = after.proposals.find((p) => p.body.kind === "gap")!;
    expect(created).toMatchObject({ state: "confirmed", result: { itemId: expect.any(Number), writeId: expect.any(Number) } });
    // The occurrence is reviewed: no nudge for it any more.
    expect((await run<Mine>(ctx, "meeting.mine")).nudges).toEqual([]);
    // My commitment is in my Promises; the client's is my Waiting on.
    const inbox = JSON.stringify(await run(ctx, "my_promises.list"));
    expect(inbox).toContain("Send the date range filter for review");
    // Undo the comment through the write log: the framework's own undo.
    const comment = after.proposals.find((p) => p.body.kind === "comment" && p.state === "confirmed")!;
    const p = (await run<{ preview: { previewId: string } }>(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "undo", writeId: comment.result!.writeId } })).preview;
    expect(await run(ctx, "devops.confirm", { previewId: p.previewId })).toMatchObject({ confirmed: true });
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
    const refused = await dispatch(ctx, { action: "meeting.prepare", input: { occurrenceId: occ.id, keep: [r.proposals[0]!.id] } });
    expect(refused).toMatchObject({ ok: false, status: 403 });
    expect((await run<Mine>(ctx, "meeting.mine")).nudges).toEqual([]);
  });
});
