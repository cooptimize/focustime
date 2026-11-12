// Step 14: DevOps writes through the write framework, against a fake dev.azure.com. Client orgs are fakes only.
import { FIXED_KEY } from "../plan/readiness.ts";
import { beforeEach, describe, expect, it } from "vitest";
import { jpegWithMetadata } from "../test/images.ts";
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
import { createConversationStore } from "../store/conversation-store.ts";
import { takesStore } from "../store/devops-takes.ts";
import { notesStore } from "../store/devops-notes.ts";
import { workTemplatesStoreOn } from "../store/work-templates-store.ts";
import { IDENTITY_KEY } from "./account.ts";
import { clearDevopsPreviews, type DevOpsPreview, type DevOpsResult } from "./devops-write-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

const NOW = "2026-11-02T14:00:00Z";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');
const COOP = "Cooptimize";
const Adatum = "Adatum";

function setup(opts: { /** GD-1: extra config (clients) and Adatum's DevOps identity. */ toml?: string; adatumEmail?: string; adatumOrg?: string; /** CV-4: my Chat.Read reader, for a conversation's images. */ chat?: import("../sources/graph/chats.ts").ChatMessagesClient; email?: string | null; acceptance?: boolean; startDate?: boolean; sizeField?: "Microsoft.VSTS.Scheduling.StoryPoints" | "Microsoft.VSTS.Scheduling.Effort" | null; /** QC-1: more fake process options (Domain, required fields). */ fake?: Parameters<typeof fakeDevOpsWrite>[0] } = {}) {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW, ...(opts.fake ?? {}), ...(opts.acceptance === false ? { acceptance: false } : {}), ...(opts.startDate === false ? { startDate: false } : {}), ...(opts.sizeField !== undefined ? { sizeField: opts.sizeField } : {}) });
  dv.add(437, { "System.WorkItemType": "Feature", "System.Title": "Need Features Here", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } });
  dv.add(500, { "System.WorkItemType": "User Story", "System.Title": "Import mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } }, 437);
  dv.add(600, { "System.WorkItemType": "Epic", "System.Title": "Platform", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } });
  dv.add(601, { "System.WorkItemType": "Feature", "System.Title": "Dana's feature", "System.State": "Active", "System.AssignedTo": { uniqueName: "dana@cooptimize.example" } }, 600);
  const logs: unknown[] = [];
  const writer = createDevOpsWriter({ fetch: dv.fetch, log: (e) => void logs.push(e) });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  // The shared Teams store (its own database here) for creates from a request.
  const teamsConn = sqliteConn(openPlanDb({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") }));
  const teams = createTeamsStore(teamsConn, () => Temporal.Instant.from(NOW));
  const convs = createConversationStore(teamsConn, () => Temporal.Instant.from(NOW), teams);
  const takes = takesStore(teamsConn, () => Temporal.Instant.from(NOW));
  const notes = notesStore(teamsConn, () => Temporal.Instant.from(NOW));
  const templates = workTemplatesStoreOn(teamsConn, () => NOW);
  const stored: { clientKey: string; id: number; fields: Record<string, unknown> }[] = [];
  const keyring = new Map<string, string>();
  const targetCalls: { keys: string[]; withPat: boolean | undefined }[] = [];
  const target = (clientKey: string, org: string, withPat: boolean): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org, project: `${clientKey} Project`, projectName: `${clientKey} Project`, email: clientKey === COOP ? (opts.email === undefined ? "avery@cooptimize.example" : opts.email) : (opts.adatumEmail ?? "avery@adatum.example"), pat: withPat ? new Pat(COMPANY_PAT) : null });
  const forgotten: string[] = [];
  const waits: number[] = [];
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(`${base}${opts.toml ?? ""}`) }),
    makeDataverse: () => ({
      devopsTargets: async (keys: string[], o: { withPat?: boolean } = {}) => {
        targetCalls.push({ keys, withPat: o.withPat });
        const withPat = o.withPat !== false;
        return { ok: true, targets: keys.map((k) => target(k, k === COOP ? "cooptimize" : (opts.adatumOrg ?? "adatumorg"), withPat)) };
      },
    }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({ forget: (k: string) => void forgotten.push(k), last: () => null }) as never,
    saveSystemUserId: async () => {},
    now: () => NOW,
    sleep: async (ms) => void waits.push(ms),
    plan,
    requests: { teams, refresh: async () => ({ polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 }), conversations: convs },
    devopsWriter: writer,
    takes,
    devopsNotes: notes,
    devopsStored: async (clientKey, v) => void stored.push({ clientKey, ...v }),
    templates,
    ...(opts.chat ? { account: () => ({ chatMessages: opts.chat }) as never } : {}),
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
  return { templates, dv, plan, teams, convs, takes, notes, stored, run, fail, enable, preview, confirm, write, keyring, logs, targetCalls, forgotten, waits };
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
  it("undo is a stack per item; SR-1: each new comment and each edited comment is its own stack", () => {
    const e = (id: number, op: DevOpsWriteEntry["op"], undoneBy: number | null = null, commentId?: number) => ({ id, op, org: "o", itemId: 9, status: "confirmed", undoneBy, ops: commentId ? { text: "x", commentId } : null }) as DevOpsWriteEntry;
    expect(undoTops([e(3, "state"), e(2, "comment"), e(1, "create")]).get("o#9")).toBe(3);
    expect(undoTops([e(4, "undo_state"), e(3, "state", 4), e(2, "comment"), e(1, "create")]).get("o#9")).toBe(1);
    const t = undoTops([e(7, "comment_edit", null, 50), e(6, "comment_edit", null, 50), e(5, "comment_edit", null, 51), e(4, "comment"), e(3, "comment"), e(2, "state")]);
    expect([t.get("o#9#c50"), t.get("o#9#c51"), t.get("o#9#new4"), t.get("o#9#new3"), t.get("o#9")]).toEqual([7, 5, 4, 3, 2]);
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
    // AH-1 (D656): the shared rule: Dana's feature sits under my epic, so I may set it; one under nobody's of mine I may not.
    expect((await s.preview({ kind: "target_date", itemId: 601, date: "2026-11-20" })).op).toBe("target_date");
    s.dv.add(602, { "System.WorkItemType": "Feature", "System.Title": "Lee's feature", "System.State": "Active", "System.AssignedTo": { uniqueName: "lee@cooptimize.example" } });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 602, date: "2026-11-20" } })).toMatchObject({ status: 409 });
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
  it("step 17, Save dates: refused where the process has no Start Date, on items I may not change (D656), or a start after the target", async () => {
    const t = setup({ startDate: false });
    await t.enable();
    expect(await t.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 437, date: "2026-12-11", startDate: "2026-11-16" } })).toMatchObject({ status: 409 });
    s.dv.add(602, { "System.WorkItemType": "Feature", "System.Title": "Lee's feature", "System.State": "Active", "System.AssignedTo": { uniqueName: "lee@cooptimize.example" } });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "target_date", itemId: 602, date: "2026-12-11", startDate: "2026-11-16" } })).toMatchObject({ status: 409 });
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

