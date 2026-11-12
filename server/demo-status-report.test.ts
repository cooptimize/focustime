// SR-2: the client report on the demo: Monday's report for Northwind and Harbor as Kat will send it (features with a
// comment since Kat's last send, in backlog order, authors as DevOps shows them, an edited older comment in), No update
// yet with owners, Upcoming PTO with its source note; a line added on a teammate's feature through SR-1's write path
// (preview, confirm, read back into the report, undo), others' comments not editable, GD-2's exit flag, and nothing
// leaving FocusTime.
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import { PTO_SOURCE } from "../actions/status-actions.ts";
import type { StatusReport, StatusReportAnswer } from "../plan/status-types.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, demoSessionOf, seedDemo } from "./demo.ts";

const NOW = "2026-11-05T15:00:00Z"; // Thursday 10:00 AM in New York

async function demo() {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  return { ctx, s: demoSessionOf(ctx)! };
}
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
const report = async (ctx: ActionContext, clientKey: string) => (await run<StatusReportAnswer>(ctx, "status.report", { clientKey })).report!;
const bullets = (r: StatusReport) => r.features.map((f) => [f.title, f.thisWeek!.map((c) => `${c.text} · ${c.author}`)]);
type Preview = { previewId: string; key?: string; op: string; fields: { before: string | null; after: string | null }[]; mentions?: string[]; notes?: string[] };
type Batch = { previews: Preview[]; nothing: string[]; refused: { itemId: number | null; error: string; code: string | null; key?: string }[] };
type Result = { confirmed: boolean; message: string; entry: { id: number } };

describe("the client report on the demo (SR-2)", () => {
  const net = useNoOutbound();

  it("offers the clients I'm on, and Northwind's report reads as Kat's email will", async () => {
    const { ctx } = await demo();
    expect((await run<StatusReportAnswer>(ctx, "status.report")).clients.map((c) => c.clientKey)).toEqual(["Atlas", "Cooptimize", "Harbor", "Northwind"]);
    const r = await report(ctx, "Northwind");
    expect(r.header).toBe("Draft for Monday, Nov 9 · Kat sends it at 7:00 AM · last sent Nov 2");
    // Loyalty points is in through Sam's comment from last week, edited this week (Kat counts the edit).
    expect(bullets(r)).toEqual([
      ["Order history export", ["CSV export is merged; filtering by date range is next and should be in review Thursday. · Alex Rivera", "The Export button is on the order page in the test site, ready for a look. · Priya Shah"]],
      ["Loyalty points", ["Points rules agreed with marketing: one point per dollar, shown on the receipt. · Sam Ortiz"]],
    ]);
    // Active this week with nothing since Kat's send: my planned Supplier onboarding, and Store locator (Sam moved its story).
    expect(r.noUpdate.map((f) => [f.title, f.owner, f.active])).toEqual([["Supplier onboarding", "Alex Rivera", "planned"], ["Store locator", "Alex Rivera", "activity"]]);
    expect(r.pto).toMatchObject({ source: PTO_SOURCE, ptoRead: true, holidaysRead: true, notes: [] });
    // SR-3: the demo's observed holidays sit among the team's PTO in date order.
    expect(r.pto.rows.map((x) => `${x.name} · ${x.when}`)).toEqual(["Priya Shah · Tue, Nov 10 to Wed, Nov 11", "Founders Day (observed) · Thu, Nov 12", "Alex Rivera · Sat, Nov 14", "Holiday · Mon, Nov 16", "Sam Ortiz · Fri, Nov 20"]);
    expect(JSON.stringify(r)).not.toMatch(/@example\.com/);
    net.expectNone();
  });

  it("Harbor's report has Priya's feature, which isn't in my features", async () => {
    const { ctx } = await demo();
    const r = await report(ctx, "Harbor");
    expect(r.features.map((f) => [f.title, f.owner])).toEqual([["Patient intake form", "Alex Rivera"], ["Appointment reminders", "Priya Shah"]]);
    const mine = await run<{ clients: { clientKey: string; features: { id: number }[]; also: { id: number }[] }[] }>(ctx, "status.load");
    expect(mine.clients.find((c) => c.clientKey === "Harbor")!.features.concat(mine.clients.find((c) => c.clientKey === "Harbor")!.also).map((f) => f.id)).not.toContain(2220);
    // A teammate's and Coop's comments are never editable; Coop's shows as DevOps shows it (as the person who ran it).
    expect(r.features.flatMap((f) => f.thisWeek!).map((c) => [c.author, c.who, c.editable])).toEqual([["Sam Ortiz", "teammate", false], ["Alex Rivera", "coop", false], ["Priya Shah", "teammate", false]]);
    net.expectNone();
  });

  it("a line on a teammate's feature goes through SR-1's write path and the report reads it back; Undo takes it out", async () => {
    const { ctx, s } = await demo();
    const b = await run<Batch>(ctx, "devops.preview", { clientKey: "Harbor", changes: [{ key: "a", kind: "comment", itemId: 2220, text: "Clinic approved the opt-out wording." }] });
    expect(b.previews.map((p) => [p.key, p.op, p.fields[0]!.after])).toEqual([["a", "comment", "Clinic approved the opt-out wording."]]);
    const done = await run<{ results: Result[] }>(ctx, "devops.confirm", { previewIds: b.previews.map((p) => p.previewId) });
    expect(done.results[0]!.confirmed).toBe(true);
    const after = await report(ctx, "Harbor");
    expect(after.features.find((f) => f.id === 2220)!.thisWeek!.map((c) => [c.text, c.author, c.who, c.editable])).toEqual([
      ["Reminder texts go out 24 hours before each visit in the test site; the opt-out wording is with the clinic.", "Priya Shah", "teammate", false],
      ["Clinic approved the opt-out wording.", "Alex Rivera", "mine", true],
    ]);
    const undo = (await run<{ preview: Preview }>(ctx, "devops.preview", { clientKey: "Harbor", change: { kind: "undo", writeId: done.results[0]!.entry.id } })).preview;
    expect((await run<Result>(ctx, "devops.confirm", { previewId: undo.previewId })).confirmed).toBe(true);
    expect((await report(ctx, "Harbor")).features.find((f) => f.id === 2220)!.thisWeek!.map((c) => c.author)).toEqual(["Priya Shah"]);
    expect(s.devops.seen.filter((x) => x.method !== "GET" && x.path.includes("/comments")).map((x) => x.method)).toEqual(["POST", "DELETE"]);
    net.expectNone();
  });

  it("someone else's comment can't be edited, and a line naming another client is flagged", async () => {
    const { ctx } = await demo();
    const r = await report(ctx, "Harbor");
    const priyas = r.features.find((f) => f.id === 2220)!.thisWeek![0]!;
    const b = await run<Batch>(ctx, "devops.preview", { clientKey: "Harbor", changes: [
      { key: "e", kind: "comment_edit", itemId: 2220, commentId: priyas.id, text: "Changed." },
      { key: "m", kind: "comment", itemId: 2220, text: "Same reminder setup as Northwind uses." },
    ] });
    expect(b.refused.map((x) => [x.key, x.error])).toEqual([["e", expect.stringMatching(/Only your own comments can be edited/)]]);
    expect(b.previews.map((p) => [p.key, p.mentions])).toEqual([["m", ["Northwind"]]]);
    net.expectNone();
  });
});
