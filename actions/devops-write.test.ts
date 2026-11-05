// Step 14: DevOps writes through the write framework, against a fake dev.azure.com. Client orgs are fakes only.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { BATCH_LIMIT, createOps, identityFrom, identityMatches, onOrg, stateOps, targetDateOps, undoTops, type DevOpsWriteEntry } from "../plan/devopswrite.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { basic, COMPANY_PAT, fakeDevOpsWrite, OTHER_PAT, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createPlanStore, openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { IDENTITY_KEY } from "./account.ts";
import { clearDevopsPreviews, type DevOpsPreview, type DevOpsResult } from "./devops-write-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

const NOW = "2026-11-02T14:00:00Z";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');
const COOP = "Cooptimize";
const Adatum = "Adatum";

function setup(opts: { email?: string | null; acceptance?: boolean; startDate?: boolean } = {}) {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW, ...(opts.acceptance === false ? { acceptance: false } : {}), ...(opts.startDate === false ? { startDate: false } : {}) });
  dv.add(437, { "System.WorkItemType": "Feature", "System.Title": "Need Features Here", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } });
  dv.add(500, { "System.WorkItemType": "User Story", "System.Title": "Import mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } }, 437);
  dv.add(600, { "System.WorkItemType": "Epic", "System.Title": "Platform", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } });
  dv.add(601, { "System.WorkItemType": "Feature", "System.Title": "Dana's feature", "System.State": "Active", "System.AssignedTo": { uniqueName: "dana@cooptimize.example" } }, 600);
  const logs: unknown[] = [];
  const writer = createDevOpsWriter({ fetch: dv.fetch, log: (e) => void logs.push(e) });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  // The shared Teams store (its own database here) for creates from a request.
  const teams = createTeamsStore(sqliteConn(openPlanDb({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") })), () => Temporal.Instant.from(NOW));
  const keyring = new Map<string, string>();
  const targetCalls: { keys: string[]; withPat: boolean | undefined }[] = [];
  const target = (clientKey: string, org: string, withPat: boolean): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org, project: `${clientKey} Project`, projectName: `${clientKey} Project`, email: clientKey === COOP ? (opts.email === undefined ? "avery@cooptimize.example" : opts.email) : "avery@adatum.example", pat: withPat ? new Pat(COMPANY_PAT) : null });
  const forgotten: string[] = [];
  const waits: number[] = [];
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(base) }),
    makeDataverse: () => ({
      devopsTargets: async (keys: string[], o: { withPat?: boolean } = {}) => {
        targetCalls.push({ keys, withPat: o.withPat });
        const withPat = o.withPat !== false;
        return { ok: true, targets: keys.map((k) => target(k, k === COOP ? "cooptimize" : "adatumorg", withPat)) };
      },
    }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({ forget: (k: string) => void forgotten.push(k) }) as never,
    saveSystemUserId: async () => {},
    now: () => NOW,
    sleep: async (ms) => void waits.push(ms),
    plan,
    requests: { teams, refresh: async () => ({ polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 }) },
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
  return { dv, plan, teams, run, fail, enable, preview, confirm, write, keyring, logs, targetCalls, forgotten, waits };
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
    expect(identityMatches({ id: "1", name: "T", email: "Avery@X.com" }, "avery@x.com")).toBe(true);
    expect(identityMatches({ id: "1", name: "T", email: "avery@x.org" }, "avery@x.com")).toBe(false);
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
    expect(r.write).toMatchObject({ name: "Sam Tester", email: "avery@cooptimize.example" });
    expect(s.keyring.get(COOP)).toBe(WRITE_PAT);
    expect(s.dv.seen.map((x) => `${x.method} ${new URL(x.url).pathname}`)).toEqual(["GET /cooptimize/_apis/connectionData"]);
    expect(JSON.stringify(r)).not.toContain(WRITE_PAT);
  });
  it("refuses someone else's PAT and saves nothing", async () => {
    const r = await s.fail("devops.set_write_pat", { clientKey: COOP, pat: OTHER_PAT });
    expect(r).toMatchObject({ status: 422, code: "identity_mismatch" });
    if (!r.ok) expect(r.error).toContain("Dana Ruiz");
    expect(s.keyring.size).toBe(0);
    expect((await s.plan.devopsIdentity(COOP))).toBeNull();
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
    expect((await s.plan.devopsIdentity(COOP))).toBeNull();
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
    expect(p).toMatchObject({ system: "DevOps", org: "cooptimize", project: "Cooptimize Project", item: "#500 Import mapping", identity: "Sam Tester <avery@cooptimize.example>" });
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
    const d = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "[FocusTime test] safe to remove", size: "S" }));
    const p = await s.preview({ kind: "create", draftId: d.id, description: "Desc", acceptance: "AC" });
    expect(p.item).toBe("New User Story: [FocusTime test] safe to remove");
    expect(p.links[0]).toContain("#437");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const post = s.dv.writes().find((w) => w.method === "POST")!;
    expect(new URL(post.url).pathname).toBe("/cooptimize/Cooptimize%20Project/_apis/wit/workitems/$User%20Story");
    const ops = post.body as { path: string; value: unknown }[];
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.AssignedTo", value: "avery@cooptimize.example" });
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.AreaPath", value: "Cooptimize\\Ops" });
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.IterationPath", value: "Cooptimize\\Sprint 9" });
    expect(ops.find((o) => o.path === "/relations/-")!.value).toEqual({ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/cooptimize/_apis/wit/workItems/437" });
    expect(ops.some((o) => o.path === "/fields/Microsoft.VSTS.Common.AcceptanceCriteria")).toBe(true);
    expect(s.forgotten).toContain(COOP);
  });
  it("create a feature from a draft feature: under an epic only", async () => {
    const ok = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 600, title: "New feature", size: "M", level: "feature" }));
    expect((await s.write({ kind: "create", draftId: ok.id })).confirmed).toBe(true);
    const wrong = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "Feature under a feature", size: "M", level: "feature" }));
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "create", draftId: wrong.id } })).toMatchObject({ status: 409 });
    const orphan = (await s.plan.addDraft({ clientKey: COOP, parentItemId: null, title: "No parent", size: "M" }));
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "create", draftId: orphan.id } })).toMatchObject({ status: 409 });
  });
  it("step 15.3: a story uses the draft editor's description and acceptance criteria; the preview shows every field", async () => {
    const d = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "Old title", size: "S" }));
    (await s.plan.updateDraft(d.id, { title: "Edited title", description: "Line one\nLine two", acceptance: "Given a file, it imports" }));
    const p = await s.preview({ kind: "create", draftId: d.id });
    expect(p.item).toBe("New User Story: Edited title");
    const rows = Object.fromEntries(p.fields.map((r) => [r.label, r.after]));
    expect(rows).toMatchObject({ Type: "User Story", Title: "Edited title", Description: "Line one\nLine two", "Acceptance criteria": "Given a file, it imports", Area: "Cooptimize\\Ops", Iteration: "Cooptimize\\Sprint 9", Parent: "#437 Need Features Here" });
    expect(rows["Assigned to"]).toContain("avery@cooptimize.example");
    await s.confirm(p);
    const ops = s.dv.writes().find((w) => w.method === "POST")!.body as { path: string; value: unknown }[];
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.Title", value: "Edited title" });
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.Description", value: "<div>Line one</div><div>Line two</div>" });
    expect(ops.find((o) => o.path === "/fields/Microsoft.VSTS.Common.AcceptanceCriteria")!.value).toContain("Given a file, it imports");
  });
  it("step 15.3: a feature sends its start and target dates (midnight in my zone) and the preview shows them", async () => {
    const d = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 600, title: "Dated feature", size: "M", level: "feature" }));
    (await s.plan.updateDraft(d.id, { startDate: "2026-11-09", targetDate: "2026-11-27" }));
    const p = await s.preview({ kind: "create", draftId: d.id });
    const rows = Object.fromEntries(p.fields.map((r) => [r.label, r.after]));
    expect(rows).toMatchObject({ Type: "Feature", "Start date": "2026-11-09", "Target date": "2026-11-27" });
    await s.confirm(p);
    const ops = s.dv.writes().find((w) => w.method === "POST")!.body as { path: string; value: unknown }[];
    expect(ops).toContainEqual({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StartDate", value: "2026-11-09T05:00:00Z" });
    expect(ops).toContainEqual({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.TargetDate", value: "2026-11-27T05:00:00Z" });
  });
  it("step 15.3: a start date the type has no field for is refused, not dropped", async () => {
    const t = setup({ startDate: false });
    await t.enable();
    const d = (await t.plan.addDraft({ clientKey: COOP, parentItemId: 600, title: "F", size: "M", level: "feature" }));
    (await t.plan.updateDraft(d.id, { startDate: "2026-11-09" }));
    expect(await t.fail("devops.preview", { clientKey: COOP, change: { kind: "create", draftId: d.id } })).toMatchObject({ status: 409 });
    expect(t.dv.writes()).toEqual([]);
  });
  it("no acceptance criteria field: none is sent", async () => {
    const t = setup({ acceptance: false });
    await t.enable();
    const d = (await t.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "S", size: "S" }));
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
    const d = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "Once only", size: "S" }));
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
    expect(await s.fail("devops.preview", { clientKey: Adatum, change: { kind: "state", itemId: 500, state: "Closed" } })).toMatchObject({ code: "no_write_pat" });
    expect(s.dv.seen).toHaveLength(0);
    const r = await s.write({ kind: "comment", itemId: 500, text: "x" });
    expect(await s.fail("devops.preview", { clientKey: Adatum, change: { kind: "undo", writeId: r.entry.id } })).toMatchObject({ code: "no_write_pat" });
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
    const d = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "[FocusTime test] safe to remove", size: "S" }));
    const pick = (await s.plan.addPick({ date: "2026-11-03", half: "AM", clientKey: COOP, kind: "draft", draftId: d.id, title: d.title, size: "S" } as never));
    const created = await s.write({ kind: "create", draftId: d.id });
    const id = created.entry.itemId!;
    // Draft replaced everywhere it was referenced: its pick is now the item, and the draft left the lists.
    expect((await s.plan.getPick(pick.id))).toMatchObject({ kind: "item", itemId: id, draftId: null, itemUrl: `https://dev.azure.com/cooptimize/Cooptimize%20Project/_workitems/edit/${id}` });
    expect((await s.plan.drafts()).some((x) => x.id === d.id)).toBe(false);
    const comment = await s.write({ kind: "comment", itemId: id, text: "FocusTime write check" });
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
    expect((await s.plan.getPick(pick.id))).toMatchObject({ kind: "draft", draftId: d.id, itemId: null });
    expect((await s.plan.drafts()).some((x) => x.id === d.id)).toBe(true);
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
  it("step 17, Save dates: Start Date and target date in one patch behind one rev test, read back, undo puts both back", async () => {
    const p = await s.preview({ kind: "target_date", itemId: 437, date: "2026-12-11", startDate: "2026-11-16" });
    expect(p.fields).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Start date", before: null, after: "2026-11-16" }), expect.objectContaining({ label: "Target date", after: "2026-12-11" })]));
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const patches = s.dv.writes().filter((w) => w.method === "PATCH" && w.url.includes("/workitems/437"));
    expect(patches).toHaveLength(1);
    const ops = patches[0]!.body as { op: string; path: string }[];
    expect(ops[0]).toMatchObject({ op: "test", path: "/rev" });
    expect(ops.slice(1).map((o) => o.path)).toEqual(["/fields/Microsoft.VSTS.Scheduling.TargetDate", "/fields/Microsoft.VSTS.Scheduling.StartDate"]);
    expect(s.dv.items.get(437)!.fields).toMatchObject({ "Microsoft.VSTS.Scheduling.StartDate": "2026-11-16T05:00:00Z", "Microsoft.VSTS.Scheduling.TargetDate": "2026-12-11T05:00:00Z" });
    await undo(r.entry.id);
    expect(s.dv.items.get(437)!.fields["Microsoft.VSTS.Scheduling.StartDate"]).toBeUndefined();
    expect(s.dv.items.get(437)!.fields["Microsoft.VSTS.Scheduling.TargetDate"]).toBeUndefined();
  });
  it("step 17, Save dates: refused where the process has no Start Date, on items not assigned to me, or a start after the target", async () => {
    const t = setup({ startDate: false });
    await t.enable();
    expect(await t.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 437, date: "2026-12-11", startDate: "2026-11-16" } })).toMatchObject({ status: 409 });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 601, date: "2026-12-11", startDate: "2026-11-16" } })).toMatchObject({ status: 409 });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 437, date: "2026-11-11", startDate: "2026-11-16" } })).toMatchObject({ status: 400 });
  });
  it("step 17: undo of Save dates refuses when either date changed in DevOps since", async () => {
    const r = await s.write({ kind: "target_date", itemId: 437, date: "2026-12-11", startDate: "2026-11-16" });
    s.dv.touch(437, { "Microsoft.VSTS.Scheduling.StartDate": "2026-11-23T05:00:00Z" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r.entry.id } })).toMatchObject({ status: 409, code: "changed" });
  });
  it("undo refuses when DevOps shows another value now", async () => {
    const r = await s.write({ kind: "state", itemId: 500, state: "Closed" });
    s.dv.touch(500, { "System.State": "Active" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r.entry.id } })).toMatchObject({ status: 409, code: "changed" });
  });
  it("Mark done in DevOps closes the follow-up after read back", async () => {
    const f = (await s.plan.openRuleFollowUp({ kind: "devops_update", ruleKey: "x:500", clientKey: COOP, who: COOP, what: "Update DevOps #500", itemId: 500 } as never))!;
    const r = await s.write({ kind: "state", itemId: 500, state: "Closed", followUpId: f.id });
    expect(r.confirmed).toBe(true);
    expect((await s.plan.getFollowUp(f.id))).toMatchObject({ outcome: "done", closeHow: "devops" });
  });
});

