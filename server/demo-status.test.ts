// SR-1: Status on the demo: the seeded week (5 features, 2 with an update), Push all's comments and edits written to the
// session's in-memory DevOps through the write framework (preview, confirm, read back, audit, undo per line), the
// edit rules, the AI draft's one-client input, GD-1, and nothing leaving FocusTime.
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { StatusLoad } from "../plan/status-types.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, demoSessionOf, seedDemo } from "./demo.ts";

const NOW = "2026-11-05T15:00:00Z"; // Thursday 10:00 AM in New York

async function demo(now = NOW) {
  const ctx = createDemoContext({ now: () => now, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  return { ctx, s: demoSessionOf(ctx)! };
}
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
type Preview = { previewId: string; key?: string; op: string; fields: { label: string; before: string | null; after: string | null }[]; mentions?: string[] };
type Batch = { previews: Preview[]; nothing: string[]; refused: { itemId: number | null; error: string; code: string | null; key?: string }[] };
type Result = { confirmed: boolean; message: string; entry: { id: number; status: string } };
const feature = (l: StatusLoad, id: number) => l.clients.flatMap((c) => [...c.features, ...c.also]).find((f) => f.id === id)!;

describe("Status (SR-1)", () => {
  const net = useNoOutbound();

  it("shows planned and touched features per client, folds the assigned ones, and counts as Monday's report will", async () => {
    const { ctx } = await demo();
    const l = await run<StatusLoad>(ctx, "status.load");
    expect(l.title).toBe("Status report · for Monday, Nov 9");
    expect(l.countLine).toBe("5 features · 2 with an update · 3 without");
    const nw = l.clients.find((c) => c.clientKey === "Northwind")!;
    expect(nw.features.map((f) => f.id)).toEqual([1110, 1120]);
    expect(nw.also.map((f) => f.id)).toEqual(expect.arrayContaining([1140, 1150]));
    expect(nw.window).toMatchObject({ source: "kat", since: "2026-11-02T12:04:00Z", note: null });
    const f = feature(l, 1110);
    expect(f.thisWeek!.map((c) => [c.author, c.who, c.editable])).toEqual([["Alex Rivera", "mine", true], ["Priya Shah", "teammate", false]]);
    expect(f.lastWeek).toHaveLength(1);
    // Harbor: a teammate's and Coop's, neither editable; Atlas comes in through a planned story.
    expect(feature(l, 2210).thisWeek!.map((c) => [c.who, c.editable])).toEqual([["teammate", false], ["coop", false]]);
    expect(l.clients.find((c) => c.clientKey === "Atlas")!.features.map((x) => [x.id, x.why])).toEqual([[3310, "planned"]]);
    // Nothing leaves the server that names an email address.
    expect(JSON.stringify(l)).not.toMatch(/@example\.com/);
    // The facts behind a draft, as hints.
    expect(feature(l, 1110).hints).toContain("#1111 Export orders to CSV: Active → Resolved");
    net.expectNone();
  });

  it("Push all: each new line is its own comment, each edit changes only my own; every one read back and undone alone", async () => {
    const { ctx, s } = await demo();
    const l = await run<StatusLoad>(ctx, "status.load");
    const mine = feature(l, 1110).thisWeek!.find((c) => c.editable)!;
    const nw = await run<Batch>(ctx, "devops.preview", { clientKey: "Northwind", changes: [
      { key: "a", kind: "comment", itemId: 1120, text: "Supplier sign-up form designed; review with purchasing Friday." },
      { key: "b", kind: "comment", itemId: 1120, text: "Certificates upload is next." },
      { key: "c", kind: "comment_edit", itemId: 1110, commentId: mine.id, text: "CSV export is merged; the date range filter is in review today." },
    ] });
    expect(nw.previews.map((p) => [p.key, p.op])).toEqual([["a", "comment"], ["b", "comment"], ["c", "comment_edit"]]);
    expect(nw.previews[2]!.fields[0]).toMatchObject({ before: expect.stringContaining("should be in review Thursday"), after: expect.stringContaining("in review today") });
    const done = await run<{ results: Result[] }>(ctx, "devops.confirm", { previewIds: nw.previews.map((p) => p.previewId) });
    expect(done.results.map((r) => r.confirmed)).toEqual([true, true, true]);
    const after = await run<StatusLoad>(ctx, "status.load");
    expect(after.countLine).toBe("5 features · 3 with an update · 2 without");
    expect(feature(after, 1120).thisWeek!.map((c) => c.text)).toEqual(["Supplier sign-up form designed; review with purchasing Friday.", "Certificates upload is next."]);
    expect(feature(after, 1110).thisWeek!.find((c) => c.id === mine.id)!.text).toBe("CSV export is merged; the date range filter is in review today.");
    // Each undone on its own: the first new line, then the edit (the second line stays).
    const undo = async (r: Result) => {
      const p = (await run<{ preview: Preview }>(ctx, "devops.preview", { clientKey: "Northwind", change: { kind: "undo", writeId: r.entry.id } })).preview;
      return run<Result>(ctx, "devops.confirm", { previewId: p.previewId });
    };
    expect((await undo(done.results[0]!)).confirmed).toBe(true);
    expect((await undo(done.results[2]!)).message).toBe("Comment put back in DevOps");
    const back = await run<StatusLoad>(ctx, "status.load");
    expect(feature(back, 1120).thisWeek!.map((c) => c.text)).toEqual(["Certificates upload is next."]);
    expect(feature(back, 1110).thisWeek!.find((c) => c.id === mine.id)!.text).toContain("should be in review Thursday");
    // Written once each: two posts, one edit and one edit back, one delete.
    const w = s.devops.seen.filter((x) => x.method !== "GET" && x.path.includes("/comments"));
    expect(w.map((x) => x.method)).toEqual(["POST", "POST", "PATCH", "DELETE", "PATCH"]);
    net.expectNone();
  });

  it("a teammate's or Coop's comment, or one before the window, is never edited; a failure lands on its own line", async () => {
    const { ctx } = await demo();
    const l = await run<StatusLoad>(ctx, "status.load");
    const priya = feature(l, 1110).thisWeek!.find((c) => c.who === "teammate")!;
    const coop = feature(l, 2210).thisWeek!.find((c) => c.who === "coop")!;
    const old = feature(l, 1110).lastWeek[0]!;
    const r = await run<Batch>(ctx, "devops.preview", { clientKey: "Northwind", changes: [
      { key: "p", kind: "comment_edit", itemId: 1110, commentId: priya.id, text: "x" },
      { key: "o", kind: "comment_edit", itemId: 1110, commentId: old.id, text: "x" },
      { key: "ok", kind: "comment", itemId: 1110, text: "A fine line" },
    ] });
    expect(r.previews.map((p) => p.key)).toEqual(["ok"]);
    expect(r.refused.map((x) => [x.key, x.error])).toEqual([["p", expect.stringContaining("Only your own comments")], ["o", "Only comments in this week's status report can be edited here"]]);
    const h = await run<Batch>(ctx, "devops.preview", { clientKey: "Harbor", changes: [{ key: "c", kind: "comment_edit", itemId: 2210, commentId: coop.id, text: "x" }] });
    expect(h.refused[0]!.error).toBe("Coop's comments aren't edited from FocusTime");
  });

  it("GD-2: a line naming another client is flagged on its line, with the replaced text from boundary.check; Internal isn't checked", async () => {
    const { ctx } = await demo();
    const r = await run<Batch>(ctx, "devops.preview", { clientKey: "Northwind", changes: [{ key: "x", kind: "comment", itemId: 1120, text: "Same approach as Harbor Health's intake form." }, { key: "y", kind: "comment", itemId: 1120, text: "Fine" }] });
    expect(r.refused).toEqual([]);
    expect(r.previews.map((p) => [p.key, p.mentions ?? null])).toEqual([["x", ["Harbor"]], ["y", null]]);
    // The line editor's check, as I type: the names and the one-click text.
    const c = await run<{ names: string[]; replaced: string[] }>(ctx, "boundary.check", { clientKey: "Northwind", texts: ["Same approach as Harbor Health's intake form."] });
    expect(c).toEqual({ names: ["Harbor"], replaced: ["Same approach as another client's intake form."] });
    expect(await run(ctx, "boundary.check", { clientKey: "Northwind", texts: ["Fine"] })).toEqual({ names: [], replaced: ["Fine"] });
    const internal = await run<Batch>(ctx, "devops.preview", { clientKey: "Cooptimize", changes: [{ key: "z", kind: "comment", itemId: 4410, text: "Northwind's report numbers now come from this." }] });
    expect(internal.previews.map((p) => [p.key, p.mentions ?? null])).toEqual([["z", null]]);
    expect((await run<{ names: string[] }>(ctx, "boundary.check", { clientKey: "Cooptimize", texts: ["Northwind's report numbers"] })).names).toEqual([]);
  });

  it("the AI draft carries only that client's facts and features", async () => {
    const { ctx, s } = await demo();
    const sent: string[] = [];
    s.ai.spy?.((input: string) => void sent.push(input));
    const r = await run<{ ai: string; drafts: { itemId: number; text: string }[] }>(ctx, "status.draft", { clientKey: "Northwind" });
    expect(r.ai).toBe("ok");
    // GD-2: the sample named another client; the check after replaced it and the draft says so.
    expect((r as { namesRemoved?: string }).namesRemoved).toBe("Another client's name was removed");
    expect(JSON.stringify(r.drafts)).toContain("another client's intake form");
    expect(JSON.stringify(r.drafts)).not.toMatch(/Harbor/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Order history export");
    expect(sent[0]).not.toMatch(/Harbor|Patient intake|Atlas|Shipment|Internal reporting/);
    expect(sent[0]).not.toMatch(/@/);
    net.expectNone();
  });

  it("with AI off for the client: no AI call, an empty draft, and the facts as hints on the page", async () => {
    const { ctx, s } = await demo();
    const sent: string[] = [];
    s.ai.spy?.((input: string) => void sent.push(input));
    // Northwind's Allow AI off (the team's rule), everything else as the demo has it.
    const load = ctx.loadConfig;
    ctx.loadConfig = async () => {
      const r = await load();
      if (r.parsed.ok) r.parsed.config.aiRules = { ...r.parsed.config.aiRules, allowedClients: r.parsed.config.aiRules.allowedClients.filter((k) => k !== "Northwind") };
      return r;
    };
    const l = await run<StatusLoad>(ctx, "status.load");
    const nw = l.clients.find((c) => c.clientKey === "Northwind")!;
    expect(nw.ai).toBe("client_off");
    expect(feature(l, 1110).hints.length).toBeGreaterThan(0);
    const r = await run<{ ai: string; drafts: unknown[] }>(ctx, "status.draft", { clientKey: "Northwind" });
    expect(r).toMatchObject({ ai: "client_off", drafts: [] });
    expect(sent).toEqual([]);
    net.expectNone();
  });
});
