// UI-5: Your first day's checklist. States from setup's record and counts only; never a PAT, token, name or device.
import { describe, expect, it } from "vitest";
import { CHECK_IDS, checklist, guideAction, type ChecklistFacts } from "./guide-actions.ts";

const facts = (o: Partial<ChecklistFacts> = {}): ChecklistFacts => ({ setup: {}, writeClients: 0, devices: 0, teamsMessages: false, weekConfirmed: false, todayConfirmed: false, ...o });
const states = (f: ChecklistFacts) => Object.fromEntries(checklist(f).map((c) => [c.id, c.state]));

describe("guide.checklist", () => {
  it("a new person: everything to do, in the Guide's order", () => {
    expect(checklist(facts()).map((c) => c.id)).toEqual([...CHECK_IDS]);
    expect(Object.values(states(facts()))).toEqual(CHECK_IDS.map(() => "todo"));
  });
  it("reads setup's steps: done, skipped (dismissed counts as skipped) or still to do", () => {
    expect(states(facts({ setup: { day: "done", clients: "skipped", calendars: "dismissed" } }))).toMatchObject({ hours: "done", clients: "skipped", calendars: "skipped" });
    // Standing blocks are on the same page as the hours.
    expect(states(facts({ setup: { blocks: "done" } })).hours).toBe("done");
  });
  it("a write PAT for any client, a device or Teams messages, a confirmed week and today", () => {
    expect(states(facts({ writeClients: 2, devices: 0, teamsMessages: true, weekConfirmed: true, todayConfirmed: true }))).toMatchObject({ devops: "done", notify: "done", week: "done", today: "done" });
    expect(states(facts({ devices: 1 })).notify).toBe("done");
  });
  it("only ids and states leave the server, whatever the facts hold", async () => {
    const r = await guideAction({ demo: false, facts: async () => facts({ writeClients: 1, setup: { day: "done" } }) }, {});
    expect(r).toMatchObject({ ok: true });
    const data = (r as { data: { demo: boolean; checks: Record<string, unknown>[] } }).data;
    expect(data.demo).toBe(false);
    for (const c of data.checks) expect(Object.keys(c).sort()).toEqual(["id", "state"]);
    // Nothing that looks like a token, an address or a name.
    expect(JSON.stringify(data)).not.toMatch(/pat|token|@|secret|key/i);
  });
  it("demo: no checks (the demo's person is made up); no store: says so; input must be empty", async () => {
    expect(await guideAction({ demo: true, facts: async () => facts() }, {})).toEqual({ ok: true, data: { demo: true, checks: [] } });
    expect(await guideAction({ demo: false, facts: async () => null }, {})).toMatchObject({ ok: false, status: 503 });
    expect(await guideAction({ demo: false, facts: async () => facts() }, { userId: "x" })).toMatchObject({ ok: false, status: 400 });
    expect(await guideAction({ demo: false, facts: async () => facts() }, undefined)).toMatchObject({ ok: true });
  });
});

describe("guide.checklist through the dispatcher, on a real plan store", () => {
  it("a stored write identity counts as done, and nothing of it comes back", async () => {
    const { dispatch } = await import("./dispatch.ts");
    const { createPlanStore } = await import("../store/plan-store.ts");
    const { parseConfig } = await import("../config/schema.ts");
    const { STARTER_TOML } = await import("../fixtures/starter.ts");
    const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from("2026-11-02T14:00:00Z").toZonedDateTimeISO("America/New_York") });
    await plan.setSetupStep("day", "done");
    await plan.setDevopsIdentity({ clientKey: "contoso", org: "contoso", id: "id-1", name: "Pat Example", email: "pat@example.com", expires: "2027-01-01" });
    const parsed = parseConfig(STARTER_TOML);
    const no = () => {
      throw new Error("not in this test");
    };
    const r = await dispatch(
      { loadConfig: async () => ({ path: "/x", parsed }), makeDataverse: no, makeOutlook: no, makeGoogle: no, makeDevOps: no, saveSystemUserId: async () => {}, now: () => "2026-11-02T14:00:00Z", plan },
      { action: "guide.checklist", input: {} },
    );
    if (!r.ok) throw new Error(r.error);
    expect((r.data as { checks: { id: string; state: string }[] }).checks.filter((c) => c.state === "done").map((c) => c.id)).toEqual(["hours", "devops"]);
    const text = JSON.stringify(r.data);
    for (const leak of ["Pat Example", "pat@example.com", "contoso", "id-1", "2027"]) expect(text).not.toContain(leak);
  });
});
