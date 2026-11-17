// ED-2: a staged title and a staged move in Backlog's change set, written by the change set's own fields write: one
// update per item with its other fields, by ED-1's rules, per-field conflicts, the old title and parent back on undo,
// and never an order field. Against the fake dev.azure.com; orgs, people and text are fakes.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { PatchOp } from "../plan/devopswrite.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { COMPANY_PAT, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { notesStore } from "../store/devops-notes.ts";
import { planWithRaw } from "../test/tp1-drafts.ts";
import { clearDevopsPreviews, devopsWriteAction, type DevOpsPreview, type DevOpsResult, type DevOpsWriteContext } from "./devops-write-actions.ts";
import type { EditOffer } from "./types.ts";
import type { ChangeField } from "../plan/ahead-edit.ts";

const NOW = "2026-11-12T14:00:00Z";
const COOP = "Cooptimize";
const ME = "avery@cooptimize.example";
const PROJECT = "Cooptimize Project";
const cfgText = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', `my_email = "${ME}"`);
const who = (email: string) => ({ uniqueName: email, displayName: email.split("@")[0] });

function setup(o: { lead?: boolean; automation?: boolean; outside?: string[]; noPat?: boolean } = {}) {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW });
  const tp = { "System.TeamProject": PROJECT };
  dv.add(600, { ...tp, "System.WorkItemType": "Epic", "System.Title": "Platform", "System.State": "Active", "System.AssignedTo": who(ME) });
  dv.add(437, { ...tp, "System.WorkItemType": "Feature", "System.Title": "Import", "System.State": "Active", "System.AssignedTo": who(ME) }, 600);
  dv.add(438, { ...tp, "System.WorkItemType": "Feature", "System.Title": "Export", "System.State": "Active", "System.AssignedTo": who("dana@cooptimize.example") }, 600);
  dv.add(439, { ...tp, "System.WorkItemType": "Feature", "System.Title": "Old feature", "System.State": "Closed" }, 600);
  dv.add(500, { ...tp, "System.WorkItemType": "User Story", "System.Title": "Import mapping", "System.State": "Active", "System.AssignedTo": who(ME), "System.Description": "<div>Map the <b>columns</b>.</div><ul><li>Name</li><li>Date</li></ul>" }, 437);
  dv.add(501, { ...tp, "System.WorkItemType": "User Story", "System.Title": "Dana's story", "System.State": "Active", "System.AssignedTo": who("dana@cooptimize.example") }, 437);
  dv.add(502, { ...tp, "System.WorkItemType": "User Story", "System.Title": "Lee's story", "System.State": "Active", "System.AssignedTo": who("lee@cooptimize.example"), "System.Description": "<table><tr><td>a</td></tr></table>" }, 438);
  dv.add(503, { ...tp, "System.WorkItemType": "User Story", "System.Title": "Guest's story", "System.State": "Active", "System.AssignedTo": who("guest@client.example") }, 437);
  dv.add(700, { "System.TeamProject": "Another Project", "System.WorkItemType": "Feature", "System.Title": "Elsewhere", "System.State": "Active" });
  const writer = createDevOpsWriter({ fetch: dv.fetch, log: () => {} });
  const { plan } = planWithRaw(() => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York"));
  const notes = notesStore(sqliteConn(openPlanDb({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") })), () => Temporal.Instant.from(NOW));
  const keyring = new Map<string, string>();
  const stored: { id: number; fields: Record<string, unknown> }[] = [];
  const targetCalls: (boolean | undefined)[] = [];
  const target = (withPat: boolean): DevOpsTarget => ({ accountId: "a", clientKey: COOP, clientName: COOP, org: "cooptimize", project: PROJECT, projectName: PROJECT, email: ME, pat: withPat ? new Pat(COMPANY_PAT) : null });
  const ctx: DevOpsWriteContext = {
    plan,
    config: async () => { const p = parseConfig(cfgText); return p.ok ? p.config : null; },
    targets: async (_cfg, _keys) => (targetCalls.push(false), { ok: true, targets: [target(false)] }),
    sleep: async () => {},
    writer,
    pats: { get: async (k) => { const v = keyring.get(k); if (!v) throw new Error("not found"); return new Pat(v); }, set: async (k, v) => void keyring.set(k, v), clear: async (k) => void keyring.delete(k) },
    devops: () => ({ forget: () => {} }) as never,
    now: () => NOW,
    notes,
    ahead: {
      // The change set as the app wires it (actions/dispatch.ts): my rows in the plan store.
      staged: async (clientKey, itemId) => (await plan.aheadChanges()).filter((c) => c.clientKey === clientKey && c.itemId === itemId),
      conflict: (clientKey, itemId, field, theirs) => plan.markAheadConflict(clientKey, itemId, field, theirs),
      landed: async (clientKey, itemId, field) => void (await plan.removeAheadChanges(clientKey, itemId, field)),
      setHalf: (clientKey, itemId, field, day, half) => plan.setAheadHalf(clientKey, itemId, field, day, half),
      isLead: async () => !!o.lead, automation: async () => !!o.automation,
      stored: async (_k, v) => void stored.push(v),
      isCooptimizer: async (_k, email) => email.endsWith("@cooptimize.example") && !(o.outside ?? []).includes(email),
    },
  };
  const run = async <T = unknown>(action: Parameters<typeof devopsWriteAction>[1], input: unknown): Promise<T> => {
    const r = await devopsWriteAction(ctx, action, input);
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${r.error}`), { code: r.code, status: r.status });
    return r.data as T;
  };
  const fail = async (action: Parameters<typeof devopsWriteAction>[1], input: unknown) => {
    const r = await devopsWriteAction(ctx, action, input);
    if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r.data).slice(0, 200)}`);
    return r;
  };
  const offer = async (itemId: number) => (await run<{ offer: EditOffer | null; why: string | null }>("devops.edit_offer", { clientKey: COOP, itemId })).offer!;
  const preview = async (change: Record<string, unknown>) => (await run<{ preview?: DevOpsPreview; nothing?: string }>("devops.preview", { clientKey: COOP, change }));
  const confirm = (p: DevOpsPreview) => run<DevOpsResult>("devops.confirm", { previewId: p.previewId });
  const write = async (change: Record<string, unknown>) => confirm((await preview(change)).preview!);
  const patches = () => dv.writes().filter((w) => w.method === "PATCH").map((w) => w.body as PatchOp[]);
  const enable = async () => {
    if (!o.noPat) await run("devops.set_write_pat", { clientKey: COOP, pat: WRITE_PAT });
  };
  return { dv, plan, notes, run, fail, offer, preview, confirm, write, patches, enable, stored, targetCalls, ctx };
}
type S = ReturnType<typeof setup>;
const rev = (s: S, id: number) => s.dv.items.get(id)!.rev;
const stage = (s: S, itemId: number, field: ChangeField, value: unknown, baseValue: unknown, baseRev = rev(s, itemId)) => s.plan.stageAheadChange({ clientKey: COOP, itemId, field, value: value as never, half: null, baseRev, baseValue: baseValue as never });
const ORDER = /StackRank|BacklogPriority/;
const titleOf = (s: S, id: number) => s.dv.items.get(id)!.fields["System.Title"];
const parentOf = (s: S, id: number) => s.dv.items.get(id)!.relations.filter((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse").map((r) => Number(/(\d+)$/.exec(r.url)![1]));

describe("ED-2: a title and a parent in the change set's one write per item", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });

  it("title, parent and a size on one item go out as one update behind one rev test, the fields first and the link last; no order field", async () => {
    await stage(s, 500, "title", "Import column mapping", "Import mapping");
    await stage(s, 500, "parent", { id: 438, title: "Export" }, { id: 437, title: "Import" });
    await stage(s, 500, "size", 5, null);
    const at = rev(s, 500);
    const p = (await s.preview({ kind: "fields", itemId: 500 })).preview!;
    expect(p.fields).toEqual(expect.arrayContaining([
      { label: "Title", before: "Import mapping", after: "Import column mapping", changed: true },
      { label: "Parent", before: "#437 Import", after: "#438 Export", changed: true },
      { label: "Story Points", before: null, after: "5", changed: true },
    ]));
    expect(p.notes.join(" ")).toContain("Only the parent link changes. Area, iteration, state, dates, assignee and backlog order stay as they are.");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const all = s.patches();
    expect(all.length).toBe(1);
    const ops = all[0]!;
    expect(ops[0]).toEqual({ op: "test", path: "/rev", value: at });
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.Title", value: "Import column mapping" });
    expect(ops).toContainEqual({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StoryPoints", value: 5 });
    expect(ops.filter((o) => o.path.startsWith("/relations/")).map((o) => o.op)).toEqual(["remove", "add"]);
    expect(ops.at(-1)).toMatchObject({ op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse" } });
    expect(ops.some((o) => ORDER.test(o.path) || o.path.includes("AreaPath") || o.path.includes("IterationPath"))).toBe(false);
    expect(titleOf(s, 500)).toBe("Import column mapping");
    expect(parentOf(s, 500)).toEqual([438]);
    // Everything of the item left the change set; the store is told the new parent.
    expect(await s.plan.aheadChanges()).toEqual([]);
    expect(s.stored.at(-1)!.fields["System.Parent"]).toBe(438);
    expect(r.entry).toMatchObject({ op: "fields", status: "confirmed", before: { Title: "Import mapping", Parent: "#437 Import" } });
  });

  it("undo puts the old title and the old parent back in one update, and is refused once DevOps shows something else", async () => {
    await stage(s, 500, "title", "Import column mapping", "Import mapping");
    await stage(s, 500, "parent", { id: 438, title: "Export" }, { id: 437, title: "Import" });
    const r = await s.confirm((await s.preview({ kind: "fields", itemId: 500 })).preview!);
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.entry).toMatchObject({ op: "undo_fields", status: "confirmed" });
    expect(titleOf(s, 500)).toBe("Import mapping");
    expect(parentOf(s, 500)).toEqual([437]);
    expect(s.patches().at(-1)!.some((o) => ORDER.test(o.path))).toBe(false);
    // Again, then a teammate renames it: undo would overwrite their title, so it is refused and nothing is written.
    await stage(s, 500, "title", "Import column mapping", "Import mapping");
    const again = await s.confirm((await s.preview({ kind: "fields", itemId: 500 })).preview!);
    s.dv.items.get(500)!.fields["System.Title"] = "Someone else's title";
    s.dv.items.get(500)!.rev++;
    const n = s.patches().length;
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: again.entry.id } })).toMatchObject({ status: 409, code: "changed" });
    expect(s.patches().length).toBe(n);
  });

  it("a move to No parent removes the link and adds none; undo links the old parent again", async () => {
    await stage(s, 500, "parent", null, { id: 437, title: "Import" });
    const r = await s.confirm((await s.preview({ kind: "fields", itemId: 500 })).preview!);
    expect(parentOf(s, 500)).toEqual([]);
    expect(s.patches().at(-1)!.filter((o) => o.path.startsWith("/relations/")).map((o) => o.op)).toEqual(["remove"]);
    await s.write({ kind: "undo", writeId: r.entry.id });
    expect(parentOf(s, 500)).toEqual([437]);
  });

  it("per field: a change in DevOps to another field (or a new revision from a comment) doesn't block", async () => {
    await stage(s, 500, "title", "Import column mapping", "Import mapping");
    // A teammate changes the state and the item moves on two revisions: my title still goes, on the new revision.
    s.dv.items.get(500)!.fields["System.State"] = "Resolved";
    s.dv.items.get(500)!.rev += 2;
    const p = (await s.preview({ kind: "fields", itemId: 500 })).preview!;
    expect((await s.confirm(p)).confirmed).toBe(true);
    expect(titleOf(s, 500)).toBe("Import column mapping");
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Resolved");
  });

  it("a conflict on the same field names it and keeps DevOps's value beside mine", async () => {
    await stage(s, 500, "title", "Mine", "Import mapping");
    await stage(s, 500, "parent", { id: 438, title: "Export" }, { id: 437, title: "Import" });
    s.dv.items.get(500)!.fields["System.Title"] = "Theirs";
    s.dv.items.get(500)!.rev++;
    const f = await s.fail("devops.preview", { clientKey: COOP, change: { kind: "fields", itemId: 500 } });
    expect(f).toMatchObject({ status: 409, code: "conflict" });
    expect(f.error).toContain("Title is Theirs now");
    expect(s.patches().length).toBe(0);
    const mine = await s.plan.aheadChanges();
    expect(mine.find((c) => c.field === "title")).toMatchObject({ value: "Mine", theirs: "Theirs" });
    // The move had no conflict of its own and is still staged.
    expect(mine.find((c) => c.field === "parent")!.theirs).toBeUndefined();
  });

  it("ED-1's rules on the write path: an empty or too-long title, the item itself, a wrong level, a closed parent and another project's item are refused and nothing is written", async () => {
    const refused = async (itemId: number, field: ChangeField, value: unknown, base: unknown, want: RegExp) => {
      await s.plan.removeAheadChanges(null);
      await stage(s, itemId, field, value, base);
      const f = await s.fail("devops.preview", { clientKey: COOP, change: { kind: "fields", itemId } });
      expect(f.status).toBe(409);
      expect(f.error).toMatch(want);
    };
    await refused(500, "title", "   ", "Import mapping", /Type a title/);
    await refused(500, "title", "x".repeat(256), "Import mapping", /at most 255 characters/);
    await refused(500, "parent", { id: 500, title: "" }, { id: 437, title: "Import" }, /can't be its own parent/);
    await refused(500, "parent", { id: 600, title: "" }, { id: 437, title: "Import" }, /Epic isn't the level above/);
    await refused(500, "parent", { id: 439, title: "" }, { id: 437, title: "Import" }, /only under open parents/);
    await refused(500, "parent", { id: 700, title: "" }, { id: 437, title: "Import" }, /isn't in Cooptimize's project/);
    await refused(500, "parent", { id: 99999, title: "" }, { id: 437, title: "Import" }, /isn't in Cooptimize's project/);
    await refused(600, "parent", { id: 437, title: "" }, null, /is the top level, so it has no parent to change/);
    expect(s.patches().length).toBe(0);
  });

  it("someone who may not change the item can't save a rename or a move of it", async () => {
    await stage(s, 502, "title", "Not mine to rename", "Lee's story");
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "fields", itemId: 502 } })).toMatchObject({ status: 403, code: "read_only" });
    expect(s.patches().length).toBe(0);
  });

  it("a failure on one item leaves the others saved and that one staged, with Retry", async () => {
    await stage(s, 500, "title", "Import column mapping", "Import mapping");
    await stage(s, 437, "title", "Imports", "Import");
    const first = await s.confirm((await s.preview({ kind: "fields", itemId: 500 })).preview!);
    expect(first.confirmed).toBe(true);
    s.dv.fail("PATCH", /workitems\/437/i, "network");
    const p = (await s.preview({ kind: "fields", itemId: 437 })).preview!;
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(false);
    expect(r.entry.status).toBe("unconfirmed");
    expect(titleOf(s, 500)).toBe("Import column mapping");
    expect((await s.plan.aheadChanges()).map((c) => c.itemId)).toEqual([437]);
    const log = (await s.run<{ entries: { id: number; retryable: boolean; itemId: number }[] }>("devops.log", {})).entries;
    expect(log.find((e) => e.itemId === 437)!.retryable).toBe(true);
    const again = await s.run<{ confirmed: boolean }>("devops.retry", { id: r.entry.id });
    expect(again.confirmed).toBe(true);
    expect(titleOf(s, 437)).toBe("Imports");
    expect(await s.plan.aheadChanges()).toEqual([]);
  });

  it("the owner of a renamed or moved item who isn't me gets ED-1's quiet note, once", async () => {
    const lead = setup({ lead: true });
    await lead.enable();
    await stage(lead, 501, "title", "Dana's renamed story", "Dana's story");
    const p = (await lead.preview({ kind: "fields", itemId: 501 })).preview!;
    expect(p.notes.join(" ")).toMatch(/dana/i);
    // Whose it is, said once (review 2).
    expect(p.notes.filter((n) => /not you/.test(n)).length).toBe(1);
    await lead.confirm(p);
    expect(await lead.notes.editedTo!(["dana@cooptimize.example"], "2026-11-01T00:00:00Z")).toEqual([expect.objectContaining({ itemId: 501 })]);
  });
});
