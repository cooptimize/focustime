import { withTitles } from "./weekplan-actions.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import type { PlanDayState } from "../plan/types.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { FollowUpView, WeekLoadData, WeekPlanState, WeekPlanView } from "./types.ts";

const text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);

const NOW = "2026-11-05T19:30:00Z"; // Thu Nov 5, 2:30 PM New York
const NEXT = "2026-11-09";

function setup() {
  let clock = NOW;
  const dir = mkdtempSync(join(tmpdir(), "c-week-"));
  const dv = fakeFetch("ok");
  // CSC's DevOps org gets the Plan the week scenario: features of mine, parents of my stories, an epic.
  const ado = fakeDevOps({ cscsteel: "planweek", cooptimize: "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, cacheDir: dir, log: () => {} });
  const devops = new Map<string, ReturnType<typeof createDevOpsSource>>();
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(clock).toZonedDateTimeISO("America/New_York") });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: (cfg, tz) => {
      const key = JSON.stringify([cfg, tz]);
      let s = devops.get(key);
      if (!s) devops.set(key, (s = createDevOpsSource({ fetch: ado.fetch, log: () => {}, cacheDir: dir, timeZone: tz, targets: (k) => makeDataverse(cfg, tz).devopsTargets(k) })));
      return s;
    },
    saveSystemUserId: async () => {},
    now: () => clock,
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
  return { run, fail, plan, ado, at: (i: string) => void (clock = i) };
}

/** CSC's focus blocks in a loaded week, and an Open half-day. */
function slots(week: WeekLoadData) {
  const all = week.week.days.flatMap((d) => [d.am, d.pm]);
  return { csc: all.filter((s) => s.focus[0]?.clientKey === "CSC"), other: all.find((s) => s.focus[0] && s.focus[0].clientKey !== "CSC"), open: all.find((s) => s.open) };
}

