// Step 14: DevOps writes through the write framework, against a fake dev.azure.com. Client orgs are fakes only.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { BATCH_LIMIT, createOps, identityFrom, identityMatches, onOrg, stateOps, targetDateOps, undoTops, type DevOpsWriteEntry } from "../plan/devopswrite.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { basic, COMPANY_PAT, fakeDevOpsWrite, OTHER_PAT, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { clearDevopsPreviews, type DevOpsPreview, type DevOpsResult } from "./devops-write-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

const NOW = "2026-11-02T14:00:00Z";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');
const COOP = "Cooptimize";
const CSC = "CSC";

function setup(opts: { email?: string | null; acceptance?: boolean } = {}) {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW, ...(opts.acceptance === false ? { acceptance: false } : {}) });
  dv.add(437, { "System.WorkItemType": "Feature", "System.Title": "Need Features Here", "System.State": "Active", "System.AssignedTo": { uniqueName: "tanner@cooptimize.example" } });
  dv.add(500, { "System.WorkItemType": "User Story", "System.Title": "Import mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: "tanner@cooptimize.example" } }, 437);
  dv.add(600, { "System.WorkItemType": "Epic", "System.Title": "Platform", "System.State": "Active", "System.AssignedTo": { uniqueName: "tanner@cooptimize.example" } });
  dv.add(601, { "System.WorkItemType": "Feature", "System.Title": "Dana's feature", "System.State": "Active", "System.AssignedTo": { uniqueName: "dana@cooptimize.example" } }, 600);
  const logs: unknown[] = [];
  const writer = createDevOpsWriter({ fetch: dv.fetch, log: (e) => void logs.push(e) });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const keyring = new Map<string, string>();
  const targetCalls: { keys: string[]; withPat: boolean | undefined }[] = [];
  const target = (clientKey: string, org: string, withPat: boolean): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org, project: `${clientKey} Project`, projectName: `${clientKey} Project`, email: clientKey === COOP ? (opts.email === undefined ? "tanner@cooptimize.example" : opts.email) : "tanner@csc.example", pat: withPat ? new Pat(COMPANY_PAT) : null });
  const forgotten: string[] = [];
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(base) }),
    makeDataverse: () => ({
      devopsTargets: async (keys: string[], o: { withPat?: boolean } = {}) => {
        targetCalls.push({ keys, withPat: o.withPat });
        const withPat = o.withPat !== false;
        return { ok: true, targets: keys.map((k) => target(k, k === COOP ? "cooptimize" : "cscorg", withPat)) };
      },
    }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({ forget: (k: string) => void forgotten.push(k) }) as never,
    saveSystemUserId: async () => {},
    now: () => NOW,
    plan,
    devopsWriter: writer,
    writePats: { get: async (k) => { const v = keyring.get(k); if (!v) throw new Error("not found"); return new Pat(v); }, set: async (k, v) => void keyring.set(k, v), clear: async (k) => void keyring.delete(k) },
  };
  const run = async <T = unknown>(action: string, input: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const fail = async (action: string, input: unknown) => {
    const r = await dispatch(c, { action, input });
    if (r.ok) throw new Error("expected failure");
    return r;
  };
  const enable = () => run("devops.set_write_pat", { clientKey: COOP, pat: WRITE_PAT });
  const preview = async (change: Record<string, unknown>, clientKey = COOP) => (await run<{ preview: DevOpsPreview }>("devops.preview", { clientKey, change })).preview;
  const confirm = (p: DevOpsPreview) => run<DevOpsResult>("devops.confirm", { previewId: p.previewId });
  const write = async (change: Record<string, unknown>) => confirm(await preview(change));
  return { dv, plan, run, fail, enable, preview, confirm, write, keyring, logs, targetCalls, forgotten };
}
type S = ReturnType<typeof setup>;
const patches = (s: S) => s.dv.writes().filter((w) => w.method === "PATCH");

