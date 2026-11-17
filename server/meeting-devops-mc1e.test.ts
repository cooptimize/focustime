// MC-1e: a call's proposals reach DevOps through the app's one door (devops.preview and devops.confirm, the same write
// framework the New form uses), with a field the client's process requires asked for on the row before anything is
// sent. On the demo: its in-memory DevOps refuses a create without a required field exactly as DevOps does (TF401320).
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { Proposal } from "../plan/meetings.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-05T15:00:00Z";
const TARGET = "Microsoft.VSTS.Scheduling.TargetDate";

async function demo(required?: Parameters<typeof createDemoContext>[0]["devopsRequired"]) {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} }, ...(required ? { devopsRequired: required } : {}) });
  await seedDemo(ctx);
  return ctx;
}
const raw = (ctx: ActionContext, action: string, input: unknown = {}) => dispatch(ctx, { action, input });
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await raw(ctx, action, input);
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
type Check = { needs?: { fill: string; name: string }[]; cant?: string | null; blocked?: string | null };
type Review = { proposals: Proposal[]; checks: Record<string, Check> };
type Log = { entries: { op: string; title: string; status: string; after: Record<string, string | null> }[] };

async function call(ctx: ActionContext) {
  const occ = (await run<{ occurrences: { id: number }[] }>(ctx, "meeting.mine")).occurrences[0]!;
  const r = await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id });
  return { occ, ...r };
}

describe("a call's new item and a required field (MC-1e)", () => {
  const net = useNoOutbound();

  it("asks for the field on the row, sends nothing without it, and creates the item with it", async () => {
    const ctx = await demo({ Northwind: { "User Story": [TARGET] } });
    const { occ, proposals, checks } = await call(ctx);
    const gap = proposals.find((p) => p.body.kind === "gap" && p.body.type === "User Story")!;
    // The row says what the process needs before any preview: a target date, which the form fills.
    expect(checks[gap.id]?.needs).toEqual([{ fill: "date", name: "Target Date" }]);
    // Without it nothing is previewed, so nothing can be sent.
    const before = (await run<Log>(ctx, "devops.log")).entries.length;
    const refused = await raw(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "meeting_create", proposalId: gap.id } });
    expect(refused).toMatchObject({ ok: false, code: "required_field" });
    expect((await run<Log>(ctx, "devops.log")).entries.length).toBe(before);
    // With it, the one preview, the one confirm, and the item has the date.
    await run(ctx, "meeting.edit", { proposalId: gap.id, date: "2026-11-20" });
    expect((await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id })).checks[gap.id]?.needs ?? []).toEqual([]);
    const { preview } = await run<{ preview: { previewId: string; op: string; fields: { label: string; after: string | null }[] } }>(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "meeting_create", proposalId: gap.id } });
    expect(preview.op).toBe("create");
    expect(preview.fields.find((f) => f.label === "Target date")?.after).toBe("2026-11-20");
    const done = await run<{ confirmed: boolean }>(ctx, "devops.confirm", { previewId: preview.previewId });
    expect(done.confirmed).toBe(true);
    const log = (await run<Log>(ctx, "devops.log")).entries;
    expect(log[0]).toMatchObject({ op: "create", status: "confirmed", title: "Monthly statement as a PDF", after: { "Target date": "2026-11-20" } });
    const after = (await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id })).proposals.find((p) => p.id === gap.id)!;
    expect(after).toMatchObject({ state: "confirmed", result: { itemId: expect.any(Number), writeId: expect.any(Number) } });
    net.expectNone();
  });
});
