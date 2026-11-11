import { createSnapshotStore } from "../host/local/snapshots.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML as STARTER_TOML } from "../fixtures/four-day-week.ts";
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
  const ado = fakeDevOps({ contoso: "portfolio", cooptimize: "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(dir), log: () => {} });
  const devopsByKey = new Map<string, ReturnType<typeof createDevOpsSource>>();
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(clock).toZonedDateTimeISO("America/New_York") });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(opts.text ?? text) }),
    makeDataverse,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: (cfg, tz) => {
      const key = JSON.stringify([cfg, tz]);
      let s = devopsByKey.get(key);
      if (!s) devopsByKey.set(key, (s = createDevOpsSource({ fetch: ado.fetch, log: () => {}, snapshots: createSnapshotStore(dir), timeZone: tz, targets: (k) => makeDataverse(cfg, tz).devopsTargets(k) })));
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
  it("a whole morning: start, pick items and an intention, size, move, tick (CF-1: no confirm), all persisted locally", async () => {
    const t = setup();
    const week = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(week.planDay).toEqual({ date: D, workday: true, available: true });

    const start = await t.run<PlanDayState>("planday.start", { date: D });
    expect(start.plan).not.toHaveProperty("committedAt");
    const a = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    expect(a.pick).toMatchObject({ kind: "item", title: "Story assigned to me", size: null, status: "planned" });
    const child = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 122, size: "S" });
    expect(child.pick.title).toBe("Story two levels down");
    await t.run("pick.add", { date: D, half: "PM", clientKey: "Cooptimize", intention: "  Review the  planning copy " });
    await t.run("pick.set_size", { id: a.pick.id, size: "L" });
    await t.run("pick.move", { id: child.pick.id, date: D, half: "PM" });
    // Ticking needs no confirm.
    await t.run("pick.mark_done", { id: a.pick.id, done: true });

    const after = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(after.plan![D]!.picks.map((p) => [p.half, p.title, p.size, p.status])).toEqual([
      ["AM", "Story assigned to me", "L", "done"],
      ["PM", "Review the planning copy", null, "planned"],
      ["PM", "Story two levels down", "S", "planned"],
    ]);
  });

  it("story level is enforced on the server: epics and features can't be picked", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const r = await t.fail("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 110 });
    expect(r).toMatchObject({ status: 422 });
    expect(r.ok ? "" : r.error).toMatch(/Pick one of its child items, or add a draft story/);
  });

  it("a feature with no children gets draft stories, which can then be picked", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { draft } = await t.run<{ draft: { id: number } }>("draft.add_story", { clientKey: "Adatum", parentItemId: 130, title: "First slice of the feature", size: "S" });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", draftId: draft.id });
    expect(pick).toMatchObject({ kind: "draft", title: "First slice of the feature", itemType: "Draft story" });
    expect((await t.fail("draft.add_story", { clientKey: "Adatum", parentItemId: 101, title: "x" })).status).toBe(422);
    expect((await t.fail("pick.add", { date: D, half: "AM", clientKey: "Cooptimize", draftId: draft.id })).status).toBe(404);
  });

  it("items are checked against that client's own DevOps items only", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    expect((await t.fail("pick.add", { date: D, half: "AM", clientKey: "Cooptimize", itemId: 122 })).status).toBe(409);
    expect((await t.fail("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 99999 })).status).toBe(409);
  });

  it("rejects bad input plainly, including sizes above L", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const err = async (input: unknown, action = "pick.add") => {
      const r = await t.fail(action, input);
      return r.ok ? "" : r.error;
    };
    expect(await err({ date: D, half: "AM", clientKey: "Adatum", intention: "x", size: "XL" })).toMatch(/split it first/);
    expect(await err({ date: D, half: "NIGHT", clientKey: "Adatum", intention: "x" })).toMatch(/AM, PM or EVE/);
    expect(await err({ date: "2026-02-30", half: "AM", clientKey: "Adatum", intention: "x" })).toMatch(/real date/);
    expect(await err({ date: D, half: "AM", clientKey: "Adatum" })).toMatch(/exactly one/);
    expect(await err({ date: D, half: "AM", clientKey: "Adatum", intention: "x", itemId: 101 })).toMatch(/exactly one/);
    expect(await err({ date: D, half: "AM", clientKey: "Adatum", intention: "   " })).toMatch(/empty/);
    expect(await err({ date: D, half: "AM", clientKey: "Adatum", intention: "x", extra: 1 })).toMatch(/unknown input field/);
    expect(await err({ id: 1.5, size: "S" }, "pick.set_size")).toMatch(/whole number/);
  });

  it("a duplicate pick of the same item on the same day is refused", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    expect((await t.fail("pick.add", { date: D, half: "PM", clientKey: "Adatum", itemId: 101 })).status).toBe(409);
  });

  it("the automatic open happens once per day (CF-1: no confirm to skip it)", async () => {
    const t = setup();
    expect((await t.run<PlanDayState>("planday.start", { date: D, auto: true })).opened).toBe(true);
    expect((await t.run<PlanDayState>("planday.start", { date: D, auto: true })).opened).toBe(false);
    expect((await t.run<PlanDayState>("planday.start", { date: D })).opened).toBe(true);
    expect((await t.run<PlanDayState>("planday.start", { date: "2026-11-04", auto: true })).opened).toBe(true);
  });

  it("carry-over moves yesterday's unfinished picks into today", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const mon = "2026-11-02";
    // Monday was planned on Monday; now it is Tuesday morning.
    t.at("2026-11-02T14:00:00Z");
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: mon, half: "PM", clientKey: "Adatum", itemId: 101 });
    await t.run("planday.commit", { date: mon });
    t.at(NOW);
    const s = await t.run<PlanDayState>("planday.start", { date: D });
    expect(s.carryOver.map((p) => p.id)).toEqual([pick.id]);
    const moved = await t.run<{ pick: Pick; state: PlanDayState }>("pick.move", { id: pick.id, date: D, half: "AM" });
    expect(moved.pick).toMatchObject({ date: D, carriedFromDate: mon });
    expect((await t.run<PlanDayState>("planday.start", { date: D })).carryOver).toEqual([]);
  });

  it("AS-2: a move to Saturday succeeds with its note (no Add hours prompt); a day with hours has none", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    const sat = await t.run<{ pick: Pick; note: string | null }>("pick.move", { id: pick.id, date: "2026-11-07", half: "AM" });
    expect(sat.pick.date).toBe("2026-11-07");
    expect(sat.note).toBe("Saturday isn't a working day: this is flex time");
    const back = await t.run<{ pick: Pick; note: string | null }>("pick.move", { id: sat.pick.id, date: "2026-11-04", half: "PM" });
    expect(back).toMatchObject({ pick: { date: "2026-11-04" }, note: null });
  });

  it("AS-2: a move into the past or into a half of today that has ended is refused; nothing moves", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: "2026-11-04", half: "PM", clientKey: "Adatum", itemId: 101 });
    expect((await t.fail("pick.move", { id: pick.id, date: "2026-10-30", half: "AM" })).status).toBe(409);
    t.at("2026-11-03T22:00:00Z"); // Tuesday 5 PM in New York: both halves of Tuesday are over
    const r = await t.fail("pick.move", { id: pick.id, date: "2026-11-03", half: "PM" });
    expect(r).toMatchObject({ status: 409, error: "This afternoon has already ended. Move it to a later block" });
    expect((await t.plan.getPick(pick.id))!).toMatchObject({ date: "2026-11-04", half: "PM", status: "planned" });
  });

  it("moving a pick to Friday never asks: it is catch-up work on the overflow day (step 13.6, Q78, D238)", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    const fri = (await t.run<{ pick: Pick }>("pick.move", { id: pick.id, date: "2026-11-06", half: "AM" })).pick;
    expect(fri).toMatchObject({ date: "2026-11-06", half: "AM", status: "planned" });
    // It counts in the week: the week's picks include it.
    expect((await t.plan.picksBetween("2026-11-02", "2026-11-08")).filter((p) => p.status === "planned").map((p) => p.date)).toEqual(["2026-11-06"]);
  });

  it("a pick being made up tonight isn't offered as carry-over until its evening session has ended (Q45)", async () => {
    const t = setup();
    const mon = "2026-11-02";
    t.at("2026-11-02T22:15:00Z"); // Mon 5:15 PM, after the workday: the next workday (Tue) is the carry-over day
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("flex.add", { date: mon, clientKey: "Adatum", start: "20:00", end: "22:00" });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: mon, half: "EVE", clientKey: "Adatum", intention: "Make up the export" });
    const tue = "2026-11-03";
    expect((await t.run<PlanDayState>("planday.start", { date: tue })).carryOver).toEqual([]);
    t.at("2026-11-03T02:30:00Z"); // Mon 9:30 PM: still under way
    expect((await t.run<PlanDayState>("planday.start", { date: tue })).carryOver).toEqual([]);
    t.at("2026-11-03T03:05:00Z"); // Mon 10:05 PM: ended, still unfinished
    expect((await t.run<PlanDayState>("planday.start", { date: tue })).carryOver.map((p) => p.id)).toEqual([pick.id]);
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
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    await t.run("pick.set_size", { id: pick.id, size: "S" });
    await t.run("pick.move", { id: pick.id, date: "2026-11-06", half: "AM", anyway: true });
    const { draft } = await t.run<{ draft: { id: number } }>("draft.add_story", { clientKey: "Adatum", parentItemId: 130, title: "Draft" });
    const p2 = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "PM", clientKey: "Adatum", draftId: draft.id });
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

  it("AS-2 (supersedes the PTO refusal): add and move onto a PTO day succeed with the note", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const added = await t.run<{ pick: Pick; note: string | null }>("pick.add", { date: "2026-11-05", half: "AM", clientKey: "Adatum", intention: "x" });
    expect(added.note).toBe("You're on PTO that day");
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: "2026-11-03", half: "AM", clientKey: "Adatum", intention: "fine on a normal day" });
    const moved = await t.run<{ pick: Pick; note: string | null }>("pick.move", { id: pick.id, date: "2026-11-05", half: "PM" });
    expect(moved).toMatchObject({ pick: { date: "2026-11-05", half: "PM" }, note: "You're on PTO that day" });
  });

  it("when PTO can't be read the week still loads and picks still work", async () => {
    const t = setup({ pto: "forbidden" });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(w.sources.find((s) => s.source === "pto")).toMatchObject({ status: "auth_required" });
    expect(w.week.days[3]!.pto).toBeNull();
    expect(w.week.days[0]!.am.focus.length).toBeGreaterThan(0);
    await t.run("pick.add", { date: "2026-11-05", half: "AM", clientKey: "Adatum", intention: "PTO unknown, so allowed" });
  });

  it("Plan the day can target the next workday from the weekend", async () => {
    const t = setup();
    const s = await t.run<PlanDayLike>("planday.start", { date: "2026-11-09" });
    expect(s.date).toBe("2026-11-09");
    await t.run("pick.add", { date: "2026-11-09", half: "AM", clientKey: "Adatum", intention: "Monday first thing" });
    expect((await t.run<PlanDayState>("planday.start", { date: "2026-11-09" })).picks.map((p) => p.title)).toEqual(["Monday first thing"]);
  });
});
type PlanDayLike = { date: string };