describe("pure request shapes", () => {
  it("a state change tests /rev first, then replaces the state and adds the comment to history", () => {
    expect(stateOps(7, "Closed", "Done & shipped")).toEqual([
      { op: "test", path: "/rev", value: 7 },
      { op: "replace", path: "/fields/System.State", value: "Closed" },
      { op: "add", path: "/fields/System.History", value: "<div>Done &amp; shipped</div>" },
    ]);
  });
  it("a target date is midnight in my zone; clearing removes the field", () => {
    expect(targetDateOps(4, "Microsoft.VSTS.Scheduling.TargetDate", "2026-11-20", "America/New_York", false)).toEqual([{ op: "test", path: "/rev", value: 4 }, { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.TargetDate", value: "2026-11-20T05:00:00Z" }]);
    expect(targetDateOps(5, "X.Y", null, "America/New_York", true)).toEqual([{ op: "test", path: "/rev", value: 5 }, { op: "remove", path: "/fields/X.Y" }]);
  });
  it("a create adds the parent with Hierarchy-Reverse to the org's work item API url, and acceptance only when the type has it", () => {
    const ops = createOps({ org: "cooptimize", title: "T", description: "d", acceptance: "a", acField: false, assignedTo: "me@x", areaPath: "A", iterationPath: "I", parentId: 437 });
    expect(ops.at(-1)).toEqual({ op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/cooptimize/_apis/wit/workItems/437" } });
    expect(ops.some((o) => o.path.includes("AcceptanceCriteria"))).toBe(false);
    expect(createOps({ org: "cooptimize", title: "T", acceptance: "a", acField: true, assignedTo: "me@x", areaPath: "A", iterationPath: "I", parentId: 1 }).some((o) => o.path === "/fields/Microsoft.VSTS.Common.AcceptanceCriteria")).toBe(true);
    expect(() => createOps({ org: "evil.com/x", title: "T", acField: false, assignedTo: "m", areaPath: "A", iterationPath: "I", parentId: 1 })).toThrow();
  });
  it("identity: anonymous or unshaped is null; match ignores case", () => {
    expect(identityFrom({ authenticatedUser: { id: "aa442b8a-0cd8-4c3e-a0b5-9b0f84d5f0bc", properties: { Account: { $value: "a@b" } } } })).toBeNull();
    expect(identityFrom({})).toBeNull();
    expect(identityMatches({ id: "1", name: "T", email: "Tanner@X.com" }, "tanner@x.com")).toBe(true);
    expect(identityMatches({ id: "1", name: "T", email: "tanner@x.org" }, "tanner@x.com")).toBe(false);
    expect(identityMatches(null, "a@b")).toBe(false);
  });
  it("URLs are checked against the org host", () => {
    expect(onOrg("https://dev.azure.com/cooptimize/p/_workitems/edit/1", "Cooptimize")).toBe(true);
    expect(onOrg("https://dev.azure.com/other/p/_workitems/edit/1", "cooptimize")).toBe(false);
    expect(onOrg("https://x@dev.azure.com/cooptimize/", "cooptimize")).toBe(false);
    expect(onOrg("http://dev.azure.com/cooptimize/", "cooptimize")).toBe(false);
  });
  it("undo is a stack per item", () => {
    const e = (id: number, op: DevOpsWriteEntry["op"], undoneBy: number | null = null) => ({ id, op, org: "o", itemId: 9, status: "confirmed", undoneBy }) as DevOpsWriteEntry;
    expect(undoTops([e(3, "state"), e(2, "comment"), e(1, "create")]).get("o#9")).toBe(3);
    expect(undoTops([e(4, "undo_state"), e(3, "state", 4), e(2, "comment"), e(1, "create")]).get("o#9")).toBe(2);
  });
});

describe("write identity", () => {
  let s: S;
  beforeEach(() => (s = setup()));
  it("checks the PAT with a read-only call and keeps it only when it is my identity for that client", async () => {
    const r = await s.enable() as { write: { name: string; email: string } };
    expect(r.write).toMatchObject({ name: "Tanner Spaulding", email: "tanner@cooptimize.example" });
    expect(s.keyring.get(COOP)).toBe(WRITE_PAT);
    expect(s.dv.seen.map((x) => `${x.method} ${new URL(x.url).pathname}`)).toEqual(["GET /cooptimize/_apis/connectionData"]);
    expect(JSON.stringify(r)).not.toContain(WRITE_PAT);
  });
  it("refuses someone else's PAT and saves nothing", async () => {
    const r = await s.fail("devops.set_write_pat", { clientKey: COOP, pat: OTHER_PAT });
    expect(r).toMatchObject({ status: 422, code: "identity_mismatch" });
    if (!r.ok) expect(r.error).toContain("Dana Ruiz");
    expect(s.keyring.size).toBe(0);
    expect(s.plan.devopsIdentity(COOP)).toBeNull();
  });
  it("refuses a PAT DevOps doesn't accept, and one when my DevOps identity is missing", async () => {
    expect(await s.fail("devops.set_write_pat", { clientKey: COOP, pat: "nope" })).toMatchObject({ status: 422 });
    const t = setup({ email: null });
    expect(await t.fail("devops.set_write_pat", { clientKey: COOP, pat: WRITE_PAT })).toMatchObject({ status: 409 });
    expect(t.keyring.size).toBe(0);
  });
  it("without a write PAT every write is refused before any DevOps call, with the enable hint", async () => {
    const r = await s.fail("devops.preview", { clientKey: COOP, change: { kind: "comment", itemId: 500, text: "hi" } });
    expect(r).toMatchObject({ status: 409, code: "no_write_pat" });
    expect(s.dv.seen).toHaveLength(0);
  });
  it("the write path never reads the company PAT: targets are read with withPat false, and every write is authorized by my PAT", async () => {
    await s.enable();
    await s.write({ kind: "state", itemId: 500, state: "Resolved" });
    await s.write({ kind: "comment", itemId: 500, text: "Note" });
    expect(s.targetCalls.length).toBeGreaterThan(0);
    expect(s.targetCalls.every((t) => t.withPat === false)).toBe(true);
    expect(s.dv.seen.every((x) => x.authorization === basic(WRITE_PAT))).toBe(true);
    expect(s.dv.seen.some((x) => x.authorization === basic(COMPANY_PAT))).toBe(false);
  });
  it("never logs or returns the PAT", async () => {
    await s.enable();
    const log = await s.run("devops.log", {});
    const status = await s.run("devops.write_status", {});
    for (const v of [log, status, s.logs]) expect(JSON.stringify(v)).not.toContain(WRITE_PAT);
  });
  it("clear forgets the PAT and the identity", async () => {
    await s.enable();
    await s.run("devops.clear_write_pat", { clientKey: COOP });
    expect(s.keyring.size).toBe(0);
    expect(s.plan.devopsIdentity(COOP)).toBeNull();
  });
});

describe("each write", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
    s.dv.seen.length = 0;
  });
  it("state: preview names org, project, item, before and after, identity and visibility; confirm sends the rev test and reads back", async () => {
    const p = await s.preview({ kind: "state", itemId: 500, state: "Closed", comment: "Shipped" });
    expect(p).toMatchObject({ system: "DevOps", org: "cooptimize", project: "Cooptimize Project", item: "#500 Import mapping", identity: "Tanner Spaulding <tanner@cooptimize.example>" });
    expect(p.fields).toContainEqual({ label: "State", before: "Active", after: "Closed", changed: true });
    expect(p.visibility).toContain("Visible to everyone");
    expect(s.dv.writes()).toHaveLength(0);
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const [w] = patches(s);
    expect(w!.contentType).toBe("application/json-patch+json");
    expect(w!.url).toContain("api-version=7.1");
    expect((w!.body as unknown[])[0]).toEqual({ op: "test", path: "/rev", value: 3 });
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Closed");
    expect(r.entry.commentId).not.toBeNull();
    // Read back: a GET after the PATCH.
    const after = s.dv.seen.slice(s.dv.seen.indexOf(w!) + 1);
    expect(after.some((x) => x.method === "GET" && x.url.includes("/workitems/500"))).toBe(true);
  });
  it("state must be a state of the item's type", async () => {
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "state", itemId: 500, state: "Done" } })).toMatchObject({ status: 400 });
  });
  it("comment: posted on the preview Comments API with {text} and read back", async () => {
    const r = await s.write({ kind: "comment", itemId: 500, text: "Looks good" });
    expect(r.confirmed).toBe(true);
    const post = s.dv.writes().find((w) => w.method === "POST")!;
    expect(post.url).toContain("/_apis/wit/workItems/500/comments?api-version=7.1-preview.4");
    expect(post.body).toEqual({ text: "Looks good" });
  });
  it("target date: only on a feature or epic assigned to me, in the detected field", async () => {
    const r = await s.write({ kind: "target_date", itemId: 437, date: "2026-11-20" });
    expect(r.confirmed).toBe(true);
    expect(s.dv.items.get(437)!.fields["Microsoft.VSTS.Scheduling.TargetDate"]).toBe("2026-11-20T05:00:00Z");
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 601, date: "2026-11-20" } })).toMatchObject({ status: 409 });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 500, date: "2026-11-20" } })).toMatchObject({ status: 409 });
  });
  it("create a story from a draft: type from the requirement backlog, parent link, me, area and iteration from the parent", async () => {
    const d = s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "[Coopilot test] safe to remove", size: "S" });
    const p = await s.preview({ kind: "create", draftId: d.id, description: "Desc", acceptance: "AC" });
    expect(p.item).toBe("New User Story: [Coopilot test] safe to remove");
    expect(p.links[0]).toContain("#437");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const post = s.dv.writes().find((w) => w.method === "POST")!;
    expect(new URL(post.url).pathname).toBe("/cooptimize/Cooptimize%20Project/_apis/wit/workitems/$User%20Story");
    const ops = post.body as { path: string; value: unknown }[];
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.AssignedTo", value: "tanner@cooptimize.example" });
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.AreaPath", value: "Cooptimize\\Ops" });
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.IterationPath", value: "Cooptimize\\Sprint 9" });
    expect(ops.find((o) => o.path === "/relations/-")!.value).toEqual({ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/cooptimize/_apis/wit/workItems/437" });
    expect(ops.some((o) => o.path === "/fields/Microsoft.VSTS.Common.AcceptanceCriteria")).toBe(true);
    expect(s.forgotten).toContain(COOP);
  });
  it("create a feature from a draft feature: under an epic only", async () => {
    const ok = s.plan.addDraft({ clientKey: COOP, parentItemId: 600, title: "New feature", size: "M", level: "feature" });
    expect((await s.write({ kind: "create", draftId: ok.id })).confirmed).toBe(true);
    const wrong = s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "Feature under a feature", size: "M", level: "feature" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "create", draftId: wrong.id } })).toMatchObject({ status: 409 });
    const orphan = s.plan.addDraft({ clientKey: COOP, parentItemId: null, title: "No parent", size: "M" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "create", draftId: orphan.id } })).toMatchObject({ status: 409 });
  });
  it("no acceptance criteria field: none is sent", async () => {
    const t = setup({ acceptance: false });
    await t.enable();
    const d = t.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "S", size: "S" });
    await t.write({ kind: "create", draftId: d.id, acceptance: "AC" });
    expect((t.dv.writes().find((w) => w.method === "POST")!.body as { path: string }[]).some((o) => o.path.includes("Acceptance"))).toBe(false);
  });
});

