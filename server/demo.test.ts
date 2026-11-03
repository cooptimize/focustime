import { localStoreFiles } from "../host/local/files.ts";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, DEMO_REFUSED, type ActionContext } from "../actions/dispatch.ts";
import type { WeekLoadData } from "../actions/types.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-02T13:30:00Z"; // Monday 8:30 AM in New York
let fetchSpy: ReturnType<typeof vi.fn>;
let dirs: { config: string; data: string; cache: string };
const saved = { fetch: globalThis.fetch, env: { ...process.env } };

beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error("network call in demo mode");
  });
  globalThis.fetch = fetchSpy as never;
  dirs = { config: mkdtempSync(join(tmpdir(), "demo-cfg-")), data: mkdtempSync(join(tmpdir(), "demo-data-")), cache: mkdtempSync(join(tmpdir(), "demo-cache-")) };
  process.env.XDG_CONFIG_HOME = dirs.config;
  process.env.XDG_DATA_HOME = dirs.data;
  process.env.XDG_CACHE_HOME = dirs.cache;
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = { ...saved.env };
});

async function demo(): Promise<ActionContext> {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  return ctx;
}
const run = async (ctx: ActionContext, action: string, input: unknown = {}) => dispatch(ctx, { action, input });
const ok = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await run(ctx, action, input);
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};