describe("Plan any day", () => {
  const MON = "2026-11-02";
  const WED = "2026-11-04";
  const THU = "2026-11-05"; // PTO in the fakes
  /** Monday planned on Monday, then the clock moves to Tuesday 9:00. */
  async function mondayPlanned(t: ReturnType<typeof setup>, n = 3) {
    t.at("2026-11-02T14:00:00Z");
    const picks: Pick[] = [];
    for (let i = 0; i < n; i++) picks.push((await t.run<{ pick: Pick }>("pick.add", { date: MON, half: "AM", clientKey: "Adatum", intention: `Monday ${i + 1}` })).pick);
    t.at(NOW);
    return picks;
  }

  describe("target selection", () => {
    it("a future day is fully plannable: pick, size, move within it", async () => {
      const t = setup();
      await t.run("week.load", { weekStart: "2026-11-02" });
      const d = "2026-11-12";
      const s = await t.run<PlanDayState>("planday.start", { date: d });
      expect(s.access).toBe("plan");
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: d, half: "AM", clientKey: "Adatum", itemId: 101 });
      await t.run("pick.set_size", { id: pick.id, size: "L" });
      await t.run("pick.move", { id: pick.id, date: d, half: "PM" });
      expect((await t.run<PlanDayState>("planday.start", { date: d })).picks).toMatchObject([{ half: "PM", size: "L", status: "planned" }]);
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
    });

    it("a Friday with working hours and a weekend day with a flex session become plannable (D127)", async () => {
      const t = setup({ text: text.replace("fri = []", 'fri = ["09:00-12:00"]') });
      expect((await t.run<PlanDayState>("planday.start", { date: "2026-11-06" })).access).toBe("plan");
      expect((await t.fail("planday.start", { date: "2026-11-07" })).status).toBe(422);
      (await t.plan.addFlex({ date: "2026-11-07", clientKey: "Adatum", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z" }));
      expect((await t.run<PlanDayState>("planday.start", { date: "2026-11-07" })).access).toBe("plan");
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: "2026-11-07", half: "EVE", clientKey: "Adatum", intention: "Saturday catch-up" });
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
    it("only done and drop: no new picks, no size change, nothing moved into it", async () => {
      const t = setup();
      const [a, b] = await mondayPlanned(t);
      const refused = [
        await t.fail("pick.add", { date: MON, half: "PM", clientKey: "Adatum", intention: "late" }),
        await t.fail("pick.set_size", { id: a!.id, size: "S" }),
        await t.fail("pick.move", { id: b!.id, date: MON, half: "PM" }),
      ];
      for (const r of refused) expect(r).toMatchObject({ status: 409, error: expect.stringMatching(/^Mon, Nov 2 is past\. Its to-dos can only be ticked done or dropped/) });
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
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: "2026-10-29", half: "AM", clientKey: "Adatum", intention: "never committed" });
      t.at(NOW);
      expect((await t.run<{ result: string }>("pick.remove", { id: pick.id })).result).toBe("dropped");
      expect((await t.plan.getPick(pick.id))?.status).toBe("dropped");
    });

    it("a past pick can move forward to today or later (carrying it), never to another past day", async () => {
      const t = setup();
      const [, , c] = await mondayPlanned(t);
      expect((await t.fail("pick.move", { id: c!.id, date: "2026-10-29", half: "AM" })).status).toBe(409);
      const moved = await t.run<{ pick: Pick }>("pick.move", { id: c!.id, date: WED, half: "PM" });
      expect(moved.pick).toMatchObject({ date: WED, carriedFromDate: MON });
      expect((await t.plan.getPick(c!.id))?.status).toBe("moved");
    });
  });

  describe("carry-over placement across several planned days", () => {
    it("only the next day that can take work offers it (CF-1: no confirm moves it on)", async () => {
      const t = setup();
      const [a, b, c] = await mondayPlanned(t);
      const ids = [a!.id, b!.id, c!.id];
      // Tuesday, Wednesday and next Monday all opened.
      const tue = await t.run<PlanDayState>("planday.start", { date: D });
      const wed = await t.run<PlanDayState>("planday.start", { date: WED });
      const nextMon = await t.run<PlanDayState>("planday.start", { date: "2026-11-09" });
      expect(tue.carryOver.map((p) => p.id).sort()).toEqual(ids);
      expect(wed.carryOver).toEqual([]);
      expect(nextMon.carryOver).toEqual([]);
      for (const s of [tue, wed, nextMon]) expect(s.carryTarget).toBe(D);
      // The past day itself never offers carry-over.
      expect((await t.run<PlanDayState>("planday.start", { date: MON })).carryOver).toEqual([]);
      // An old Confirm on Tuesday changes nothing: Tuesday stays the carry-over day.
      await t.run("planday.commit", { date: D });
      expect((await t.run<PlanDayState>("planday.start", { date: D })).carryOver.map((p) => p.id).sort()).toEqual(ids);
      expect((await t.run<PlanDayState>("planday.start", { date: WED })).carryOver).toEqual([]);
    });

    it("a carried pick is offered nowhere else, and a future day's picks are not carry-over", async () => {
      const t = setup();
      const [a] = await mondayPlanned(t, 1);
      await t.run("pick.add", { date: WED, half: "AM", clientKey: "Adatum", intention: "planned ahead" });
      await t.run("pick.move", { id: a!.id, date: D, half: "AM" });
      for (const d of [D, WED, "2026-11-09"]) expect((await t.run<PlanDayState>("planday.start", { date: d })).carryOver, d).toEqual([]);
    });

    it("after the usual end of day, today's unfinished picks go to the next day that can be planned", async () => {
      const t = setup();
      const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "PM", clientKey: "Adatum", intention: "Tuesday work" });
      await t.run("planday.commit", { date: D });
      t.at("2026-11-03T23:30:00Z"); // Tue 18:30 New York
      const tue = await t.run<PlanDayState>("planday.start", { date: D });
      expect(tue).toMatchObject({ access: "plan", carryOver: [], carryTarget: WED });
      expect((await t.run<PlanDayState>("planday.start", { date: WED })).carryOver.map((p) => p.id)).toEqual([pick.id]);
    });
  });
});