describe("read-back resilience (step 14.5, D255)", () => {
  it("the write lands, the first read-back fails on the network: wait, read again, confirmed with one PATCH", async () => {
    const s = setup();
    await s.enable();
    const p = await s.preview({ kind: "state", itemId: 500, state: "Resolved" });
    s.dv.fail("GET", /workitems\/500$/i, "network");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(s.waits).toEqual([1500]);
    expect(patches(s)).toHaveLength(1);
  });
  it("two network failures in a row: Not confirmed, and Retry adopts it without a second PATCH", async () => {
    const s = setup();
    await s.enable();
    const p = await s.preview({ kind: "state", itemId: 500, state: "Resolved" });
    s.dv.fail("GET", /workitems\/500$/i, "network");
    s.dv.fail("GET", /workitems\/500$/i, "network");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(false);
    expect(r.entry.status).toBe("unconfirmed");
    const again = await s.run<DevOpsResult>("devops.retry", { id: r.entry.id });
    expect(again.confirmed).toBe(true);
    expect(patches(s)).toHaveLength(1);
  });
  it("a create's read-back is retried the same way", async () => {
    const s = setup();
    await s.enable();
    const d = (await s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "Retry me", size: "S" }));
    const p = await s.preview({ kind: "create", draftId: d.id });
    s.dv.fail("GET", /workitems\/\d+$/i, "network");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(s.dv.writes().filter((w) => w.method === "POST" && w.url.includes("$"))).toHaveLength(1);
  });
});