describe("Take one (PV-1, D572)", () => {
  let s: S;
  const DANA = "dana@cooptimize.example";
  beforeEach(async () => {
    s = setup();
    await s.enable();
    s.dv.add(510, { "System.WorkItemType": "User Story", "System.Title": "Their story", "System.State": "Active", "System.AssignedTo": { displayName: "Dana Reyes", uniqueName: DANA } }, 437);
    s.dv.add(511, { "System.WorkItemType": "User Story", "System.Title": "Done story", "System.State": "Closed", "System.AssignedTo": { displayName: "Dana Reyes", uniqueName: DANA } }, 437);
  });
  it("preview shows the current assignee and me; confirm tests /rev, assigns me, reads back and tells the teammate", async () => {
    const p = await s.preview({ kind: "assign", itemId: 510 });
    expect(p.summary).toBe("Assign a DevOps story or feature to you");
    expect(p.fields).toContainEqual({ label: "Assigned to", before: `Dana Reyes <${DANA}>`, after: "Sam Tester <avery@cooptimize.example>", changed: true });
    expect(p.notes.join(" ")).toContain("Dana Reyes gets a quiet note in FocusTime");
    const r = await s.confirm(p);
    expect(r).toMatchObject({ confirmed: true, message: "#510 is assigned to you in DevOps" });
    const [w] = patches(s);
    expect(w!.body).toEqual([{ op: "test", path: "/rev", value: 3 }, { op: "add", path: "/fields/System.AssignedTo", value: "avery@cooptimize.example" }]);
    expect(r.entry).toMatchObject({ op: "assign", status: "confirmed", before: { "Assigned to": `Dana Reyes <${DANA}>` } });
    expect(await s.takes.from([DANA], "2026-11-01T00:00:00Z")).toEqual([expect.objectContaining({ itemId: 510, fromEmail: DANA, byName: "Sam Tester", clientKey: COOP })]);
    // The audit log lists it with Undo.
    const log = await s.run<{ entries: { op: string; undoable: boolean }[] }>("devops.log", {});
    expect(log.entries[0]).toMatchObject({ op: "assign", undoable: true });
  });
  it("undo gives the story back to who had it and takes the note back", async () => {
    const r = await s.write({ kind: "assign", itemId: 510 });
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect(s.dv.items.get(510)!.fields["System.AssignedTo"]).toBe(DANA);
    expect(await s.takes.from([DANA], "2026-11-01T00:00:00Z")).toEqual([]);
  });
  it("undo refuses when someone else has it in DevOps now", async () => {
    const r = await s.write({ kind: "assign", itemId: 510 });
    s.dv.touch(510, { "System.AssignedTo": { displayName: "Lee", uniqueName: "lee@cooptimize.example" } });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r.entry.id } })).toMatchObject({ status: 409, code: "changed" });
  });
  it("only open stories and features (SW-1): a closed story is refused, a feature previews, mine already says so", async () => {
    const f = await s.run<{ summary?: string; nothing?: string }>("devops.preview", { clientKey: COOP, change: { kind: "assign", itemId: 437 } });
    expect(f.nothing ?? f.summary).toMatch(/already assigned to you|Assign a DevOps story or feature to you/);
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "assign", itemId: 511 } })).toMatchObject({ status: 409 });
    expect(await s.run("devops.preview", { clientKey: COOP, change: { kind: "assign", itemId: 500 } })).toEqual({ nothing: "#500 is already assigned to you" });
    expect(patches(s)).toHaveLength(0);
  });
  it("Add a story for me: a draft story under the feature, created as the parent type's default child", async () => {
    const d = await s.plan.addDraft({ clientKey: COOP, parentItemId: 437, title: "Story for me", size: "S" });
    const p = await s.preview({ kind: "create", draftId: d.id, type: "Bug" });
    expect(p.item).toBe("New Bug: Story for me");
    // A type the parent doesn't take falls back to the process's story type.
    const q = await s.preview({ kind: "create", draftId: d.id, type: "Epic" });
    expect(q.item).toBe("New User Story: Story for me");
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

describe("CV-1: a DevOps item, a comment and a description change from a conversation", () => {
  const CHAT = "19:cooptimize-alliance@thread.v2";
  const ME = "00000000-0000-4000-8000-0000000000a1";
  const HOME = "11111111-1111-4111-8111-111111111111";
  const BLAKE = { userId: "00000000-0000-4000-8000-0000000000c2", displayName: "Blake Novak", email: null, tenantId: "22222222-2222-4222-8222-222222222222" };
  async function world(s: S, kind: "customer" | "delivery" = "customer") {
    await s.plan.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Avery", username: "avery@cooptimize.example", email: "avery@cooptimize.example", signedInAt: NOW, systemUserId: null, systemUserEmail: null });
    await s.teams.addChat({ chatId: CHAT, clientKey: COOP, kind, displayName: "Alliance chat", webUrl: null, members: [BLAKE, { userId: ME, displayName: "Avery", email: null, tenantId: HOME }], by: ME });
    const html = '<p><at id="0">Avery</at> the totals are off by 7.7k lb</p><table><tr><td>MD</td><td>12,400</td></tr></table><script>alert(1)</script>';
    await s.teams.saveMessages([{ chatId: CHAT, messageId: "1730000000101", clientKey: COOP, senderId: BLAKE.userId, senderName: "Blake Novak", senderTenant: BLAKE.tenantId, createdAt: "2026-11-02T13:00:00Z", modifiedAt: "2026-11-02T13:00:00Z", html, text: "Avery the totals are off by 7.7k lb", hasImage: false, hasFile: false, replyToId: null, mentions: [{ id: ME, name: "Avery", at: 0 }], fetchedAt: NOW }]);
    const c = await s.convs.addConversation({ chatId: CHAT, clientKey: COOP, title: "Totals gap", summary: "Totals off by 7.7k lb.", participants: [], firstAt: "2026-11-02T13:00:00Z", lastAt: "2026-11-02T13:00:00Z", lastWorkAt: "2026-11-02T13:00:00Z" });
    await s.convs.place([{ chatId: CHAT, messageId: "1730000000101", conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: "2026-11-02T13:00:00Z" }]);
    const k = await s.convs.addCommitment({ conversationId: c.id, chatId: CHAT, clientKey: COOP, whoId: ME, whoName: "Avery", toId: BLAKE.userId, toName: "Blake Novak", what: "Fix the totals", dueAt: null, dueDate: null, impliesItem: true, messageIds: ["1730000000101"], reason: null });
    return { c, k };
  }

  it("creates a Bug under a feature with the path of action, then the original message (sanitized) and the Teams link; Tracked after read back", async () => {
    const s = setup();
    await s.enable();
    const { c, k } = await world(s);
    const change = { kind: "conversation_create", conversationId: c.id, commitmentId: k.id, title: "Totals gap on the dashboard", description: "What's being asked\nTotals are off.\n\nCheck first\n- BOM bridging", level: "bug", parentId: 437 };
    const p = await s.preview(change);
    expect(p.item).toBe("New Bug: Totals gap on the dashboard");
    expect(p.notes.join(" ")).toMatch(/Tracks the conversation/);
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const bug = [...s.dv.items.values()].find((i) => i.fields["System.WorkItemType"] === "Bug")!;
    const body = String(bug.fields["Microsoft.VSTS.TCM.ReproSteps"]);
    expect(body).toContain("<strong>What's being asked</strong>");
    expect(body).toContain('<span class="mention">Avery</span>');
    expect(body).toContain("<td>12,400</td>");
    expect(body).not.toContain("script");
    expect(body).toContain("Blake Novak");
    expect(body).toContain("https://teams.microsoft.com/");
    expect(bug.fields["System.Parent"]).toBe(437);
    // CV-5: the promise stays open (actionable) with its item.
    expect(await s.convs.commitment(k.id)).toMatchObject({ state: "open", itemId: bug.id });
    expect(await s.convs.conversation(c.id)).toMatchObject({ itemId: bug.id, status: "tracked" });
    expect((await s.plan.devopsWrite(r.entry.id))!.conv).toEqual({ conversationId: c.id, commitmentId: k.id, suggestionId: null });
    expect((await s.run<{ nothing?: string }>("devops.preview", { clientKey: COOP, change })).nothing).toBe(`This conversation is already tracked as #${bug.id}`);
    // Undo sets it to Removed and opens the conversation and the promise again.
    await s.write({ kind: "undo", writeId: r.entry.id });
    expect(await s.convs.commitment(k.id)).toMatchObject({ state: "open", itemId: null });
    expect((await s.convs.conversation(c.id))!.itemId).toBeNull();
  });

  it("from an internal chat the messages are left out unless included", async () => {
    const s = setup();
    await s.enable();
    const { c } = await world(s, "delivery");
    const p = await s.preview({ kind: "conversation_create", conversationId: c.id, title: "T", description: "d", level: "story" });
    expect(p.fields.find((f) => f.label === "Description")!.after).toMatch(/left out: it's an internal chat/);
    const q = await s.preview({ kind: "conversation_create", conversationId: c.id, title: "T", description: "d", level: "story", includeInternal: true });
    expect(q.fields.find((f) => f.label === "Description")!.after).toMatch(/original message/);
  });

  it("CV-5: the preview shows who will see it and the full text, acceptance criteria where the type has them, unassigned when asked; one create, audit, undo", async () => {
    const s = setup();
    await s.enable();
    const { c } = await world(s);
    const p = await s.preview({ kind: "conversation_create", conversationId: c.id, title: "Totals gap on the dashboard", description: "What's being asked\nTotals are off.", level: "story", acceptance: "- Totals match the BOM report", assign: "none" });
    expect(p.visibility).toMatch(/Cooptimize Project/);
    const desc = p.fields.find((f) => f.label === "Description")!.after!;
    expect(desc).toContain("Blake Novak · 2026-11-02 08:00: Avery the totals are off by 7.7k lb");
    expect(desc).toMatch(/Open the chat in Teams: https:\/\/teams\.microsoft\.com\//);
    expect(p.fields.find((f) => f.label === "Acceptance criteria")!.after).toBe("- Totals match the BOM report");
    expect(p.fields.find((f) => f.label === "Assigned to")!.after).toBe("Nobody");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const story = s.dv.items.get(r.itemId!)!;
    expect(story.fields["System.AssignedTo"] ?? null).toBeNull();
    expect(String(story.fields["Microsoft.VSTS.Common.AcceptanceCriteria"])).toContain("Totals match the BOM report");
    expect(s.dv.writes().filter((w) => w.method === "POST" && w.url.includes("workitems/$"))).toHaveLength(1);
    expect((await s.plan.devopsWrite(r.entry.id))!.after["Assigned to"]).toBe("Nobody");
    await s.write({ kind: "undo", writeId: r.entry.id });
    expect(story.fields["System.State"]).toBe("Removed");
    expect((await s.convs.conversation(c.id))!.itemId).toBeNull();
  });

  it("CV-5: a type without acceptance criteria leaves them out and says so; never assigned to anyone but me", async () => {
    const s = setup();
    await s.enable();
    const { c } = await world(s);
    const p = await s.preview({ kind: "conversation_create", conversationId: c.id, title: "Totals gap", description: "d", level: "bug", acceptance: "- Totals match" });
    expect(p.fields.some((f) => f.label === "Acceptance criteria")).toBe(false);
    expect(p.notes.join(" ")).toMatch(/Bug has no acceptance criteria field in this project, so they're left out/);
    expect(p.fields.find((f) => f.label === "Assigned to")!.after).toBe("Sam Tester <avery@cooptimize.example>");
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "conversation_create", conversationId: c.id, title: "T", description: "d", level: "story", assign: "dana@cooptimize.example" } })).error).toBe("assign is me or none");
  });

  it("CV-5: Also add a comment after Link to item: the comment write with its preview, the link back, confirm once, undo", async () => {
    const s = setup();
    await s.enable();
    const { c, k } = await world(s);
    const change = { kind: "conversation_comment", conversationId: c.id, itemId: 500 };
    expect((await s.fail("devops.preview", { clientKey: COOP, change })).error).toBe("Link #500 to the conversation first");
    await s.convs.updateConversation(c.id, { item: { id: 500, url: null, title: "Import mapping" } });
    const p = await s.preview(change);
    expect(p.op).toBe("comment");
    const text = p.fields.find((f) => f.label === "Comment")!.after!;
    expect(text).toMatch(/^Linked to the Teams conversation: Totals gap\n\nFrom the Teams conversation: https:\/\/teams\.microsoft\.com\//);
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(s.dv.writes().filter((w) => w.method === "POST" && /comments/.test(w.url))).toHaveLength(1);
    expect((await s.write({ kind: "undo", writeId: r.entry.id })).confirmed).toBe(true);
    // From my promise, with my own words.
    await s.convs.updateCommitment(k.id, { itemId: 500, itemUrl: null, itemTitle: "Import mapping" });
    const q = await s.preview({ kind: "conversation_comment", commitmentId: k.id, itemId: 500, text: "Picking this up from the chat" });
    expect(q.fields.find((f) => f.label === "Comment")!.after).toMatch(/^Picking this up from the chat\n\nFrom the Teams conversation: /);
  });

  it("posts a suggested comment for its owner (internal lines only when included) and settles it", async () => {
    const s = setup();
    await s.enable();
    const { c } = await world(s);
    await s.convs.updateConversation(c.id, { item: { id: 500, url: null, title: "Import mapping" } });
    const sg = await s.convs.addSuggestion({ conversationId: c.id, itemId: 500, kind: "comment", forUser: ME, body: "Root cause is BOM bridging.", before: null, after: null, internal: ["Internal: we owe them a fix"], day: "2026-11-02" });
    const p = await s.preview({ kind: "conversation_comment", suggestionId: sg.id });
    const text = p.fields.find((f) => f.label === "Comment")!.after!;
    expect(text).toContain("Root cause is BOM bridging.");
    expect(text).not.toContain("Internal");
    expect(text).toMatch(/From the Teams conversation: https:\/\/teams\.microsoft\.com\//);
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(await s.convs.suggestion(sg.id)).toMatchObject({ state: "posted", writeId: r.entry.id });
    const other = await s.convs.addSuggestion({ conversationId: c.id, itemId: 500, kind: "comment", forUser: "someone-else", body: "x", before: null, after: null, internal: [], day: "2026-11-02" });
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "conversation_comment", suggestionId: other.id } })).status).toBe(409);
  });

  it("description_update shows before and after, appends (never rewrites), reads back, keeps the old text and undoes", async () => {
    const s = setup();
    await s.enable();
    const { c } = await world(s);
    s.dv.items.get(500)!.fields["System.Description"] = "<div>Map the import columns.</div>";
    const sg = await s.convs.addSuggestion({ conversationId: c.id, itemId: 500, kind: "description", forUser: ME, body: "Also cover the weekly view", before: null, after: null, internal: [], day: "2026-11-02" });
    const p = await s.preview({ kind: "description_update", suggestionId: sg.id });
    expect(p.op).toBe("description");
    const row = p.fields.find((f) => f.label === "Description")!;
    expect(row.before).toBe("Map the import columns.");
    expect(row.after).toBe("Map the import columns.\n\nScope change from Teams, 2026-11-02: Also cover the weekly view");
    expect(p.notes.join(" ")).toMatch(/old text is kept/);
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(String(s.dv.items.get(500)!.fields["System.Description"])).toMatch(/^<div>Map the import columns\.<\/div>.*weekly view/);
    expect((await s.plan.devopsWrite(r.entry.id))!.before.Description).toBe("<div>Map the import columns.</div>");
    expect(patches(s).at(-1)!.body).toEqual(expect.arrayContaining([{ op: "test", path: "/rev", value: expect.any(Number) }]));
    await s.write({ kind: "undo", writeId: r.entry.id });
    expect(s.dv.items.get(500)!.fields["System.Description"]).toBe("<div>Map the import columns.</div>");
  });
});