describe("flex follow-ups open by the server's clock (step 6c)", () => {
  it("a week read with a later ?now does not open a follow-up for a session that hasn't ended yet", async () => {
    const t = setup();
    (await t.plan.addFlex({ date: "2026-11-03", clientKey: "Adatum", start: "2026-11-03T23:00:00Z", end: "2026-11-04T01:00:00Z" }));
    await t.run("week.load", { weekStart: "2026-11-02", now: "2026-11-05T14:00:00Z" });
    expect((await t.plan.openFollowUps())).toEqual([]);
    t.at("2026-11-04T02:00:00Z");
    await t.run("week.load", { weekStart: "2026-11-02" });
    expect((await t.plan.openFollowUps())).toHaveLength(1);
  });
});

describe("focused time in Plan the day (step 6d)", () => {
  it("planday.start returns seconds focused per pick, for past days too", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { pick: p } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", intention: "Write it" });
    (await t.plan.addFocus({ pickId: p.id, label: "Write it", startedAt: "2026-11-03T14:00:00Z", endedAt: "2026-11-03T14:25:00Z", seconds: 1500 }));
    (await t.plan.addFocus({ pickId: p.id, label: "Write it", startedAt: "2026-11-03T15:00:00Z", endedAt: "2026-11-03T15:20:00Z", seconds: 1200 }));
    expect((await t.run<PlanDayState>("planday.start", { date: D })).focused).toEqual({ [p.id]: 2700 });
    t.at("2026-11-05T14:00:00Z"); // the day is past: Review shows it too
    const past = await t.run<PlanDayState>("planday.start", { date: D });
    expect(past).toMatchObject({ access: "past", focused: { [p.id]: 2700 } });
  });
});

