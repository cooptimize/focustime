// F1, FB-1: Send feedback. The real path is the write framework with the person's own write PAT (a fake
// dev.azure.com); the demo's pretend backlog covers the dialog's rules (payload, limit, expiry). Orgs are fakes only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearFeedbackPreviews, type FeedbackPreview, type FeedbackSent, type FeedbackStatus } from "./feedback-actions.ts";
import { clearDevopsPreviews } from "./devops-write-actions.ts";
import { createDemoContext, seedDemo } from "../server/demo.ts";
import { DEMO_CLIENTS, DEMO_PEOPLE } from "../sources/demo/data.ts";
import { aFeedbackDraft, aSender, aUser } from "../test/builders/index.ts";
import { DAILY_LIMIT, LIMIT_REACHED, NOT_SET_UP } from "../plan/feedback.ts";
import type { DevOpsWriteEntry } from "../plan/devopswrite.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { createDemoFeedbackDevOps, demoFeedbackBackend, type DemoFeedbackParent } from "../sources/demo/feedback.ts";

const NOW = "2026-11-03T15:00:00Z";
const sender = aSender(aUser({ displayName: "Alex Rivera", email: "alex@contoso.example" }));
const INTERNAL = "Cooptimize";
const TARGET = { org: "cooptimize", project: "Cooptimize Project", parentId: 437 };
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');

type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

