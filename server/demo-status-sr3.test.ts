// SR-3 on the demo: Needs your update (features I worked on with no line of mine), the "AI suggests" line (that
// client's facts only, GD-2's check after generation, Internal exempt, the plain template with AI off), Delete on my
// own comment through the write framework (preview, read back, audit, undo; stored rollback-safe), Add a feature over
// the client's whole backlog in stack rank, and nothing leaving FocusTime.
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { StatusLoad, StatusReportAnswer } from "../plan/status-types.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, demoSessionOf, seedDemo } from "./demo.ts";

const NOW = "2026-11-05T15:00:00Z"; // Thursday 10:00 AM in New York
const ZONE = "America/New_York";

async function demo(path = ":memory:") {
  const plan = createPlanStore({ path, now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO(ZONE) });
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} }, plan });
  await seedDemo(ctx);
  return { ctx, s: demoSessionOf(ctx)! };
}
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
type Suggest = { clientKey: string; ai: string; suggestions: { itemId: number; text: string; source: string }[]; namesRemoved?: string };
type Preview = { previewId: string; key?: string; op: string; fields: { before: string | null; after: string | null }[] };
type Batch = { previews: Preview[]; refused: { key?: string; error: string }[] };
type Result = { confirmed: boolean; message: string; entry: { id: number } };
const needs = (l: StatusLoad) => l.clients.flatMap((c) => c.features.filter((f) => f.needsYou).map((f) => [c.clientKey, f.title, f.you!.line]));