describe("Plan the week actions (step 8)", () => {
  it("loads next week by default with CSC's features and epics from DevOps, read-only", async () => {
    const t = setup();
    const s = await t.run<WeekPlanState>("weekplan.load", {});
    expect(s).toMatchObject({ weekStart: NEXT, thisWeek: "2026-11-02", access: "plan", plan: { committedAt: null, features: [] } });
    const csc = s.portfolios.find((p) => p.clientKey === "CSC")!;
    expect(csc.items.map((i) => [i.id, i.tier])).toEqual([[210, "feature"], [220, "feature"], [230, "epic"], [240, "feature"], [250, "epic"]]);
    for (const call of t.ado.calls) if (call.method === "POST") expect(call.url).toMatch(/\/_apis\/wit\/(wiql|workitemsbatch)\?/);
  });

  it("commits features by blocks or by placing them on CSC's blocks; refuses other clients' blocks and unknown features", async () => {
    const t = setup();
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const { csc, other, open } = slots(week);
    expect(csc.length).toBeGreaterThan(0);
    await t.run("weekplan.load", { weekStart: NEXT });
    const a = await t.run<{ plan: WeekPlanView }>("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 210, blocks: 2 });
    expect(a.plan.features).toEqual([expect.objectContaining({ clientKey: "CSC", itemId: 210, title: "Dana's feature", itemType: "Feature", blocks: 2 })]);
    // Placing a feature not yet on the plan commits it with one block.
    const p = await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "CSC", itemId: 240, date: csc[0]!.date, half: csc[0]!.half, on: true });
    expect(p.plan.features.find((f) => f.itemId === 240)).toMatchObject({ blocks: 1, slots: [{ date: csc[0]!.date, half: csc[0]!.half }] });
    if (open) expect((await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "CSC", itemId: 210, date: open.date, half: open.half, on: true })).plan.features.find((f) => f.itemId === 210)!.slots).toHaveLength(1);
    if (other) expect((await t.fail("weekplan.place", { weekStart: NEXT, clientKey: "CSC", itemId: 210, date: other.date, half: other.half, on: true })).status).toBe(422);
    expect((await t.fail("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 999, blocks: 1 })).status).toBe(422);
    // An epic is not committed to a week; its features are.
    expect((await t.fail("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 250, blocks: 1 })).status).toBe(422);
    expect((await t.fail("weekplan.place", { weekStart: NEXT, clientKey: "CSC", itemId: 210, date: "2026-11-16", half: "AM", on: true })).status).toBe(422);
  });

  it("Q51: shows the current DevOps title; the stored title only when DevOps can't give one", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 210, blocks: 1 });
    // The title stored at commit differs from DevOps's (as after a rename in DevOps).
    t.plan.setWeekFeature({ weekStart: NEXT, clientKey: "CSC", itemId: 210, title: "Name at commit", itemType: "Feature", url: null, blocks: 1 });
    const s = await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT });
    expect(s.plan.features[0]).toMatchObject({ title: "Dana's feature", titleSource: "devops" });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    expect(w.weekPlan!.features[0]).toMatchObject({ title: "Dana's feature", titleSource: "devops" });
    // DevOps unreachable (a fresh server with only the stored plan): the stored title stands, marked as saved.
    expect(withTitles({ weekStart: NEXT, committedAt: null, updatedAt: null, changed: false, features: t.plan.weekPlan(NEXT).features }, () => null).features[0]).toMatchObject({ title: "Name at commit", titleSource: "saved" });
  });

  it("commits the week, stays editable and re-committable, and week.load shows it", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 210, blocks: 2 });
    const c = await t.run<{ plan: WeekPlanView }>("weekplan.commit", { weekStart: NEXT });
    expect(c.plan.committedAt).toBeTruthy();
    expect(c.plan.changed).toBe(false);
    t.at("2026-11-05T19:45:00Z");
    const e = await t.run<{ plan: WeekPlanView }>("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 210, blocks: 3 });
    expect(e.plan.changed).toBe(true);
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    expect(week.weekPlan?.features.map((f) => [f.itemId, f.blocks])).toEqual([[210, 3]]);
    expect(week.weekFeatures.map((f) => f.itemId)).toEqual([210]);
  });

  it("Plan the day for that week offers the committed feature's stories: the feature and its open children come with the DevOps read", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 210, blocks: 2 });
    await t.run("weekplan.commit", { weekStart: NEXT });
    t.at("2026-11-09T13:30:00Z"); // Mon Nov 9, 8:30 AM
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const csc = week.devops!.find((w) => w.clientKey === "CSC")!;
    expect(csc.committed?.map((i) => i.id)).toEqual([210]);
    expect(csc.children.map((c) => c.id)).toContain(212);
    const day = await t.run<PlanDayState>("planday.start", { date: NEXT });
    expect(day.weekFeatures).toEqual([expect.objectContaining({ clientKey: "CSC", itemId: 210, title: "Dana's feature" })]);
    // A story of the committed feature (not mine) can be picked.
    const added = await t.run<{ pick: { title: string } }>("pick.add", { date: NEXT, half: "PM", clientKey: "CSC", itemId: 212 });
    expect(added.pick.title).toBe("Unassigned story");
  });

  it("a past week is a review: nothing changes", async () => {
    const t = setup();
    const s = await t.run<WeekPlanState>("weekplan.load", { weekStart: "2026-10-26" });
    expect(s.access).toBe("past");
    expect(s.portfolios).toEqual([]);
    for (const [a, i] of [
      ["weekplan.set_feature", { weekStart: "2026-10-26", clientKey: "CSC", itemId: 210, blocks: 1 }],
      ["weekplan.commit", { weekStart: "2026-10-26" }],
      ["weekplan.place", { weekStart: "2026-10-26", clientKey: "CSC", itemId: 210, date: "2026-10-26", half: "AM", on: true }],
    ] as const)
      expect((await t.fail(a, i)).status).toBe(409);
    expect((await t.fail("weekplan.load", { weekStart: "2026-11-10" })).status).toBe(400);
  });

  it("copies a Coop brief with DevOps fields only, reading the description just for it", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    const before = t.ado.calls.length;
    const b = await t.run<{ markdown: string }>("feature.brief", { clientKey: "CSC", itemId: 210 });
    expect(b.markdown).toContain("# Coop brief: Feature #210 Dana's feature");
    expect(b.markdown).toContain("Export the weekly report & email it.");
    expect(b.markdown).toContain("- #212 User Story: Unassigned story (New)");
    expect(b.markdown).not.toContain("Dana Ruiz");
    expect(t.ado.calls.slice(before).filter((c) => c.body?.includes("System.Description"))).toHaveLength(1);
  });

  it("marks a feature as being broken down, and creates the 'ask about priorities' follow-up once per client and week", async () => {
    const t = setup();
    await t.run("feature.mark_breakdown", { clientKey: "CSC", itemId: 240, on: true });
    expect((await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT })).marks).toEqual([expect.objectContaining({ clientKey: "CSC", itemId: 240 })]);
    const l = await t.run<{ followUp: FollowUpView; created: boolean }>("followup.ask_priorities", { weekStart: NEXT, clientKey: "CSC" });
    expect(l.created).toBe(true);
    expect(l.followUp).toMatchObject({ kind: "priorities", clientKey: "CSC" });
    expect(l.followUp.what).toMatch(/^Ask .+ about priorities for the week of Mon, Nov 9$/);
    expect(l.followUp.draft).toContain("Nothing open is assigned to me in DevOps right now.");
    expect((await t.run<{ created: boolean }>("followup.ask_priorities", { weekStart: NEXT, clientKey: "CSC" })).created).toBe(false);
    expect((await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT })).followUps).toHaveLength(1);
  });

  it("week.load raises the Plan the week badge after Thursday's nudge until next week is committed", async () => {
    const t = setup();
    expect((await t.run<WeekLoadData>("week.load", {})).weekNudge.badge).toBe(NEXT);
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "CSC", itemId: 210, blocks: 1 });
    await t.run("weekplan.commit", { weekStart: NEXT });
    expect((await t.run<WeekLoadData>("week.load", {})).weekNudge.badge).toBeNull();
  });
});