describe("AH-1: Ahead's change set as one fields write per item (D657 to D660)", () => {
  let s: S;
  const DANA = "dana@cooptimize.example";
  const stage = (itemId: number, field: "start" | "target" | "size" | "assignee", value: unknown, baseValue: unknown = null, half: "AM" | "PM" | null = null, baseRev = 3) =>
    s.plan.stageAheadChange({ clientKey: COOP, itemId, field, value: value as never, half, baseRev, baseValue: baseValue as never });
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  it("one patch per item behind a test on its rev; the rows leave the change set, the half stays, the read-back goes to the store", async () => {
    await stage(437, "start", "2026-11-16", null, "PM");
    await stage(437, "target", "2026-12-11", null, "AM");
    const p = await s.preview({ kind: "fields", itemId: 437 });
    expect(p.summary).toBe("Change dates, state, size or owner in DevOps");
    expect(p.fields).toEqual(expect.arrayContaining([{ label: "Start date", before: null, after: "2026-11-16", changed: true }, { label: "Target date", before: null, after: "2026-12-11", changed: true }]));
    expect(p.notes.join(" ")).toContain("Mon, Nov 16 PM in FocusTime");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const [w] = patches(s);
    expect(w!.body).toEqual([{ op: "test", path: "/rev", value: 3 }, { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StartDate", value: "2026-11-16T05:00:00Z" }, { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.TargetDate", value: "2026-12-11T05:00:00Z" }]);
    expect(await s.plan.aheadChanges()).toEqual([]);
    expect(await s.plan.aheadHalves()).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 437, field: "start", day: "2026-11-16", half: "PM" }), expect.objectContaining({ itemId: 437, field: "target", day: "2026-12-11", half: "AM" })]));
    expect(s.stored).toEqual([expect.objectContaining({ clientKey: COOP, id: 437 })]);
    expect(s.stored[0]!.fields["System.Rev"]).toBe(4);
    expect(r.entry).toMatchObject({ op: "fields", status: "confirmed" });
  });
  it("AH-7: a saved field that fills a Readiness gap counts as fixed (a start alone doesn't); its undo takes it back", async () => {
    await stage(437, "start", "2026-11-16");
    await stage(437, "target", "2026-12-11");
    await stage(500, "size", 5);
    const r = await s.confirm(await s.preview({ kind: "fields", itemId: 437 }));
    await s.confirm(await s.preview({ kind: "fields", itemId: 500 }));
    const log = (await s.plan.getState<{ k: string; g: string }[]>(FIXED_KEY))!;
    expect(log.map((x) => `${x.k} ${x.g}`)).toEqual([`${COOP}:437 no_dates`, `${COOP}:500 unsized`]);
    await s.write({ kind: "undo", writeId: r.entry.id });
    expect((await s.plan.getState<{ k: string; g: string }[]>(FIXED_KEY))!.map((x) => `${x.k} ${x.g}`)).toEqual([`${COOP}:500 unsized`]);
  });
  it("the size in the type's own field, labelled with its name; Effort in another process", async () => {
    await stage(500, "size", 5);
    const p = await s.preview({ kind: "fields", itemId: 500 });
    expect(p.fields).toContainEqual({ label: "Story Points", before: null, after: "5", changed: true });
    await s.confirm(p);
    expect(s.dv.items.get(500)!.fields["Microsoft.VSTS.Scheduling.StoryPoints"]).toBe(5);
    const t = setup({ sizeField: "Microsoft.VSTS.Scheduling.Effort" });
    await t.enable();
    await t.plan.stageAheadChange({ clientKey: COOP, itemId: 500, field: "size", value: 8, half: null, baseRev: 3, baseValue: null });
    const q = (await t.run<{ preview: DevOpsPreview }>("devops.preview", { clientKey: COOP, change: { kind: "fields", itemId: 500 } })).preview;
    expect(q.fields).toContainEqual({ label: "Effort", before: null, after: "8", changed: true });
    await t.run("devops.confirm", { previewId: q.previewId });
    expect(t.dv.items.get(500)!.fields["Microsoft.VSTS.Scheduling.Effort"]).toBe(8);
    // No size field at all: the change can't go, and says so.
    const u = setup({ sizeField: null });
    await u.enable();
    await u.plan.stageAheadChange({ clientKey: COOP, itemId: 500, field: "size", value: 3, half: null, baseRev: 3, baseValue: null });
    expect(await u.fail("devops.preview", { clientKey: COOP, change: { kind: "fields", itemId: 500 } })).toMatchObject({ status: 409, code: "no_field" });
  });
  it("assigning a teammate notifies them once; Nobody is add with an empty value; undo puts every field back and takes the notice back", async () => {
    await stage(500, "assignee", { email: DANA, name: "Dana Reyes" }, { email: "avery@cooptimize.example", name: "Sam Tester" });
    await stage(500, "size", 3);
    const p = await s.preview({ kind: "fields", itemId: 500 });
    expect(p.notes.join(" ")).toContain("Dana Reyes gets a notice in FocusTime");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(await s.notes.to([DANA], "2026-11-01T00:00:00Z")).toEqual([expect.objectContaining({ kind: "assigned", itemIds: [500], byName: "Sam Tester" })]);
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect(s.dv.items.get(500)!.fields["System.AssignedTo"]).toBe("avery@cooptimize.example");
    expect(s.dv.items.get(500)!.fields["Microsoft.VSTS.Scheduling.StoryPoints"]).toBeUndefined();
    expect(await s.notes.to([DANA], "2026-11-01T00:00:00Z")).toEqual([]);
    // Nobody.
    await s.plan.stageAheadChange({ clientKey: COOP, itemId: 500, field: "assignee", value: null, half: null, baseRev: s.dv.items.get(500)!.rev, baseValue: { email: "avery@cooptimize.example", name: "Sam Tester" } });
    await s.write({ kind: "fields", itemId: 500 });
    expect(patches(s).at(-1)!.body).toContainEqual({ op: "add", path: "/fields/System.AssignedTo", value: "" });
    expect(s.dv.items.get(500)!.fields["System.AssignedTo"]).toBeUndefined();
  });
  it("AH-5: a state goes in the same patch, checked against the type's states; undo puts the old state back", async () => {
    await s.plan.stageAheadChange({ clientKey: COOP, itemId: 500, field: "state", value: "Closed", half: null, baseRev: 3, baseValue: "Active" });
    await stage(500, "size", 2);
    const p = await s.preview({ kind: "fields", itemId: 500 });
    expect(p.fields).toContainEqual({ label: "State", before: "Active", after: "Closed", changed: true });
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    expect(patches(s).at(-1)!.body).toContainEqual({ op: "add", path: "/fields/System.State", value: "Closed" });
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Closed");
    expect(await s.plan.aheadChanges()).toEqual([]);
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect(s.dv.items.get(500)!.fields["System.State"]).toBe("Active");
    // A name the type doesn't have is refused before anything is written.
    await s.plan.stageAheadChange({ clientKey: COOP, itemId: 500, field: "state", value: "Doing", half: null, baseRev: s.dv.items.get(500)!.rev, baseValue: "Active" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "fields", itemId: 500 } })).toMatchObject({ status: 409, code: "no_field" });
  });
  it("a conflict only when a field I'm changing changed in DevOps; anything else and mine go on the new rev quietly", async () => {
    await stage(437, "target", "2026-12-11");
    s.dv.touch(437, { "System.Title": "Renamed" });
    const r = await s.write({ kind: "fields", itemId: 437 });
    expect(r.confirmed).toBe(true);
    expect(patches(s)[0]!.body).toContainEqual({ op: "test", path: "/rev", value: 4 });
    await stage(437, "target", "2026-12-18", "2026-12-11", null, 5);
    s.dv.touch(437, { "Microsoft.VSTS.Scheduling.TargetDate": "2027-01-08T05:00:00Z" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "fields", itemId: 437 } })).toMatchObject({ status: 409, code: "conflict" });
    expect((await s.plan.aheadChanges())[0]).toMatchObject({ field: "target", value: "2026-12-18", theirs: "2027-01-08" });
    expect(patches(s)).toHaveLength(1);
  });
  it("who may change it: the owner one level up, never two; a refused item in a batch doesn't stop the rest", async () => {
    // Dana's feature under my epic: mine to change (one level down).
    s.dv.add(610, { "System.WorkItemType": "User Story", "System.Title": "Dana's story", "System.State": "Active", "System.AssignedTo": { uniqueName: DANA } }, 601);
    await stage(601, "target", "2026-12-04");
    await stage(610, "size", 2);
    const r = await s.run<{ previews: DevOpsPreview[]; refused: { itemId: number; code: string }[] }>("devops.preview", { clientKey: COOP, changes: [{ kind: "fields", itemId: 601 }, { kind: "fields", itemId: 610 }] });
    expect(r.previews.map((p) => p.op)).toEqual(["fields"]);
    expect(r.refused).toEqual([expect.objectContaining({ itemId: 610, code: "read_only" })]);
  });
  it("a write that fails is retried through the log, and lands once", async () => {
    await stage(437, "target", "2026-12-11");
    s.dv.fail("PATCH", /workitems\/437$/i, "network");
    const r = await s.write({ kind: "fields", itemId: 437 });
    expect(r.confirmed).toBe(false);
    expect(await s.plan.aheadChanges()).toHaveLength(1);
    const again = await s.run<DevOpsResult>("devops.retry", { id: r.entry.id });
    expect(again.confirmed).toBe(true);
    expect(patches(s).filter((w) => w.url.includes("/437"))).toHaveLength(2);
    expect(await s.plan.aheadChanges()).toEqual([]);
  });
  it("BH-1: a bulk push is one patch per item; the preview names a teammate's assignee; undo puts each date back", async () => {
    // What ahead.stage_bulk stages for "Push target date by 2 weeks" on my feature and Dana's.
    s.dv.touch(437, { "Microsoft.VSTS.Scheduling.TargetDate": "2026-11-20T05:00:00Z" });
    s.dv.touch(601, { "Microsoft.VSTS.Scheduling.TargetDate": "2026-11-27T05:00:00Z" });
    await stage(437, "target", "2026-12-04", "2026-11-20", "PM", s.dv.items.get(437)!.rev);
    await stage(601, "target", "2026-12-11", "2026-11-27", "PM", s.dv.items.get(601)!.rev);
    const r = await s.run<{ previews: DevOpsPreview[] }>("devops.preview", { clientKey: COOP, changes: [{ kind: "fields", itemId: 437 }, { kind: "fields", itemId: 601 }] });
    const [mine, danas] = r.previews;
    expect(mine!.notes.join(" ")).not.toContain("not you");
    expect(danas!.notes[0]).toBe("Assigned to dana@cooptimize.example, not you. They get a quiet note in FocusTime that the dates moved.");
    const done = [await s.confirm(mine!), await s.confirm(danas!)];
    expect(done.map((d) => d.confirmed)).toEqual([true, true]);
    expect(patches(s).map((w) => w.url.match(/workitems\/(\d+)/i)![1])).toEqual(["437", "601"]);
    expect(await s.plan.aheadChanges()).toEqual([]);
    for (const d of done) expect((await s.write({ kind: "undo", writeId: d.entry.id })).confirmed).toBe(true);
    expect([s.dv.items.get(437)!.fields["Microsoft.VSTS.Scheduling.TargetDate"], s.dv.items.get(601)!.fields["Microsoft.VSTS.Scheduling.TargetDate"]]).toEqual(["2026-11-20T05:00:00Z", "2026-11-27T05:00:00Z"]);
  });
  it("dates moved on a teammate's item: the owner gets a note", async () => {
    await stage(601, "start", "2026-11-23");
    await s.write({ kind: "fields", itemId: 601 });
    expect(await s.notes.to([DANA], "2026-11-01T00:00:00Z")).toEqual([expect.objectContaining({ kind: "dates", itemIds: [601] })]);
  });
});

