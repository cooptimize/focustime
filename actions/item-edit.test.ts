// ED-1: item_edit and reparent through the write framework, against the fake dev.azure.com. Orgs, people and text are fakes.
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

const NOW = "2026-11-12T14:00:00Z";
const COOP = "Cooptimize";
const ME = "avery@cooptimize.example";
const PROJECT = "Cooptimize Project";
const cfgText = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', `my_email = "${ME}"`);
const who = (email: string) => ({ uniqueName: email, displayName: email.split("@")[0] });
const AC = "Microsoft.VSTS.Common.AcceptanceCriteria";

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
      staged: async () => [], conflict: async () => {}, landed: async () => {}, setHalf: async () => {},
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

describe("ED-1 devops.edit_offer", () => {
  it("reads the item with my write PAT: its rev, the light text, acceptance only where the type has it, and the level above", async () => {
    const s = setup();
    await s.enable();
    const o = await s.offer(500);
    expect(o).toMatchObject({ itemId: 500, rev: rev(s, 500), canEdit: true, titleMax: 255, parent: { id: 437 }, parentTypes: ["Feature"] });
    expect(o.description).toMatchObject({ editable: true, format: "html", text: "Map the **columns**.\n- Name\n- Date" });
    expect(o.acceptance).toMatchObject({ editable: true, text: "" });
    // A feature in this process has no acceptance criteria field.
    expect((await s.offer(437)).acceptance).toBeNull();
    // The top level has nothing above it.
    expect((await s.offer(600)).parentTypes).toEqual([]);
    // Never the company read PAT on this path.
    expect(s.targetCalls.every((x) => x === false)).toBe(true);
    expect(s.dv.seen.every((x) => x.authorization !== new Pat(COMPANY_PAT).basicAuth())).toBe(true);
  });
  it("a table makes the description not editable here, with the reason", async () => {
    const s = setup({ lead: true });
    await s.enable();
    expect((await s.offer(502)).description).toMatchObject({ editable: false, why: "This has a table or an image, so it can't be changed here without losing it." });
  });
  it("rights: owner, parent's owner and a lead may; someone else and an automation account may not, with the card's words", async () => {
    const s = setup();
    await s.enable();
    expect((await s.offer(500)).canEdit).toBe(true); // mine
    expect((await s.offer(501)).canEdit).toBe(true); // under my feature
    expect(await s.offer(502)).toMatchObject({ canEdit: false, editNote: "Only Cooptimize's leads and the owner can change this." });
    const lead = setup({ lead: true });
    await lead.enable();
    expect((await lead.offer(502)).canEdit).toBe(true);
    const bot = setup({ lead: true, automation: true });
    await bot.enable();
    expect(await bot.offer(500)).toMatchObject({ canEdit: false, editNote: "Automation accounts don't change DevOps from FocusTime." });
  });
  it("without my write token: no offer, with the reason", async () => {
    const s = setup({ noPat: true });
    const r = await s.run<{ offer: null; why: string; code: string }>("devops.edit_offer", { clientKey: COOP, itemId: 500 });
    expect(r).toMatchObject({ offer: null, code: "no_write_pat" });
  });
});

