import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import type { PlanDayState, Pick } from "../plan/types.ts";
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

function setup(opts: { noPlan?: boolean; pto?: "ok" | "forbidden"; text?: string } = {}) {
  let clock = NOW;
  const dir = mkdtempSync(join(tmpdir(), "c-plan-"));
  const dv = fakeFetch("ok", { pto: opts.pto ?? "ok" });
  const ado = fakeDevOps({ cscsteel: "portfolio", cooptimize: "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, cacheDir: dir, log: () => {} });
  const devopsByKey = new Map<string, ReturnType<typeof createDevOpsSource>>();
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(opts.text ?? text) }),
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
    now: () => clock,
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
  /** Move the real clock (the server's), e.g. to make a day past. */
  const at = (instant: string) => void (clock = instant);
  return { c, run, fail, dv, ado, plan, at };
}

const D = "2026-11-03";

describe("Plan the day actions", () => {
  it("a whole morning: start, pick items and an intention, size, move, commit, tick, all persisted locally", async () => {
    const t = setup();
    const week = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(week.planDay).toEqual({ date: D, workday: true, committed: false, available: true });

    const start = await t.run<PlanDayState>("planday.start", { date: D });
    expect(start.plan.committedAt).toBeNull();
    const a = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 101 });
    expect(a.pick).toMatchObject({ kind: "item", title: "Story assigned to me", size: "M", status: "planned" });
    const child = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 122, size: "S" });
    expect(child.pick.title).toBe("Story two levels down");
    await t.run("pick.add", { date: D, half: "PM", clientKey: "Cooptimize", intention: "  Review the  planning copy " });
    await t.run("pick.set_size", { id: a.pick.id, size: "L" });
    await t.run("pick.move", { id: child.pick.id, date: D, half: "PM" });
    const committed = await t.run<PlanDayState>("planday.commit", { date: D });
    expect(committed.plan.committedAt).toMatch(/-05:00\[America\/New_York\]$/);
    await t.run("pick.mark_done", { id: a.pick.id, done: true });

    const after = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(after.planDay.committed).toBe(true);
    expect(after.plan![D]!.picks.map((p) => [p.half, p.title, p.size, p.status])).toEqual([
      ["AM", "Story assigned to me", "L", "done"],
      ["PM", "Review the planning copy", "M", "planned"],
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
    expect(await err({ date: D, half: "NIGHT", clientKey: "CSC", intention: "x" })).toMatch(/AM, PM or EVE/);
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
    expect((await t.run<PlanDayState>("planday.start", { date: D, auto: true })).opened).toBe(true);
    expect((await t.run<PlanDayState>("planday.start", { date: D, auto: true })).opened).toBe(false);
    expect((await t.run<PlanDayState>("planday.start", { date: D })).opened).toBe(true);
    await t.run("planday.commit", { date: "2026-11-04" });
    expect((await t.run<PlanDayState>("planday.start", { date: "2026-11-04", auto: true })).opened).toBe(false);
  });

  it("carry-over moves yesterday's unfinished picks into today", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const mon = "2026-11-02";
    // Monday was planned on Monday; now it is Tuesday morning.
    t.at("2026-11-02T14:00:00Z");
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: mon, half: "PM", clientKey: "CSC", itemId: 101 });
    await t.run("planday.commit", { date: mon });
    t.at(NOW);
    const s = await t.run<PlanDayState>("planday.start", { date: D });
    expect(s.carryOver.map((p) => p.id)).toEqual([pick.id]);
    const moved = await t.run<{ pick: Pick; state: PlanDayState }>("pick.move", { id: pick.id, date: D, half: "AM" });
    expect(moved.pick).toMatchObject({ date: D, carriedFromDate: mon });
    expect((await t.run<PlanDayState>("planday.start", { date: D })).carryOver).toEqual([]);
  });

  it("without a plan store the actions say so and the week still loads", async () => {
    const t = setup({ noPlan: true });
    expect((await t.fail("planday.start", { date: D })).status).toBe(503);
    const w = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(w.plan).toBeNull();
    expect(w.planDay.available).toBe(false);
  });

  it("nothing in this step calls a write endpoint: only GETs, plus the token, WIQL and batch reads", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const before = t.ado.calls.length;
    const dvBefore = t.dv.calls.length;
    // After the week is loaded, plan actions make no DevOps call, and in Dataverse only the PTO reads
    // that check a day isn't a full PTO day (step 6).
    await t.run("planday.start", { date: D });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "CSC", itemId: 101 });
    await t.run("pick.set_size", { id: pick.id, size: "S" });
    await t.run("pick.move", { id: pick.id, date: "2026-11-06", half: "AM" });
    const { draft } = await t.run<{ draft: { id: number } }>("draft.add_story", { clientKey: "CSC", parentItemId: 130, title: "Draft" });
    const p2 = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "PM", clientKey: "CSC", draftId: draft.id });
    await t.run("planday.commit", { date: D });
    await t.run("pick.mark_done", { id: p2.pick.id, done: true });
    await t.run("pick.remove", { id: p2.pick.id });
    expect(t.ado.calls.length).toBe(before);
    for (const c of t.dv.calls.slice(dvBefore)) {
      if (c.method === "POST") expect(c.url).toMatch(/oauth2\/v2\.0\/token$/);
      else expect(c.url).toMatch(/\/coop_timeofftracker(s|details)\?/);
    }

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