describe("CP-1: create from a captured draft's preview", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  const captured = async (title: string, level: "story" | "feature" = "story") => {
    const c = await s.plan.addCapture({ text: title, clientKey: COOP });
    const r = await s.plan.routeCapture(c.id, level === "story" ? { as: "draft", clientKey: COOP, parentItemId: null, title, size: "M" } : { as: "draft_feature", clientKey: COOP, parentItemId: null, title });
    const id = r.routedId!;
    await s.plan.setDraftAi(id, { state: "ready", title: "Import the mapping file", description: "Read the mapping from a file.", acceptance: level === "story" ? "- Upload a file\n- See the mapping" : null, type: level === "story" ? "User Story" : "Feature", parentId: level === "story" ? 437 : 600, parentReason: "It fits", note: null, ranAt: NOW });
    return id;
  };

  it("accept the AI version: its words and parent are written, after the preview and confirm only, with read back and undo", async () => {
    const id = await captured("mapping import thing");
    // The dialog saves the accepted side to the draft, then previews.
    await s.run("draft.update", { id, title: "Import the mapping file", description: "Read the mapping from a file.", acceptance: "- Upload a file\n- See the mapping" });
    await s.plan.setDraftParent(id, 437);
    const p = await s.preview({ kind: "create", draftId: id, type: "User Story" });
    expect(p.item).toBe("New User Story: Import the mapping file");
    // Nothing is written by the preview.
    expect(s.dv.writes().filter((w) => w.method === "POST")).toEqual([]);
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const ops = s.dv.writes().find((w) => w.method === "POST")!.body as { path: string; value: unknown }[];
    expect(ops).toContainEqual({ op: "add", path: "/fields/System.Title", value: "Import the mapping file" });
    expect((await s.plan.getDraft(id))!.devopsId).toBeGreaterThan(0);
    // The write is logged, and Undo sets it to Removed and brings the draft back.
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect((await s.plan.getDraft(id))!.devopsId).toBeUndefined();
  });

  it("keep mine: my own title, the process default type", async () => {
    const id = await captured("mapping import thing");
    await s.plan.setDraftParent(id, 437);
    const p = await s.preview({ kind: "create", draftId: id });
    expect(p.item).toBe("New User Story: mapping import thing");
  });

  it("edit, then create: the edited words", async () => {
    const id = await captured("mapping import thing");
    await s.run("draft.update", { id, title: "Import the mapping file (CSV only)" });
    await s.plan.setDraftParent(id, 437);
    expect((await s.preview({ kind: "create", draftId: id })).item).toBe("New User Story: Import the mapping file (CSV only)");
  });

  it("a parent is required: without one nothing is previewed", async () => {
    const id = await captured("mapping import thing");
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "create", draftId: id } })).toMatchObject({ status: 409 });
  });

  it("a feature takes the accepted type only when its epic takes it at the feature tier", async () => {
    const id = await captured("reporting", "feature");
    await s.plan.setDraftParent(id, 600);
    expect((await s.preview({ kind: "create", draftId: id, type: "Feature" })).item).toBe("New Feature: reporting");
    // A type the epic doesn't take is ignored: the process default, as before.
    expect((await s.preview({ kind: "create", draftId: id, type: "User Story" })).item).toBe("New Feature: reporting");
  });
});

