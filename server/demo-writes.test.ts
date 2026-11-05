// DM-1: in the demo every write the script shows runs end to end (preview, confirm, read back, undo) against the
// session's own in-memory DevOps and calendar, and nothing leaves FocusTime: each test runs under useNoOutbound(), so a
// single fetch, http(s) request or socket fails the test. Secrets, connecting, signing in and export stay refused.
import { describe, expect, it } from "vitest";
import { dispatch, DEMO_REFUSED, type ActionContext } from "../actions/dispatch.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, demoSessionOf, seedDemo } from "./demo.ts";

const NOW = "2026-11-02T14:30:00Z"; // Monday 9:30 AM in New York
const D = "2026-11-03";

async function demo() {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  const s = demoSessionOf(ctx)!;
  return { ctx, devops: s.devops, outlook: s.outlook };
}
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
type Preview = { previewId: string };
type Result = { confirmed?: boolean; entry: { id: number; status: string } };
const devops = async (ctx: ActionContext, clientKey: string, change: Record<string, unknown>) => {
  const p = (await run<{ preview: Preview }>(ctx, "devops.preview", { clientKey, change })).preview;
  return run<Result>(ctx, "devops.confirm", { previewId: p.previewId });
};
const undo = (ctx: ActionContext, clientKey: string, r: Result) => devops(ctx, clientKey, { kind: "undo", writeId: r.entry.id });
const outlook = async (ctx: ActionContext, input: Record<string, unknown>) => {
  const p = (await run<{ preview: Preview }>(ctx, "write.preview", input)).preview;
  return run<{ entry: { id: number; status: string } }>(ctx, "write.confirm", { previewId: p.previewId });
};