describe("ED-1 item_edit", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  it("only the changed parts are in the patch, behind the rev the card read", async () => {
    const r = await s.preview({ kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "Import column mapping", description: "Map the **columns**.\n- Name\n- Date" });
    const p = r.preview!;
    expect(p.summary).toBe("Edit a DevOps item's title, description or acceptance criteria");
    expect(p.fields).toEqual([expect.objectContaining({ label: "Title", before: "Import mapping", after: "Import column mapping", changed: true })]);
    const res = await s.confirm(p);
    expect(res.confirmed).toBe(true);
    const [ops] = s.patches();
    expect(ops).toEqual([{ op: "test", path: "/rev", value: 3 }, { op: "add", path: "/fields/System.Title", value: "Import column mapping" }]);
    expect(res.entry).toMatchObject({ op: "item_edit", status: "confirmed", before: { Title: "Import mapping" }, after: { Title: "Import column mapping" } });
    // The read back went straight into the central store.
    expect(s.stored.at(-1)).toMatchObject({ id: 500 });
  });
  it("title, description and acceptance in one patch; description and acceptance shown as they will read", async () => {
    const p = (await s.preview({ kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "Mapping", description: "Map *every* column:\n- Name\n  - first and last\n- Date", acceptance: "Given a file with 3 columns, all 3 are mapped." })).preview!;
    expect(p.looks?.map((l) => l.label)).toEqual(["Description", "Acceptance criteria"]);
    expect(p.looks![0]!.after).toBe("<div>Map <em>every</em> column:</div><ul><li>Name<ul><li>first and last</li></ul></li><li>Date</li></ul>");
    expect(p.notes.join(" ")).toContain(`Written only if the item is still at revision ${rev(s, 500)}`);
    await s.confirm(p);
    const ops = s.patches()[0]!;
    expect(ops.map((x) => x.path)).toEqual(["/rev", "/fields/System.Title", "/fields/System.Description", `/fields/${AC}`]);
    expect(s.dv.items.get(500)!.fields[AC]).toBe("<div>Given a file with 3 columns, all 3 are mapped.</div>");
  });
  it("nothing changed: nothing written", async () => {
    expect(await s.preview({ kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "Import mapping", description: "Map the **columns**.\n- Name\n- Date" })).toEqual({ nothing: "Nothing changed on #500" });
    expect(s.patches()).toEqual([]);
  });
  it("a changed revision writes nothing and says so (code changed); the offer then has the current values", async () => {
    const was = rev(s, 500);
    s.dv.touch(500, { "System.Title": "Renamed by a teammate" });
    const r = await s.fail("devops.preview", { clientKey: COOP, change: { kind: "item_edit", itemId: 500, rev: was, title: "Mine" } });
    expect(r).toMatchObject({ status: 409, code: "changed", error: expect.stringContaining("This changed in DevOps since you opened it") });
    expect(s.patches()).toEqual([]);
    expect((await s.offer(500)).title).toBe("Renamed by a teammate");
    // Between preview and confirm too: the rev test refuses it and nothing lands.
    const p = (await s.preview({ kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "Mine" })).preview!;
    s.dv.touch(500, { "System.State": "Resolved" });
    const c = await s.confirm(p);
    expect(c.confirmed).toBe(false);
    expect(s.dv.items.get(500)!.fields["System.Title"]).toBe("Renamed by a teammate");
  });
  it("an empty title is refused; acceptance only on a type that has it; no text field: refused", async () => {
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "   " } })).toMatchObject({ status: 400, error: "Type a title" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "x".repeat(256) } })).toMatchObject({ status: 400 });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "item_edit", itemId: 437, rev: rev(s, 437), acceptance: "Done when done" } })).toMatchObject({ status: 409, code: "no_field" });
  });
  it("a description FocusTime can't keep is refused on the server, whatever the browser sends", async () => {
    const lead = setup({ lead: true });
    await lead.enable();
    expect(await lead.fail("devops.preview", { clientKey: COOP, change: { kind: "item_edit", itemId: 502, rev: rev(lead, 502), description: "a" } })).toMatchObject({ status: 409, code: "not_editable" });
    // Add to the end still works, and keeps the table.
    const r = await lead.write({ kind: "description_update", itemId: 502, rev: rev(lead, 502), text: "Also: **dates**." });
    expect(r.confirmed).toBe(true);
    expect(lead.dv.items.get(502)!.fields["System.Description"]).toBe("<table><tr><td>a</td></tr></table><div><br></div><div>Also: <strong>dates</strong>.</div>");
    const u = await lead.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect(lead.dv.items.get(502)!.fields["System.Description"]).toBe("<table><tr><td>a</td></tr></table>");
  });
  it("fonts and colors: flagged in the preview", async () => {
    s.dv.touch(500, { "System.Description": '<div><span style="font-family: Segoe UI; color: #333">Old words</span></div>' });
    const p = (await s.preview({ kind: "item_edit", itemId: 500, rev: rev(s, 500), description: "New words" })).preview!;
    expect(p.notes[0]).toBe("Fonts and colors from the old text will be removed.");
  });
  it("a Markdown-stored field is written back as Markdown, with its format kept", async () => {
    s.dv.items.get(500)!.formats = { "System.Description": "markdown" };
    s.dv.touch(500, { "System.Description": "# Plan\n\n- one" });
    const o = await s.offer(500);
    expect(o.description).toMatchObject({ format: "markdown", text: "# Plan\n\n- one" });
    const r = await s.write({ kind: "item_edit", itemId: 500, rev: o.rev, description: "# Plan\n\n- one\n- **two**" });
    expect(r.confirmed).toBe(true);
    const ops = s.patches()[0]!;
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.Description", value: "# Plan\n\n- one\n- **two**" });
    expect(ops).toContainEqual({ op: "add", path: "/multilineFieldsFormat/System.Description", value: "markdown" });
    expect(s.dv.seen.filter((x) => x.method === "PATCH").every((x) => x.url.includes("api-version=7.2-preview.3"))).toBe(true);
    expect(s.dv.items.get(500)!.formats).toEqual({ "System.Description": "markdown" });
  });
  it("rights on the server: someone else's item and an automation account are refused before anything is written", async () => {
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "item_edit", itemId: 502, rev: rev(s, 502), title: "Mine" } })).toMatchObject({ status: 403, code: "read_only" });
    const bot = setup({ lead: true, automation: true });
    await bot.enable();
    expect(await bot.fail("devops.preview", { clientKey: COOP, change: { kind: "item_edit", itemId: 500, rev: rev(bot, 500), title: "Mine" } })).toMatchObject({ status: 403 });
    expect([...s.patches(), ...bot.patches()]).toEqual([]);
  });
  it("undo restores each part, and is refused after a later change", async () => {
    const r = await s.write({ kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "New", description: "New text", acceptance: "One example" });
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    const f = s.dv.items.get(500)!.fields;
    expect(f["System.Title"]).toBe("Import mapping");
    expect(f["System.Description"]).toBe("<div>Map the <b>columns</b>.</div><ul><li>Name</li><li>Date</li></ul>");
    expect(f[AC]).toBeUndefined();
    const r2 = await s.write({ kind: "item_edit", itemId: 500, rev: rev(s, 500), description: "Second" });
    s.dv.touch(500, { "System.Description": "<div>Second</div><table><tr><td>x</td></tr></table>" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r2.entry.id } })).toMatchObject({ status: 409, code: "changed" });
  });
  it("the note to the owner goes once a day and only to a Cooptimizer", async () => {
    const p = (await s.preview({ kind: "item_edit", itemId: 501, rev: rev(s, 501), title: "Dana's story, renamed" })).preview!;
    expect(p.notes.join(" ")).toContain("They get a quiet note in FocusTime that you edited it.");
    await s.confirm(p);
    await s.write({ kind: "item_edit", itemId: 501, rev: rev(s, 501), title: "Renamed again" });
    expect(await s.notes.editedTo!(["dana@cooptimize.example"], "2026-11-01T00:00:00Z")).toEqual([expect.objectContaining({ itemId: 501, byName: "Sam Tester" })]);
    // Someone outside Cooptimize gets nothing, and the preview doesn't promise it.
    const g = (await s.preview({ kind: "item_edit", itemId: 503, rev: rev(s, 503), title: "Guest's story, renamed" })).preview!;
    expect(g.notes.join(" ")).not.toContain("quiet note");
    await s.confirm(g);
    expect(await s.notes.editedTo!(["guest@client.example"], "2026-11-01T00:00:00Z")).toEqual([]);
    // My own item: no note.
    await s.write({ kind: "item_edit", itemId: 500, rev: rev(s, 500), title: "Mine renamed" });
    expect(await s.notes.editedTo!([ME], "2026-11-01T00:00:00Z")).toEqual([]);
  });
});