/** One signed-in person on the real path: the write framework against a fake DevOps, their own keyring. */
function person(o: { env?: string; target?: typeof TARGET | null; refuse?: { method: string; path: RegExp; status: 401 | 403 } } = {}) {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW });
  dv.add(437, { "System.WorkItemType": "Feature", "System.Title": "FocusTime", "System.State": "Active" });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const r = o.refuse;
    if (r && (init?.method ?? "GET") === r.method && r.path.test(new URL(String(input)).pathname)) return new Response(JSON.stringify({ message: "TF400813: not authorized" }), { status: r.status, headers: { "content-type": "application/json" } });
    return dv.fetch(input, init);
  }) as typeof globalThis.fetch;
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const keyring = new Map<string, string>();
  const target = (clientKey: string): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org: "cooptimize", project: `${clientKey} Project`, projectName: `${clientKey} Project`, email: "avery@cooptimize.example", pat: null });
  const ctx: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(base) }),
    makeDataverse: () => ({ devopsTargets: async (keys: string[]) => ({ ok: true, targets: keys.map(target) }) }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({ forget: () => {}, last: () => null }) as never,
    saveSystemUserId: async () => {},
    now: () => NOW,
    sleep: async () => {},
    plan,
    env: o.env ?? "prod",
    devopsWriter: createDevOpsWriter({ fetch, log: () => {} }),
    writePats: { get: async (k) => { const v = keyring.get(k); if (!v) throw new Error("not found"); return new Pat(v); }, set: async (k, v) => void keyring.set(k, v), clear: async (k) => void keyring.delete(k) },
    feedback: { sender: async () => sender, target: async () => (o.target === undefined ? TARGET : o.target) },
  };
  const run = <T,>(action: string, input: unknown = {}) => dispatch(ctx, { action, input }) as Promise<Res<T>>;
  const preview = async (input: unknown = aFeedbackDraft()) => {
    const r = await run<FeedbackPreview>("feedback.preview", input);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  const status = async () => {
    const r = await run<FeedbackStatus>("feedback.status");
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  const enable = async () => {
    const r = await run("devops.set_write_pat", { clientKey: INTERNAL, pat: WRITE_PAT });
    if (!r.ok) throw new Error(r.error);
    dv.seen.length = 0;
  };
  const created = () => [...dv.items.values()].filter((i) => i.id !== 437);
  return { ctx, dv, run, preview, status, enable, created };
}

beforeEach(() => clearFeedbackPreviews());

describe("Send feedback with my own DevOps write PAT (FB-1)", () => {
  it("creates one story under the configured parent, as me, with its number and link, in the write log", async () => {
    const p = person();
    await p.enable();
    const st = await p.status();
    expect(st.setup).toEqual({ state: "ready", clientName: "Internal", parentId: 437, parentTitle: "FocusTime", storyType: "User Story" });
    expect(st.line).toBe("Set up: stories go under Feature #437 (FocusTime) as User Story, created as you with your DevOps write PAT for Internal.");
    const pv = await p.preview();
    // The preview shows the full text, who it is created as and who can see it.
    expect(pv).toMatchObject({ setUp: true, message: null, title: "Idea: Show the week's free hours on the Week tab", write: { identity: "Sam Tester <avery@cooptimize.example>", org: "cooptimize", project: "Cooptimize Project", visibility: expect.stringContaining("Visible to everyone with access to the Cooptimize Project project") } });
    expect(pv.description).toContain("From Alex Rivera (alex@contoso.example)");
    const r = await p.run<FeedbackSent>("feedback.send", { previewId: pv.previewId });
    expect(r).toEqual({ ok: true, data: { sent: true, id: 900, url: "https://dev.azure.com/cooptimize/Cooptimize%20Project/_workitems/edit/900", confirmed: true, message: "Sent. Thanks." } });
    // One create, under #437, with my PAT and nothing else.
    expect(p.dv.writes().filter((w) => w.method === "POST" && /\/_apis\/wit\/workitems\//i.test(w.url))).toHaveLength(1);
    expect(p.dv.seen.every((s) => s.authorization === basic(WRITE_PAT))).toBe(true);
    const [item] = p.created();
    expect(item!.fields).toMatchObject({ "System.Title": pv.title, "System.WorkItemType": "User Story", "System.Tags": "FocusTime feedback; Idea", "System.AreaPath": "Cooptimize\\Ops" });
    expect(item!.fields["System.AssignedTo"]).toBeUndefined();
    expect(item!.relations[0]!.url).toMatch(/workItems\/437$/);
    // The write framework's audit: a create like any other, as me, with Undo.
    const log = await p.run<{ entries: (DevOpsWriteEntry & { undoable: boolean })[] }>("devops.log");
    const e = log.ok ? log.data.entries.find((x) => x.itemId === 900) : undefined;
    expect(e).toMatchObject({ op: "create", clientKey: INTERNAL, parentId: 437, status: "confirmed", identity: "avery@cooptimize.example", title: pv.title, undoable: true });
  });

  it("without a write PAT says to turn writes on, offers only Copy text, and makes no DevOps request", async () => {
    const p = person();
    const st = await p.status();
    expect(st.setup).toEqual({ state: "no_pat", clientName: "Internal" });
    expect(st.line).toContain("Turn on DevOps writes for Internal");
    const pv = await p.preview();
    expect(pv).toMatchObject({ setUp: false, write: null, message: expect.stringContaining("Turn on DevOps writes for Internal") });
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 503, error: NOT_SET_UP });
    expect(p.dv.seen).toEqual([]);
    expect(p.created()).toEqual([]);
  });

  it.each([401, 403] as const)("when DevOps refuses my read of the project (%s), says ask an admin, never Sent", async (status) => {
    const p = person({ refuse: { method: "GET", path: /\/_apis\/wit\/workitems\/437$/i, status } });
    await p.enable();
    const no = "Your DevOps account can't reach Cooptimize Project; ask an admin to add you.";
    const st = await p.status();
    expect(st.setup).toEqual({ state: "no_access", clientName: "Internal", project: "Cooptimize Project" });
    expect(st.line).toBe(no);
    const pv = await p.preview();
    expect(pv).toMatchObject({ setUp: false, message: no });
    expect((await p.run("feedback.send", { previewId: pv.previewId })).ok).toBe(false);
    expect(p.created()).toEqual([]);
  });

  it("when DevOps refuses the create, says Not sent and keeps the text; logged as failed", async () => {
    const p = person({ refuse: { method: "POST", path: /\/_apis\/wit\/workitems\//i, status: 403 } });
    await p.enable();
    const pv = await p.preview();
    const r = await p.run<FeedbackSent>("feedback.send", { previewId: pv.previewId });
    expect(r).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/^Not sent: .*Copy text keeps it\.$/) });
    expect(JSON.stringify(r)).not.toContain("Sent.");
    const log = await p.run<{ entries: DevOpsWriteEntry[] }>("devops.log");
    expect(log.ok && log.data.entries.map((x) => [x.op, x.status])).toEqual([["create", "failed"]]);
  });

  it("checks the setup per person: one with a PAT is ready, one without isn't", async () => {
    const a = person();
    await a.enable();
    const b = person();
    expect((await a.status()).setup.state).toBe("ready");
    expect((await b.status()).setup.state).toBe("no_pat");
  });

  it("says it isn't set up when no destination is set, and asks DevOps nothing", async () => {
    const p = person({ target: null });
    await p.enable();
    expect((await p.status()).setup).toMatchObject({ state: "not_set_up" });
    expect(p.dv.seen).toEqual([]);
  });

  it("is a real write on dev too (no preview-only mode), with [dev] in the title", async () => {
    const p = person({ env: "dev" });
    await p.enable();
    const pv = await p.preview();
    expect(pv.title).toBe("[dev] Idea: Show the week's free hours on the Week tab");
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: true, data: { sent: true, id: 900 } });
  });

  it("never asks for an app identity's token: no managed identity or DevOps token scope in the feedback code", () => {
    const root = join(import.meta.dirname, "..");
    const files = ["actions/feedback-actions.ts", "actions/feedback-devops.ts", "sources/demo/feedback.ts", "actions/feedback-types.ts", "plan/feedback.ts", "ui/Feedback.tsx"];
    for (const f of files) expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/@azure\/identity|getToken|Bearer/);
    // Nothing anywhere asks for an Azure DevOps token (the managed identity path is gone).
    const walk = (d: string): string[] => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [join(d, e.name)] : []));
    for (const f of ["actions", "server", "sources", "host"].flatMap(walk)) expect(readFileSync(join(root, f), "utf8"), f).not.toContain("app.vssps.visualstudio.com");
  });
});

