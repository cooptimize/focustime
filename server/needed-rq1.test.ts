// RQ-1: a field a client's process requires by a rule (not on the type's always-required list) is asked for before any
// preview, on a call's row and in the New form, because FocusTime asks DevOps to check the new item without saving it.
// On the demo: its in-memory DevOps refuses a create without a rule's field as DevOps does (TF401320).
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { Proposal } from "../plan/meetings.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-05T15:00:00Z";
const TARGET = "Microsoft.VSTS.Scheduling.TargetDate";

async function demo(rules: Parameters<typeof createDemoContext>[0]["devopsRules"]) {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} }, devopsRules: rules });
  await seedDemo(ctx);
  return ctx;
}
const raw = (ctx: ActionContext, action: string, input: unknown = {}) => dispatch(ctx, { action, input });
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await raw(ctx, action, input);
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
type Check = { needs?: { fill: string; name: string }[]; required?: string[]; cant?: string | null };
type Review = { proposals: Proposal[]; checks: Record<string, Check> };
type Log = { entries: { op: string; title: string; status: string; after: Record<string, string | null> }[] };
const review = async (ctx: ActionContext) => {
  const occ = (await run<{ occurrences: { id: number }[] }>(ctx, "meeting.mine")).occurrences[0]!;
  return { occ, ...(await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id })) };
};

describe("a field required by a process rule (RQ-1)", () => {
  const net = useNoOutbound();

  it("a call's row marks it Needed when it opens, holds the preview without it, and creates the item with it", async () => {
    const ctx = await demo({ Northwind: { "User Story": [TARGET] } });
    const { occ, proposals, checks } = await review(ctx);
    const gap = proposals.find((p) => p.body.kind === "gap" && p.body.type === "User Story" && p.body.parentId !== null)!;
    // The type's own field list doesn't say so; DevOps's check does.
    expect(checks[gap.id]?.needs).toEqual([{ fill: "date", name: "Target Date" }]);
    expect(checks[gap.id]?.required).toContain("date");
    const before = (await run<Log>(ctx, "devops.log")).entries.length;
    expect(await raw(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "meeting_create", proposalId: gap.id } })).toMatchObject({ ok: false, code: "required_field", needed: [{ fill: "date", name: "Target Date" }] });
    expect((await run<Log>(ctx, "devops.log")).entries.length).toBe(before);
    await run(ctx, "meeting.edit", { proposalId: gap.id, date: "2026-11-20" });
    expect((await run<Review>(ctx, "meeting.review", { occurrenceId: occ.id })).checks[gap.id]?.needs ?? []).toEqual([]);
    const { preview } = await run<{ preview: { previewId: string } }>(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "meeting_create", proposalId: gap.id } });
    expect(await run(ctx, "devops.confirm", { previewId: preview.previewId })).toMatchObject({ confirmed: true });
    expect((await run<Log>(ctx, "devops.log")).entries[0]).toMatchObject({ op: "create", status: "confirmed", after: { "Target date": "2026-11-20" } });
    net.expectNone();
  });

  it("the New form hears it before anything is typed, the preview waits for it, and the item is created with it", async () => {
    const ctx = await demo({ Northwind: { Feature: [TARGET] } });
    const early = await run<{ checked: boolean; needed: { fill: string | null; name: string }[] }>(ctx, "devops.needed", { clientKey: "Northwind", change: { kind: "new_item", type: "Feature", title: "" } });
    expect(early).toMatchObject({ checked: true, needed: [{ fill: "date", name: "Target Date" }] });
    const change = { kind: "new_item", type: "Feature", title: "Statements for accountants" };
    expect(await raw(ctx, "devops.preview", { clientKey: "Northwind", change })).toMatchObject({ ok: false, code: "required_field", needed: [{ fill: "date" }] });
    const { preview } = await run<{ preview: { previewId: string } }>(ctx, "devops.preview", { clientKey: "Northwind", change: { ...change, date: "2026-12-04" } });
    expect(await run(ctx, "devops.confirm", { previewId: preview.previewId })).toMatchObject({ confirmed: true });
    expect((await run<Log>(ctx, "devops.log")).entries[0]).toMatchObject({ op: "create", status: "confirmed", after: { "Target date": "2026-12-04" } });
    net.expectNone();
  });
});