describe("guardrails", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  it("rev conflict: the item changed after the preview; nothing is written, what changed is shown", async () => {
    const p = await s.preview({ kind: "state", itemId: 500, state: "Closed" });
    s.dv.touch(500, { "System.State": "Resolved" });
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(false);
    expect(r.entry.status).toBe("refused");
    expect(r.changed).toEqual([{ field: "State", was: "Active", now: "Resolved" }]);
    expect(r.message).toContain("Reload");
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Resolved");
  });
  it("read back: an answer lost after the write is unconfirmed; Retry adopts it without writing twice", async () => {
    s.dv.fail("PATCH", /workitems\/500$/, "lost");
    const r = await s.write({ kind: "state", itemId: 500, state: "Closed" });
    expect(r.confirmed).toBe(false);
    expect(r.entry.status).toBe("unconfirmed");
    const n = patches(s).length;
    const again = await s.run<DevOpsResult>("devops.retry", { id: r.entry.id });
    expect(again.confirmed).toBe(true);
    expect(patches(s).length).toBe(n);
  });
  it("a lost create answer: Retry finds the item under the parent and doesn't create a second", async () => {
    const d = s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "Once only", size: "S" });
    s.dv.fail("POST", /\$User%20Story$/, "lost");
    const r = await s.write({ kind: "create", draftId: d.id });
    expect(r.confirmed).toBe(false);
    const again = await s.run<DevOpsResult>("devops.retry", { id: r.entry.id });
    expect(again.confirmed).toBe(true);
    expect([...s.dv.items.values()].filter((i) => i.fields["System.Title"] === "Once only")).toHaveLength(1);
  });
  it("a lost comment answer: Retry finds the posted comment", async () => {
    s.dv.fail("POST", /comments$/, "lost");
    const r = await s.write({ kind: "comment", itemId: 500, text: "Only once" });
    expect(r.confirmed).toBe(false);
    expect((await s.run<DevOpsResult>("devops.retry", { id: r.entry.id })).confirmed).toBe(true);
    expect(s.dv.comments.get(500)!.filter((c) => c.text === "Only once")).toHaveLength(1);
  });
  it("at most 10 changes in one preview and one confirm", async () => {
    const changes = Array.from({ length: BATCH_LIMIT + 1 }, () => ({ kind: "comment", itemId: 500, text: "x" }));
    expect(await s.fail("devops.preview", { clientKey: COOP, changes })).toMatchObject({ status: 400 });
    expect(await s.fail("devops.confirm", { previewIds: Array.from({ length: 11 }, (_, i) => `p${i}`) })).toMatchObject({ status: 400 });
    const ok = await s.run<{ previews: DevOpsPreview[] }>("devops.preview", { clientKey: COOP, changes: changes.slice(0, 10) });
    expect(ok.previews).toHaveLength(10);
  });
  it("client isolation: a client without its own write PAT can't be written, and Cooptimize's PAT never goes to its org", async () => {
    s.dv.seen.length = 0;
    expect(await s.fail("devops.preview", { clientKey: CSC, change: { kind: "state", itemId: 500, state: "Closed" } })).toMatchObject({ code: "no_write_pat" });
    expect(s.dv.seen).toHaveLength(0);
    const r = await s.write({ kind: "comment", itemId: 500, text: "x" });
    expect(await s.fail("devops.preview", { clientKey: CSC, change: { kind: "undo", writeId: r.entry.id } })).toMatchObject({ code: "no_write_pat" });
    // Every request went to Cooptimize's own org.
    expect(s.dv.seen.every((x) => new URL(x.url).pathname.startsWith("/cooptimize/"))).toBe(true);
  });
  it("a preview expires and can't be confirmed twice", async () => {
    const p = await s.preview({ kind: "comment", itemId: 500, text: "x" });
    await s.confirm(p);
    expect(await s.fail("devops.confirm", { previewId: p.previewId })).toMatchObject({ status: 410 });
  });
});