describe("CV-4: a conversation's images attached to the item it creates", () => {
  const CHAT = "19:cooptimize-images@thread.v2";
  const ME = "00000000-0000-4000-8000-0000000000a1";
  const HOME = "11111111-1111-4111-8111-111111111111";
  const BLAKE = { userId: "00000000-0000-4000-8000-0000000000c2", displayName: "Blake Novak", email: null, tenantId: "22222222-2222-4222-8222-222222222222" };
  const img = (h: string) => `<img src="https://graph.microsoft.com/v1.0/chats/${CHAT}/messages/1/hostedContents/${h}/$value" itemtype="http://schema.skype.com/AMSImage">`;
  function graph(gone: string[] = []) {
    const calls: string[] = [];
    const client = {
      messagesSince: async () => ({ messages: [], newest: null }),
      hostedContent: async (_c: string, _m: string, h: string) => {
        calls.push(h);
        if (gone.includes(h)) throw new (await import("../sources/calendar/http.ts")).HttpError(404);
        return { bytes: jpegWithMetadata() };
      },
    };
    return { client, calls };
  }
  async function world(s: S, kind: "customer" | "delivery" = "customer") {
    await s.plan.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Avery", username: "avery@cooptimize.example", email: "avery@cooptimize.example", signedInAt: NOW, systemUserId: null, systemUserEmail: null });
    await s.teams.addChat({ chatId: CHAT, clientKey: COOP, kind, displayName: "Images chat", webUrl: null, members: [BLAKE, { userId: ME, displayName: "Avery", email: null, tenantId: HOME }], by: ME });
    await s.teams.saveMessages([{ chatId: CHAT, messageId: "1730000000201", clientKey: COOP, senderId: BLAKE.userId, senderName: "Blake Novak", senderTenant: BLAKE.tenantId, createdAt: "2026-11-02T13:00:00Z", modifiedAt: "2026-11-02T13:00:00Z", html: `<p>The refresh failed</p>${img("aaa")}${img("bbb")}${img("ccc")}`, text: "The refresh failed", hasImage: true, hasFile: false, replyToId: null, mentions: [], fetchedAt: NOW }]);
    const c = await s.convs.addConversation({ chatId: CHAT, clientKey: COOP, title: "Refresh failed", summary: "The refresh failed.", participants: [], firstAt: "2026-11-02T13:00:00Z", lastAt: "2026-11-02T13:00:00Z", lastWorkAt: "2026-11-02T13:00:00Z" });
    await s.convs.place([{ chatId: CHAT, messageId: "1730000000201", conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: "2026-11-02T13:00:00Z" }]);
    const ids = (await s.teams.images(CHAT, ["1730000000201"])).map((i) => i.id);
    return { c, ids };
  }
  const change = (c: { id: number }, more: Record<string, unknown> = {}) => ({ kind: "conversation_create", conversationId: c.id, title: "Refresh failed on the sales model", description: "What's being asked\nThe refresh fails.", level: "bug", ...more });

  it("the preview offers each image ticked; unticking one leaves it out; confirm reads them with my token, uploads them and links them in the create patch, read back", async () => {
    const g = graph();
    const s = setup({ chat: g.client });
    await s.enable();
    const { c, ids } = await world(s);
    const all = await s.preview(change(c));
    expect(all.attachments!.map((a) => [a.id, a.ticked, a.sender, a.src])).toEqual(ids.map((id) => [id, true, "Blake Novak", `/media/chat-images/${id}`]));
    expect(all.notes.join(" ")).toMatch(/read from Teams with your sign-in when you confirm/);
    expect(g.calls).toEqual([]);
    const p = await s.preview(change(c, { images: [ids[0], ids[2]] }));
    expect(p.attachments!.map((a) => a.ticked)).toEqual([true, false, true]);
    expect(p.fields.find((f) => f.label === "Repro steps")!.after).toMatch(/Attached: 2 images from the chat\./);
    const r = await s.confirm(p);
    expect(r).toMatchObject({ confirmed: true });
    expect(r.message).toBe(`Created #${r.itemId} in DevOps with 2 images`);
    expect(g.calls).toEqual(["aaa", "ccc"]);
    // Uploaded as raw bytes (octet-stream, stripped), with my write PAT; linked in the same create patch.
    const uploads = s.dv.seen.filter((x) => x.url.includes("/_apis/wit/attachments"));
    expect(uploads.map((u) => [u.method, u.contentType, u.authorization])).toEqual([["POST", "application/octet-stream", basic(WRITE_PAT)], ["POST", "application/octet-stream", basic(WRITE_PAT)]]);
    expect([...s.dv.attachments.values()].map((a) => a.fileName)).toEqual(["teams-image-202611020800-1.jpg", "teams-image-202611020800-2.jpg"]);
    const bug = s.dv.items.get(r.itemId!)!;
    const files = bug.relations.filter((x) => x.rel === "AttachedFile");
    expect(files).toHaveLength(2);
    expect(files[0]!.attributes).toEqual({ comment: "From Teams, Blake Novak, 2026-11-02 08:00" });
    expect(String(bug.fields["Microsoft.VSTS.TCM.ReproSteps"])).toContain("<div>Attached: 2 images from the chat</div>");
    const creates = s.dv.writes().filter((w) => w.method === "POST" && w.url.includes("workitems/$"));
    expect(creates).toHaveLength(1);
    // The audit log: ids, names, sizes, attachment ids and URLs; never bytes.
    const entry = (await s.plan.devopsWrite(r.entry.id))!;
    expect(entry.after.Attachments).toMatch(new RegExp(`^Image ${ids[0]}: teams-image-202611020800-1\\.jpg, \\d+ KB, attachment aaaaaaaa-`));
    expect(JSON.stringify(entry)).not.toMatch(/base64|\/9j\//);
    // Nothing kept in FocusTime.
    expect(await (s.teams as unknown as { image: (id: number) => Promise<unknown> }).image(ids[0]!)).not.toHaveProperty("bytes");
  });

  it("an image that can't be read is reported and left out; the item is still created", async () => {
    const g = graph(["bbb"]);
    const s = setup({ chat: g.client });
    await s.enable();
    const { c } = await world(s);
    const r = await s.confirm(await s.preview(change(c)));
    expect(r.confirmed).toBe(true);
    expect(r.message).toBe(`Created #${r.itemId} in DevOps with 2 images. 1 image couldn't be read from Teams or uploaded, so it was left out`);
    expect(s.dv.items.get(r.itemId!)!.relations.filter((x) => x.rel === "AttachedFile")).toHaveLength(2);
  });

  it("an internal chat's images only with include internal", async () => {
    const s = setup({ chat: graph().client });
    await s.enable();
    const { c } = await world(s, "delivery");
    const p = await s.preview(change(c, { level: "story" }));
    expect(p.attachments).toBeUndefined();
    expect(p.notes.join(" ")).toMatch(/images are left out with its messages/);
    expect((await s.preview(change(c, { level: "story", includeInternal: true }))).attachments).toHaveLength(3);
  });

  it("refuses images that aren't this conversation's, or more than 10", async () => {
    const s = setup({ chat: graph().client });
    await s.enable();
    const { c } = await world(s);
    const r = await s.fail("devops.preview", { clientKey: COOP, change: change(c, { images: [99999] }) });
    expect(r).toMatchObject({ status: 400, error: "images must be ids of this conversation's images" });
  });

  it("undo sets it to Removed and unlinks the images in the same patch (test /rev); the files stay in DevOps, and it says so", async () => {
    const s = setup({ chat: graph().client });
    await s.enable();
    const { c } = await world(s);
    const r = await s.confirm(await s.preview(change(c)));
    const id = r.itemId!;
    const u = await s.preview({ kind: "undo", writeId: r.entry.id });
    expect(u.notes.join(" ")).toMatch(/Unlinks the 3 images\. The files stay in DevOps, unlinked: DevOps has no way to delete an attachment\./);
    const done = await s.confirm(u);
    expect(done).toMatchObject({ confirmed: true, message: "Undone in DevOps. The 3 images stay in DevOps as files, unlinked: DevOps has no way to delete an attachment" });
    const last = patches(s).at(-1)!.body as { op: string; path: string }[];
    expect(last[0]).toMatchObject({ op: "test", path: "/rev" });
    expect(last.filter((o) => o.op === "remove").map((o) => o.path)).toEqual(["/relations/2", "/relations/1", "/relations/0"]);
    expect(s.dv.items.get(id)!.relations.filter((x) => x.rel === "AttachedFile")).toEqual([]);
    expect(s.dv.items.get(id)!.fields["System.State"]).toBe("Removed");
    expect(s.dv.attachments.size).toBe(3);
    expect(s.dv.writes().filter((w) => w.method === "DELETE")).toEqual([]);
  });
});

describe("AS-1: description_edit (a dictated description, which may rewrite it)", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
    s.dv.touch(437, { "System.Description": "<div>Old scope: import only.</div>" });
  });
  it("preview shows the whole text before and after; confirm tests /rev, replaces it, reads back and keeps the old text in the audit log", async () => {
    const p = await s.preview({ kind: "description_edit", itemId: 437, after: "New scope: import and export.\nBoth formats." });
    expect(p.summary).toBe("Change a DevOps item's description");
    expect(p.fields).toContainEqual(expect.objectContaining({ label: "Description", before: "Old scope: import only.", after: "New scope: import and export.\nBoth formats." }));
    expect(p.notes.join(" ")).toContain("The old text is kept in the audit log, and Undo puts it back");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const [w] = patches(s);
    expect((w!.body as unknown[])[0]).toMatchObject({ op: "test", path: "/rev" });
    expect(String(s.dv.items.get(437)!.fields["System.Description"])).toContain("New scope: import and export.");
    expect(String(s.dv.items.get(437)!.fields["System.Description"])).not.toContain("Old scope");
    expect(r.entry).toMatchObject({ op: "description", status: "confirmed", before: { Description: "<div>Old scope: import only.</div>" } });
  });
  it("undo puts the old text back; undo is refused once the description changed in DevOps since", async () => {
    const r = await s.write({ kind: "description_edit", itemId: 437, after: "Rewritten." });
    const u = await s.write({ kind: "undo", writeId: r.entry.id });
    expect(u.confirmed).toBe(true);
    expect(String(s.dv.items.get(437)!.fields["System.Description"])).toContain("Old scope: import only.");
    const r2 = await s.write({ kind: "description_edit", itemId: 437, after: "Second rewrite." });
    s.dv.touch(437, { "System.Description": "<div>Someone else's text</div>" });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r2.entry.id } })).toMatchObject({ status: 409, code: "changed" });
  });
  it("only on items the shared canEdit allows: a teammate's feature (not under my epic) is refused before anything is written", async () => {
    s.dv.add(602, { "System.WorkItemType": "Feature", "System.Title": "Lee's feature", "System.State": "Active", "System.AssignedTo": { uniqueName: "lee@cooptimize.example" } });
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "description_edit", itemId: 602, after: "Mine now" } })).toMatchObject({ status: 409 });
    expect(patches(s)).toEqual([]);
  });
  it("written only at the revision read: a change in DevOps between preview and confirm writes nothing", async () => {
    const p = await s.preview({ kind: "description_edit", itemId: 437, after: "Rewritten." });
    s.dv.touch(437, { "System.Title": "Renamed meanwhile" });
    const r = await s.confirm(p).catch((e: Error) => e);
    expect(r instanceof Error ? "refused" : (r as DevOpsResult).confirmed).not.toBe(true);
    expect(String(s.dv.items.get(437)!.fields["System.Description"])).toContain("Old scope");
  });
  it("an empty text or the same text: nothing to write", async () => {
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "description_edit", itemId: 437, after: "  " } })).toMatchObject({ status: 400 });
    expect(await s.run("devops.preview", { clientKey: COOP, change: { kind: "description_edit", itemId: 437, after: "Old scope: import only." } })).toMatchObject({ nothing: "#437 already has that description" });
  });
});

