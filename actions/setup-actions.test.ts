// S1 (D451): setup's own actions on a real plan store: the record per step, closing, start over, demo mode, and the
// day screen's values from Outlook with the saved settings as the fallback.
import { describe, expect, it } from "vitest";
import { parseConfig, type AppConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { SETUP_STEPS } from "../plan/setup.ts";
import { aClient } from "../test/builders/index.ts";
import { setupAction, type SetupContext, type SetupPrefill, type SetupView } from "./setup-actions.ts";

const NOW = "2026-11-02T14:00:00Z";
const cfg = (() => {
  const p = parseConfig(STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"'));
  if (!p.ok) throw new Error("starter");
  return p.config;
})();

function setup(o: Partial<SetupContext> = {}) {
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const adatum = aClient({ name: "Adatum" });
  const ctx: SetupContext = {
    plan,
    demo: false,
    env: "dev",
    config: async () => cfg,
    clients: async () => [{ key: adatum.clientKey, name: adatum.clientName, org: "contoso", write: null }],
    workingHours: async () => null,
    today: () => "2026-11-02",
    ...o,
  };
  const run = async <T>(action: Parameters<typeof setupAction>[1], input: unknown = {}) => {
    const r = await setupAction(ctx, action, input);
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  return { plan, run, ctx };
}

describe("setup actions", () => {
  it("a new person: the flow opens at Your day; each step's record moves it on", async () => {
    const s = setup();
    expect(await s.run<SetupView>("setup.load")).toMatchObject({ open: "day", line: null });
    expect(await s.run<SetupView>("setup.mark", { step: "day", status: "done" })).toMatchObject({ open: "clients", line: null });
  });

  it("closing halfway skips the rest; Today keeps the line; nothing opens by itself", async () => {
    const s = setup();
    await s.run("setup.mark", { step: "day", status: "done" });
    const v = await s.run<SetupView>("setup.mark", { closeFrom: "clients" });
    expect(v).toMatchObject({ open: null, line: { text: "3 setup steps left", step: "clients" } });
    expect(await s.plan.setupState()).toEqual({ day: "done", clients: "dismissed", blocks: "dismissed", calendars: "dismissed" });
  });

  it("the clients screen lists Dataverse's clients, or says plainly it couldn't read them", async () => {
    expect(await setup().run("setup.load", { clients: true })).toMatchObject({ clients: [{ name: "Adatum", org: "contoso", write: null }], clientsProblem: null });
    const down = await setup({ clients: async () => null }).run<{ clients: unknown[]; clientsProblem: string }>("setup.load", { clients: true });
    expect(down.clients).toEqual([]);
    expect(down.clientsProblem).toMatch(/couldn't read your clients/);
  });

  it("Start over forgets the record on dev and locally, never on prod", async () => {
    const s = setup();
    for (const step of SETUP_STEPS) await s.plan.setSetupStep(step, "done");
    expect(await s.run<SetupView>("setup.reset")).toMatchObject({ open: "day" });
    expect(await s.plan.setupState()).toEqual({});
    const prod = setup({ env: "prod" });
    expect(await setupAction(prod.ctx, "setup.reset", {})).toMatchObject({ ok: false, status: 403 });
  });

  it("demo mode: never opens, keeps no record", async () => {
    const s = setup({ demo: true });
    expect(await s.run<SetupView>("setup.load")).toMatchObject({ demo: true, open: null, line: null });
    expect(await setupAction(s.ctx, "setup.mark", { step: "day", status: "done" })).toMatchObject({ ok: false, status: 403 });
    expect(await s.plan.setupState()).toEqual({});
  });

  it("refuses unknown steps and statuses", async () => {
    const s = setup();
    expect(await setupAction(s.ctx, "setup.mark", { step: "billing", status: "done" })).toMatchObject({ ok: false, status: 400 });
    expect(await setupAction(s.ctx, "setup.mark", { step: "day", status: "dismissed" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("Your day's values", () => {
  it("from Outlook's working hours: its zone and days, the saved lunch kept", async () => {
    const s = setup({ workingHours: async () => ({ days: ["monday", "tuesday", "wednesday", "thursday"], start: "08:00", end: "16:30", zone: "America/Chicago" }) });
    const p = await s.run<SetupPrefill>("setup.prefill");
    expect(p).toMatchObject({ from: "outlook", timeZone: "America/Chicago", note: null });
    expect(p.weekdays).toMatchObject({ mon: ["08:00-16:30"], thu: ["08:00-16:30"], fri: [], sat: [] });
    const l = cfg.week.hours.lunch;
    // A split with no break reads as one time ("12:00"), not "12:00-12:00".
    expect(p.lunch).toBe(l ? (l.start === l.end ? l.start : `${l.start}-${l.end}`) : "");
    expect(p.lunch).not.toMatch(/^(\d\d:\d\d)-\1$/);
  });

  it("when Graph fails: the saved settings, with a plain note", async () => {
    for (const workingHours of [async () => null, async () => Promise.reject(new Error("Graph 503"))] as SetupContext["workingHours"][]) {
      const p = await setup({ workingHours }).run<SetupPrefill>("setup.prefill");
      expect(p.from).toBe("settings");
      expect(p.timeZone).toBe((cfg as AppConfig).week.hours.timeZone);
      expect(p.note).toMatch(/Outlook didn't share your working hours/);
      expect(p.weekdays.mon).toEqual(cfg.week.hours.weekdays.mon.map((x) => `${x.start}-${x.end}`));
    }
  });
});

describe("RF-1: stepping through to the end", () => {
  it("the last step done or skipped ends Day's line, with a step skipped; Settings still says what's left", async () => {
    const s = setup();
    await s.run("setup.mark", { step: "day", status: "done" });
    await s.run("setup.mark", { step: "clients", status: "skipped" });
    await s.run("setup.mark", { step: "blocks", status: "done" });
    const mid = await s.run<SetupView>("setup.load");
    expect(mid.through).toBe(false);
    const v = await s.run<SetupView>("setup.mark", { step: "calendars", status: "skipped" });
    expect(v).toMatchObject({ through: true, line: null, left: { text: "2 setup steps left", step: "clients" } });
    // After a reload too.
    expect(await s.run<SetupView>("setup.load")).toMatchObject({ through: true, line: null, left: { step: "clients" } });
  });

  it("closing the flow early keeps the line; a later step through to the end removes it", async () => {
    const s = setup();
    await s.run("setup.mark", { step: "day", status: "done" });
    const closed = await s.run<SetupView>("setup.mark", { closeFrom: "clients" });
    expect(closed).toMatchObject({ through: false, line: { text: "3 setup steps left" } });
    // Run from Settings, skipping to the end.
    for (const step of ["clients", "blocks", "calendars"]) await s.run("setup.mark", { step, status: "skipped" });
    expect(await s.run<SetupView>("setup.load")).toMatchObject({ through: true, line: null, left: { text: "3 setup steps left" } });
  });

  it("someone who never opened the flow has no line yet (it opens by itself), and Start over forgets the mark", async () => {
    const s = setup();
    expect(await s.run<SetupView>("setup.load")).toMatchObject({ through: false, line: null, open: "day" });
    await s.run("setup.mark", { step: "calendars", status: "done" });
    expect((await s.run<SetupView>("setup.load")).through).toBe(true);
    expect(await s.run<SetupView>("setup.reset")).toMatchObject({ through: false });
    expect((await s.run<SetupView>("setup.load")).through).toBe(false);
  });
});