describe("draft editor (step 15.3): draft.update", () => {
  it("edits title, description, acceptance criteria, size and parent of a story, and keeps them", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { draft } = await t.run<{ draft: { id: number } }>("draft.add_story", { clientKey: "Adatum", parentItemId: null, title: "Loose story", size: "S" });
    const r = await t.run<{ draft: Record<string, unknown> }>("draft.update", { id: draft.id, title: "Export the report", description: "Line one\nLine two", acceptance: "Given a week, then a CSV", size: "L", parentItemId: 130 });
    expect(r.draft).toMatchObject({ title: "Export the report", description: "Line one\nLine two", acceptance: "Given a week, then a CSV", size: "L", parentItemId: 130 });
    expect((await t.plan.getDraft(draft.id))).toMatchObject({ title: "Export the report", parentItemId: 130 });
    expect((await t.run<{ draft: Record<string, unknown> }>("draft.update", { id: draft.id, parentItemId: null, description: "" })).draft).toMatchObject({ parentItemId: null, description: null });
  });
  it("a feature takes start and target dates; a story doesn't; start can't be after target", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const f = (await t.plan.addDraft({ clientKey: "Adatum", parentItemId: null, title: "Loose feature", size: "M", level: "feature" }));
    expect((await t.run<{ draft: Record<string, unknown> }>("draft.update", { id: f.id, startDate: "2026-11-09", targetDate: "2026-11-27", parentItemId: 120 })).draft).toMatchObject({ startDate: "2026-11-09", targetDate: "2026-11-27", parentItemId: 120 });
    expect((await t.fail("draft.update", { id: f.id, startDate: "2026-12-01" })).status).toBe(422);
    const s = (await t.plan.addDraft({ clientKey: "Adatum", parentItemId: null, title: "Story", size: "M" }));
    expect((await t.fail("draft.update", { id: s.id, targetDate: "2026-11-27" })).status).toBe(422);
    expect((await t.fail("draft.update", { id: f.id, parentItemId: 130 })).error).toMatch(/epic/i);
  });
  it("a new client clears the parent; refused while a pick uses the draft", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const d = (await t.plan.addDraft({ clientKey: "Adatum", parentItemId: 130, title: "Story", size: "M" }));
    expect((await t.run<{ draft: Record<string, unknown> }>("draft.update", { id: d.id, clientKey: "T&W" })).draft).toMatchObject({ clientKey: "T&W", parentItemId: null });
    await t.run("pick.add", { date: D, half: "AM", clientKey: "T&W", draftId: d.id });
    expect((await t.fail("draft.update", { id: d.id, clientKey: "Adatum" })).status).toBe(409);
    expect((await t.fail("draft.update", { id: d.id, title: "" })).status).toBe(400);
    // A new title shows on the planned pick (Plan it, then edit).
    await t.run("draft.update", { id: d.id, title: "Story, renamed" });
    expect((await t.plan.picksFor(D)).find((p) => p.draftId === d.id)).toMatchObject({ title: "Story, renamed", itemType: "Draft story" });
  });
});