// GD-1: in a client's DevOps, another client's name never appears; Cooptimize Internal's may name clients.
describe("the client boundary in the preview", () => {
  const clients = `\n[clients.Northwind]\nname = "Northwind Traders"\n`;
  beforeEach(() => clearDevopsPreviews());

  // GD-2 point 6: every write into a client's org is checked; the preview flags it with one click to replace; my
  // own words can still be saved once I've seen the flag.
  it("GD-2: a client: a comment naming another client is flagged in the preview; Confirm needs the flag seen; nothing is logged", async () => {
    const s = setup({ toml: clients, adatumEmail: "avery@cooptimize.example", adatumOrg: "cooptimize" });
    await s.run("devops.set_write_pat", { clientKey: Adatum, pat: WRITE_PAT });
    const p = await s.preview({ kind: "comment", itemId: 500, text: "Same fix as for Northwind Traders" }, Adatum);
    expect(p.mentions).toEqual(["Northwind Traders"]);
    expect(p.notes?.join(" ")).toMatch(/This mentions Northwind Traders, and Adatum's DevOps can be seen by people outside Cooptimize/);
    const no = await s.fail("devops.confirm", { previewId: p.previewId });
    expect(no).toMatchObject({ status: 409, code: "mentions" });
    expect(s.dv.writes().filter((w) => w.method === "POST")).toEqual([]);
    expect(JSON.stringify(s.logs)).not.toContain("Northwind");
    // Seen: my own words are saved as I wrote them.
    expect((await s.run<DevOpsResult>("devops.confirm", { previewId: p.previewId, mentionsOk: true })).confirmed).toBe(true);
    expect(JSON.stringify(s.dv.writes())).toContain("Northwind Traders");
    // Its own name, and plain text, aren't flagged.
    expect((await s.preview({ kind: "comment", itemId: 500, text: "Adatum asked for this" }, Adatum)).mentions).toBeUndefined();
  });

  it("GD-2: Replace writes \"another client\" in the comment, and a state change's note is checked too", async () => {
    const s = setup({ toml: clients, adatumEmail: "avery@cooptimize.example", adatumOrg: "cooptimize" });
    await s.run("devops.set_write_pat", { clientKey: Adatum, pat: WRITE_PAT });
    const p = await s.preview({ kind: "comment", itemId: 500, text: "Same fix as for Northwind Traders", mentions: "replace" }, Adatum);
    expect(p.mentions).toBeUndefined();
    expect(p.notes?.join(" ")).toContain("Another client's name was removed");
    expect((await s.confirm(p)).confirmed).toBe(true);
    const sent = JSON.stringify(s.dv.writes());
    expect(sent).toContain("Same fix as for another client");
    expect(sent).not.toContain("Northwind");
    expect((await s.preview({ kind: "state", itemId: 500, state: "Closed", comment: "Done, like Northwind" }, Adatum)).mentions).toEqual(["Northwind Traders"]);
  });

  it("CV-5: a create from a client's conversation naming another client is flagged at preview; Internal's isn't", async () => {
    const s = setup({ toml: clients, adatumEmail: "avery@cooptimize.example", adatumOrg: "cooptimize" });
    await s.run("devops.set_write_pat", { clientKey: Adatum, pat: WRITE_PAT });
    await s.enable();
    const ME = "00000000-0000-4000-8000-0000000000a1";
    const HOME = "11111111-1111-4111-8111-111111111111";
    await s.plan.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Avery", username: "avery@cooptimize.example", email: "avery@cooptimize.example", signedInAt: NOW, systemUserId: null, systemUserEmail: null });
    const conv = async (clientKey: string, chatId: string) => {
      await s.teams.addChat({ chatId, clientKey, kind: "customer", displayName: "A chat", webUrl: null, members: [{ userId: ME, displayName: "Avery", email: null, tenantId: HOME }], by: ME });
      return s.convs.addConversation({ chatId, clientKey, title: "Totals", summary: "s", participants: [], firstAt: NOW, lastAt: NOW, lastWorkAt: NOW });
    };
    const a = await conv(Adatum, "19:adatum-cv5@thread.v2");
    const p = await s.preview({ kind: "conversation_create", conversationId: a.id, title: "Same fix as Northwind Traders", description: "d", level: "story" }, Adatum);
    expect(p.mentions).toEqual(["Northwind Traders"]);
    expect((await s.fail("devops.confirm", { previewId: p.previewId })).code).toBe("mentions");
    expect(s.dv.writes().filter((w) => w.method === "POST")).toEqual([]);
    const i = await conv(COOP, "19:coop-cv5@thread.v2");
    const q = await s.preview({ kind: "conversation_create", conversationId: i.id, title: "Same fix as Northwind Traders", description: "d", level: "story" });
    expect(q.op).toBe("create");
    expect(q.mentions).toBeUndefined();
  });

  it("Internal: a comment naming two clients is previewed and written", async () => {
    const s = setup({ toml: clients });
    await s.enable();
    await s.write({ kind: "comment", itemId: 500, text: "Adatum and Northwind Traders both need this" });
    expect(s.dv.writes().some((w) => w.method === "POST" && /comments/.test(w.url))).toBe(true);
  });
});

describe("QC-1: new_item, the New form's create", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  const shown = (p: DevOpsPreview) => Object.fromEntries(p.fields.map((r) => [r.label, r.after]));
  const posts = (t: S) => t.dv.writes().filter((w) => w.method === "POST" && /workitems\/\$/.test(w.url));

  it("the preview is exactly what is sent: a feature with no parent, assigned to me, the project's default area", async () => {
    const p = await s.preview({ kind: "new_item", title: "  Billing   export ", type: "Feature" });
    expect(shown(p)).toMatchObject({ Type: "Feature", Title: "Billing export", "Assigned to": expect.stringContaining("avery@cooptimize.example"), Parent: "None", Area: "The project's default", Iteration: "The project's default" });
    expect(posts(s)).toHaveLength(0);
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(true);
    const it = s.dv.items.get(r.entry.itemId!)!;
    expect(it.fields).toMatchObject({ "System.WorkItemType": "Feature", "System.Title": "Billing export" });
    expect(it.relations).toEqual([]);
    expect(it.fields["System.AreaPath"]).toBeUndefined();
    expect(r.entry).toMatchObject({ op: "create", status: "confirmed", parentId: null });
    expect(posts(s)).toHaveLength(1);
  });

  it("under an epic a feature; under a feature a story, with the parent's area and iteration", async () => {
    const f = await s.write({ kind: "new_item", title: "Under the epic", type: "Feature", parentId: 600 });
    expect(s.dv.items.get(f.entry.itemId!)!.fields["System.Parent"]).toBe(600);
    const st = await s.write({ kind: "new_item", title: "Under the feature", type: "User Story", parentId: 437, size: 3 });
    const it = s.dv.items.get(st.entry.itemId!)!;
    expect(it.fields).toMatchObject({ "System.Parent": 437, "System.AreaPath": "Cooptimize\\Ops", "Microsoft.VSTS.Scheduling.StoryPoints": 3 });
  });

  it("refuses in plain words, before anything is sent: wrong level under a parent, unknown type, closed parent, another project", async () => {
    const r1 = await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "Story under epic", type: "User Story", parentId: 600 } });
    expect(r1).toMatchObject({ status: 409, error: expect.stringContaining("doesn't go under an Epic") });
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Initiative" } })).error).toMatch(/isn't a level in .*It has: Epic, Feature, User Story/);
    s.dv.add(700, { "System.WorkItemType": "Epic", "System.Title": "Old", "System.State": "Closed" });
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Feature", parentId: 700 } })).error).toContain("only under open parents");
    s.dv.add(701, { "System.WorkItemType": "Epic", "System.Title": "Elsewhere", "System.State": "Active", "System.TeamProject": "Another Project" });
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Feature", parentId: 701 } })).error).toContain("isn't in Cooptimize's project");
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Feature", parentId: 99999 } })).status).toBe(409);
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Epic", size: 5 } })).error).toContain("no size field");
    expect(posts(s)).toHaveLength(0);
  });

  it("a title is required, one line, at most 255 characters", async () => {
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "   ", type: "Feature" } })).error).toBe("Type a title");
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "x".repeat(300), type: "Feature" } })).error).toContain("at most 255");
    const p = await s.preview({ kind: "new_item", title: `${"y".repeat(255)}`, type: "Feature" });
    expect(shown(p).Title).toHaveLength(255);
  });

  it("a level above epic: Domain, and an epic under it", async () => {
    const t = setup({ fake: { domain: true } });
    await t.enable();
    const d = await t.write({ kind: "new_item", title: "Payments", type: "Domain" });
    expect(t.dv.items.get(d.entry.itemId!)!.fields["System.WorkItemType"]).toBe("Domain");
    const e = await t.write({ kind: "new_item", title: "Card payments", type: "Epic", parentId: d.entry.itemId });
    expect(t.dv.items.get(e.entry.itemId!)!.fields["System.Parent"]).toBe(d.entry.itemId);
    expect((await t.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Feature", parentId: d.entry.itemId } })).error).toContain("Under a Domain go: Epic");
  });

  it("a required field FocusTime doesn't fill is refused at the preview, never half-created", async () => {
    const t = setup({ fake: { required: { Feature: ["Custom.CostCenter"] } } });
    await t.enable();
    const r = await t.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "Needs a cost center", type: "Feature" } });
    expect(r).toMatchObject({ status: 409, error: expect.stringContaining("needs CostCenter on a new Feature") });
    expect(t.dv.writes().filter((w) => w.method === "POST")).toHaveLength(0);
  });

  it("never two: after a create that may have landed, the same create is refused until Retry checks", async () => {
    const p = await s.preview({ kind: "new_item", title: "Maybe landed", type: "Feature" });
    s.dv.fail("POST", /workitems\/\$/, "lost");
    const r = await s.confirm(p);
    expect(r.confirmed).toBe(false);
    expect(await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "Maybe landed", type: "Feature" } })).toMatchObject({ status: 409, error: expect.stringContaining("may already be in DevOps") });
  });

  it("the same preview confirmed twice (a double click) creates once", async () => {
    const p = await s.preview({ kind: "new_item", title: "Once", type: "Feature" });
    const [a, b] = await Promise.allSettled([s.confirm(p), s.confirm(p)]);
    expect([a, b].filter((x) => x.status === "fulfilled" && (x.value as DevOpsResult).confirmed)).toHaveLength(1);
    expect(posts(s)).toHaveLength(1);
  });

  it("two tabs: two previews of the same create, both confirmed, make one item; a later same create says where it is", async () => {
    const a = await s.preview({ kind: "new_item", title: "Two tabs", type: "Feature" });
    const b = await s.preview({ kind: "new_item", title: "Two tabs", type: "Feature" });
    const ra = await s.confirm(a);
    expect(ra.confirmed).toBe(true);
    expect(await s.fail("devops.confirm", { previewId: b.previewId })).toMatchObject({ status: 409, error: `"Two tabs" is already in DevOps as #${ra.entry.itemId}` });
    expect(posts(s)).toHaveLength(1);
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "Two tabs", type: "Feature" } })).error).toBe(`"Two tabs" is already in DevOps as #${ra.entry.itemId}`);
    // Another type or another title is not a twin.
    expect((await s.preview({ kind: "new_item", title: "Two tabs", type: "Epic" })).fields.length).toBeGreaterThan(0);
  });

  it("assigning: nobody, or only someone on the client's project", async () => {
    const p = await s.preview({ kind: "new_item", title: "Nobody's", type: "Feature", assignTo: null });
    expect(shown(p)["Assigned to"]).toBe("Nobody");
    const r = await s.confirm(p);
    expect(s.dv.items.get(r.entry.itemId!)!.fields["System.AssignedTo"]).toBeUndefined();
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Feature", assignTo: "stranger@example.com" } })).error).toContain("Only people on Cooptimize's DevOps project");
  });

  it("without my write PAT nothing is previewed", async () => {
    const t = setup();
    expect((await t.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "Feature" } })).status).toBeGreaterThanOrEqual(400);
    expect(t.dv.writes().filter((w) => w.method === "POST")).toHaveLength(0);
  });

  it("a draft at any level keeps its exact type, and the created item takes its place: block, size and timebox", async () => {
    const d = await s.plan.addDraft({ clientKey: COOP, title: "An epic draft", level: "feature", itemType: "Epic", size: "L" } as never);
    expect(d.itemType).toBe("Epic");
    const pick = await s.plan.addPick({ date: "2026-11-03", half: "PM", clientKey: COOP, kind: "draft", draftId: d.id, title: d.title, size: "L" } as never);
    const p = await s.preview({ kind: "new_item", draftId: d.id });
    expect(shown(p)).toMatchObject({ Type: "Epic", Title: "An epic draft" });
    const r = await s.confirm(p);
    const id = r.entry.itemId!;
    expect(await s.plan.getPick(pick.id)).toMatchObject({ kind: "item", itemId: id, date: "2026-11-03", half: "PM", size: "L", itemType: "Epic" });
    // From another tab: the same draft again says where it is.
    expect(await s.run("devops.preview", { clientKey: COOP, change: { kind: "new_item", draftId: d.id } })).toEqual({ nothing: `"An epic draft" is already in DevOps as #${id}` });
  });
});