describe("demo mode (D272)", () => {
  it("serves a believable week from fictional data with no network call", async () => {
    const ctx = await demo();
    const w = await ok<WeekLoadData>(ctx, "week.load", { refresh: true });
    expect(w.demo).toBe(true);
    expect(w.sources.every((s) => s.status === "ok")).toBe(true);
    expect(Object.values(w.week.days).flatMap((d) => [d.am, d.pm]).flatMap((s) => s.focus.map((f) => f.clientName))).toEqual(expect.arrayContaining(["Cooptimize", "Northwind", "Harbor", "Atlas"]));
    expect(w.week.days.find((d) => d.weekday === "Thu")?.pto).not.toBeNull();
    expect((w.devops ?? []).map((c) => c.clientKey).sort()).toEqual(["Atlas", "Cooptimize", "Harbor", "Northwind"]);
    expect(w.weekFeatures.filter((f) => f.tier === "must").length).toBe(11);
    expect(w.followUps.length).toBe(4);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs the walkthrough (plan the day, Done, focus, close the loop) with no network call", async () => {
    const ctx = await demo();
    await ok(ctx, "weekplan.load", { weekStart: "2026-11-02" });
    await ok(ctx, "planday.start", { date: "2026-11-02" });
    await ok(ctx, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411 });
    await ok(ctx, "pick.add", { date: "2026-11-02", half: "PM", clientKey: "Northwind", itemId: 1112 });
    await ok(ctx, "planday.commit", { date: "2026-11-02" });
    await ok(ctx, "timer.start", { kind: "focus" });
    await ok(ctx, "timer.stop", {});
    const fus = await ok<{ followUps: { id: number }[] }>(ctx, "followups.list", {});
    await ok(ctx, "followup.close", { id: fus.followUps[0]!.id, how: "teams" });
    await ok(ctx, "settings.load", {});
    await ok(ctx, "capture.load", {});
    await ok(ctx, "ui.set_theme", { theme: "cooptimize-light" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows meetings I'm invited to with their organizer, previews an answer, and refuses to send it (step 16)", async () => {
    const ctx = await demo();
    const w = await ok<WeekLoadData>(ctx, "week.load", {});
    const id = Object.keys(w.eventEdit).find((k) => k.includes("nwstatus"))!;
    expect(w.eventEdit[id]).toMatchObject({ isOrganizer: false, organizer: "Dana Morales", response: "accepted" });
    const p = await ok<{ preview: { previewId: string; summary: string; visibility: string } }>(ctx, "write.preview", { rsvp: { id: id.replace(/^outlook:/, ""), response: "declined", comment: "Out that afternoon" } });
    expect(p.preview).toMatchObject({ summary: "Decline the meeting", visibility: expect.stringMatching(/^Dana Morales gets your response/) });
    expect(await run(ctx, "write.confirm", { previewId: p.preview.previewId })).toMatchObject({ ok: false, code: "demo" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses every outward action with a plain reason", async () => {
    const ctx = await demo();
    for (const action of DEMO_REFUSED) {
      const r = await run(ctx, action, {});
      expect(r, action).toMatchObject({ ok: false, status: 403, code: "demo" });
    }
    expect(DEMO_REFUSED).toEqual(expect.arrayContaining(["write.confirm", "devops.confirm", "devops.set_write_pat", "secret.set", "link.open", "data.export"]));
    expect(ctx.writePats).toBeUndefined();
    expect(ctx.devopsWriter).toBeUndefined();
    expect(ctx.links).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("writes nothing to disk: config, data and cache folders stay empty, and the real store is untouched", async () => {
    const realPath = join(dirs.data, "real", "plan.db");
    const real = createPlanStore({ path: realPath, now: () => Temporal.Now.zonedDateTimeISO("America/New_York"), files: localStoreFiles });
    real.addPick({ date: "2026-11-02", half: "AM", clientKey: "Adatum", kind: "intention", title: "Real work", size: "M" } as never);
    const before = JSON.stringify(real.picksBetween("2026-10-01", "2026-12-31"));
    real.close();
    const bytes = readFileSync(realPath);
    const cfgPath = join(dirs.config, "focustime", "config.toml");
    writeFileSync(join(dirs.config, "marker"), "x");

    const ctx = await demo();
    await ok(ctx, "week.load", {});
    await ok(ctx, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411 });
    await ok(ctx, "planday.commit", { date: "2026-11-02" });
    await ok(ctx, "ui.set_view_range", { range: "24h" });
    await ok(ctx, "plan.reset", { confirm: "RESET" }).catch(() => null);

    expect(readdirSync(dirs.config)).toEqual(["marker"]);
    expect(readdirSync(dirs.cache)).toEqual([]);
    expect(readdirSync(dirs.data)).toEqual(["real"]);
    expect(() => readFileSync(cfgPath)).toThrow();
    expect(readFileSync(realPath).equals(bytes)).toBe(true);
    const again = createPlanStore({ path: realPath, now: () => Temporal.Now.zonedDateTimeISO("America/New_York") });
    expect(JSON.stringify(again.picksBetween("2026-10-01", "2026-12-31"))).toBe(before);
    again.close();
  });

  it("demo.set calls the server's switch; it is refused where there is none", async () => {
    const set = vi.fn(async () => {});
    const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set } });
    expect(await run(ctx, "demo.set", { on: false })).toMatchObject({ ok: true, data: { demo: false } });
    expect(set).toHaveBeenCalledWith(false);
    expect(await run((({ demo: _d, ...rest }) => rest)(ctx) as ActionContext, "demo.set", { on: true })).toMatchObject({ ok: false, status: 503 });
    expect(await run(ctx, "demo.set", { on: "yes" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("Done and commit (D265)", () => {
  it("the first Done commits; later edits keep that commit and need no second one, and committed rules apply", async () => {
    const ctx = await demo();
    await ok(ctx, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411 });
    const c = await ok<{ plan: { committedAt: string } }>(ctx, "planday.commit", { date: "2026-11-02" });
    const first = c.plan?.committedAt ?? ctx.plan!.day("2026-11-02")!.committedAt;
    expect(first).toBeTruthy();
    const added = await ok<{ pick: { id: number } }>(ctx, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4412 });
    expect(ctx.plan!.day("2026-11-02")!.committedAt).toBe(first);
    // After the commit a removed pick is kept as dropped (the committed-day rule), with no second commit.
    const removed = await ok<{ result: string }>(ctx, "pick.remove", { id: added.pick.id });
    expect(removed.result).toBe("dropped");
  });
});
