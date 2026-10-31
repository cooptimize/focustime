import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import type { IgnitionState, Pick } from "../plan/types.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { WeekLoadData } from "./types.ts";

const text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);

const NOW = "2026-11-03T14:00:00Z"; // Tue 9:00 New York

function setup(opts: { noPlan?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "c-plan-"));
  const dv = fakeFetch("ok");
  const ado = fakeDevOps({ cscsteel: "portfolio", cooptimize: "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, cacheDir: dir, log: () => {} });
  const devopsByKey = new Map<string, ReturnType<typeof createDevOpsSource>>();
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: (cfg, tz) => {
      const key = JSON.stringify([cfg, tz]);
      let s = devopsByKey.get(key);
      if (!s) devopsByKey.set(key, (s = createDevOpsSource({ fetch: ado.fetch, log: () => {}, cacheDir: dir, timeZone: tz, targets: (k) => makeDataverse(cfg, tz).devopsTargets(k) })));
      return s;
    },
    saveSystemUserId: async () => {},
    now: () => NOW,
    ...(opts.noPlan ? {} : { plan }),
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
  return { c, run, fail, dv, ado, plan };
}

const D = "2026-11-03";

describe("ignition actions", () => {
  it("a whole morning: start, pick items and an intention, size, move, commit, tick, all persisted locally", async () => {
    const t = setup();
    const week = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(week.ignition).toEqual({ date: D, workday: true, committed: false, available: true });

    const start = await t.run<IgnitionState>("ignition.start", { date: D });
    expect(start.plan.committedAt).toBeNull();
    const a = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 101 });
    expect(a.pick).toMatchObject({ kind: "item", title: "Story assigned to me", size: "M", status: "planned" });
    const child = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 122, size: "S" });
    expect(child.pick.title).toBe("Story two levels down");
    await t.run("pick.add", { date: D, half: "PM", clientKey: "Cooptimize", intention: "  Review the  ignition copy " });
    await t.run("pick.set_size", { id: a.pick.id, size: "L" });
    await t.run("pick.move", { id: child.pick.id, date: D, half: "PM" });
    const committed = await t.run<IgnitionState>("ignition.commit", { date: D });
    expect(committed.plan.committedAt).toMatch(/-05:00\[America\/New_York\]$/);
    await t.run("pick.mark_done", { id: a.pick.id, done: true });

    const after = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(after.ignition.committed).toBe(true);
    expect(after.plan![D]!.picks.map((p) => [p.half, p.title, p.size, p.status])).toEqual([
      ["AM", "Story assigned to me", "L", "done"],
      ["PM", "Review the ignition copy", "M", "planned"],
      ["PM", "Story two levels down", "S", "planned"],
    ]);
  });

  it("story level is enforced on the server: epics and features can't be picked", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const r = await t.fail("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 110 });
    expect(r).toMatchObject({ status: 422 });
    expect(r.ok ? "" : r.error).toMatch(/Pick one of its child items, or add a draft story/);
  });

  it("a feature with no children gets draft stories, which can then be picked", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { draft } = await t.run<{ draft: { id: number } }>("draft.add_story", { clientKey: "CSC", parentItemId: 130, title: "First slice of the feature", size: "S" });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "CSC", draftId: draft.id });
    expect(pick).toMatchObject({ kind: "draft", title: "First slice of the feature", itemType: "Draft story" });
    expect((await t.fail("draft.add_story", { clientKey: "CSC", parentItemId: 101, title: "x" })).status).toBe(422);
    expect((await t.fail("pick.add", { date: D, half: "AM", clientKey: "Cooptimize", draftId: draft.id })).status).toBe(404);
  });

  it("items are checked against that client's own DevOps items only", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    expect((await t.fail("pick.add", { date: D, half: "AM", clientKey: "Cooptimize", itemId: 122 })).status).toBe(409);
    expect((await t.fail("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 99999 })).status).toBe(409);
  });

  it("rejects bad input plainly, including sizes above L", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const err = async (input: unknown, action = "pick.add") => {
      const r = await t.fail(action, input);
      return r.ok ? "" : r.error;
    };
    expect(await err({ date: D, half: "AM", clientKey: "CSC", intention: "x", size: "XL" })).toMatch(/split it first/);
    expect(await err({ date: D, half: "EVE", clientKey: "CSC", intention: "x" })).toMatch(/AM or PM/);
    expect(await err({ date: "2026-02-30", half: "AM", clientKey: "CSC", intention: "x" })).toMatch(/real date/);
    expect(await err({ date: D, half: "AM", clientKey: "CSC" })).toMatch(/exactly one/);
    expect(await err({ date: D, half: "AM", clientKey: "CSC", intention: "x", itemId: 101 })).toMatch(/exactly one/);
    expect(await err({ date: D, half: "AM", clientKey: "CSC", intention: "   " })).toMatch(/empty/);
    expect(await err({ date: D, half: "AM", clientKey: "CSC", intention: "x", extra: 1 })).toMatch(/unknown input field/);
    expect(await err({ id: 1.5, size: "S" }, "pick.set_size")).toMatch(/whole number/);
  });

  it("a duplicate pick of the same item on the same day is refused", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 101 });
    expect((await t.fail("pick.add", { date: D, half: "PM", clientKey: "CSC", itemId: 101 })).status).toBe(409);
  });

  it("the automatic open happens once per day and never for a committed day", async () => {
    const t = setup();
    expect((await t.run<IgnitionState>("ignition.start", { date: D, auto: true })).opened).toBe(true);
    expect((await t.run<IgnitionState>("ignition.start", { date: D, auto: true })).opened).toBe(false);
    expect((await t.run<IgnitionState>("ignition.start", { date: D })).opened).toBe(true);
    await t.run("ignition.commit", { date: "2026-11-04" });
    expect((await t.run<IgnitionState>("ignition.start", { date: "2026-11-04", auto: true })).opened).toBe(false);
  });

  it("carry-over moves yesterday's unfinished picks into today", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const mon = "2026-11-02";
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: mon, half: "PM", clientKey: "CSC", itemId: 101 });
    await t.run("ignition.commit", { date: mon });
    const s = await t.run<IgnitionState>("ignition.start", { date: D });
    expect(s.carryOver.map((p) => p.id)).toEqual([pick.id]);
    const moved = await t.run<{ pick: Pick; state: IgnitionState }>("pick.move", { id: pick.id, date: D, half: "AM" });
    expect(moved.pick).toMatchObject({ date: D, carriedFromDate: mon });
    expect((await t.run<IgnitionState>("ignition.start", { date: D })).carryOver).toEqual([]);
  });

  it("without a plan store the actions say so and the week still loads", async () => {
    const t = setup({ noPlan: true });
    expect((await t.fail("ignition.start", { date: D })).status).toBe(503);
    const w = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(w.plan).toBeNull();
    expect(w.ignition.available).toBe(false);
  });

  it("nothing in this step calls a write endpoint: only GETs, plus the token, WIQL and batch reads", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const before = t.dv.calls.length + t.ado.calls.length;
    // Every plan action, after the week is loaded, makes no external call at all.
    await t.run("ignition.start", { date: D });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 101 });
    await t.run("pick.set_size", { id: pick.id, size: "S" });
    await t.run("pick.move", { id: pick.id, date: "2026-11-06", half: "AM" });
    const { draft } = await t.run<{ draft: { id: number } }>("draft.add_story", { clientKey: "CSC", parentItemId: 130, title: "Draft" });
    const p2 = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "PM", clientKey: "CSC", draftId: draft.id });
    await t.run("ignition.commit", { date: D });
    await t.run("pick.mark_done", { id: p2.pick.id, done: true });
    await t.run("pick.remove", { id: p2.pick.id });
    expect(t.dv.calls.length + t.ado.calls.length).toBe(before);

    // And the reads that did happen are reads.
    for (const c of t.dv.calls) {
      if (c.method === "POST") expect(c.url).toMatch(/^https:\/\/login\.microsoftonline\.com\/[^/]+\/oauth2\/v2\.0\/token$/);
      else expect(c.method).toBe("GET");
    }
    for (const c of t.ado.calls) {
      if (c.method === "POST") expect(c.url).toMatch(/^https:\/\/dev\.azure\.com\/[^/]+\/[^/]+\/_apis\/wit\/(wiql|workitemsbatch)\?/);
      else expect(c.method).toBe("GET");
    }
    expect([...t.dv.calls, ...t.ado.calls].some((c) => ["PATCH", "PUT", "DELETE"].includes(c.method))).toBe(false);
  });
});