// TP-1: the four lines at create. One addition to new_item: the lines under their headings in the description, "How
// we'll check" in the acceptance field when the type has it, and one request type tag; nothing else changes.
describe("TP-1: the four lines and the request type tag at create", () => {
  let s: S;
  beforeEach(async () => {
    s = setup();
    await s.enable();
  });
  const shown = (p: DevOpsPreview) => Object.fromEntries(p.fields.map((r) => [r.label, r.after]));
  const posts = (t: S) => t.dv.writes().filter((w) => w.method === "POST" && /workitems\/\$/.test(w.url));
  const sentPaths = (t: S) => (posts(t).at(-1)!.body as { path: string }[]).map((o) => o.path);
  const brief = { type: "new-measure", where: "The Sales model", env: "Test", change: "Gross margin percent", checkedBy: { name: "Sam Lee", email: null }, doneWhen: "In test", signedOffBy: { name: "the finance lead", email: null }, notWithout: ["Deploy to production"] };

  it("title only: the same keys as before, nothing new written", async () => {
    const before = await s.preview({ kind: "new_item", title: "Plain one", type: "User Story" });
    await s.confirm(before);
    const plain = sentPaths(s);
    const p = await s.preview({ kind: "new_item", title: "Plain two", type: "User Story", brief: null });
    expect(p.fields.map((r) => r.label)).toEqual(before.fields.map((r) => r.label));
    await s.confirm(p);
    expect(sentPaths(s)).toEqual(plain);
    expect(plain).not.toContain("/fields/System.Tags");
    expect(plain).not.toContain("/fields/System.Description");
    expect(await s.templates.uses()).toEqual({});
  });

  it("two lines and choices: the preview shows the description, acceptance and tag in plain words; DevOps gets them under headings", async () => {
    const p = await s.preview({ kind: "new_item", title: "Margin percent", type: "User Story", description: "From the finance review.", brief: { ...brief, check: "October, East: 31.2%" } });
    const f = shown(p);
    expect(f.Description).toBe("From the finance review.\n\nWhat and where\nThe Sales model\nEnvironment: Test.\n\nWhat changes\nGross margin percent\n\nHow we'll check\nOctober, East: 31.2%\nChecked by: Sam Lee.\n\nHow far and who signs off\nDone when it is: in test. Signed off by: the finance lead. Not without asking: deploy to production.");
    expect(f["Acceptance criteria"]).toBe("October, East: 31.2%\nChecked by: Sam Lee.");
    expect(f.Tag).toBe("type:new-measure");
    expect(p.notes?.join(" ")).toContain("Adds the tag type:new-measure");
    const r = await s.confirm(p);
    const it = s.dv.items.get(r.entry.itemId!)!;
    expect(it.fields["System.Tags"]).toBe("type:new-measure");
    expect(String(it.fields["System.Description"])).toBe("<div>From the finance review.</div><h3>What and where</h3><p>The Sales model</p><p>Environment: Test.</p><h3>What changes</h3><p>Gross margin percent</p><h3>How we'll check</h3><p>October, East: 31.2%</p><p>Checked by: Sam Lee.</p><h3>How far and who signs off</h3><p>Done when it is: in test. Signed off by: the finance lead. Not without asking: deploy to production.</p>");
    expect(String(it.fields["Microsoft.VSTS.Common.AcceptanceCriteria"])).toBe("<div>October, East: 31.2%</div><div>Checked by: Sam Lee.</div>");
    expect(await s.templates.uses()).toEqual({ "new-measure": { created: 1, complete: 1 } });
  });

  it("acceptance only when the type has the field and How we'll check has text", async () => {
    const f = await s.preview({ kind: "new_item", title: "A feature", type: "Feature", brief: { check: "One row" } });
    expect(shown(f)["Acceptance criteria"]).toBeUndefined();
    expect(f.notes?.join(" ")).toContain("Feature has no acceptance criteria field");
    await s.confirm(f);
    expect(sentPaths(s)).not.toContain("/fields/Microsoft.VSTS.Common.AcceptanceCriteria");
    const st = await s.preview({ kind: "new_item", title: "A story", type: "User Story", brief: { where: "x", checkedBy: { name: "Sam", email: null } } });
    expect(shown(st)["Acceptance criteria"]).toBeUndefined();
  });

  it("the tag only when a type is chosen; a line's text and no type writes no tag", async () => {
    const p = await s.preview({ kind: "new_item", title: "Generic", type: "User Story", brief: { where: "Orders report" } });
    expect(shown(p).Tag).toBeUndefined();
    await s.confirm(p);
    expect(sentPaths(s)).not.toContain("/fields/System.Tags");
    expect(sentPaths(s)).toContain("/fields/System.Description");
  });

  it("a refused tag creates nothing, says so in plain words, and the same create goes without it", async () => {
    const t = setup({ fake: { noNewTags: true } });
    await t.enable();
    const r = await t.confirm(await t.preview({ kind: "new_item", title: "Tagged", type: "User Story", brief }));
    expect(r).toMatchObject({ confirmed: false, code: "tag_refused" });
    expect(r.message).toContain("didn't let you add the tag type:new-measure");
    expect(r.entry.status).toBe("refused");
    expect([...t.dv.items.values()].some((i) => i.fields["System.Title"] === "Tagged")).toBe(false);
    const again = await t.preview({ kind: "new_item", title: "Tagged", type: "User Story", brief, noTag: true });
    expect(shown(again).Tag).toBeUndefined();
    const ok = await t.confirm(again);
    expect(ok.confirmed).toBe(true);
    expect(t.dv.items.get(ok.entry.itemId!)!.fields["System.Tags"]).toBeUndefined();
    expect(String(t.dv.items.get(ok.entry.itemId!)!.fields["System.Description"])).toContain("<h3>What and where</h3>");
  });

  it("a draft keeps its type, lines and choices, and its create writes them", async () => {
    const d = await s.run<{ draft: { id: number; brief: unknown } }>("draft.add", { clientKey: COOP, title: "Drafted", type: "User Story", brief });
    expect(d.draft.brief).toMatchObject({ type: "new-measure", where: "The Sales model", doneWhen: "In test" });
    const saved = await s.run<{ draft: { brief: unknown } }>("draft.save", { id: d.draft.id, clientKey: COOP, title: "Drafted", type: "User Story" });
    expect(saved.draft.brief).toMatchObject({ type: "new-measure" });
    const p = await s.preview({ kind: "new_item", draftId: d.draft.id });
    expect(shown(p).Tag).toBe("type:new-measure");
    expect(shown(p).Description).toContain("Done when it is: in test.");
  });

  it("an unknown type or field is refused before anything is sent", async () => {
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "User Story", brief: { type: "nope" } } })).error).toContain("isn't one of the team's");
    expect((await s.fail("devops.preview", { clientKey: COOP, change: { kind: "new_item", title: "X", type: "User Story", brief: { secret: "x" } } })).status).toBe(400);
    expect(posts(s)).toHaveLength(0);
  });

  it("a renamed or removed type: a draft keeps its tag, and the tag is written as it was", async () => {
    const d = await s.run<{ draft: { id: number } }>("draft.add", { clientKey: COOP, title: "Old type", type: "User Story", brief: { type: "deployment", where: "x" } });
    const doc = (await s.templates.read()).doc;
    await s.templates.save({ ...doc, types: doc.types.map((t) => (t.id === "deployment" ? { ...t, name: "Release", removed: true } : t)) }, 1, { id: "a", name: "Ada" }, "test", [{ target: "Release", setting: "Removed", oldValue: null, newValue: null }]);
    const p = await s.preview({ kind: "new_item", draftId: d.draft.id });
    expect(shown(p).Tag).toBe("type:deployment");
  });

  it("the client boundary covers the four lines", async () => {
    const t = setup({ toml: `\n[clients.Northwind]\nname = "Northwind Traders"\n`, adatumEmail: "avery@cooptimize.example", adatumOrg: "cooptimize" });
    await t.run("devops.set_write_pat", { clientKey: Adatum, pat: WRITE_PAT });
    const p = await t.preview({ kind: "new_item", title: "Same as before", type: "User Story", brief: { change: "As we did for Northwind Traders" } }, Adatum);
    expect(p.mentions).toEqual(["Northwind Traders"]);
    const fixed = await t.preview({ kind: "new_item", title: "Same as before", type: "User Story", brief: { change: "As we did for Northwind Traders" }, mentions: "replace" }, Adatum);
    expect(shown(fixed).Description).toContain("As we did for another client");
  });
});