describe("parent first (step 14.5, D257)", () => {
  const it_ = (id: number, tier: "feature" | "epic" | undefined, stateCategory = "InProgress", order: number | null = null) => ({ id, level: "portfolio", ...(tier ? { tier } : {}), stateCategory, order });
  it("a story goes under an open feature, a draft feature under an open epic", async () => {
    const { parentChoices } = await import("../plan/devopswrite.ts");
    const items = [it_(3, "feature", "Completed"), it_(2, "feature", "Proposed", 5), it_(1, undefined, "InProgress", 2), it_(9, "epic"), { id: 7, level: "requirement", stateCategory: "Proposed", order: 1 }];
    expect(parentChoices(items, "story").map((i) => i.id)).toEqual([1, 2]);
    expect(parentChoices(items, "feature").map((i) => i.id)).toEqual([9]);
  });
  it("the server never creates a draft without a parent", async () => {
    const s = setup();
    await s.enable();
    const d = (await s.plan.addDraft({ clientKey: COOP, parentItemId: null, title: "No parent", size: "S" }));
    const r = await s.fail("devops.preview", { clientKey: COOP, change: { kind: "create", draftId: d.id } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(s.dv.writes()).toHaveLength(0);
  });
});

describe("a DevOps item from a request (shared polling)", () => {
  const CHAT = "19:cooptimize-client@thread.v2";
  const TEXT = "The export button fails with an error\nIt happens on every report since Monday.";
  const ME = "00000000-0000-4000-8000-0000000000a1";
  const DANA = { userId: "00000000-0000-4000-8000-0000000000c1", displayName: "Dana Client", email: null, tenantId: "22222222-2222-4222-8222-222222222222" };
  const message = (chatId: string, messageId: string, clientKey: string, text: string) => ({ chatId, messageId, clientKey, senderId: DANA.userId, senderName: null, senderTenant: DANA.tenantId, createdAt: "2026-11-02T13:30:00Z", modifiedAt: "2026-11-02T13:30:00Z", html: null, text, hasImage: false, hasFile: false, replyToId: null, mentions: [], fetchedAt: NOW });
  async function withAsk(s: S, messageId = "1730000000001") {
    if (!(await s.teams.chat(CHAT))) {
      await s.plan.setAccountState(IDENTITY_KEY, { oid: ME, tid: "11111111-1111-4111-8111-111111111111", name: "Avery", username: "avery@cooptimize.example", email: "avery@cooptimize.example", signedInAt: NOW, systemUserId: null, systemUserEmail: null });
      await s.teams.addChat({ chatId: CHAT, clientKey: COOP, kind: "customer", displayName: "Client chat", webUrl: null, members: [DANA, { userId: ME, displayName: "Avery", email: null, tenantId: "11111111-1111-4111-8111-111111111111" }], by: ME });
    }
    await s.teams.saveMessages([message(CHAT, messageId, COOP, TEXT)]);
    await s.teams.addRequest({ chatId: CHAT, messageId, clientKey: COOP, rule: "phrase", ruleDetail: "error", at: "2026-11-02T13:30:00Z" });
    return { kind: "request_create", chatId: CHAT, messageId, level: "bug" };
  }
  const items = (s: S, type: string) => [...s.dv.items.values()].filter((i) => i.fields["System.WorkItemType"] === type);

  it("previews a Bug with no parent: the first line as title, the message, author, time and Teams link as repro steps", async () => {
    const s = setup();
    await s.enable();
    const p = await s.preview(await withAsk(s));
    expect(p.item).toBe("New Bug: The export button fails with an error");
    const f = Object.fromEntries(p.fields.map((x) => [x.label, x.after]));
    expect(f.Type).toBe("Bug");
    expect(f["Repro steps"]).toContain("From Dana Client in Teams, 2026-11-02 08:30.");
    expect(f["Repro steps"]).toContain("https://teams.microsoft.com/l/message/");
    expect(f.Parent).toBeUndefined();
    expect(p.links).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/Nothing is posted in Teams/);
    expect(s.dv.writes()).toHaveLength(0);
  });

  it("confirm creates it, reads it back and resolves the request as created for everyone, by me; a second create is refused", async () => {
    const s = setup();
    await s.enable();
    const change = await withAsk(s);
    const r = await s.write(change);
    expect(r.confirmed).toBe(true);
    const bug = items(s, "Bug")[0]!;
    expect(bug.fields["Microsoft.VSTS.TCM.ReproSteps"]).toContain("every report since Monday");
    expect(bug.fields["System.Parent"]).toBeUndefined();
    expect(await s.teams.request(CHAT, "1730000000001")).toMatchObject({ status: "created", itemId: bug.id, itemTitle: "The export button fails with an error", resolvedBy: ME });
    const again = await s.run<{ nothing?: string }>("devops.preview", { clientKey: COOP, change });
    expect(again.nothing).toBe(`This request is already in DevOps as #${bug.id}`);
  });

  it("AP-2: a sorted request's draft gives the title and description; the message still goes with it", async () => {
    const s = setup();
    await s.enable();
    const change = await withAsk(s);
    await s.teams.setSort(CHAT, "1730000000001", "sorted", { kind: "bug", urgency: "this_week", itemType: "bug", title: "Export fails on every report", description: "Export has failed since Monday.", likely: null, reason: "Something is broken." }, ME);
    const p = await s.preview(change);
    expect(p.item).toBe("New Bug: Export fails on every report");
    const f = Object.fromEntries(p.fields.map((x) => [x.label, x.after]));
    expect(f["Repro steps"]).toContain("Export has failed since Monday.");
    expect(f["Repro steps"]).toContain("every report since Monday");
    expect(s.dv.writes()).toHaveLength(0);
  });

  it.each([["story", "User Story", "Description"], ["feature", "Feature", "Description"]])("a %s uses the process's %s type", async (level, type, field) => {
    const s = setup();
    await s.enable();
    const p = await s.preview({ ...(await withAsk(s)), level });
    expect(p.fields.find((x) => x.label === "Type")?.after).toBe(type);
    expect(p.fields.some((x) => x.label === field)).toBe(true);
  });

  it("idempotent: a lost answer is unconfirmed; a new preview is refused; Retry finds the item and makes no second one", async () => {
    const s = setup();
    await s.enable();
    const change = await withAsk(s);
    s.dv.fail("POST", /\$Bug$/, "lost");
    const r = await s.write(change);
    expect(r.confirmed).toBe(false);
    expect(items(s, "Bug")).toHaveLength(1);
    expect((await s.teams.request(CHAT, "1730000000001"))?.status).toBe("open");
    const refused = await s.fail("devops.preview", { clientKey: COOP, change });
    expect(refused).toMatchObject({ status: 409, code: "pending_write" });
    const retried = await s.run<DevOpsResult>("devops.retry", { id: r.entry.id });
    expect(retried.confirmed).toBe(true);
    expect(items(s, "Bug")).toHaveLength(1);
    expect((await s.teams.request(CHAT, "1730000000001"))?.itemId).toBe(items(s, "Bug")[0]!.id);
  });

  it("without the client's write PAT: the plain message and nothing sent", async () => {
    const s = setup();
    const r = await s.fail("devops.preview", { clientKey: COOP, change: await withAsk(s) });
    expect(r).toMatchObject({ status: 409, code: "no_write_pat" });
    expect(r.error).toMatch(/DevOps writes aren't enabled for Cooptimize/);
    expect(s.dv.seen).toHaveLength(0);
  });

  it("a request of another client is refused; one in a chat I'm not in is unknown", async () => {
    const s = setup();
    await s.enable();
    const change = await withAsk(s);
    const me = { userId: ME, displayName: "Avery", email: null, tenantId: "11111111-1111-4111-8111-111111111111" };
    await s.teams.addChat({ chatId: "19:adatum@thread.v2", clientKey: Adatum, kind: "customer", displayName: "Adatum chat", webUrl: null, members: [DANA, me], by: ME });
    await s.teams.saveMessages([message("19:adatum@thread.v2", "1730000000009", Adatum, "Adatum text")]);
    await s.teams.addRequest({ chatId: "19:adatum@thread.v2", messageId: "1730000000009", clientKey: Adatum, rule: "question", ruleDetail: null, at: NOW });
    const r = await s.fail("devops.preview", { clientKey: COOP, change: { ...change, chatId: "19:adatum@thread.v2", messageId: "1730000000009" } });
    expect(r.error).toMatch(/another client/);
    await s.teams.addChat({ chatId: "19:elsewhere@thread.v2", clientKey: COOP, kind: "customer", displayName: "Not mine", webUrl: null, members: [DANA], by: "someone" });
    await s.teams.saveMessages([message("19:elsewhere@thread.v2", "1730000000010", COOP, "Not for me")]);
    await s.teams.addRequest({ chatId: "19:elsewhere@thread.v2", messageId: "1730000000010", clientKey: COOP, rule: "question", ruleDetail: null, at: NOW });
    const unknown = await s.fail("devops.preview", { clientKey: COOP, change: { ...change, chatId: "19:elsewhere@thread.v2", messageId: "1730000000010" } });
    expect(unknown.error).toMatch(/No such request/);
  });

  it("Undo sets the item to Removed and opens the request again", async () => {
    const s = setup();
    await s.enable();
    const r = await s.write(await withAsk(s));
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect(items(s, "Bug")[0]!.fields["System.State"]).toBe("Removed");
    expect((await s.teams.request(CHAT, "1730000000001"))?.status).toBe("open");
  });
});