describe("week plan by client (step 11)", () => {
  type Res = { plan: WeekPlanView; headsUp: { weekStart: string; clientKey: string; itemId: number; title: string } | null };
  it("adds DevOps features and stories as musts or nice to haves; refuses what DevOps doesn't show for that client", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: NEXT });
    await t.run("weekplan.load", { weekStart: NEXT });
    const a = await t.run<{ plan: WeekPlanView }>("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 210 });
    expect(a.plan.features).toEqual([expect.objectContaining({ itemId: 210, level: "feature", tier: "must", blocks: 1 })]);
    // A story of mine (work read) and a story under a feature that isn't mine (portfolio read).
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 204, tier: "nice" });
    const c = await t.run<{ plan: WeekPlanView }>("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 212, blocks: 1.5 });
    expect(c.plan.features.map((f) => [f.itemId, f.level, f.tier, f.blocks])).toEqual([[210, "feature", "must", 1], [204, "story", "nice", 0.5], [212, "story", "must", 1.5]]);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 999 })).status).toBe(422);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 250 })).status).toBe(422); // an epic
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 210, blocks: 0.3 })).status).toBe(400);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 210, tier: "maybe" })).status).toBe(400);
  });

  it("moves, reorders and resets in one call each, no reason asked; nothing goes to DevOps", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: NEXT });
    await t.run("weekplan.load", { weekStart: NEXT });
    for (const itemId of [210, 240, 201]) await t.run("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId });
    const posts = t.ado.calls.length;
    const id = (n: number) => t.plan.weekPlan(NEXT).features.find((f) => f.itemId === n)!.id;
    const r = await t.run<{ plan: WeekPlanView }>("weekplan.reorder", { weekStart: NEXT, clientKey: "CSC", tier: "must", order: [201, 210, 240] });
    expect(Object.fromEntries(r.plan.features.map((f) => [f.itemId, f.position]))).toEqual({ 210: 2, 240: 3, 201: 1 });
    const s = await t.run<Res>("weekplan.set_tier", { id: id(240), tier: "nice" });
    expect(s.headsUp).toBeNull(); // not committed yet
    expect(s.plan.features.find((f) => f.itemId === 240)).toMatchObject({ tier: "nice", position: null });
    await t.run("weekplan.set_blocks", { id: id(210), blocks: 2.5 });
    await t.run("weekplan.mark_done", { id: id(201), on: true });
    const z = await t.run<{ plan: WeekPlanView }>("weekplan.reorder", { weekStart: NEXT, clientKey: "CSC", reset: true });
    expect(z.plan.features.every((f) => f.position === null)).toBe(true);
    expect(z.plan.features.find((f) => f.itemId === 201)!.doneAt).toBeTruthy();
    expect((await t.fail("weekplan.reorder", { weekStart: NEXT, clientKey: "CSC", tier: "must", order: [201, 201] })).status).toBe(400);
    expect((await t.fail("weekplan.reorder", { weekStart: NEXT, clientKey: "CSC", tier: "must", order: [240] })).status).toBe(409);
    // Local only: no DevOps writes, and no reads beyond what's cached.
    expect(t.ado.calls.slice(posts).filter((c) => c.method !== "GET" && c.method !== "POST")).toEqual([]);
    for (const call of t.ado.calls) if (call.method === "POST") expect(call.url).toMatch(/\/_apis\/wit\/(wiql|workitemsbatch)\?/);
  });

  it("dropping a must the week was committed with offers the heads-up follow-up (once); a must added after the commit doesn't", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: NEXT });
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 210 });
    await t.run("weekplan.commit", { weekStart: NEXT });
    t.at("2026-11-05T19:45:00Z");
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 240 });
    const id = (n: number) => t.plan.weekPlan(NEXT).features.find((f) => f.itemId === n)!.id;
    expect((await t.run<Res>("weekplan.remove", { id: id(240) })).headsUp).toBeNull();
    const d = await t.run<Res>("weekplan.set_tier", { id: id(210), tier: "nice" });
    expect(d.headsUp).toEqual({ weekStart: NEXT, clientKey: "CSC", itemId: 210, title: "Dana's feature", trigger: "demoted" });
    const l = await t.run<{ followUp: FollowUpView; created: boolean }>("weekplan.headsup", d.headsUp!);
    expect(l.created).toBe(true);
    expect(l.followUp).toMatchObject({ kind: "slip", clientKey: "CSC" });
    // Step 13.5: it says where it came from.
    expect(l.followUp.origin).toEqual({ trigger: "A committed must was made a nice to have", items: [{ itemId: 210, title: "Dana's feature" }], at: "2026-11-05T19:45:00Z" });
    expect(l.followUp.draft).toContain("#210 Dana's feature won't be finished the week of Mon, Nov 9");
    expect((await t.run<{ created: boolean }>("weekplan.headsup", d.headsUp!)).created).toBe(false);
    // A nice to have dropped: nothing offered.
    expect((await t.run<Res>("weekplan.remove", { id: id(210) })).headsUp).toBeNull();
  });

  it("pins without raising blocks; pinning a story not on the list puts it on as a must", async () => {
    const t = setup();
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const { csc } = slots(week);
    await t.run("weekplan.load", { weekStart: NEXT });
    const p = await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "CSC", itemId: 201, date: csc[0]!.date, half: csc[0]!.half, on: true });
    expect(p.plan.features).toEqual([expect.objectContaining({ itemId: 201, level: "story", tier: "must", blocks: 0.5, slots: [{ date: csc[0]!.date, half: csc[0]!.half }] })]);
    if (csc[1]) expect((await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "CSC", itemId: 201, date: csc[1].date, half: csc[1].half, on: true })).plan.features[0]!.blocks).toBe(0.5);
  });

  it("week.load reads list items by id, so a story completed in DevOps still comes back (for progress)", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: NEXT });
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "CSC", itemId: 210 });
    // 211 is a Closed story under 210: not mine, not open; put it on the list directly (as if done after adding).
    t.plan.addWeekItem({ weekStart: NEXT, clientKey: "CSC", itemId: 211, title: "Done story", itemType: "User Story", url: null, level: "story" });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const csc = w.devops!.find((x) => x.clientKey === "CSC")!;
    expect(csc.watched?.find((i) => i.id === 211)?.stateCategory).toBe("Completed");
    expect(csc.committed?.map((i) => i.id)).toEqual([210]);
  });

  it("a past week stays a review for the new actions too", async () => {
    const t = setup();
    expect((await t.fail("weekplan.add", { weekStart: "2026-10-26", clientKey: "CSC", itemId: 210 })).status).toBe(409);
    expect((await t.fail("weekplan.reorder", { weekStart: "2026-10-26", clientKey: "CSC", reset: true })).status).toBe(409);
  });
});

describe("draft stories with no feature (step 11)", () => {
  it("draft.add_story takes parentItemId null", async () => {
    const t = setup();
    const d = await t.run<{ draft: { parentItemId: number | null; title: string } }>("draft.add_story", { clientKey: "CSC", parentItemId: null, title: "Paging for the export" });
    expect(d.draft).toMatchObject({ parentItemId: null, title: "Paging for the export" });
  });
});
