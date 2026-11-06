import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../host/local/config-file.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
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
    expect(r).toEqual({ ok: true, data: { ui: { theme: "cooptimize-light", viewRange: "business", showTimelines: true, reduceMotion: false, textSize: "default", showPersonal: true, inbox: { view: "needs_you", clients: [], group: "client" } } } });
    const text = readFileSync(t.path, "utf8");
    expect(text).toContain('[ui]\ntheme = "cooptimize-light"');
    expect(text).toContain("# FocusTime configuration.");
  });
  it("refuses unknown themes and extra fields", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.set_theme", input: { theme: "desktop" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(t.c, { action: "ui.set_theme", input: { theme: "neutral", x: 1 } })).toMatchObject({ ok: false, status: 400 });
  });
  it("says so when settings can't be saved", async () => {
    expect(await dispatch(setup(false).c, { action: "ui.set_theme", input: { theme: "neutral" } })).toMatchObject({ ok: false, status: 503 });
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

describe("ui.set_text_size (U5)", () => {
  it("saves the text size in [ui] text_size, read back by the config; refuses anything but the three presets", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.set_text_size", input: { size: "larger" } })).toMatchObject({ ok: true, data: { ui: { textSize: "larger" } } });
    expect(readFileSync(t.path, "utf8")).toContain('text_size = "larger"');
    expect(parseConfig(readFileSync(t.path, "utf8"))).toMatchObject({ ok: true, config: { ui: { textSize: "larger" } } });
    for (const input of [{ size: "huge" }, { size: 17 }, { size: "large", x: 1 }, null])
      expect(await dispatch(t.c, { action: "ui.set_text_size", input })).toMatchObject({ ok: false, status: 400 });
  });
  it("a config with no text_size reads as Default, and a bad one is a config error", () => {
    const base = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"');
    expect(parseConfig(base)).toMatchObject({ ok: true, config: { ui: { textSize: "default" } } });
    const bad = parseConfig(base.replace("[ui]\n", '[ui]\ntext_size = "tiny"\n'));
    expect(bad.ok ? [] : bad.errors.map((e) => e.field)).toContain("ui.text_size");
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

describe("ui.tour_offer (G1): the tour link on a first Today, once per person", () => {
  it("shows until done, then never again, across restarts; asking alone never marks it", async () => {
    const t = setup();
    const db = join(mkdtempSync(join(tmpdir(), "c-tour-")), "plan.db");
    const now = () => Temporal.Instant.from("2026-11-02T14:00:00Z").toZonedDateTimeISO("America/New_York");
    const run = async (input: unknown) => {
      const plan = createPlanStore({ path: db, now });
      try {
        return (await dispatch({ ...t.c, plan }, { action: "ui.tour_offer", input })) as { ok: boolean; data: { show: boolean } };
      } finally {
        plan.close();
      }
    };
    expect((await run({})).data.show).toBe(true);
    expect((await run({})).data.show).toBe(true);
    expect((await run({ done: true })).data.show).toBe(false);
    expect((await run({})).data.show).toBe(false);
    expect((await run({ done: true })).data.show).toBe(false);
  });
  it("is kept per person: one person's Not now doesn't hide it for another", async () => {
    const t = setup();
    const db = join(mkdtempSync(join(tmpdir(), "c-tour2-")), "plan.db");
    const now = () => Temporal.Instant.from("2026-11-02T14:00:00Z").toZonedDateTimeISO("America/New_York");
    const run = async (userId: string, input: unknown) => {
      const plan = createPlanStore({ path: db, now, userId });
      try {
        return (await dispatch({ ...t.c, plan }, { action: "ui.tour_offer", input })) as { data: { show: boolean } };
      } finally {
        plan.close();
      }
    };
    await run("ana", { done: true });
    expect((await run("ana", {})).data.show).toBe(false);
    expect((await run("ben", {})).data.show).toBe(true);
  });
  it("never in demo mode or without a plan store; anything else is a bad request", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.tour_offer", input: {} })).toEqual({ ok: true, data: { show: false } });
    for (const input of [{ done: false }, { done: true, x: 1 }, [], "yes"]) expect((await dispatch(t.c, { action: "ui.tour_offer", input })).ok, JSON.stringify(input)).toBe(false);
  });
});