describe("drafts: choose a parent, and delete (step 14.5, D257)", () => {
  it("a story draft with no parent gets an open feature of its own client; nothing else", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { draft } = await t.run<{ draft: { id: number; parentItemId: number | null } }>("draft.add_story", { clientKey: "Adatum", parentItemId: null, title: "Loose story", size: "S" });
    expect((await t.fail("draft.set_parent", { id: draft.id, parentItemId: 120 })).error).toMatch(/feature/i);
    expect((await t.fail("draft.set_parent", { id: draft.id, parentItemId: 101 })).status).toBe(422);
    expect((await t.fail("draft.set_parent", { id: draft.id, parentItemId: 99999 })).status).toBe(409);
    const r = await t.run<{ draft: { parentItemId: number } }>("draft.set_parent", { id: draft.id, parentItemId: 130 });
    expect(r.draft.parentItemId).toBe(130);
  });
  it("a draft feature takes an epic", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const d = (await t.plan.addDraft({ clientKey: "Adatum", parentItemId: null, title: "Loose feature", size: "M", level: "feature" }));
    expect((await t.fail("draft.set_parent", { id: d.id, parentItemId: 130 })).error).toMatch(/epic/i);
    expect((await t.run<{ draft: { parentItemId: number } }>("draft.set_parent", { id: d.id, parentItemId: 120 })).draft.parentItemId).toBe(120);
  });
  it("delete removes a draft no pick uses; a picked one says to drop the pick first", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const a = (await t.plan.addDraft({ clientKey: "Adatum", parentItemId: 130, title: "Unused", size: "S" }));
    const b = (await t.plan.addDraft({ clientKey: "Adatum", parentItemId: 130, title: "Picked", size: "S" }));
    await t.run("pick.add", { date: D, half: "AM", clientKey: "Adatum", draftId: b.id });
    await t.run("draft.remove", { id: a.id });
    expect((await t.plan.getDraft(a.id))).toBeNull();
    expect((await t.fail("draft.remove", { id: b.id })).error).toMatch(/drop the to-do/i);
    expect((await t.plan.getDraft(b.id))).not.toBeNull();
  });
});

