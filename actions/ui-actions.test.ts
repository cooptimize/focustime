import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

function setup(write = true) {
  const dir = mkdtempSync(join(tmpdir(), "c-ui-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"'));
  const no = () => { throw new Error("n/a"); };
  const c: ActionContext = {
    loadConfig: async () => ({ path, parsed: parseConfig(readFileSync(path, "utf8")) }),
    makeDataverse: no, makeOutlook: no, makeGoogle: no, makeDevOps: no,
    saveSystemUserId: async () => {},
    now: () => "2026-11-02T14:00:00Z",
    ...(write ? { writeConfig: (edit: (t: string) => string) => writeConfig(path, edit) } : {}),
  };
  return { c, path };
}

describe("ui.set_theme (step 6b)", () => {
  it("saves the theme in [ui] and returns it; the file keeps its comments", async () => {
    const t = setup();
    const r = await dispatch(t.c, { action: "ui.set_theme", input: { theme: "cooptimize-light" } });
    expect(r).toEqual({ ok: true, data: { ui: { theme: "cooptimize-light", viewRange: "business", showTimelines: true, reduceMotion: false } } });
    const text = readFileSync(t.path, "utf8");
    expect(text).toContain('[ui]\ntheme = "cooptimize-light"');
    expect(text).toContain("# Coopilot configuration.");
  });
  it("refuses unknown themes and extra fields", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.set_theme", input: { theme: "omarchy" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(t.c, { action: "ui.set_theme", input: { theme: "neutral", x: 1 } })).toMatchObject({ ok: false, status: 400 });
  });
  it("says so when settings can't be saved", async () => {
    expect(await dispatch(setup(false).c, { action: "ui.set_theme", input: { theme: "neutral" } })).toMatchObject({ ok: false, status: 503 });
  });
});

describe("ui.set_timelines (step 15.1, D276)", () => {
  it("saves the default for compact timelines in [ui]", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.set_timelines", input: { on: false } })).toEqual({ ok: true, data: { ui: { theme: "cooptimize-dark", viewRange: "business", showTimelines: false, reduceMotion: false } } });
    expect(readFileSync(t.path, "utf8")).toContain("show_timelines = false");
    expect((await dispatch(t.c, { action: "ui.set_timelines", input: { on: true } }) as { data: { ui: { showTimelines: boolean } } }).data.ui.showTimelines).toBe(true);
  });
  it("refuses anything but { on: boolean }", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.set_timelines", input: { on: "yes" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(t.c, { action: "ui.set_timelines", input: { on: true, x: 1 } })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("ui.set_reduce_motion (step 17.5)", () => {
  it("saves Reduce motion in [ui], read back by the config", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.set_reduce_motion", input: { on: true } })).toMatchObject({ ok: true, data: { ui: { reduceMotion: true } } });
    expect(readFileSync(t.path, "utf8")).toContain("reduce_motion = true");
    expect(await dispatch(t.c, { action: "ui.set_reduce_motion", input: { on: "yes" } })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("ui.first_launch (step 17.5)", () => {
  it("is true exactly once, across restarts (kept in the plan store)", async () => {
    const t = setup();
    const db = join(mkdtempSync(join(tmpdir(), "c-first-")), "plan.db");
    const now = () => Temporal.Instant.from("2026-11-02T14:00:00Z").toZonedDateTimeISO("America/New_York");
    const run = async () => {
      const plan = createPlanStore({ path: db, now });
      try {
        return (await dispatch({ ...t.c, plan }, { action: "ui.first_launch", input: {} })) as { data: { first: boolean } };
      } finally {
        plan.close();
      }
    };
    expect((await run()).data.first).toBe(true);
    expect((await run()).data.first).toBe(false);
    expect((await run()).data.first).toBe(false);
  });
  it("never in demo mode or without a plan store", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.first_launch", input: {} })).toEqual({ ok: true, data: { first: false } });
  });
});