describe("ED-1 reparent", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  const parentsOf = (id: number) => s.dv.items.get(id)!.relations.filter((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse").map((r) => Number(r.url.split("/").pop()));
  it("old link out and new link in, in one patch behind the rev; only the link changes", async () => {
    s.dv.items.get(500)!.relations.push({ rel: "Related", url: "https://dev.azure.com/cooptimize/_apis/wit/workItems/600" });
    const before = structuredClone(s.dv.items.get(500)!.fields);
    const p = (await s.preview({ kind: "reparent", itemId: 500, rev: rev(s, 500), parentId: 438 })).preview!;
    expect(p.fields).toEqual([expect.objectContaining({ label: "Parent", before: "#437 Import", after: "#438 Export" })]);
    expect(p.notes.join(" ")).toContain("Only the parent link changes. Area, iteration, state, dates, assignee and backlog order stay as they are.");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(s.patches()[0]).toEqual([
      { op: "test", path: "/rev", value: 3 },
      { op: "remove", path: "/relations/0" },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/cooptimize/_apis/wit/workItems/438" } },
    ]);
    expect(parentsOf(500)).toEqual([438]);
    const after = s.dv.items.get(500)!.fields;
    for (const k of Object.keys(before)) if (k !== "System.Parent" && k !== "System.ChangedDate") expect(after[k]).toEqual(before[k]);
    expect(s.dv.items.get(500)!.relations.some((x) => x.rel === "Related")).toBe(true);
    // The store hears the new parent at once.
    expect(s.stored.at(-1)!.fields["System.Parent"]).toBe(438);
  });
  it("No parent removes the link only; the store hears null", async () => {
    const r = await s.write({ kind: "reparent", itemId: 500, rev: rev(s, 500), parentId: null });
    expect(r.confirmed).toBe(true);
    expect(parentsOf(500)).toEqual([]);
    expect(s.stored.at(-1)!.fields["System.Parent"]).toBeNull();
    expect(s.patches()[0]).toEqual([{ op: "test", path: "/rev", value: rev(s, 500) - 1 }, { op: "remove", path: "/relations/0" }]);
  });
  it("refused on the server whatever the browser sends: wrong level, closed, another project, itself, unknown", async () => {
    const r = (parentId: number) => s.fail("devops.preview", { clientKey: COOP, change: { kind: "reparent", itemId: 500, rev: rev(s, 500), parentId } });
    expect(await r(600)).toMatchObject({ status: 409, code: "wrong_level" }); // an epic: two levels up
    expect(await r(501)).toMatchObject({ status: 409, code: "wrong_level" }); // a story
    expect(await r(439)).toMatchObject({ status: 409, code: "closed_parent" });
    expect(await r(700)).toMatchObject({ status: 409, error: expect.stringContaining("isn't in Cooptimize's project") });
    expect(await r(500)).toMatchObject({ status: 409, error: "An item can't be its own parent" });
    expect(await r(9999)).toMatchObject({ status: 409 });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "reparent", itemId: 600, rev: rev(s, 600), parentId: 437 } })).toMatchObject({ code: "no_parent_level" });
    expect(s.patches()).toEqual([]);
  });
  it("a failed move leaves the item with its one parent (never two, never none)", async () => {
    const p = (await s.preview({ kind: "reparent", itemId: 500, rev: rev(s, 500), parentId: 438 })).preview!;
    // Someone else moved it meanwhile: the rev test refuses the whole patch.
    s.dv.touch(500, { "System.Title": "Touched" });
    const c = await s.confirm(p);
    expect(c.confirmed).toBe(false);
    expect(parentsOf(500)).toEqual([437]);
  });
  it("rights: a story under someone else's feature is refused", async () => {
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "reparent", itemId: 502, rev: rev(s, 502), parentId: 437 } })).toMatchObject({ status: 403 });
  });
  it("undo puts the old parent back; refused once the parent changed since", async () => {
    const r = await s.write({ kind: "reparent", itemId: 500, rev: rev(s, 500), parentId: 438 });
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect(parentsOf(500)).toEqual([437]);
    const r2 = await s.write({ kind: "reparent", itemId: 500, rev: rev(s, 500), parentId: 438 });
    // A teammate moves it back in DevOps.
    const it = s.dv.items.get(500)!;
    it.relations = it.relations.filter((x) => x.rel !== "System.LinkTypes.Hierarchy-Reverse");
    it.relations.push({ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/cooptimize/_apis/wit/workItems/437" });
    s.dv.touch(500, {});
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r2.entry.id } })).toMatchObject({ status: 409, code: "changed" });
  });
});