describe("duplicate picks (step 15.1, D277)", () => {
  it("adding the same item to the same block again says 'Already planned here'", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    const r = await t.fail("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    expect(r).toMatchObject({ status: 409, code: "duplicate", error: "Already planned here" });
    // The other half of the same day keeps its own refusal.
    expect((await t.fail("pick.add", { date: D, half: "PM", clientKey: "Adatum", itemId: 101 })).error).toBe("Already planned for the morning that day");
  });
  it("moving a pick into a block that already has that item is refused (how one item got planned three times)", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const first = (await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 })).pick;
    const wed = (await t.run<{ pick: Pick }>("pick.move", { id: first.id, date: "2026-11-04", half: "AM" })).pick;
    // With the first copy on Wednesday, the item can be added to Tuesday again.
    await t.run("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    const r = await t.fail("pick.move", { id: wed.id, date: D, half: "AM" });
    expect(r).toMatchObject({ status: 409, code: "duplicate", error: "Already planned here" });
    expect((await t.plan.getPick(wed.id))).toMatchObject({ date: "2026-11-04", status: "planned" });
    expect((await t.plan.picksFor(D)).filter((p) => p.itemId === 101 && p.status === "planned")).toHaveLength(1);
    // Moving a pick within its own block's day to the other half is still fine.
    const other = (await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 122 })).pick;
    expect((await t.run<{ pick: Pick }>("pick.move", { id: other.id, date: D, half: "PM" })).pick.half).toBe("PM");
  });
});

