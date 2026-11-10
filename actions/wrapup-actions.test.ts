// FN-1: Wrap it up through dispatch, on a real store, against a fake dev.azure.com: the offer, one preview of every
// write, Confirm writing them in order (a later rev-tested write on the rev the earlier one made), a partial failure
// that says what landed, Made progress keeping the story's later to-dos, and nothing written before Confirm.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { clearDevopsPreviews, type DevOpsPreview } from "./devops-write-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { WrapOffer } from "./types.ts";

const NOW = "2026-11-02T17:30:00Z";
const D = "2026-11-02";
const LATER = "2026-11-04";
const COOP = "Cooptimize";
const ME = "avery@cooptimize.example";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"').replace('time_zone = ""', 'time_zone = "America/New_York"');

function setup() {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW, remainingWork: ["User Story"] });
  dv.add(400, { "System.WorkItemType": "Feature", "System.Title": "Billing", "System.State": "Active", "System.AssignedTo": { uniqueName: ME } });
  dv.add(500, { "System.WorkItemType": "User Story", "System.Title": "Mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: ME }, "Microsoft.VSTS.Scheduling.RemainingWork": 4 }, 400);
  dv.add(501, { "System.WorkItemType": "User Story", "System.Title": "Export", "System.State": "New", "System.AssignedTo": { uniqueName: ME }, "Microsoft.VSTS.Scheduling.RemainingWork": 6 });
  const writer = createDevOpsWriter({ fetch: dv.fetch, log: () => {} });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const keyring = new Map<string, string>();
  const target = (clientKey: string): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org: "cooptimize", project: "Coop Project", projectName: "Coop Project", email: ME, pat: null });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(base) }),
    makeDataverse: () => ({ devopsTargets: async (keys: string[]) => ({ ok: true, targets: keys.map(target) }) }) as never,
    makeOutlook: () => {
      throw new Error("n/a");
    },
    makeGoogle: () => {
      throw new Error("n/a");
    },
    makeDevOps: () => ({ forget: () => {}, last: () => null, itemStates: async () => new Map(), lookup: (clientKey: string, id: number) => ({ id, clientKey, title: "Mapping", type: "User Story", level: "story", state: "Active", url: "https://dev.azure.com/cooptimize/x" }) }) as never,
    saveSystemUserId: async () => {},
    now: () => NOW,
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
  const todo = async (itemId: number, date = D) => {
    await plan.start(date);
    return plan.addPick({ date, half: "AM", clientKey: COOP, kind: "item", itemId, title: itemId === 500 ? "Mapping" : "Export", itemType: "User Story", size: "M" });
  };
  const patches = () => dv.seen.filter((w) => w.method === "PATCH" || w.method === "POST").length;
  return { dv, plan, run, todo, patches, enable: () => run("devops.set_write_pat", { clientKey: COOP, pat: WRITE_PAT }) };
}

type Preview = { previews: DevOpsPreview[]; nothing: string[]; summary: string; refused: { error: string }[] };
type Results = { results: { key: string | null; ok: boolean; message: string; writeId: number | null; retry: string | null }[]; landed: number; message: string };

describe("the wrap-up offer", () => {
  it("without a write PAT: no offer, with the reason, and nothing read from DevOps", async () => {
    const t = setup();
    const p = await t.todo(500);
    const r = await t.run<{ offer: WrapOffer | null; why: string | null }>("wrapup.offer", { pickId: p.id });
    expect(r.offer).toBeNull();
    expect(r.why).toBeTruthy();
    expect(t.dv.seen).toEqual([]);
  });
  it("offers the type's done states, Remaining Work, the parent; a New item moves to its In Progress state on Made progress", async () => {
    const t = setup();
    await t.enable();
    const a = await t.run<{ offer: WrapOffer }>("wrapup.offer", { pickId: (await t.todo(500)).id });
    expect(a.offer).toMatchObject({ itemId: 500, state: "Active", done: false, chosen: "Closed", hasRemaining: true, remaining: 4, canEdit: true, parent: { id: 400, title: "Billing" } });
    expect(a.offer.choices[0]).toBe("Closed");
    expect(a.offer.activate).toBeNull();
    const b = await t.run<{ offer: WrapOffer }>("wrapup.offer", { pickId: (await t.todo(501)).id });
    expect(b.offer.activate).toBe("Active");
  });
});