describe("simulated writes in the demo (DM-1)", () => {
  const net = useNoOutbound();

  it("DevOps state and comment: written, read back, undone", async () => {
    const { ctx, devops: dv } = await demo();
    const r = await devops(ctx, "Northwind", { kind: "state", itemId: 1112, state: "Active", comment: "Starting on it" });
    expect(r.entry.status).toBe("confirmed");
    expect(dv.item(1112)!.state).toBe("Active");
    expect(dv.comments(1112).map((c) => c.text)).toContain("Starting on it");
    await undo(ctx, "Northwind", r);
    expect(dv.item(1112)!.state).toBe("New");
    const c = await devops(ctx, "Northwind", { kind: "comment", itemId: 1112, text: "The date filter works for orders" });
    expect(c.entry.status).toBe("confirmed");
    expect(dv.comments(1112).map((x) => x.text)).toContain("The date filter works for orders");
    expect(dv.seen.some((x) => x.method === "GET" && x.path.includes("/workitems/1112"))).toBe(true); // read back
    net.expectNone();
  });

  it("DevOps create from a draft (the captured draft with its AI version) and its undo", async () => {
    const { ctx, devops: dv } = await demo();
    const drafts = (await run<{ drafts: { id: number; title: string; clientKey: string }[] }>(ctx, "weekplan.load", {})).drafts;
    const d = drafts.find((x) => x.clientKey === "Northwind")!;
    const before = dv.items("Northwind").length;
    const r = await devops(ctx, "Northwind", { kind: "create", draftId: d.id });
    expect(r.entry.status).toBe("confirmed");
    const made = dv.items("Northwind").at(-1)!;
    expect(dv.items("Northwind")).toHaveLength(before + 1);
    expect(made.parent).toBe(1110);
    await undo(ctx, "Northwind", r);
    expect(dv.item(made.id)!.state).toBe("Removed");
  });

  it("Ahead's change set (fields) saves, reads back and undoes", async () => {
    const { ctx, devops: dv } = await demo();
    const r = await devops(ctx, "Northwind", { kind: "fields", itemId: 1150 });
    expect(r.entry.status).toBe("confirmed");
    expect(dv.item(1150)!.start).toBe("2026-11-16");
    await undo(ctx, "Northwind", r);
    expect(dv.item(1150)!.start).toBeNull();
  });

  it("Take one (assign to me) and a description edit, each with undo", async () => {
    const { ctx, devops: dv } = await demo();
    const a = await devops(ctx, "Northwind", { kind: "assign", itemId: 1113 });
    expect(dv.item(1113)!.who).toBe("You");
    await undo(ctx, "Northwind", a);
    expect(dv.item(1113)!.who).toBe("Priya Shah");
    const old = dv.description(1112);
    const e = await devops(ctx, "Northwind", { kind: "description_edit", itemId: 1112, after: "Filter the order history by a from and to date." });
    expect(e.entry.status).toBe("confirmed");
    expect(dv.description(1112)).toContain("from and to date");
    await undo(ctx, "Northwind", e);
    expect(dv.description(1112)).toBe(old);
  });

  it("Create DevOps item from the conversation that needs me", async () => {
    const { ctx, devops: dv } = await demo();
    const list = await run<{ needsYou: { id: number; title: string }[] }>(ctx, "conversations.list", {});
    const fee = list.needsYou.find((c) => /delivery fee/i.test(c.title))!;
    const r = await devops(ctx, "Northwind", { kind: "conversation_create", conversationId: fee.id, title: "Add the delivery fee as its own column in the order export", description: "Finance wants the fee in its own column.", level: "story", parentId: 1110 });
    expect(r.entry.status).toBe("confirmed");
    expect(dv.items("Northwind").some((i) => /delivery fee/i.test(i.title))).toBe(true);
    const after = await run<{ inProgress: { id: number }[] }>(ctx, "conversations.list", {});
    expect(after.inProgress.map((c) => c.id)).toContain(fee.id);
  });

  it("Break down's Create all publishes the cards under the feature", async () => {
    const { ctx, devops: dv } = await demo();
    const d = await run<{ id: number; cards: unknown[] }>(ctx, "stories.run", { clientKey: "Northwind", featureId: 1120 });
    expect(d.cards).toHaveLength(5); // the stored sample (no real AI in this test)
    const pv = await run<{ previews: Preview[] }>(ctx, "stories.publish_preview", { draftId: d.id });
    const r = await run<{ created: number; failed: string[] }>(ctx, "stories.publish", { draftId: d.id, previewIds: pv.previews.map((p) => p.previewId) });
    expect(r).toMatchObject({ created: 5, failed: [] });
    expect(dv.items("Northwind").filter((i) => i.parent === 1120)).toHaveLength(5);
  });

  it("Outlook: a timebox put on Outlook and undone; a help invite", async () => {
    const { ctx, outlook: cal } = await demo();
    const tb = await run<{ timebox: { uid: string } }>(ctx, "timebox.add", { date: D, start: `${D}T09:00:00-05:00`, end: `${D}T10:30:00-05:00`, clientKey: "Northwind", title: "#1112 Filter orders by date range", outlook: true });
    const put = await outlook(ctx, { uid: tb.timebox.uid });
    expect(put.entry.status).toBe("confirmed");
    expect(cal.ownEvents().some((e) => e.title.includes("#1112 Filter orders by date range"))).toBe(true);
    await outlook(ctx, { undo: put.entry.id });
    expect(cal.ownEvents()).toHaveLength(0);

    const inv = (await run<{ preview: Preview }>(ctx, "collab.preview_invite", { clientKey: "Northwind", title: "#1112 Filter orders by date range", itemId: 1112, start: `${D}T13:00:00-05:00`, end: `${D}T13:30:00-05:00`, people: ["priya.shah@example.com"], note: "A second pair of eyes" })).preview;
    expect((await run<Result>(ctx, "write.confirm", { previewId: inv.previewId })).entry.status).toBe("confirmed");
    expect(cal.ownEvents().some((e) => /help on/i.test(e.title))).toBe(true);
  });

  it("the VM's Start and Send feedback stay in the demo", async () => {
    const { ctx } = await demo();
    expect((await run<{ entry: { status: string } }>(ctx, "vm.start_now", {})).entry.status).toBeTruthy();
    const pv = await run<{ previewId: string }>(ctx, "feedback.preview", { kind: "idea", text: "Show the week's free hours on the Week tab", where: { view: "Week", version: "demo", browser: "Chrome on Windows", screen: "1920×1080" } });
    expect(await run(ctx, "feedback.send", { previewId: pv.previewId })).toBeTruthy();
  });

  it("secrets, connecting, signing in and export stay refused", async () => {
    const { ctx } = await demo();
    for (const action of ["devops.set_write_pat", "secret.set", "auth.connect_microsoft", "auth.sign_in", "data.export"] as const) {
      expect(DEMO_REFUSED).toContain(action);
      expect(await dispatch(ctx, { action, input: {} }), action).toMatchObject({ ok: false, status: 403, code: "demo" });
    }
  });
});
