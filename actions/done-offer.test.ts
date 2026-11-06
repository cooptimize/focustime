// PK-1: checking off a to-do offers the DevOps update. The offer is read only (devops.done_offer); Confirm is the
// existing state write (preview, test /rev, read back, audit log, undo), and unchecking offers that write's own undo
// (devops.undo_offer). Against a fake dev.azure.com; orgs and people are fakes.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { alreadyDone, doneChoices } from "../plan/devopswrite.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { clearDevopsPreviews, type DevOpsPreview, type DevOpsResult, type DoneOffer, type UndoOffer } from "./devops-write-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

const NOW = "2026-11-02T14:00:00Z";
const COOP = "Cooptimize";
const ME = "avery@cooptimize.example";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');

function setup(o: { toml?: string; pat?: boolean } = {}) {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW });
  dv.add(437, { "System.WorkItemType": "Feature", "System.Title": "Import", "System.State": "Active", "System.AssignedTo": { uniqueName: "dana@cooptimize.example" } });
  // Agile-like: User Story has Resolved and Closed. Basic-like: Issue has only Done.
  dv.add(500, { "System.WorkItemType": "User Story", "System.Title": "Import mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: ME } }, 437);
  dv.add(501, { "System.WorkItemType": "Issue", "System.Title": "Fix the export", "System.State": "To Do", "System.AssignedTo": { uniqueName: ME } });
  dv.add(502, { "System.WorkItemType": "User Story", "System.Title": "Already closed", "System.State": "Closed", "System.AssignedTo": { uniqueName: ME } }, 437);
  dv.add(503, { "System.WorkItemType": "User Story", "System.Title": "Dana's story", "System.State": "Active", "System.AssignedTo": { uniqueName: "kim@cooptimize.example" } }, 437);
  dv.add(504, { "System.WorkItemType": "User Story", "System.Title": "Resolved one", "System.State": "Resolved", "System.AssignedTo": { uniqueName: ME } }, 437);
  const writer = createDevOpsWriter({ fetch: dv.fetch, log: () => {} });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const keyring = new Map<string, string>();
  const target = (clientKey: string): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org: "cooptimize", project: "Coop Project", projectName: "Coop Project", email: ME, pat: null });
  let now = NOW;
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(`${base}${o.toml ?? ""}`) }),
    makeDataverse: () => ({ devopsTargets: async (keys: string[]) => ({ ok: true, targets: keys.map(target) }) }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({ forget: () => {}, last: () => null }) as never,
    saveSystemUserId: async () => {},
    now: () => now,
    sleep: async () => {},
    plan,
    devopsWriter: writer,
    writePats: { get: async (k) => { const v = keyring.get(k); if (!v) throw new Error("not found"); return new Pat(v); }, set: async (k, v) => void keyring.set(k, v), clear: async (k) => void keyring.delete(k) },
  };
  const run = async <T = unknown>(action: string, input: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const todo = async (itemId: number | null, done = true) => {
    await plan.start("2026-11-02");
    const p = await plan.addPick({ date: "2026-11-02", half: "AM", clientKey: COOP, kind: itemId === null ? "intention" : "item", itemId, title: `#${itemId ?? "none"}`, itemType: "User Story", size: "S" });
    if (done) await plan.setDone(p.id, true);
    return p.id;
  };
  const offers = async (pickIds: number[]) => (await run<{ offers: DoneOffer[]; off: boolean }>("devops.done_offer", { pickIds }));
  const setDone = async (o: DoneOffer, state = o.choices[0]!) => {
    const p = (await run<{ preview: DevOpsPreview }>("devops.preview", { clientKey: o.clientKey, change: { kind: "state", itemId: o.itemId, state, pickId: o.pickId } })).preview;
    return run<DevOpsResult>("devops.confirm", { previewId: p.previewId });
  };
  const patches = () => dv.seen.filter((w) => w.method === "PATCH");
  return { dv, plan, run, todo, offers, setDone, patches, enable: () => (o.pat === false ? null : run("devops.set_write_pat", { clientKey: COOP, pat: WRITE_PAT })), later: (h: number) => void (now = Temporal.Instant.from(NOW).add({ hours: h }).toString()) };
}

describe("PK-1 the done state comes from the process model", () => {
  it("Completed first, then Resolved when the type has one; never a name", () => {
    const agile = [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }];
    const basic = [{ name: "To Do", category: "Proposed" }, { name: "Doing", category: "InProgress" }, { name: "Done", category: "Completed" }];
    const custom = [{ name: "07-Blocked", category: "Removed" }, { name: "09-Shipped", category: "Completed" }, { name: "08-Ready", category: "Resolved" }];
    expect(doneChoices(agile)).toEqual(["Closed", "Resolved"]);
    expect(doneChoices(basic)).toEqual(["Done"]);
    expect(doneChoices(custom)).toEqual(["09-Shipped", "08-Ready"]);
    expect(doneChoices([{ name: "Open", category: "InProgress" }])).toEqual([]);
    expect([alreadyDone(agile, "Resolved"), alreadyDone(agile, "Closed"), alreadyDone(agile, "Active"), alreadyDone(custom, "07-Blocked"), alreadyDone(agile, "Mystery")]).toEqual([true, true, false, true, false]);
  });

  it("two processes in one offer: User Story offers Closed and Resolved, Issue offers Done", async () => {
    const s = setup();
    await s.enable();
    const a = await s.todo(500);
    const b = await s.todo(501);
    const r = await s.offers([a, b]);
    expect(r.offers.map((x) => [x.itemId, x.state, x.choices])).toEqual([[500, "Active", ["Closed", "Resolved"]], [501, "To Do", ["Done"]]]);
    expect(s.patches()).toHaveLength(0);
  });
});