describe("PTO and Plan the day (step 6)", () => {
  it("the week shows Thu Nov 5 as a PTO day with no risks; PTO ahead is sent for the planning target", async () => {
    const t = setup();
    const w = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    const thu = w.week.days[3]!;
    expect(thu.pto).toEqual({ date: "2026-11-05", titles: ["Watch Kids"] });
    expect([...thu.am.risks, ...thu.pm.risks]).toEqual([]);
    expect([thu.am.pto, thu.pm.pto]).toEqual([true, true]);
    expect(w.week.days[1]!.pto).toBeNull();
    expect(w.sources.find((s) => s.source === "pto")).toMatchObject({ status: "ok", itemCount: 1 });
    // The tracker with no detail rows (Nov 16 to 17) counts on every weekday (D109).
    expect(w.ptoAhead).toEqual(["2026-11-05", "2026-11-16", "2026-11-17"]);
  });

  it("today on a PTO day is not a planning workday, so Plan the day doesn't open by itself (D106)", async () => {
    const t = setup();
    const thu = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02", now: "2026-11-05T14:00:00Z" });
    expect(thu.planDay).toMatchObject({ date: "2026-11-05", workday: false });
    const wed = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02", now: "2026-11-04T14:00:00Z" });
    expect(wed.planDay).toMatchObject({ date: "2026-11-04", workday: true });
  });

  it("picks are refused on a PTO day, by add or by move; other days still take them", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const r = await t.fail("pick.add", { date: "2026-11-05", half: "AM", clientKey: "CSC", intention: "x" });
    expect(r).toMatchObject({ status: 422 });
    expect(r.ok ? "" : r.error).toBe("Thu, Nov 5 is a PTO day (Watch Kids). Nothing can be planned on it");
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: "2026-11-03", half: "AM", clientKey: "CSC", intention: "fine on a normal day" });
    expect((await t.fail("pick.move", { id: pick.id, date: "2026-11-05", half: "PM" })).status).toBe(422);
  });

  it("when PTO can't be read the week still loads and picks still work", async () => {
    const t = setup({ pto: "forbidden" });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(w.sources.find((s) => s.source === "pto")).toMatchObject({ status: "auth_required" });
    expect(w.week.days[3]!.pto).toBeNull();
    expect(w.week.days[0]!.am.focus.length).toBeGreaterThan(0);
    await t.run("pick.add", { date: "2026-11-05", half: "AM", clientKey: "CSC", intention: "PTO unknown, so allowed" });
  });

  it("Plan the day can target the next workday from the weekend", async () => {
    const t = setup();
    const s = await t.run<PlanDayLike>("planday.start", { date: "2026-11-09" });
    expect(s.date).toBe("2026-11-09");
    await t.run("pick.add", { date: "2026-11-09", half: "AM", clientKey: "CSC", intention: "Monday first thing" });
    expect((await t.run<PlanDayLike>("planday.commit", { date: "2026-11-09" })).plan.committedAt).toBeTruthy();
  });
});
type PlanDayLike = { date: string; plan: { committedAt: string | null } };

