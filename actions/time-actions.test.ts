import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "c-time-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"'));
  const no = () => { throw new Error("n/a"); };
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.ZonedDateTime.from("2026-11-02T09:00:00-05:00[America/New_York]") });
  const c: ActionContext = {
    loadConfig: async () => ({ path, parsed: parseConfig(readFileSync(path, "utf8")) }),
    makeDataverse: no, makeOutlook: no, makeGoogle: no,
    makeDevOps: () => ({ lookup: (k: string, id: number) => (k === "CSC" && id === 101 ? { title: "Story 101", url: "https://dev.azure.com/o/p/_workitems/edit/101" } : null) }) as never,
    saveSystemUserId: async () => {},
    now: () => "2026-11-02T14:00:00Z",
    writeConfig: (edit: (t: string) => string) => writeConfig(path, edit),
    plan,
  };
  const run = (action: string, input: unknown) => dispatch(c, { action, input });
  return { c, path, plan, run };
}

describe("time model actions (step 6b)", () => {
  it("sets and clears one day's hours as an [[hours.override]], keeping the rest of the file", async () => {
    const t = setup();
    const r = await t.run("hours.set_day", { date: "2026-11-05", segments: ["20:00-22:00", "09:00-16:00"], lunch: "" });
    expect(r.ok).toBe(true);
    const text = readFileSync(t.path, "utf8");
    expect(text).toContain('[[hours.override]]\ndate = "2026-11-05"\nsegments = ["09:00-16:00", "20:00-22:00"]\nlunch = ""');
    expect(text).toContain("# Coopilot configuration.");
    await t.run("hours.set_day", { date: "2026-11-06", segments: ["09:00-12:00"] });
    await t.run("hours.set_day", { date: "2026-11-05", segments: ["10:00-15:00"] });
    const after = parseConfig(readFileSync(t.path, "utf8"));
    expect(after.ok && after.config.week.hours.overrides.map((o) => [o.date, o.segments![0]!.start])).toEqual([
      ["2026-11-05", "10:00"],
      ["2026-11-06", "09:00"],
    ]);
    expect((await t.run("hours.clear_day", { date: "2026-11-05" })).ok).toBe(true);
    const cleared = parseConfig(readFileSync(t.path, "utf8"));
    expect(cleared.ok && cleared.config.week.hours.overrides.map((o) => o.date)).toEqual(["2026-11-06"]);
  });

  it("refuses overlapping or malformed spans with a plain reason and writes nothing", async () => {
    const t = setup();
    const before = readFileSync(t.path, "utf8");
    expect(await t.run("hours.set_day", { date: "2026-11-05", segments: ["09:00-13:00", "12:00-17:00"] })).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/overlap/) });
    expect(await t.run("hours.set_day", { date: "2026-11-05", segments: ["9-5"] })).toMatchObject({ ok: false, status: 400 });
    expect(readFileSync(t.path, "utf8")).toBe(before);
  });

  it("saves the view range in [ui]", async () => {
    const t = setup();
    expect(await t.run("ui.set_view_range", { range: "24h" })).toEqual({ ok: true, data: { ui: { theme: "cooptimize-dark", viewRange: "24h", showTimelines: true } } });
    expect(await t.run("ui.set_view_range", { range: "48h" })).toMatchObject({ ok: false, status: 400 });
  });

  it("adds and removes unavailable time in the plan store, in the configured zone", async () => {
    const t = setup();
    const r = await t.run("unavailable.add", { date: "2026-11-03", title: "Dentist", start: "14:00", end: "15:30" });
    expect(r.ok).toBe(true);
    const u = (r as { data: { unavailable: { id: number; start: string } } }).data.unavailable;
    expect(Temporal.Instant.from(u.start).toString()).toBe("2026-11-03T19:00:00Z");
    expect(await t.run("unavailable.add", { date: "2026-11-03", title: "x", start: "15:00", end: "14:00" })).toMatchObject({ ok: false, status: 400 });
    expect((await t.run("unavailable.remove", { id: u.id })).ok).toBe(true);
    expect(await t.run("unavailable.remove", { id: u.id })).toMatchObject({ ok: false, status: 404 });
  });

  it("adds a flex session, names its DevOps item, and keeps it once it has ended", async () => {
    const t = setup();
    // Q34 (step 6c): an overlap with working hours is allowed and reported; a session all inside them is not flex.
    const over = await t.run("flex.add", { date: "2026-11-02", clientKey: "CSC", start: "16:00", end: "18:00" });
    expect(over).toMatchObject({ ok: true, data: { overlapMinutes: 60 } });
    expect(await t.run("flex.add", { date: "2026-11-02", clientKey: "CSC", start: "10:00", end: "11:00" })).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/inside working hours/) });
    expect(await t.run("flex.add", { date: "2026-11-07", clientKey: "CSC", start: "10:00", end: "12:00", itemId: 999 })).toMatchObject({ ok: false, status: 409 });
    const r = await t.run("flex.add", { date: "2026-11-07", clientKey: "CSC", start: "10:00", end: "12:00", itemId: 101, note: "Finish the import" });
    expect(r.ok).toBe(true);
    const f = (r as { data: { flex: { id: number; itemTitle: string } } }).data.flex;
    expect(f.itemTitle).toBe("Story 101");
    const evening = await t.run("flex.add", { date: "2026-11-02", clientKey: "CSC", start: "19:00", end: "20:00" });
    const e = (evening as { data: { flex: { id: number } } }).data.flex;
    t.plan.openFlexFollowUps(Temporal.Instant.from("2026-11-03T02:00:00Z"));
    expect(await t.run("flex.remove", { id: e.id })).toMatchObject({ ok: false, status: 409 });
    expect((await t.run("flex.remove", { id: f.id })).ok).toBe(true);
  });
});
