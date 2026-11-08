// WK-3 (DP-0): Deployment to-dos through the actions (create, kind, window, move, after hours) and the weekend rule
// on week.load. Local only: nothing here writes outside FocusTime.
import { createSnapshotStore } from "../host/local/snapshots.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML as STARTER_TOML } from "../fixtures/four-day-week.ts";
import type { Pick } from "../plan/types.ts";
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
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
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


type Added = { pick: Pick; note: string | null };

describe("Deployment to-dos", () => {
  it("are created with a client, a date and a window, sit where the window says and count after hours", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const sat = await t.run<Added>("deploy.add", { clientKey: "Adatum", date: "2026-11-07", start: "09:00", end: "11:00", title: "Release 4.2", note: "code and the sales model", itemIds: [101] });
    expect(sat.pick).toMatchObject({ todoKind: "deployment", kind: "intention", itemType: "Deployment", window: { start: "09:00", end: "11:00" }, half: "EVE", notes: "code and the sales model", links: [{ id: 101, title: "Story assigned to me" }], minutes: 120 });
    expect(sat.note).toBe("Saturday isn't a working day: this is flex time");
    const fri = await t.run<Added>("deploy.add", { clientKey: "Adatum", date: "2026-11-06", start: "19:00", end: "20:30" });
    expect(fri.pick).toMatchObject({ title: "Deployment", half: "EVE" });
    const inside = await t.run<Added>("deploy.add", { clientKey: "Adatum", date: "2026-11-04", start: "14:00", end: "15:00" });
    expect(inside.pick.half).toBe("PM");
    const week = await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02" });
    expect(week.afterHours?.minutes).toBe(120 + 90);
    expect(week.week.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("need a client, a date and a whole window, and only that client's items", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    expect((await t.fail("deploy.add", { clientKey: "Adatum", date: "2026-11-07", start: "09:00" })).error).toMatch(/end is required/);
    expect((await t.fail("deploy.add", { date: "2026-11-07", start: "09:00", end: "10:00" })).error).toMatch(/clientKey is required/);
    expect((await t.fail("deploy.add", { clientKey: "Adatum", date: "2026-11-07", start: "11:00", end: "09:00" })).error).toMatch(/end must be after the start/);
    expect((await t.fail("deploy.add", { clientKey: "Adatum", date: "2026-11-02", start: "19:00", end: "20:00" })).error).toMatch(/is past/);
    expect((await t.fail("deploy.add", { clientKey: "Cooptimize", date: "2026-11-07", start: "09:00", end: "10:00", itemIds: [101] })).error).toMatch(/#101 isn't among this client's/);
  });

  it("a to-do changes kind with its window, and back to a plain to-do, keeping what it points at", async () => {
    const t = setup();
    await t.run("week.load", { weekStart: "2026-11-02" });
    const { pick } = await t.run<Added>("pick.add", { date: "2026-11-05", half: "AM", clientKey: "Adatum", itemId: 101 });
    expect((await t.fail("pick.set_kind", { id: pick.id, kind: "deployment" })).error).toMatch(/needs a start and an end/);
    const dep = await t.run<Added>("pick.set_kind", { id: pick.id, kind: "deployment", start: "18:00", end: "20:00", note: "reports" });
    expect(dep.pick).toMatchObject({ todoKind: "deployment", kind: "item", itemId: 101, itemType: "User Story", half: "EVE", notes: "reports", links: [{ id: 101, title: "Story assigned to me" }] });
    const back = await t.run<Added>("pick.set_kind", { id: pick.id, kind: "todo" });
    expect(back.pick.todoKind).toBeUndefined();
    expect(back.pick.window).toBeUndefined();
    expect(back.pick).toMatchObject({ kind: "item", itemId: 101, notes: "reports" });
  });

  it("move like any to-do, keep their window and go where it puts them on the new day; Undo puts them back", async () => {
    const t = setup();
    const { pick } = await t.run<Added>("deploy.add", { clientKey: "Adatum", date: "2026-11-05", start: "19:00", end: "21:00", note: "SQL objects" });
    const moved = await t.run<Added>("pick.move", { id: pick.id, date: "2026-11-07", half: "AM" });
    expect(moved.pick).toMatchObject({ date: "2026-11-07", half: "EVE", todoKind: "deployment", window: { start: "19:00", end: "21:00" }, notes: "SQL objects", carriedFrom: pick.id });
    expect(moved.note).toBe("Saturday isn't a working day: this is flex time");
    await t.run("pick.uncarry", { id: moved.pick.id });
    const day = await t.plan.picksFor("2026-11-05");
    expect(day.find((p) => p.id === pick.id)).toMatchObject({ status: "planned", todoKind: "deployment" });
  });
});

describe("weekend columns on week.load", () => {
  it("stay off with nothing there, show for a to-do or a promise due, and always with Show weekend", async () => {
    const t = setup();
    const days = async (input: Record<string, unknown> = {}) => (await t.run<WeekLoadData>("week.load", { weekStart: "2026-11-02", ...input })).week.days.map((d) => d.weekday);
    expect(await days()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(await days({ weekend: true })).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    await t.run("followup.add", { what: "Send the cutover notes", due: "2026-11-08" });
    expect(await days()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sun"]);
    await t.run("pick.add", { date: "2026-11-07", half: "AM", clientKey: "Adatum", intention: "Check the overnight load" });
    expect(await days()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect((await t.fail("week.load", { weekend: "yes" })).error).toMatch(/weekend must be true or false/);
  });
});