describe("Status: a report you can finish (SR-3)", () => {
  const net = useNoOutbound();

  it("Needs your update: the features I worked on with no line of mine since Kat's send; a comment of mine clears it", async () => {
    const { ctx } = await demo();
    const l = await run<StatusLoad>(ctx, "status.load");
    expect(needs(l)).toEqual([["Cooptimize", "Internal reporting refresh", "1 story · your to-dos"], ["Harbor", "Patient intake form", "2 stories · your to-dos"], ["Atlas", "Shipment tracking dashboard", "1 story · your to-dos"]]);
    expect(l.needsYou).toBe(3);
    // Order history export: I worked on it and already have a line this week, so no badge.
    const oh = l.clients.find((c) => c.clientKey === "Northwind")!.features.find((f) => f.id === 1110)!;
    expect([oh.needsYou, !!oh.you]).toEqual([false, true]);
    const p = await run<Batch>(ctx, "devops.preview", { clientKey: "Atlas", changes: [{ key: "a", kind: "comment", itemId: 3310, text: "Map of active shipments is in review." }] });
    await run(ctx, "devops.confirm", { previewIds: p.previews.map((x) => x.previewId) });
    const after = await run<StatusLoad>(ctx, "status.load");
    expect(needs(after).map((x) => x[1])).toEqual(["Internal reporting refresh", "Patient intake form"]);
    net.expectNone();
  });

  it("AI suggests: one request per client with that client's facts only; GD-2 replaces another client's name, Internal keeps it", async () => {
    const { ctx, s } = await demo();
    const sent: string[] = [];
    s.ai.spy?.((input: string) => void sent.push(input));
    const h = await run<Suggest>(ctx, "status.suggest", { clientKey: "Harbor", itemIds: [2210] });
    expect(h.ai).toBe("ok");
    expect(h.suggestions).toEqual([{ itemId: 2210, text: expect.stringContaining("another client"), source: "ai" }]);
    expect(h.suggestions[0]!.text).not.toMatch(/Northwind/);
    expect(h.namesRemoved).toBe("Another client's name was removed");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Patient intake form");
    expect(sent[0]).not.toMatch(/Northwind|Order history|Atlas|Shipment|Internal reporting|@/);
    const i = await run<Suggest>(ctx, "status.suggest", { clientKey: "Cooptimize", itemIds: [4410] });
    expect(i.suggestions[0]!.text).toContain("Northwind");
    expect(i.namesRemoved).toBeUndefined();
    // A feature I didn't work on (or another client's id) gets nothing; the same facts again aren't asked twice.
    expect((await run<Suggest>(ctx, "status.suggest", { clientKey: "Harbor", itemIds: [1110, 2220] })).suggestions).toEqual([]);
    await run<Suggest>(ctx, "status.suggest", { clientKey: "Harbor", itemIds: [2210] });
    expect(sent).toHaveLength(2);
    net.expectNone();
  });

  it("with Allow AI off: no AI call, and the plain 'Worked on' line instead", async () => {
    const { ctx, s } = await demo();
    const sent: string[] = [];
    s.ai.spy?.((input: string) => void sent.push(input));
    const load = ctx.loadConfig;
    ctx.loadConfig = async () => {
      const r = await load();
      if (r.parsed.ok) r.parsed.config.aiRules = { ...r.parsed.config.aiRules, allowedClients: r.parsed.config.aiRules.allowedClients.filter((k) => k !== "Harbor") };
      return r;
    };
    const h = await run<Suggest>(ctx, "status.suggest", { clientKey: "Harbor", itemIds: [2210] });
    expect(h.ai).toBe("client_off");
    expect(h.suggestions).toEqual([{ itemId: 2210, text: expect.stringMatching(/^Worked on: /), source: "template" }]);
    expect(sent).toEqual([]);
  });

  it("a client I'm not on: refused before anything is read", async () => {
    const { ctx } = await demo();
    const r = await dispatch(ctx, { action: "status.suggest", input: { clientKey: "Contoso", itemIds: [1] } });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("Delete my own comment: previewed, read back, logged, undone; stored as a comment edit an older build can read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "c-sr3-"));
    const { ctx, s } = await demo(join(dir, "plan.db"));
    const l = await run<StatusLoad>(ctx, "status.load");
    const f = l.clients.find((c) => c.clientKey === "Northwind")!.features.find((x) => x.id === 1110)!;
    const mine = f.thisWeek!.find((c) => c.editable)!;
    const priya = f.thisWeek!.find((c) => c.who === "teammate")!;
    const b = await run<Batch>(ctx, "devops.preview", { clientKey: "Northwind", changes: [{ key: "d", kind: "comment_delete", itemId: 1110, commentId: mine.id }, { key: "p", kind: "comment_delete", itemId: 1110, commentId: priya.id }] });
    expect(b.previews.map((p) => [p.key, p.op, p.fields[0]!.after])).toEqual([["d", "comment_delete", "(deleted)"]]);
    expect(b.refused.map((x) => x.key)).toEqual(["p"]);
    // Nothing is written until confirm.
    expect(s.devops.seen.filter((x) => x.method !== "GET")).toEqual([]);
    const done = await run<{ results: Result[] }>(ctx, "devops.confirm", { previewIds: b.previews.map((p) => p.previewId) });
    expect(done.results[0]!.confirmed).toBe(true);
    const gone = await run<StatusLoad>(ctx, "status.load");
    expect(gone.clients.find((c) => c.clientKey === "Northwind")!.features.find((x) => x.id === 1110)!.thisWeek!.map((c) => c.id)).not.toContain(mine.id);
    const raw = new DatabaseSync(join(dir, "plan.db"));
    const row = raw.prepare("SELECT op, write_kind, ops FROM devops_write_log WHERE id = ?").get(done.results[0]!.entry.id) as { op: string; write_kind: string; ops: string };
    expect([row.op, row.write_kind, JSON.parse(row.ops).deleted]).toEqual(["comment", "comment_edit", true]);
    raw.close();
    const u = (await run<{ preview: Preview }>(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "undo", writeId: done.results[0]!.entry.id } })).preview;
    expect(u.op).toBe("undo_comment_delete");
    expect((await run<Result>(ctx, "devops.confirm", { previewId: u.previewId })).confirmed).toBe(true);
    const back = await run<StatusLoad>(ctx, "status.load");
    expect(back.clients.find((c) => c.clientKey === "Northwind")!.features.find((x) => x.id === 1110)!.thisWeek!.map((c) => c.text)).toContain(mine.text);
    net.expectNone();
  });

  it("Add a feature: any of the client's features by title or #id, placed in stack rank, pending until a line is pushed", async () => {
    const { ctx } = await demo();
    const r = (await run<StatusReportAnswer>(ctx, "status.report", { clientKey: "Northwind" })).report!;
    const shown = new Set([...r.features, ...r.noUpdate, ...r.needsYou].map((f) => f.id));
    const pick = r.catalog.find((f) => !shown.has(f.id))!;
    expect(pick).toBeTruthy();
    expect(r.catalog.map((f) => f.order ?? Infinity)).toEqual([...r.catalog.map((f) => f.order ?? Infinity)].sort((a, b) => a - b));
    const added = (await run<StatusReportAnswer>(ctx, "status.report", { clientKey: "Northwind", added: [pick.id] })).report!;
    expect(added.added.map((f) => f.id)).toEqual([pick.id]);
    // Not in Monday's report until a line is pushed: Kat's report is the features with a comment.
    expect(added.features.map((f) => f.id)).not.toContain(pick.id);
    // Another client's feature id isn't added.
    const other = (await run<StatusReportAnswer>(ctx, "status.report", { clientKey: "Northwind", added: [2210] })).report!;
    expect(other.added).toEqual([]);
    net.expectNone();
  });
});
