import { createSnapshotStore } from "../host/local/snapshots.ts";
import { withTitles } from "./weekplan-actions.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
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
  // Adatum's DevOps org gets the Plan the week scenario: features of mine, parents of my stories, an epic.
  const ado = fakeDevOps({ contoso: "planweek", cooptimize: "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(dir), log: () => {} });
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
      if (!s) devops.set(key, (s = createDevOpsSource({ fetch: ado.fetch, log: () => {}, snapshots: createSnapshotStore(dir), timeZone: tz, targets: (k) => makeDataverse(cfg, tz).devopsTargets(k) })));
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

/** Adatum's focus blocks in a loaded week, and an Open half-day. */
function slots(week: WeekLoadData) {
  const all = week.week.days.flatMap((d) => [d.am, d.pm]);
  return { adatum: all.filter((s) => s.focus[0]?.clientKey === "Adatum"), other: all.find((s) => s.focus[0] && s.focus[0].clientKey !== "Adatum"), open: all.find((s) => s.open) };
}

describe("Plan the week actions (step 8)", () => {
  it("loads next week by default with Adatum's features and epics from DevOps, read-only", async () => {
    const t = setup();
    const s = await t.run<WeekPlanState>("weekplan.load", {});
    expect(s).toMatchObject({ weekStart: NEXT, thisWeek: "2026-11-02", access: "plan", plan: { committedAt: null, features: [] } });
    const adatum = s.portfolios.find((p) => p.clientKey === "Adatum")!;
    expect(adatum.items.map((i) => [i.id, i.tier])).toEqual([[210, "feature"], [220, "feature"], [230, "epic"], [240, "feature"], [250, "epic"]]);
    for (const call of t.ado.calls) if (call.method === "POST") expect(call.url).toMatch(/\/_apis\/wit\/(wiql|workitemsbatch)\?/);
  });

  it("commits features by hours or by placing them on Adatum's blocks; refuses other clients' blocks and unknown features", async () => {
    const t = setup();
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const { adatum, other, open } = slots(week);
    expect(adatum.length).toBeGreaterThan(0);
    await t.run("weekplan.load", { weekStart: NEXT });
    const a = await t.run<{ plan: WeekPlanView }>("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 8 });
    expect(a.plan.features).toEqual([expect.objectContaining({ clientKey: "Adatum", itemId: 210, title: "Dana's feature", itemType: "Feature", estimate: 480 })]);
    // Placing a feature not yet on the plan commits it with one block.
    const p = await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "Adatum", itemId: 240, date: adatum[0]!.date, half: adatum[0]!.half, on: true });
    expect(p.plan.features.find((f) => f.itemId === 240)).toMatchObject({ estimate: null, slots: [{ date: adatum[0]!.date, half: adatum[0]!.half }] });
    if (open) expect((await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, date: open.date, half: open.half, on: true })).plan.features.find((f) => f.itemId === 210)!.slots).toHaveLength(1);
    if (other) expect((await t.fail("weekplan.place", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, date: other.date, half: other.half, on: true })).status).toBe(422);
    expect((await t.fail("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 999, hours: 4 })).status).toBe(422);
    // An epic is not committed to a week; its features are.
    expect((await t.fail("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 250, hours: 4 })).status).toBe(422);
    expect((await t.fail("weekplan.place", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, date: "2026-11-16", half: "AM", on: true })).status).toBe(422);
  });

  it("Q51: shows the current DevOps title; the stored title only when DevOps can't give one", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 4 });
    // The title stored at commit differs from DevOps's (as after a rename in DevOps).
    (await t.plan.setWeekFeature({ weekStart: NEXT, clientKey: "Adatum", itemId: 210, title: "Name at commit", itemType: "Feature", url: null, estimate: 240 }));
    const s = await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT });
    expect(s.plan.features[0]).toMatchObject({ title: "Dana's feature", titleSource: "devops" });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    expect(w.weekPlan!.features[0]).toMatchObject({ title: "Dana's feature", titleSource: "devops" });
    // DevOps unreachable (a fresh server with only the stored plan): the stored title stands, marked as saved.
    expect(withTitles({ weekStart: NEXT, committedAt: null, updatedAt: null, changed: false, features: (await t.plan.weekPlan(NEXT)).features }, () => null).features[0]).toMatchObject({ title: "Name at commit", titleSource: "saved" });
  });

  it("commits the week, stays editable and re-committable, and week.load shows it", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 8 });
    const c = await t.run<{ plan: WeekPlanView }>("weekplan.commit", { weekStart: NEXT });
    expect(c.plan.committedAt).toBeTruthy();
    expect(c.plan.changed).toBe(false);
    t.at("2026-11-05T19:45:00Z");
    const e = await t.run<{ plan: WeekPlanView }>("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 12 });
    expect(e.plan.changed).toBe(true);
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    expect(week.weekPlan?.features.map((f) => [f.itemId, f.estimate])).toEqual([[210, 720]]);
    expect(week.weekFeatures.map((f) => f.itemId)).toEqual([210]);
  });

  it("Plan the day for that week offers the committed feature's stories: the feature and its open children come with the DevOps read", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 8 });
    await t.run("weekplan.commit", { weekStart: NEXT });
    t.at("2026-11-09T13:30:00Z"); // Mon Nov 9, 8:30 AM
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const adatum = week.devops!.find((w) => w.clientKey === "Adatum")!;
    expect(adatum.committed?.map((i) => i.id)).toEqual([210]);
    expect(adatum.children.map((c) => c.id)).toContain(212);
    const day = await t.run<PlanDayState>("planday.start", { date: NEXT });
    expect(day.weekFeatures).toEqual([expect.objectContaining({ clientKey: "Adatum", itemId: 210, title: "Dana's feature" })]);
    // A story of the committed feature (not mine) can be picked.
    const added = await t.run<{ pick: { title: string } }>("pick.add", { date: NEXT, half: "PM", clientKey: "Adatum", itemId: 212 });
    expect(added.pick.title).toBe("Unassigned story");
  });

  it("a past week is a review: nothing changes", async () => {
    const t = setup();
    const s = await t.run<WeekPlanState>("weekplan.load", { weekStart: "2026-10-26" });
    expect(s.access).toBe("past");
    expect(s.portfolios).toEqual([]);
    for (const [a, i] of [
      ["weekplan.set_feature", { weekStart: "2026-10-26", clientKey: "Adatum", itemId: 210, hours: 4 }],
      ["weekplan.commit", { weekStart: "2026-10-26" }],
      ["weekplan.place", { weekStart: "2026-10-26", clientKey: "Adatum", itemId: 210, date: "2026-10-26", half: "AM", on: true }],
    ] as const)
      expect((await t.fail(a, i)).status).toBe(409);
    expect((await t.fail("weekplan.load", { weekStart: "2026-11-10" })).status).toBe(400);
  });

  it("copies a Coop brief with DevOps fields only, reading the description just for it", async () => {
    const t = setup();
    await t.run("weekplan.load", { weekStart: NEXT });
    const before = t.ado.calls.length;
    const b = await t.run<{ markdown: string }>("feature.brief", { clientKey: "Adatum", itemId: 210 });
    expect(b.markdown).toContain("# Coop brief: Feature #210 Dana's feature");
    expect(b.markdown).toContain("Export the weekly report & email it.");
    expect(b.markdown).toContain("- #212 User Story: Unassigned story (New)");
    expect(b.markdown).not.toContain("Dana Ruiz");
    expect(t.ado.calls.slice(before).filter((c) => c.body?.includes("System.Description"))).toHaveLength(1);
  });

  it("marks a feature as being broken down, and creates the 'ask about priorities' follow-up once per client and week", async () => {
    const t = setup();
    await t.run("feature.mark_breakdown", { clientKey: "Adatum", itemId: 240, on: true });
    expect((await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT })).marks).toEqual([expect.objectContaining({ clientKey: "Adatum", itemId: 240 })]);
    const l = await t.run<{ followUp: FollowUpView; created: boolean }>("followup.ask_priorities", { weekStart: NEXT, clientKey: "Adatum" });
    expect(l.created).toBe(true);
    expect(l.followUp).toMatchObject({ kind: "priorities", clientKey: "Adatum" });
    expect(l.followUp.what).toMatch(/^Ask .+ about priorities for the week of Mon, Nov 9$/);
    expect(l.followUp.draft).toContain("Nothing open is assigned to me in DevOps right now.");
    expect((await t.run<{ created: boolean }>("followup.ask_priorities", { weekStart: NEXT, clientKey: "Adatum" })).created).toBe(false);
    expect((await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT })).followUps).toHaveLength(1);
  });

  it("week.load raises the Plan the week badge after Thursday's nudge until next week is committed", async () => {
    const t = setup();
    expect((await t.run<WeekLoadData>("week.load", {})).weekNudge.badge).toBe(NEXT);
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.set_feature", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 4 });
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
    const a = await t.run<{ plan: WeekPlanView }>("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 210 });
    expect(a.plan.features).toEqual([expect.objectContaining({ itemId: 210, level: "feature", tier: "must", estimate: null })]);
    // A story of mine (work read) and a story under a feature that isn't mine (portfolio read).
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 204, tier: "nice" });
    const c = await t.run<{ plan: WeekPlanView }>("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 212, size: "L" });
    expect(c.plan.features.map((f) => [f.itemId, f.level, f.tier, f.estimate, f.size])).toEqual([[210, "feature", "must", null, null], [204, "story", "nice", null, null], [212, "story", "must", null, "L"]]);
    // E2: whole hours for features (1 to 80), sizes for stories.
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 1.5 })).status).toBe(400);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 204, hours: 4 })).status).toBe(400);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, size: "M" })).status).toBe(400);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 999 })).status).toBe(422);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 250 })).status).toBe(422); // an epic
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, hours: 81 })).status).toBe(400);
    expect((await t.fail("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 210, tier: "maybe" })).status).toBe(400);
  });

  it("moves, reorders and resets in one call each, no reason asked; nothing goes to DevOps", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: NEXT });
    await t.run("weekplan.load", { weekStart: NEXT });
    for (const itemId of [210, 240, 201]) await t.run("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId });
    const posts = t.ado.calls.length;
    const id = async (n: number) => (await t.plan.weekPlan(NEXT)).features.find((f) => f.itemId === n)!.id;
    const r = await t.run<{ plan: WeekPlanView }>("weekplan.reorder", { weekStart: NEXT, clientKey: "Adatum", tier: "must", order: [201, 210, 240] });
    expect(Object.fromEntries(r.plan.features.map((f) => [f.itemId, f.position]))).toEqual({ 210: 2, 240: 3, 201: 1 });
    const s = await t.run<Res>("weekplan.set_tier", { id: await id(240), tier: "nice" });
    expect(s.headsUp).toBeNull(); // not committed yet
    expect(s.plan.features.find((f) => f.itemId === 240)).toMatchObject({ tier: "nice", position: null });
    await t.run("weekplan.set_estimate", { id: await id(210), hours: 10 });
    expect((await t.plan.weekPlan(NEXT)).features.find((f) => f.itemId === 210)!.estimate).toBe(600);
    await t.run("weekplan.set_estimate", { id: await id(210), hours: 12 });
    for (const hours of [0, 2.5, 81, "6"]) expect((await t.fail("weekplan.set_estimate", { id: await id(210), hours })).status).toBe(400);
    expect((await t.fail("weekplan.set_estimate", { id: await id(201), hours: 4 })).status).toBe(422);
    await t.run("weekplan.set_size", { id: await id(201), size: "S" });
    // Sizing is optional: clearing it is allowed.
    await t.run("weekplan.set_size", { id: await id(201), size: null });
    expect((await t.plan.weekPlan(NEXT)).features.find((f) => f.itemId === 201)!.size).toBeNull();
    await t.run("weekplan.set_size", { id: await id(201), size: "S" });
    expect((await t.fail("weekplan.set_size", { id: await id(210), size: "S" })).status).toBe(422);
    await t.run("weekplan.mark_done", { id: await id(201), on: true });
    const z = await t.run<{ plan: WeekPlanView }>("weekplan.reorder", { weekStart: NEXT, clientKey: "Adatum", reset: true });
    expect(z.plan.features.every((f) => f.position === null)).toBe(true);
    expect(z.plan.features.find((f) => f.itemId === 201)!.doneAt).toBeTruthy();
    expect((await t.fail("weekplan.reorder", { weekStart: NEXT, clientKey: "Adatum", tier: "must", order: [201, 201] })).status).toBe(400);
    expect((await t.fail("weekplan.reorder", { weekStart: NEXT, clientKey: "Adatum", tier: "must", order: [240] })).status).toBe(409);
    // Local only: no DevOps writes, and no reads beyond what's cached.
    expect(t.ado.calls.slice(posts).filter((c) => c.method !== "GET" && c.method !== "POST")).toEqual([]);
    for (const call of t.ado.calls) if (call.method === "POST") expect(call.url).toMatch(/\/_apis\/wit\/(wiql|workitemsbatch)\?/);
  });

  it("dropping a must the week was committed with offers the heads-up follow-up (once); a must added after the commit doesn't", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: NEXT });
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 210 });
    await t.run("weekplan.commit", { weekStart: NEXT });
    t.at("2026-11-05T19:45:00Z");
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 240 });
    const id = async (n: number) => (await t.plan.weekPlan(NEXT)).features.find((f) => f.itemId === n)!.id;
    expect((await t.run<Res>("weekplan.remove", { id: await id(240) })).headsUp).toBeNull();
    const d = await t.run<Res>("weekplan.set_tier", { id: await id(210), tier: "nice" });
    expect(d.headsUp).toEqual({ weekStart: NEXT, clientKey: "Adatum", itemId: 210, title: "Dana's feature", trigger: "demoted" });
    const l = await t.run<{ followUp: FollowUpView; created: boolean }>("weekplan.headsup", d.headsUp!);
    expect(l.created).toBe(true);
    expect(l.followUp).toMatchObject({ kind: "slip", clientKey: "Adatum" });
    // Step 13.5: it says where it came from.
    expect(l.followUp.origin).toEqual({ trigger: "A confirmed must was made a nice to have", items: [{ itemId: 210, title: "Dana's feature" }], at: "2026-11-05T19:45:00Z" });
    expect(l.followUp.draft).toContain("#210 Dana's feature won't be finished the week of Mon, Nov 9");
    expect((await t.run<{ created: boolean }>("weekplan.headsup", d.headsUp!)).created).toBe(false);
    // A nice to have dropped: nothing offered.
    expect((await t.run<Res>("weekplan.remove", { id: await id(210) })).headsUp).toBeNull();
  });

  it("pins without raising blocks; pinning a story not on the list puts it on as a must", async () => {
    const t = setup();
    const week = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const { adatum } = slots(week);
    await t.run("weekplan.load", { weekStart: NEXT });
    const p = await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "Adatum", itemId: 201, date: adatum[0]!.date, half: adatum[0]!.half, on: true });
    expect(p.plan.features).toEqual([expect.objectContaining({ itemId: 201, level: "story", tier: "must", estimate: null, size: null, slots: [{ date: adatum[0]!.date, half: adatum[0]!.half }] })]);
    if (adatum[1]) expect((await t.run<{ plan: WeekPlanView }>("weekplan.place", { weekStart: NEXT, clientKey: "Adatum", itemId: 201, date: adatum[1].date, half: adatum[1].half, on: true })).plan.features[0]!.size).toBeNull();
  });

  it("week.load reads list items by id, so a story completed in DevOps still comes back (for progress)", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: NEXT });
    await t.run("weekplan.load", { weekStart: NEXT });
    await t.run("weekplan.add", { weekStart: NEXT, clientKey: "Adatum", itemId: 210 });
    // 211 is a Closed story under 210: not mine, not open; put it on the list directly (as if done after adding).
    (await t.plan.addWeekItem({ weekStart: NEXT, clientKey: "Adatum", itemId: 211, title: "Done story", itemType: "User Story", url: null, level: "story" }));
    const w = await t.run<WeekLoadData>("week.load", { weekStart: NEXT });
    const adatum = w.devops!.find((x) => x.clientKey === "Adatum")!;
    expect(adatum.watched?.find((i) => i.id === 211)?.stateCategory).toBe("Completed");
    expect(adatum.committed?.map((i) => i.id)).toEqual([210]);
  });

  it("a past week stays a review for the new actions too", async () => {
    const t = setup();
    expect((await t.fail("weekplan.add", { weekStart: "2026-10-26", clientKey: "Adatum", itemId: 210 })).status).toBe(409);
    expect((await t.fail("weekplan.reorder", { weekStart: "2026-10-26", clientKey: "Adatum", reset: true })).status).toBe(409);
  });
});