describe("PK-1 when there's no offer", () => {
  it("not for an item already done (Resolved or Closed), one I can't change, or a to-do without an item", async () => {
    const s = setup();
    await s.enable();
    const ids = [await s.todo(502), await s.todo(503), await s.todo(504), await s.todo(null)];
    expect((await s.offers(ids)).offers).toEqual([]);
  });
  it("not for a to-do that isn't checked done", async () => {
    const s = setup();
    await s.enable();
    expect((await s.offers([await s.todo(500, false)])).offers).toEqual([]);
  });
  it("not without my write PAT for the client (it stays read-only)", async () => {
    const s = setup({ pat: false });
    expect((await s.offers([await s.todo(500)])).offers).toEqual([]);
  });
  it("Never ask turns the offers off, and nothing is read from DevOps", async () => {
    const s = setup({ toml: "\n[plan]\ndevops_on_done = \"never\"\n" });
    await s.enable();
    const before = s.dv.seen.length;
    expect(await s.offers([await s.todo(500)])).toEqual({ offers: [], off: true });
    expect(s.dv.seen.length).toBe(before);
  });
});

describe("PK-1 Confirm and Undo", () => {
  it("Confirm writes the state once, with test /rev, read back and the audit log naming the to-do", async () => {
    const s = setup();
    await s.enable();
    const id = await s.todo(500);
    const [o] = (await s.offers([id])).offers;
    const r = await s.setDone(o!);
    expect(r.confirmed).toBe(true);
    expect(s.patches()).toHaveLength(1);
    expect((s.patches()[0]!.body as unknown[])[0]).toEqual({ op: "test", path: "/rev", value: expect.any(Number) });
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Closed");
    const log = (await s.plan.devopsWriteLog(10))[0]!;
    expect(log).toMatchObject({ op: "state", itemId: 500, status: "confirmed", before: { State: "Active" }, after: { State: "Closed" }, pickIds: [id] });
    // Done now: no second offer.
    expect((await s.offers([id])).offers).toEqual([]);
  });
  it("the Resolved choice writes Resolved", async () => {
    const s = setup();
    await s.enable();
    const [o] = (await s.offers([await s.todo(500)])).offers;
    await s.setDone(o!, "Resolved");
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Resolved");
  });
  it("Not now writes nothing (the offer itself only reads)", async () => {
    const s = setup();
    await s.enable();
    await s.offers([await s.todo(500)]);
    expect(s.patches()).toHaveLength(0);
  });
  it("a state change can't name a to-do for another item", async () => {
    const s = setup();
    await s.enable();
    const id = await s.todo(501);
    await expect(s.run("devops.preview", { clientKey: COOP, change: { kind: "state", itemId: 500, state: "Closed", pickId: id } })).rejects.toThrow(/isn't for this item/);
  });
  it("unchecking after the write offers that write's own Undo; after Undo, or 12 hours on, or after a newer write, none", async () => {
    const s = setup();
    await s.enable();
    const id = await s.todo(500);
    const [o] = (await s.offers([id])).offers;
    const w = await s.setDone(o!);
    await s.plan.setDone(id, false);
    const u = (await s.run<{ offer: UndoOffer | null }>("devops.undo_offer", { pickId: id })).offer;
    expect(u).toMatchObject({ writeId: w.entry.id, itemId: 500, before: "Active", after: "Closed" });
    // The undo is the write framework's own: preview, confirm, read back.
    const p = (await s.run<{ preview: DevOpsPreview }>("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: u!.writeId } })).preview;
    await s.run("devops.confirm", { previewId: p.previewId });
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Active");
    expect((await s.run<{ offer: UndoOffer | null }>("devops.undo_offer", { pickId: id })).offer).toBeNull();
    // A fresh write, then 13 hours: too late to offer.
    await s.plan.setDone(id, true);
    await s.setDone((await s.offers([id])).offers[0]!);
    s.later(13);
    expect((await s.run<{ offer: UndoOffer | null }>("devops.undo_offer", { pickId: id })).offer).toBeNull();
  });
  it("no Undo offer for a to-do whose item FocusTime never set", async () => {
    const s = setup();
    await s.enable();
    expect((await s.run<{ offer: UndoOffer | null }>("devops.undo_offer", { pickId: await s.todo(500, false) })).offer).toBeNull();
  });
});