describe("UI-B: unfinished picks suggested in the next block", () => {
  it("Keep moves the pick, the original reads → moved to, and Undo puts it back", async () => {
    const t = setup();
    await t.run("planday.start", { date: D });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", intention: "Write the release notes" });
    t.at("2026-11-04T14:00:00Z"); // Wed 9:00: Tuesday's pick is unfinished
    const carry = await t.run<{ picks: Pick[]; hint: boolean }>("planday.carry", {});
    expect(carry.picks.map((p) => p.id)).toEqual([pick.id]);
    expect(carry.hint).toBe(true);

    const kept = await t.run<{ pick: Pick }>("pick.move", { id: pick.id, date: "2026-11-04", half: "PM" });
    const week = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(week.plan![D]!.picks.find((p) => p.id === pick.id)).toMatchObject({ status: "moved", carriedTo: { date: "2026-11-04", half: "PM" } });
    expect((await t.run<{ picks: Pick[] }>("planday.carry", {})).picks).toEqual([]);

    const back = await t.run<{ pick: Pick }>("pick.uncarry", { id: kept.pick.id });
    expect(back.pick).toMatchObject({ id: pick.id, status: "planned" });
    expect((await t.run<{ picks: Pick[] }>("planday.carry", {})).picks.map((p) => p.id)).toEqual([pick.id]);
    // Only a carried copy can be put back.
    expect((await t.fail("pick.uncarry", { id: pick.id })).status).toBe(409);
  });

  it("WD-2: Take off the plan: a story leaves its block and isn't marked dropped; Undo's add puts it back", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("planday.start", { date: D });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101, size: "S" });
    const r = await t.run<{ result: string; kind: string; draftId: number | null; undo: { add?: Record<string, unknown>; undrop?: number }; state: { picks: Pick[] } }>("pick.take_off", { id: pick.id });
    expect(r).toMatchObject({ result: "deleted", kind: "item", draftId: null });
    expect(r.state.picks).toEqual([]);
    expect(r.undo.add).toEqual({ date: D, half: "AM", clientKey: "Adatum", size: "S", itemId: 101 });
    const back = await t.run<{ pick: Pick }>("pick.add", r.undo.add);
    expect(back.pick).toMatchObject({ date: D, half: "AM", itemId: 101, status: "planned", size: "S" });
  });

  it("WD-2: a plain to-do taken off isn't destroyed: its words are kept as a draft with no feature; Undo makes it a plain to-do again", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("planday.start", { date: D });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "PM", clientKey: "Adatum", intention: "Call the vendor" });
    const r = await t.run<{ result: string; kind: string; draftId: number; undo: { add: Record<string, unknown>; draftId: number }; state: { picks: Pick[]; drafts: { id: number; title: string; parentItemId: number | null }[] } }>("pick.take_off", { id: pick.id });
    expect(r).toMatchObject({ result: "deleted", kind: "plain" });
    expect(r.state.picks).toEqual([]);
    expect(r.state.drafts.find((d) => d.id === r.draftId)).toMatchObject({ title: "Call the vendor", parentItemId: null });
    expect(r.undo).toMatchObject({ add: { date: D, half: "PM", clientKey: "Adatum", intention: "Call the vendor" }, draftId: r.draftId });
    // Placed again from To place, it is that draft on the block.
    const again = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", draftId: r.draftId });
    expect(again.pick).toMatchObject({ kind: "draft", draftId: r.draftId, title: "Call the vendor" });
  });

  it("WD-2: a draft story and a promise taken off stay a draft and a promise, not placed", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("planday.start", { date: D });
    const { draft } = await t.run<{ draft: { id: number } }>("draft.add_story", { clientKey: "Adatum", parentItemId: null, title: "Sketch the export" });
    const d = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", draftId: draft.id });
    const r = await t.run<{ kind: string; draftId: number | null; undo: { add: Record<string, unknown> }; state: { drafts: { id: number }[] } }>("pick.take_off", { id: d.pick.id });
    expect(r).toMatchObject({ kind: "draft", draftId: null });
    expect(r.undo.add).toMatchObject({ draftId: draft.id });
    expect(r.state.drafts.map((x) => x.id)).toContain(draft.id);
  });

  it("WD-2: a done to-do, a past day's to-do and a deployment can't be taken off; an unknown one is 404", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("planday.start", { date: D });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    await t.run("pick.mark_done", { id: pick.id, done: true });
    expect(await t.fail("pick.take_off", { id: pick.id })).toMatchObject({ status: 409, error: expect.stringMatching(/done to-do stays/) });
    await t.run("pick.mark_done", { id: pick.id, done: false });
    t.at("2026-11-04T14:00:00Z");
    expect(await t.fail("pick.take_off", { id: pick.id })).toMatchObject({ status: 409, error: expect.stringMatching(/past day keeps its record/) });
    expect((await t.fail("pick.take_off", { id: 99999 })).status).toBe(404);
    // Nothing changed: the to-do is still planned on its day.
    expect((await t.plan.getPick(pick.id))?.status).toBe("planned");
  });

  it("WD-2: taking off a to-do with a timebox removes its local timebox; one on Outlook is refused until the timebox is removed", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    await t.run("planday.start", { date: D });
    const a = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 101 });
    const b = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "PM", clientKey: "Adatum", intention: "Prep the demo" });
    const box = (pickId: number, outlook: boolean) => t.plan.addTimebox({ date: D, clientKey: "Adatum", pickId, title: "x", start: `${D}T14:00:00Z`, end: `${D}T15:00:00Z`, outlook });
    await box(a.pick.id, false);
    await box(b.pick.id, true);
    const r = await t.run<{ timeboxes: number }>("pick.take_off", { id: a.pick.id });
    expect(r.timeboxes).toBe(1);
    expect((await t.plan.timeboxesBetween(D, D)).filter((x) => x.pickId === a.pick.id && !x.removedAt)).toEqual([]);
    expect(await t.fail("pick.take_off", { id: b.pick.id })).toMatchObject({ status: 409, error: expect.stringMatching(/timebox is on Outlook/) });
    expect((await t.plan.getPick(b.pick.id))?.status).toBe("planned");
  });

  it("Drop settles it and Undo plans it again", async () => {
    const t = setup();
    await t.run("planday.start", { date: D });
    const { pick } = await t.run<{ pick: Pick }>("pick.add", { date: D, half: "AM", clientKey: "Adatum", intention: "Write the release notes" });
    t.at("2026-11-04T14:00:00Z");
    await t.run("pick.remove", { id: pick.id });
    expect((await t.run<{ picks: Pick[] }>("planday.carry", {})).picks).toEqual([]);
    expect((await t.run<{ pick: Pick }>("pick.undrop", { id: pick.id })).pick.status).toBe("planned");
    expect((await t.run<{ picks: Pick[] }>("planday.carry", {})).picks.map((p) => p.id)).toEqual([pick.id]);
  });

  it("the hint shows until it is dismissed once", async () => {
    const t = setup();
    expect((await t.run<{ hint: boolean }>("planday.carry", {})).hint).toBe(true);
    await t.run("planday.carry_hint", {});
    expect((await t.run<{ hint: boolean }>("planday.carry", {})).hint).toBe(false);
  });

  it("WD-1: placing a story adds its feature to the week, once; a story with no parent adds nothing; no DevOps call", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const before = t.ado.calls.length;
    await t.run("pick.add", { date: D, half: "AM", clientKey: "Adatum", itemId: 111 });
    await t.run("pick.add", { date: D, half: "PM", clientKey: "Adatum", itemId: 112 });
    await t.run("pick.add", { date: D, half: "PM", clientKey: "Adatum", itemId: 101 });
    expect(t.ado.calls.length).toBe(before);
    const st = await t.run<PlanDayState>("planday.start", { date: D });
    const added = st.weekFeatures.filter((f) => f.clientKey === "Adatum");
    expect(added.map((f) => [f.itemId, f.level])).toEqual([[110, "feature"]]);
    expect(added[0]!.id).toBeTypeOf("number");
  });

  it("CF-1: an old Confirm today changes nothing and says so", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const r = await t.run<{ unchanged: boolean; message: string }>("planday.commit", { date: D });
    expect(r).toMatchObject({ unchanged: true, message: "There's nothing to confirm now. Your plan is what's on your day." });
  });
});