describe("draft stories with no feature (step 11)", () => {
  it("draft.add_story takes parentItemId null", async () => {
    const t = setup();
    const d = await t.run<{ draft: { parentItemId: number | null; title: string } }>("draft.add_story", { clientKey: "Adatum", parentItemId: null, title: "Paging for the export" });
    expect(d.draft).toMatchObject({ parentItemId: null, title: "Paging for the export" });
  });
});

describe("Plan the week one client at a time (U6)", () => {
  it("the type box: a draft feature as a must or a nice to have; its tier changes; off takes it off; a past week refuses", async () => {
    const t = setup();
    const a = await t.run<{ draft: { id: number; level: string; parentItemId: number | null }; weekDrafts: { draftId: number; tier: string }[] }>("weekplan.add_draft", { weekStart: NEXT, clientKey: "Adatum", title: "Self-service export", tier: "must" });
    expect(a.draft).toMatchObject({ level: "feature", parentItemId: null });
    await t.run("weekplan.add_draft", { weekStart: NEXT, clientKey: "Adatum", title: "Audit trail", tier: "nice" });
    let s = await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT });
    expect(s.weekDrafts.map((d) => d.tier)).toEqual(["must", "nice"]);
    expect(s.drafts.filter((d) => d.level === "feature").map((d) => d.title)).toEqual(["Self-service export", "Audit trail"]);
    // The week list's records (week_features) are not touched by drafts.
    expect(s.plan.features).toEqual([]);
    await t.run("weekplan.draft_tier", { weekStart: NEXT, draftId: a.draft.id, tier: "nice" });
    await t.run("weekplan.draft_tier", { weekStart: NEXT, draftId: s.weekDrafts[1]!.draftId, tier: "off" });
    s = await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT });
    expect(s.weekDrafts).toEqual([{ draftId: a.draft.id, tier: "nice" }]);
    expect((await t.fail("weekplan.add_draft", { weekStart: NEXT, clientKey: "Adatum", title: " ", tier: "must" })).status).toBe(400);
    // D437: the type box always saves a draft feature; a level can't be asked for (never a story).
    expect((await t.fail("weekplan.add_draft", { weekStart: NEXT, clientKey: "Adatum", title: "A story?", tier: "must", level: "story" })).status).toBe(400);
    expect((await t.fail("weekplan.add_draft", { weekStart: "2026-10-26", clientKey: "Adatum", title: "Late", tier: "must" })).status).toBe(409);
  });

  it("a week-list draft created in DevOps becomes a week item with its tier once DevOps shows it", async () => {
    const t = setup();
    const a = await t.run<{ draft: { id: number } }>("weekplan.add_draft", { weekStart: NEXT, clientKey: "Adatum", title: "Reporting", tier: "must" });
    const s0 = await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT });
    const feature = s0.portfolios.find((p) => p.clientKey === "Adatum")!.items.find((i) => i.tier === "feature")!;
    (await t.plan.markDraftCreated(a.draft.id, { itemId: feature.id, url: feature.url, title: feature.title, type: feature.type }));
    const s = await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT });
    expect(s.weekDrafts).toEqual([]);
    expect(s.plan.features.map((f) => [f.itemId, f.tier, f.level])).toEqual([[feature.id, "must", "feature"]]);
  });

  it("Nothing this week is kept per week and client, and taken back", async () => {
    const t = setup();
    await t.run("weekplan.nothing", { weekStart: NEXT, clientKey: "Adatum", on: true });
    expect((await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT })).quiet).toEqual(["Adatum"]);
    expect((await t.run<WeekPlanState>("weekplan.load", { weekStart: "2026-11-16" })).quiet).toEqual([]);
    await t.run("weekplan.nothing", { weekStart: NEXT, clientKey: "Adatum", on: false });
    expect((await t.run<WeekPlanState>("weekplan.load", { weekStart: NEXT })).quiet).toEqual([]);
  });
});

describe("S1 (D453): Plan the week takes PTO the same way as Week", () => {
  it("a block on a PTO day reads PTO on Week and can't be pinned in Plan the week", async () => {
    const t = setup();
    const w = "2026-11-16"; // the fake Dataverse has PTO Mon Nov 16 and Tue Nov 17 ("Trip")
    const week = await t.run<WeekLoadData>("week.load", { weekStart: w });
    const off = week.week.days.flatMap((d) => [d.am, d.pm]).filter((s) => s.pto);
    expect(off.map((s) => s.date)).toEqual(["2026-11-16", "2026-11-16", "2026-11-17", "2026-11-17"]);
    const blocked = off.find((s) => s.focus[0]);
    expect(blocked).toBeTruthy();
    const r = await t.fail("weekplan.place", { weekStart: w, clientKey: blocked!.focus[0]!.clientKey, itemId: 210, date: blocked!.date, half: blocked!.half, on: true });
    expect([r.status, !r.ok && r.error]).toEqual([422, "That half-day is PTO. Nothing can be planned on it"]);
  });
});
