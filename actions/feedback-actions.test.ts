import { beforeEach, describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearFeedbackPreviews, createFeedbackService, type FeedbackPreview, type FeedbackSent, type FeedbackStatus } from "./feedback-actions.ts";
import { createDemoContext, seedDemo } from "../server/demo.ts";
import { createDemoFeedbackDevOps, type DemoFeedbackParent } from "../sources/demo/feedback.ts";
import { DEMO_CLIENTS, DEMO_PEOPLE } from "../sources/demo/data.ts";
import { aFeedbackDraft, aSender, aUser } from "../test/builders/index.ts";
import { DAILY_LIMIT, LIMIT_REACHED, NOT_SET_UP } from "../plan/feedback.ts";

const NOW = "2026-11-03T15:00:00Z";
const sender = aSender(aUser({ displayName: "Alex Rivera", email: "alex@contoso.example" }));

/** A person with clients, plans and work items (the demo's), sending feedback to a pretend DevOps. */
async function person(o: { parent?: DemoFeedbackParent; failCreate?: boolean; mode?: "live" | "preview_only"; env?: string; seed?: boolean } = {}) {
  let now = NOW;
  const ctx: ActionContext = createDemoContext({ now: () => now, demo: { on: true, set: async () => {} } });
  if (o.seed !== false) await seedDemo(ctx);
  const devops = createDemoFeedbackDevOps({ parent: o.parent ?? "ok", failCreate: o.failCreate });
  const service = createFeedbackService({ devops, mode: o.mode ?? "live", env: o.env ?? "prod", local: false, now: () => Date.parse(now), log: () => {}, sleep: async () => {} });
  ctx.feedback = { service, sender: async () => sender };
  const run = async <T,>(action: string, input: unknown = {}) => dispatch(ctx, { action, input }) as Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; code?: string }>;
  const preview = async (input: unknown = aFeedbackDraft()) => {
    const r = await run<FeedbackPreview>("feedback.preview", input);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  return { ctx, devops, run, preview, at: (t: string) => (now = t) };
}

beforeEach(() => clearFeedbackPreviews());

describe("Send feedback (F1)", () => {
  it("creates the story under the feature, reads it back, then says Sent", async () => {
    const p = await person();
    const pv = await p.preview();
    expect(pv).toMatchObject({ title: "Idea: Show the week's free hours on the Week tab", mode: "live", setUp: true, remaining: DAILY_LIMIT, destination: "Goes to the FocusTime backlog in Cooptimize's DevOps" });
    const r = await p.run<FeedbackSent>("feedback.send", { previewId: pv.previewId });
    expect(r).toEqual({ ok: true, data: { sent: true, id: 9001, url: "", confirmed: true, message: "Sent. Thanks." } });
    expect(p.devops.created).toEqual([{ title: pv.title, description: pv.description, tags: ["FocusTime feedback", "Idea"], id: 9001, area: "Demo Internal", iteration: "Demo Internal\\Iteration 1" }]);
    // Read back: the item's parent is the feature.
    expect((await p.devops.read(9001)).parentId).toBe(496);
  });

  it("never puts the person's plan, clients or work items in the payload", async () => {
    const p = await person();
    // They have clients, a week plan and work items.
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
    // And nothing extra gets in through the input.
    expect(await p.run("feedback.preview", { ...aFeedbackDraft(), plan: { clients: ["Northwind Foods"] } })).toMatchObject({ ok: false, status: 400 });
  });

  it.each([
    ["missing", "isn't there"],
    ["wrong_type", "not at the feature level of this process"],
  ] as const)("says it isn't set up when the feature is %s, and sends nothing", async (parent, reason) => {
    const p = await person({ parent, seed: false });
    const st = await p.run<FeedbackStatus>("feedback.status");
    expect(st.ok && st.data.setup).toMatchObject({ state: "not_set_up", reason: expect.stringContaining(reason) });
    expect(st.ok && st.data.notSetUp).toBe(NOT_SET_UP);
    const pv = await p.preview();
    expect(pv).toMatchObject({ setUp: false, message: NOT_SET_UP });
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 503, error: NOT_SET_UP, code: "not_set_up" });
    expect(p.devops.created).toEqual([]);
  });

  it("keeps the text when DevOps fails, and doesn't try again on its own", async () => {
    const p = await person({ failCreate: true, seed: false });
    const pv = await p.preview();
    const r = await p.run("feedback.send", { previewId: pv.previewId });
    expect(r).toMatchObject({ ok: false, status: 502, code: "devops", error: expect.stringContaining("Copy text") });
    expect(p.devops.created).toEqual([]);
    // The preview is used up: a second send needs a fresh preview (no silent retry).
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 410 });
  });

  it(`stops at ${DAILY_LIMIT} a day, with a plain message, and starts again the next day`, async () => {
    const p = await person({ seed: false });
    for (let i = 0; i < DAILY_LIMIT; i++) {
      const pv = await p.preview(aFeedbackDraft({ text: `Idea ${i}` }));
      expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: true });
    }
    const pv = await p.preview();
    expect(pv).toMatchObject({ remaining: 0, message: LIMIT_REACHED });
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 429, error: LIMIT_REACHED });
    expect(p.devops.created).toHaveLength(DAILY_LIMIT);
    p.at("2026-11-04T15:00:00Z");
    const next = await p.preview();
    expect(next.remaining).toBe(DAILY_LIMIT);
  });

  it("creates nothing in preview-only mode", async () => {
    const p = await person({ mode: "preview_only", env: "dev", seed: false });
    const pv = await p.preview();
    expect(pv.title).toBe("[dev] Idea: Show the week's free hours on the Week tab");
    expect(pv.message).toContain("Preview only");
    expect(await p.run("feedback.send", { previewId: pv.previewId })).toEqual({ ok: true, data: { sent: false, previewOnly: true, message: "Preview only here: nothing was created." } });
    expect(p.devops.created).toEqual([]);
  });

  it("refuses a preview that expired or isn't theirs", async () => {
    const a = await person({ seed: false });
    const b = await person({ seed: false });
    const pv = await a.preview();
    expect(await b.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 410 });
    a.at("2026-11-03T15:11:00Z");
    expect(await a.run("feedback.send", { previewId: pv.previewId })).toMatchObject({ ok: false, status: 410 });
    expect(a.devops.created).toEqual([]);
  });
});