/** The demo: a person with clients, plans and work items, sending feedback to a pretend backlog. */
async function demoPerson(o: { parent?: DemoFeedbackParent; failCreate?: boolean; seed?: boolean } = {}) {
  let now = NOW;
  const ctx: ActionContext = createDemoContext({ now: () => now, demo: { on: true, set: async () => {} } });
  if (o.seed !== false) await seedDemo(ctx);
  const devops = createDemoFeedbackDevOps({ parent: o.parent ?? "ok", failCreate: o.failCreate });
  ctx.feedback = { demo: demoFeedbackBackend(devops), sender: async () => sender };
  const run = <T,>(action: string, input: unknown = {}) => dispatch(ctx, { action, input }) as Promise<Res<T>>;
  const preview = async (input: unknown = aFeedbackDraft()) => {
    const r = await run<FeedbackPreview>("feedback.preview", input);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  return { ctx, devops, run, preview, at: (t: string) => (now = t) };
}

describe("Send feedback's rules (the demo's pretend backlog)", () => {
  it("creates the story under the feature, reads it back, then says Sent", async () => {
    const p = await demoPerson();
    const pv = await p.preview();
    expect(pv).toMatchObject({ title: "Idea: Show the week's free hours on the Week tab", setUp: true, remaining: DAILY_LIMIT, destination: "Goes to the FocusTime backlog in Cooptimize's DevOps" });
    const r = await p.run<FeedbackSent>("feedback.send", { previewId: pv.previewId });
    expect(r).toEqual({ ok: true, data: { sent: true, id: 9001, url: "", confirmed: true, message: "Sent. Thanks." } });
    expect(p.devops.created).toEqual([{ title: pv.title, description: pv.description, tags: ["FocusTime feedback", "Idea"], id: 9001, area: "Demo Internal" }]);
  });

  it("never puts the person's plan, clients or work items in the payload", async () => {
    const p = await demoPerson();
    const week = await p.run<{ clients?: unknown }>("weekplan.load", { weekStart: "2026-11-02" });
    expect(JSON.stringify(week)).toContain("Northwind");
    const pv = await p.preview(aFeedbackDraft({ kind: "problem", text: "The plan didn't save" }));
    await p.run("feedback.send", { previewId: pv.previewId });
    const sent = JSON.stringify(p.devops.created);
    for (const c of DEMO_CLIENTS) {
      expect(sent).not.toContain(c.name);
      expect(sent).not.toContain(c.org);
    }
    for (const person of DEMO_PEOPLE) expect(sent).not.toContain(person.name);
    for (const id of ["4410", "1110", "2210", "3311"]) expect(sent).not.toContain(id);
    expect(await p.run("feedback.preview", { ...aFeedbackDraft(), plan: { clients: ["Northwind Foods"] } })).toMatchObject({ ok: false, status: 400 });
  });

  it.each([
    ["missing", "isn't there"],
    ["wrong_type", "not at the feature level of this process"],
  ] as const)("says it isn't set up when the feature is %s, and sends nothing", async (parent, reason) => {
    const p = await demoPerson({ parent, seed: false });
    const st = await p.run<FeedbackStatus>("feedback.status");
    expect(st.ok && st.data.setup).toMatchObject({ state: "not_set_up", reason: expect.stringContaining(reason) });
    const pv = await p.preview();
    expect(pv).toMatchObject({ setUp: false, message: expect.stringContaining(reason) });
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 503, code: "not_set_up" });
    expect(p.devops.created).toEqual([]);
  });

  it("keeps the text when DevOps fails, and doesn't try again on its own", async () => {
    const p = await demoPerson({ failCreate: true, seed: false });
    const pv = await p.preview();
    const r = await p.run("feedback.send", { previewId: pv.previewId });
    expect(r).toMatchObject({ ok: false, status: 502, code: "devops", error: expect.stringMatching(/^Not sent: DevOps refused it \(HTTP 500\)\. .*Copy text/) });
    expect(p.devops.created).toEqual([]);
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 410 });
  });

  it(`stops at ${DAILY_LIMIT} a day, with a plain message, and starts again the next day`, async () => {
    const p = await demoPerson({ seed: false });
    for (let i = 0; i < DAILY_LIMIT; i++) {
      const pv = await p.preview(aFeedbackDraft({ text: `Idea ${i}` }));
      expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: true });
    }
    const pv = await p.preview();
    expect(pv).toMatchObject({ remaining: 0, message: LIMIT_REACHED });
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 429, error: LIMIT_REACHED });
    expect(p.devops.created).toHaveLength(DAILY_LIMIT);
    p.at("2026-11-04T15:00:00Z");
    expect((await p.preview()).remaining).toBe(DAILY_LIMIT);
  });

  it("refuses a preview that expired or isn't theirs", async () => {
    const a = await demoPerson({ seed: false });
    const b = await demoPerson({ seed: false });
    const pv = await a.preview();
    expect(await b.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 410 });
    a.at("2026-11-03T15:11:00Z");
    expect(await a.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 410 });
    expect(a.devops.created).toEqual([]);
  });
});