describe("Plan any day", () => {
  const MON = "2026-11-02";
  const WED = "2026-11-04";
  const THU = "2026-11-05"; // PTO in the fakes
  /** Monday planned and committed on Monday, then the clock moves to Tuesday 9:00. */
  async function mondayPlanned(t: ReturnType<typeof setup>, n = 3) {
    t.at("2026-11-02T14:00:00Z");
    const picks: Pick[] = [];
    for (let i = 0; i < n; i++) picks.push((await t.run<{ pick: Pick }>("pick.add", { date: MON, half: "AM", clientKey: "CSC", intention: `Monday ${i + 1}` })).pick);
    await t.run("planday.commit", { date: MON });
    t.at(NOW);
    return picks;
  }

  describe("target selection", () => {
    it("a future day is fully plannable: pick, size, move within it, commit", async () => {
      const t = setup();
      await t.run("week.load", { weekStart: "2026-11-02" });
      const d = "2026-11-12";
      const s = await t.run<PlanDayState>("planday.start", { date: d });
      expect(s.access).toBe("plan");
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: d, half: "AM", clientKey: "CSC", itemId: 101 });
      await t.run("pick.set_size", { id: pick.id, size: "L" });
      await t.run("pick.move", { id: pick.id, date: d, half: "PM" });
      expect((await t.run<PlanDayState>("planday.commit", { date: d })).picks).toMatchObject([{ half: "PM", size: "L", status: "planned" }]);
    });

    it("PTO days are refused with the reason", async () => {
      const t = setup();
      const r = await t.fail("planday.start", { date: THU });
      expect(r).toMatchObject({ status: 422, error: "Thu, Nov 5 is a PTO day (Watch Kids). Nothing can be planned on it" });
      expect((await t.fail("planday.start", { date: "2026-11-17" })).status).toBe(422);
    });

    it("days without working hours or a flex session are refused (by default Fridays and weekends)", async () => {
      const t = setup();
      for (const d of ["2026-11-06", "2026-11-07", "2026-11-08"]) {
        const r = await t.fail("planday.start", { date: d });
        expect(r.status, d).toBe(422);
        expect(r.ok ? "" : r.error, d).toMatch(/has no working hours.*add a flex session/);
      }
      expect((await t.fail("planday.commit", { date: "2026-11-06" })).status).toBe(422);
    });

    it("a Friday with working hours and a weekend day with a flex session become plannable (D127)", async () => {
      const t = setup({ text: text.replace("fri = []", 'fri = ["09:00-12:00"]') });
      expect((await t.run<PlanDayState>("planday.start", { date: "2026-11-06" })).access).toBe("plan");
      expect((await t.fail("planday.start", { date: "2026-11-07" })).status).toBe(422);
      t.plan.addFlex({ date: "2026-11-07", clientKey: "CSC", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z" });
      expect((await t.run<PlanDayState>("planday.start", { date: "2026-11-07" })).access).toBe("plan");
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: "2026-11-07", half: "EVE", clientKey: "CSC", intention: "Saturday catch-up" });
      expect(pick.half).toBe("EVE");
    });

    it("today and earlier days open; earlier days are past", async () => {
      const t = setup();
      expect((await t.run<PlanDayState>("planday.start", { date: D })).access).toBe("plan");
      expect((await t.run<PlanDayState>("planday.start", { date: MON })).access).toBe("past");
      expect((await t.run<PlanDayState>("planday.start", { date: "2026-10-26" })).access).toBe("past");
    });
  });

  describe("past-day editing rules", () => {
    it("only done and drop: no new picks, no size change, no commit, nothing moved into it", async () => {
      const t = setup();
      const [a, b] = await mondayPlanned(t);
      const refused = [
        await t.fail("pick.add", { date: MON, half: "PM", clientKey: "CSC", intention: "late" }),
        await t.fail("pick.set_size", { id: a!.id, size: "S" }),
        await t.fail("planday.commit", { date: MON }),
        await t.fail("pick.move", { id: b!.id, date: MON, half: "PM" }),
      ];
      for (const r of refused) expect(r).toMatchObject({ status: 409, error: expect.stringMatching(/^Mon, Nov 2 is past\. Its picks can only be ticked done or dropped/) });
      const done = await t.run<{ pick: Pick }>("pick.mark_done", { id: a!.id, done: true });
      expect(done.pick.status).toBe("done");
      expect((await t.run<{ pick: Pick }>("pick.mark_done", { id: a!.id, done: false })).pick.status).toBe("planned");
    });

    it("dropping a past pick keeps it as dropped, even on a day that was never committed", async () => {
      const t = setup();
      const [, b] = await mondayPlanned(t);
      const r = await t.run<{ result: string; state: PlanDayState }>("pick.remove", { id: b!.id });
      expect(r.result).toBe("dropped");
      expect(r.state.picks.find((p) => p.id === b!.id)?.status).toBe("dropped");

      t.at("2026-10-29T14:00:00Z");
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: "2026-10-29", half: "AM", clientKey: "CSC", intention: "never committed" });
      t.at(NOW);
      expect((await t.run<{ result: string }>("pick.remove", { id: pick.id })).result).toBe("dropped");
      expect(t.plan.getPick(pick.id)?.status).toBe("dropped");
    });

    it("a past pick can move forward to today or later (carrying it), never to another past day", async () => {
      const t = setup();
      const [, , c] = await mondayPlanned(t);
      expect((await t.fail("pick.move", { id: c!.id, date: "2026-10-29", half: "AM" })).status).toBe(409);
      const moved = await t.run<{ pick: Pick }>("pick.move", { id: c!.id, date: WED, half: "PM" });
      expect(moved.pick).toMatchObject({ date: WED, carriedFromDate: MON });
      expect(t.plan.getPick(c!.id)?.status).toBe("moved");
    });
  });

  describe("carry-over placement across several planned days", () => {
    it("only the earliest upcoming uncommitted day offers it; committing it moves the offer on", async () => {
      const t = setup();
      const [a, b, c] = await mondayPlanned(t);
      const ids = [a!.id, b!.id, c!.id];
      // Tuesday, Wednesday and next Monday all opened before anything is committed.
      const tue = await t.run<PlanDayState>("planday.start", { date: D });
      const wed = await t.run<PlanDayState>("planday.start", { date: WED });
      const nextMon = await t.run<PlanDayState>("planday.start", { date: "2026-11-09" });
      expect(tue.carryOver.map((p) => p.id).sort()).toEqual(ids);
      expect(wed.carryOver).toEqual([]);
      expect(nextMon.carryOver).toEqual([]);
      for (const s of [tue, wed, nextMon]) expect(s.carryTarget).toBe(D);
      // The past day itself never offers carry-over.
      expect((await t.run<PlanDayState>("planday.start", { date: MON })).carryOver).toEqual([]);

      // Tuesday is committed without carrying anything: Wednesday is now the carry-over day.
      await t.run("planday.commit", { date: D });
      expect((await t.run<PlanDayState>("planday.start", { date: D })).carryOver).toEqual([]);
      const wed2 = await t.run<PlanDayState>("planday.start", { date: WED });
      expect(wed2.carryOver.map((p) => p.id).sort()).toEqual(ids);

      // Wednesday committed too, Thursday is PTO and Friday has no hours: next Monday.
      await t.run("planday.commit", { date: WED });
      const mon2 = await t.run<PlanDayState>("planday.start", { date: "2026-11-09" });
      expect(mon2.carryTarget).toBe("2026-11-09");
      expect(mon2.carryOver.map((p) => p.id).sort()).toEqual(ids);
    });

    it("a carried pick is offered nowhere else, and a future day's picks are not carry-over", async () => {
      const t = setup();
      const [a] = await mondayPlanned(t, 1);
      await t.run("pick.add", { date: WED, half: "AM", clientKey: "CSC", intention: "planned ahead" });
      await t.run("pick.move", { id: a!.id, date: D, half: "AM" });
      for (const d of [D, WED, "2026-11-09"]) expect((await t.run<PlanDayState>("planday.start", { date: d })).carryOver, d).toEqual([]);
    });

    it("after the usual end of day, today's unfinished picks go to the next day that can be planned", async () => {
      const t = setup();
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "PM", clientKey: "CSC", intention: "Tuesday work" });
      await t.run("planday.commit", { date: D });
      t.at("2026-11-03T23:30:00Z"); // Tue 18:30 New York
      const tue = await t.run<PlanDayState>("planday.start", { date: D });
      expect(tue).toMatchObject({ access: "plan", carryOver: [], carryTarget: WED });
      expect((await t.run<PlanDayState>("planday.start", { date: WED })).carryOver.map((p) => p.id)).toEqual([pick.id]);
    });
  });
});

describe("flex loops open by the server's clock (step 6c)", () => {
  it("a week read with a later ?now does not open a loop for a session that hasn't ended yet", async () => {
    const t = setup();
    t.plan.addFlex({ date: "2026-11-03", clientKey: "CSC", start: "2026-11-03T23:00:00Z", end: "2026-11-04T01:00:00Z" });
    await t.run("week.load", { weekStart: "2026-11-02", now: "2026-11-05T14:00:00Z" });
    expect(t.plan.openLoops()).toEqual([]);
    t.at("2026-11-04T02:00:00Z");
    await t.run("week.load", { weekStart: "2026-11-02" });
    expect(t.plan.openLoops()).toHaveLength(1);
  });
});