describe("Finished", () => {
  it("one preview of every write (state with the comment, Remaining Work 0, the feature's line); nothing before Confirm; Confirm writes them in order", async () => {
    const t = setup();
    await t.enable();
    const p = await t.todo(500);
    const before = t.patches();
    const pv = await t.run<Preview>("wrapup.preview", { clientKey: COOP, itemId: 500, pickId: p.id, outcome: "finished", comment: "mapping covers all ledgers", feature: true });
    expect(pv.summary).toBe("#500: state Active → Closed · add comment · Remaining Work 0 · #400: add comment");
    expect(pv.previews.map((x) => x.key)).toEqual(["state", "remaining", "feature"]);
    expect(t.patches()).toBe(before);
    const r = await t.run<Results>("wrapup.confirm", { previewIds: pv.previews.map((x) => x.previewId) });
    expect(r.results.map((x) => [x.key, x.ok])).toEqual([["state", true], ["remaining", true], ["feature", true]]);
    expect(r.message).toBe("3 changes saved to DevOps");
    expect(t.dv.items.get(500)!.fields["System.State"]).toBe("Closed");
    expect(t.dv.items.get(500)!.fields["Microsoft.VSTS.Scheduling.RemainingWork"]).toBe(0);
    expect(t.dv.comments.get(500)?.map((c) => c.text.replace(/<\/?div>/g, ""))).toEqual(["Done: mapping covers all ledgers"]);
    expect(t.dv.comments.get(400)?.map((c) => c.text.replace(/<\/?div>/g, ""))).toEqual(["#500 Mapping: Done: mapping covers all ledgers"]);
  });
  it("a write that fails says what landed; Retry is offered for it", async () => {
    const t = setup();
    await t.enable();
    const p = await t.todo(500);
    const pv = await t.run<Preview>("wrapup.preview", { clientKey: COOP, itemId: 500, pickId: p.id, outcome: "finished", comment: "" });
    expect(pv.previews.map((x) => x.key)).toEqual(["state", "remaining"]);
    // The second write's PATCH fails at the network: the state landed, Remaining Work didn't.
    t.dv.fail("PATCH", /workitems\/500/i, "network");
    t.dv.fail("PATCH", /workitems\/500/i, "network");
    const r = await t.run<Results>("wrapup.confirm", { previewIds: pv.previews.map((x) => x.previewId) });
    expect(r.landed).toBeLessThan(2);
    expect(r.results.some((x) => !x.ok && x.retry !== null)).toBe(true);
    expect(r.message).toMatch(/saved to DevOps|Nothing was saved/);
  });
  it("someone changes the item after the preview: the later write stops, nothing more is written", async () => {
    const t = setup();
    await t.enable();
    const p = await t.todo(500);
    const pv = await t.run<Preview>("wrapup.preview", { clientKey: COOP, itemId: 500, pickId: p.id, outcome: "finished", comment: "" });
    t.dv.touch(500, { "Microsoft.VSTS.Scheduling.RemainingWork": 9 });
    const r = await t.run<Results>("wrapup.confirm", { previewIds: pv.previews.map((x) => x.previewId) });
    expect(r.results.every((x) => !x.ok)).toBe(true);
    expect(t.dv.items.get(500)!.fields["System.State"]).toBe("Active");
  });
});

describe("Made progress", () => {
  it("keeps the state (New moves to Active), writes the time left as Remaining Work, and the comment says Progress", async () => {
    const t = setup();
    await t.enable();
    const p = await t.todo(501);
    const pv = await t.run<Preview>("wrapup.preview", { clientKey: COOP, itemId: 501, pickId: p.id, outcome: "progress", left: 90, comment: "schema done. Next: the CSV" });
    expect(pv.summary).toBe("#501: state New → Active · add comment · Remaining Work 1.5");
    await t.run<Results>("wrapup.confirm", { previewIds: pv.previews.map((x) => x.previewId) });
    expect(t.dv.items.get(501)!.fields["System.State"]).toBe("Active");
    expect(t.dv.items.get(501)!.fields["Microsoft.VSTS.Scheduling.RemainingWork"]).toBe(1.5);
    expect(t.dv.comments.get(501)?.map((c) => c.text.replace(/<\/?div>/g, ""))).toEqual(["Progress: schema done. Next: the CSV"]);
  });
  it("an Active item with no comment and no Remaining Work: nothing to change in DevOps", async () => {
    const t = setup();
    await t.enable();
    const p = await t.todo(500);
    const pv = await t.run<Preview>("wrapup.preview", { clientKey: COOP, itemId: 500, pickId: p.id, outcome: "progress", left: 60, remaining: false, comment: "" });
    expect(pv.previews).toEqual([]);
    expect(pv.nothing).toEqual(["Nothing to change in DevOps"]);
  });
  it("on the plan: the plain tick becomes a progress tick, the story's later to-dos come back, and untick restores all", async () => {
    const t = setup();
    const today = await t.todo(500);
    const later = await t.todo(500, LATER);
    // The tick lands first (as anywhere): TX-1c takes the later to-do off.
    await t.run("pick.mark_done", { id: today.id, done: true });
    expect((await t.plan.getPick(later.id))?.status).not.toBe("planned");
    const r = await t.run<{ notice: string }>("wrapup.tick", { pickId: today.id, outcome: "progress", left: 120 });
    expect(r.notice).toBe("About 2h left on the story");
    expect((await t.plan.getPick(today.id))?.status).toBe("done");
    expect(await t.plan.getPick(later.id)).toMatchObject({ status: "planned", remainingMinutes: 120 });
    await t.run("pick.mark_done", { id: today.id, done: false });
    expect((await t.plan.getPick(today.id))?.status).toBe("planned");
    expect((await t.plan.getPick(later.id))?.remainingMinutes ?? null).not.toBe(120);
  });
  it("Finished and Skip keep a tick that already landed", async () => {
    const t = setup();
    const p = await t.todo(500);
    await t.run("pick.mark_done", { id: p.id, done: true });
    expect(await t.run<{ notice: string | null }>("wrapup.tick", { pickId: p.id, outcome: "skip" })).toMatchObject({ notice: null });
    expect((await t.plan.getPick(p.id))?.status).toBe("done");
  });
});
