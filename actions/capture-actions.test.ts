import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { createPlanStore } from "../store/plan-store.ts";
import type { CaptureFeatures, CaptureState } from "./capture-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { CloseOutState, FollowUpView, WeekPlanState } from "./types.ts";

const text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);
const NOW = "2026-11-05T19:30:00Z"; // Thu Nov 5, 2:30 PM New York

/** offline: every source fails (Dataverse, DevOps network, calendars, even the config read). */
function setup(o: { offline?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "c-cap-"));
  const dv = fakeFetch(o.offline ? "token_network_down" : "ok");
  const ado = fakeDevOps({ contoso: o.offline ? "offline" : "planweek", cooptimize: o.offline ? "offline" : "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, cacheDir: dir, log: () => {} });
  let devops: ReturnType<typeof createDevOpsSource> | null = null;
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const c: ActionContext = {
    loadConfig: o.offline ? async () => { throw new Error("disk gone"); } : async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: (cfg, tz) => (devops ??= createDevOpsSource({ fetch: ado.fetch, log: () => {}, cacheDir: dir, timeZone: tz, targets: (k) => makeDataverse(cfg, tz).devopsTargets(k) })),
    saveSystemUserId: async () => {},
    now: () => NOW,
    plan,
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
  return { run, fail, plan, ado, dv };
}

describe("quick capture actions (step 9)", () => {
  it("saves at once with every source offline, and lists the inbox without any source", async () => {
    const t = setup({ offline: true });
    const r = await t.run<{ capture: { id: number; text: string; clientKey: string | null }; inboxCount: number }>("capture.add", { text: "Told Dana I'd send the export by Thursday", clientKey: "CSC" });
    expect(r).toMatchObject({ capture: { text: "Told Dana I'd send the export by Thursday", clientKey: "CSC" }, inboxCount: 1 });
    const s = await t.run<CaptureState>("capture.load", {});
    expect(s.inbox.map((c) => c.id)).toEqual([r.capture.id]);
    expect(s.today).toBe("2026-11-05");
    // Routing to a follow-up needs nothing outside the store either.
    await t.run("capture.route", { id: r.capture.id, as: "follow_up", clientKey: "CSC", who: "Dana", what: "Send the export", due: "2026-11-05" });
    expect(t.plan.openFollowUps()).toEqual([expect.objectContaining({ kind: "capture", who: "Dana", due: "2026-11-05" })]);
    // Nothing was sent anywhere: no DevOps call, and no Dataverse call for capture.add or capture.load.
    expect(t.ado.calls).toEqual([]);
  });

  it("refuses empty or oversized text and bad fields", async () => {
    const t = setup();
    expect((await t.fail("capture.add", { text: "   " })).status).toBe(400);
    expect((await t.fail("capture.add", { text: "x".repeat(1001) })).status).toBe(400);
    expect((await t.fail("capture.add", { text: "ok", extra: 1 })).status).toBe(400);
    const { capture } = await t.run<{ capture: { id: number } }>("capture.add", { text: "need to add paging" });
    expect((await t.fail("capture.route", { id: capture.id, as: "draft", title: "Add paging" })).status).toBe(400); // a draft needs a client
    expect((await t.fail("capture.route", { id: capture.id, as: "follow_up", what: "x", due: "Thursday" })).status).toBe(400);
    expect((await t.fail("capture.route", { id: capture.id, as: "elsewhere" })).status).toBe(400);
  });

  it("a draft story goes under one of the client's open features (checked with DevOps), or under none", async () => {
    const t = setup();
    const f = await t.run<CaptureFeatures>("capture.features", { clientKey: "CSC" });
    expect(f.status).toBe("ok");
    expect(f.features.map((x) => x.id)).toEqual([210, 220, 240]);
    const a = await t.run<{ capture: { id: number } }>("capture.add", { text: "need to export as CSV", clientKey: "CSC" });
    expect((await t.fail("capture.route", { id: a.capture.id, as: "draft", clientKey: "CSC", title: "Export as CSV", parentItemId: 250 })).status).toBe(422); // an epic
    const r = await t.run<{ capture: { routedId: number } }>("capture.route", { id: a.capture.id, as: "draft", clientKey: "CSC", title: "Export as CSV", size: "S", parentItemId: 240 });
    expect(t.plan.getDraft(r.capture.routedId)).toMatchObject({ clientKey: "CSC", parentItemId: 240, title: "Export as CSV", size: "S" });
    const b = await t.run<{ capture: { id: number } }>("capture.add", { text: "todo retry failed syncs", clientKey: "CSC" });
    const n = await t.run<{ capture: { routedId: number } }>("capture.route", { id: b.capture.id, as: "draft", clientKey: "CSC", title: "Retry failed syncs" });
    expect(t.plan.getDraft(n.capture.routedId)).toMatchObject({ parentItemId: null, size: "M" });
  });

  it("with DevOps down, a draft can't be put under a feature but saves without one", async () => {
    const t = setup({ offline: true });
    const a = await t.run<{ capture: { id: number } }>("capture.add", { text: "need to export", clientKey: "CSC" });
    expect((await t.fail("capture.route", { id: a.capture.id, as: "draft", clientKey: "CSC", title: "Export", parentItemId: 240 })).status).toBe(409);
    expect((await t.run<{ inboxCount: number }>("capture.route", { id: a.capture.id, as: "draft", clientKey: "CSC", title: "Export" })).inboxCount).toBe(0);
  });

  it("a draft feature goes under one of the client's open epics, or under none; there are no notes (step 13.5)", async () => {
    const t = setup();
    const f = await t.run<CaptureFeatures>("capture.features", { clientKey: "CSC" });
    expect(f.epics.map((x) => x.id)).toContain(250);
    expect(f.epics.map((x) => x.id)).not.toContain(240);
    const a = await t.run<{ capture: { id: number } }>("capture.add", { text: "feature: onboarding", clientKey: "CSC" });
    expect((await t.fail("capture.route", { id: a.capture.id, as: "draft_feature", clientKey: "CSC", title: "Onboarding", parentItemId: 240 })).status).toBe(422); // a feature, not an epic
    expect((await t.fail("capture.route", { id: a.capture.id, as: "note", clientKey: "CSC", text: "x" })).status).toBe(400);
    const r = await t.run<{ capture: { routedId: number } }>("capture.route", { id: a.capture.id, as: "draft_feature", clientKey: "CSC", title: "Onboarding", parentItemId: 250 });
    expect(t.plan.getDraft(r.capture.routedId)).toMatchObject({ level: "feature", parentItemId: 250, title: "Onboarding" });
    // Plan the week's "Draft a feature" under an epic, the same check.
    const d = await t.run<{ draft: { level: string; parentItemId: number | null } }>("draft.add_feature", { clientKey: "CSC", parentItemId: 250, title: "Self-service export" });
    expect(d.draft).toMatchObject({ level: "feature", parentItemId: 250 });
    expect((await t.fail("draft.add_feature", { clientKey: "CSC", title: " " })).status).toBe(400);
    expect((await t.fail("note.delete", { id: 1 })).status).toBe(400);
  });

  it("Close out says how many captures are unprocessed", async () => {
    const t = setup();
    await t.run("capture.add", { text: "one" });
    await t.run("capture.add", { text: "two" });
    expect((await t.run<CloseOutState>("closeout.load", { date: "2026-11-05" })).captures).toBe(2);
  });

  it("Plan the week lists the local drafts (under features) and the inbox count; readiness counts drafts under a feature", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: "2026-11-09" });
    const { capture } = await t.run<{ capture: { id: number } }>("capture.add", { text: "story: CSV export", clientKey: "CSC" });
    await t.run("capture.route", { id: capture.id, as: "draft", clientKey: "CSC", title: "CSV export", parentItemId: 240 });
    await t.run("capture.add", { text: "unsorted" });
    const s = await t.run<WeekPlanState>("weekplan.load", { weekStart: "2026-11-09" });
    expect(s.drafts).toEqual([expect.objectContaining({ clientKey: "CSC", parentItemId: 240, title: "CSV export" })]);
    expect(s.captures).toBe(1);
  });

  it("a capture follow-up shows in the Follow-ups list as captured", async () => {
    const t = setup();
    const { capture } = await t.run<{ capture: { id: number } }>("capture.add", { text: "I'll call the vendor" });
    await t.run("capture.route", { id: capture.id, as: "follow_up", who: "", what: "Call the vendor" });
    const followUps = await t.run<{ followUps: FollowUpView[] }>("followups.list", {});
    expect(followUps.followUps).toEqual([expect.objectContaining({ kind: "capture", what: "Call the vendor", due: null })]);
  });
});