describe("undo of each kind", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  const undo = async (id: number) => s.write({ kind: "undo", writeId: id });
  it("the live sequence: create, comment, state, then undo state, comment and create (Removed, draft and picks back)", async () => {
    const d = s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "[Coopilot test] safe to remove", size: "S" });
    const pick = s.plan.addPick({ date: "2026-11-03", half: "AM", clientKey: COOP, kind: "draft", draftId: d.id, title: d.title, size: "S" } as never);
    const created = await s.write({ kind: "create", draftId: d.id });
    const id = created.entry.itemId!;
    // Draft replaced everywhere it was referenced: its pick is now the item, and the draft left the lists.
    expect(s.plan.getPick(pick.id)).toMatchObject({ kind: "item", itemId: id, draftId: null, itemUrl: `https://dev.azure.com/cooptimize/Cooptimize%20Project/_workitems/edit/${id}` });
    expect(s.plan.drafts().some((x) => x.id === d.id)).toBe(false);
    const comment = await s.write({ kind: "comment", itemId: id, text: "Coopilot write check" });
    const state = await s.write({ kind: "state", itemId: id, state: "Active" });
    // Only the newest change can be undone first.
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: created.entry.id } })).toMatchObject({ status: 409 });
    expect((await undo(state.entry.id)).confirmed).toBe(true);
    expect(s.dv.items.get(id)!.fields["System.State"]).toBe("New");
    expect((await undo(comment.entry.id)).confirmed).toBe(true);
    expect(s.dv.comments.get(id)!.find((c) => c.id === comment.entry.commentId)!.isDeleted).toBe(true);
    const removed = await undo(created.entry.id);
    expect(removed.confirmed).toBe(true);
    expect(s.dv.items.get(id)!.fields["System.State"]).toBe("Removed");
    expect(s.dv.items.has(id)).toBe(true); // never deleted
    expect(s.plan.getPick(pick.id)).toMatchObject({ kind: "draft", draftId: d.id, itemId: null });
    expect(s.plan.drafts().some((x) => x.id === d.id)).toBe(true);
    // #437 only gained the child link.
    expect(s.dv.writes().filter((w) => w.url.includes("/workitems/437"))).toHaveLength(0);
  });
  it("undo of a state change that came with a comment deletes that comment too", async () => {
    const r = await s.write({ kind: "state", itemId: 500, state: "Closed", comment: "Done" });
    await undo(r.entry.id);
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Active");
    expect(s.dv.comments.get(500)!.find((c) => c.id === r.entry.commentId)!.isDeleted).toBe(true);
  });
  it("undo of a target date restores the prior value (none: the field is removed)", async () => {
    const r = await s.write({ kind: "target_date", itemId: 437, date: "2026-11-20" });
    await undo(r.entry.id);
    expect(s.dv.items.get(437)!.fields["Microsoft.VSTS.Scheduling.TargetDate"]).toBeUndefined();
  });
  it("undo refuses when DevOps shows another value now", async () => {
    const r = await s.write({ kind: "state", itemId: 500, state: "Closed" });
    s.dv.touch(500, { "System.State": "Active" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r.entry.id } })).toMatchObject({ status: 409, code: "changed" });
  });
  it("Mark done in DevOps closes the follow-up after read back", async () => {
    const f = s.plan.openRuleFollowUp({ kind: "devops_update", ruleKey: "x:500", clientKey: COOP, who: COOP, what: "Update DevOps #500", itemId: 500 } as never)!;
    const r = await s.write({ kind: "state", itemId: 500, state: "Closed", followUpId: f.id });
    expect(r.confirmed).toBe(true);
    expect(s.plan.getFollowUp(f.id)).toMatchObject({ outcome: "done", closeHow: "devops" });
  });
});
