import { mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createPlanStore, MIGRATIONS } from "./plan-store.ts";

const NY = "America/New_York";
let clock = Temporal.ZonedDateTime.from("2026-11-02T08:01:00-05:00[America/New_York]");
const now = () => clock;
const fresh = () => {
  const path = join(mkdtempSync(join(tmpdir(), "coopilot-plan-")), "data", "plan.db");
  return { path, store: createPlanStore({ path, now }) };
};
const item = { half: "AM" as const, clientKey: "CSC", kind: "item" as const, itemId: 101, title: "Story", itemType: "User Story", itemUrl: "https://dev.azure.com/x/y/_workitems/edit/101", size: "M" as const };

describe("plan store", () => {
  it("migrates from empty, creates a private file, and records the schema version", () => {
    const { path, store } = fresh();
    expect(store.schemaVersion()).toBe(MIGRATIONS.length);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    store.close();
    // Re-opening runs nothing again.
    const again = createPlanStore({ path, now });
    expect(again.schemaVersion()).toBe(MIGRATIONS.length);
    again.close();
  });

  it("migrates a step 6 store to the time model with a private backup first, keeping every pick (D125)", () => {
    const dir = mkdtempSync(join(tmpdir(), "coopilot-plan-"));
    const path = join(dir, "plan.db");
    mkdirSync(dir, { recursive: true });
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    old.exec(MIGRATIONS[0]!);
    old.exec(MIGRATIONS[1]!);
    old.exec("INSERT INTO schema_migrations VALUES (1, 'x'), (2, 'x')");
    old.exec("INSERT INTO day_plans VALUES ('2026-10-29', '2026-10-29T08:00:00-04:00[America/New_York]', 'x', 'x')");
    old.exec(`INSERT INTO picks (id, date, half, client_key, kind, item_id, title, size, status, position, created_at, updated_at)
              VALUES (1, '2026-10-29', 'AM', 'CSC', 'item', 101, 'Story', 'M', 'done', 0, 'x', 'x'),
                     (2, '2026-10-29', 'PM', 'CSC', 'intention', NULL, 'Review', 'S', 'planned', 0, 'x', 'x')`);
    old.exec("UPDATE picks SET carried_from = 1 WHERE id = 2");
    old.close();

    const store = createPlanStore({ path, now });
    expect(store.schemaVersion()).toBe(MIGRATIONS.length);
    expect(store.picksFor("2026-10-29").map((p) => [p.id, p.half, p.status, p.carriedFrom])).toEqual([
      [1, "AM", "done", null],
      [2, "PM", "planned", 1],
    ]);
    store.start("2026-11-02");
    expect(store.addPick({ ...item, date: "2026-11-02", half: "EVE" }).half).toBe("EVE");
    const backups = readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-v2-"));
    expect(backups).toHaveLength(1);
    expect(statSync(join(dir, backups[0]!)).mode & 0o777).toBe(0o600);
    const bak = new DatabaseSync(join(dir, backups[0]!), { readOnly: true });
    expect((bak.prepare("SELECT COUNT(*) AS n FROM picks").get() as { n: number }).n).toBe(2);
    bak.close();
    store.close();
    // Opening again makes no second backup.
    createPlanStore({ path, now }).close();
    expect(readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-"))).toHaveLength(1);
  });

  it("stores unavailable time and flex sessions; a flex session opens its update loop once it has ended", () => {
    const { store } = fresh();
    const u = store.addUnavailable({ date: "2026-11-03", title: "Dentist", start: "2026-11-03T19:00:00Z", end: "2026-11-03T20:00:00Z" });
    expect(store.unavailableBetween("2026-11-02", "2026-11-08").map((x) => x.id)).toEqual([u.id]);
    const f = store.addFlex({ date: "2026-11-07", clientKey: "CSC", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z", itemId: 101 });
    expect(store.flexBetween("2026-11-07", "2026-11-07").map((x) => x.itemId)).toEqual([101]);
    store.openFlexLoops(Temporal.Instant.from("2026-11-07T16:00:00Z"));
    expect(store.openLoops()).toEqual([]);
    store.openFlexLoops(Temporal.Instant.from("2026-11-07T17:00:00Z"));
    store.openFlexLoops(Temporal.Instant.from("2026-11-07T18:00:00Z"));
    const loops = store.openLoops();
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ clientKey: "CSC", sourceKind: "flex", sourceId: f.id });
    expect(loops[0]!.what).toMatch(/update to CSC/);
    expect(() => store.removeFlex(f.id)).toThrow();
    expect(store.removeUnavailable(u.id)).toBe(true);
  });

  it("refuses a store from a newer Coopilot instead of guessing", () => {
    const { path, store } = fresh();
    store.close();
    const db = new DatabaseSync(path);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(MIGRATIONS.length + 5, "x");
    db.close();
    expect(() => createPlanStore({ path, now })).toThrow(/newer Coopilot/);
  });

  it("timestamps carry offset and time zone", () => {
    const { store } = fresh();
    const plan = store.start("2026-11-02");
    expect(plan.createdAt).toBe("2026-11-02T08:01:00-05:00[America/New_York]");
    expect(store.commit("2026-11-02").committedAt).toMatch(/-05:00\[America\/New_York\]$/);
  });

  it("commit and picks persist across a restart", () => {
    const { path, store } = fresh();
    store.start("2026-11-02");
    const a = store.addPick({ date: "2026-11-02", ...item });
    store.addPick({ date: "2026-11-02", half: "PM", clientKey: "Cooptimize", kind: "intention", title: "Write the planning doc", size: "S" });
    store.setSize(a.id, "L");
    store.commit("2026-11-02");
    store.setDone(a.id, true);
    store.close();

    const reopened = createPlanStore({ path, now });
    expect(reopened.day("2026-11-02")?.committedAt).not.toBeNull();
    const picks = reopened.picksFor("2026-11-02");
    expect(picks.map((p) => [p.half, p.title, p.size, p.status])).toEqual([
      ["AM", "Story", "L", "done"],
      ["PM", "Write the planning doc", "S", "planned"],
    ]);
    reopened.close();
  });

  it("enforces the shape of a pick in the schema too", () => {
    const { store } = fresh();
    expect(() => store.addPick({ date: "2026-11-02", ...item, size: "XL" as never })).toThrow();
    expect(() => store.addPick({ date: "2026-11-02", half: "AM", clientKey: "CSC", kind: "item", title: "no id", size: "M" })).toThrow();
  });

  it("moving to another day carries the pick and settles the original; same day just changes block", () => {
    const { store } = fresh();
    const a = store.addPick({ date: "2026-11-02", ...item });
    const inPlace = store.move(a.id, "2026-11-02", "PM");
    expect([inPlace.id, inPlace.half]).toEqual([a.id, "PM"]);
    const fri = store.move(a.id, "2026-11-06", "AM");
    expect(fri).toMatchObject({ date: "2026-11-06", half: "AM", status: "planned", carriedFrom: a.id, carriedFromDate: "2026-11-02", itemId: 101 });
    expect(store.getPick(a.id)!.status).toBe("moved");
  });

  it("carry-over: yesterday's unfinished picks, carried once", () => {
    const { store } = fresh();
    const done = store.addPick({ date: "2026-10-29", ...item, title: "done" });
    const open = store.addPick({ date: "2026-10-29", ...item, title: "unfinished" });
    store.commit("2026-10-29");
    store.setDone(done.id, true);
    expect(store.carryOverFor("2026-11-02").map((p) => p.title)).toEqual(["unfinished"]);
    store.move(open.id, "2026-11-02", "AM");
    expect(store.carryOverFor("2026-11-02")).toEqual([]);
    expect(store.picksFor("2026-11-02")[0]).toMatchObject({ title: "unfinished", carriedFromDate: "2026-10-29" });
  });

  it("remove: deleted before commit, kept as dropped after; a carried pick dropped again goes back to its day", () => {
    const { store } = fresh();
    const a = store.addPick({ date: "2026-11-02", ...item });
    expect(store.removePick(a.id).result).toBe("deleted");
    expect(store.getPick(a.id)).toBeNull();

    const old = store.addPick({ date: "2026-10-29", ...item });
    store.commit("2026-10-29");
    const carried = store.move(old.id, "2026-11-02", "AM");
    expect(store.removePick(carried.id).result).toBe("deleted");
    expect(store.getPick(old.id)!.status).toBe("planned");
    expect(store.carryOverFor("2026-11-02")).toHaveLength(1);

    const b = store.addPick({ date: "2026-11-02", ...item });
    store.commit("2026-11-02");
    expect(store.removePick(b.id)).toMatchObject({ result: "dropped", pick: { status: "dropped" } });
  });

  it("markOnce is true only the first time, across restarts", () => {
    const { path, store } = fresh();
    expect(store.markOnce("notify", "2026-11-02")).toBe(true);
    expect(store.markOnce("notify", "2026-11-02")).toBe(false);
    store.close();
    const again = createPlanStore({ path, now });
    expect(again.markOnce("notify", "2026-11-02")).toBe(false);
    expect(again.markOnce("notify", "2026-11-03")).toBe(true);
  });

  it("exports everything to JSON", () => {
    const { store } = fresh();
    store.addPick({ date: "2026-11-02", ...item });
    store.addDraft({ clientKey: "CSC", parentItemId: 130, title: "Split the feature", size: "S" });
    store.commit("2026-11-02");
    const out = JSON.parse(JSON.stringify(store.exportJson()));
    expect(out.schemaVersion).toBe(MIGRATIONS.length);
    expect(out.dayPlans).toHaveLength(1);
    expect(out.picks[0]).toMatchObject({ itemId: 101, size: "M", status: "planned" });
    expect(out.draftStories[0]).toMatchObject({ parentItemId: 130, title: "Split the feature" });
  });

  it("works for any zone the clock is in", () => {
    clock = Temporal.ZonedDateTime.from("2026-11-02T08:01:00+01:00[Europe/Paris]");
    const { store } = fresh();
    expect(store.start("2026-11-02").createdAt).toContain("[Europe/Paris]");
    clock = Temporal.ZonedDateTime.from(`2026-11-02T08:01:00-05:00[${NY}]`);
  });
});

describe("step 6c: loops, timer state, focused time and reset", () => {
  it("closes a loop by hand with a note, once", () => {
    const { store } = fresh();
    const f = store.addFlex({ date: "2026-11-07", clientKey: "CSC", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z" });
    const [loop] = store.openFlexLoops(Temporal.Instant.from("2026-11-07T18:00:00Z"));
    expect(loop?.sourceId).toBe(f.id);
    const closed = store.closeLoop(loop!.id, "Posted in Teams");
    expect(closed).toMatchObject({ closeNote: "Posted in Teams" });
    expect(closed.closedAt).not.toBeNull();
    expect(store.openLoops()).toEqual([]);
    expect(store.allLoops()).toHaveLength(1);
    expect(() => store.closeLoop(loop!.id, null)).toThrow(/already closed/);
    expect(() => store.closeLoop(999, null)).toThrow(/No loop/);
  });

  it("keeps small state and focused time across a reopen", () => {
    const { path, store } = fresh();
    const p = store.addPick({ date: "2026-11-02", ...item });
    store.setState("timer", { kind: "focus", pickId: p.id });
    store.addFocus({ pickId: p.id, label: "Story", startedAt: "2026-11-02T14:00:00Z", endedAt: "2026-11-02T14:25:00Z", seconds: 1500 });
    store.addFocus({ pickId: p.id, label: "Story", startedAt: "2026-11-02T15:00:00Z", endedAt: "2026-11-02T15:10:00Z", seconds: 600 });
    store.close();
    const again = createPlanStore({ path, now });
    expect(again.getState("timer")).toEqual({ kind: "focus", pickId: p.id });
    expect(again.focusedSeconds([p.id, 999])).toEqual({ [p.id]: 2100 });
    again.setState("timer", null);
    expect(again.getState("timer")).toBeNull();
    again.close();
  });

  it("reset empties every plan table after a private full backup, and keeps the once-a-day markers (Q37)", () => {
    const { path, store } = fresh();
    store.addPick({ date: "2026-11-02", ...item });
    store.markOnce("reminder", "2026-11-02");
    const bak = store.reset();
    expect(bak).toMatch(/plan\.db\.bak-reset-\d+T\d+Z$/);
    expect(statSync(bak!).mode & 0o777).toBe(0o600);
    expect(store.picksFor("2026-11-02")).toEqual([]);
    expect(store.markOnce("reminder", "2026-11-02")).toBe(false);
    // The backup still has the pick.
    const copy = new DatabaseSync(bak!);
    expect((copy.prepare("SELECT COUNT(*) AS n FROM picks").get() as { n: number }).n).toBe(1);
    copy.close();
    expect(readdirSync(join(path, "..")).some((f) => f.includes("bak-reset"))).toBe(true);
  });
});

describe("week plan (step 8)", () => {
  const W = "2026-11-09";
  const f = { weekStart: W, clientKey: "CSC", itemId: 210, title: "Dana's feature", itemType: "Feature", url: "https://dev.azure.com/x/y/_workitems/edit/210" };
  it("commits features to a week by a number of blocks; 0 blocks takes it off", () => {
    const { store } = fresh();
    expect(store.weekPlan(W)).toEqual({ weekStart: W, committedAt: null, updatedAt: null, features: [] });
    const a = store.setWeekFeature({ ...f, blocks: 2 });
    expect(a).toMatchObject({ clientKey: "CSC", itemId: 210, blocks: 2, slots: [] });
    store.setWeekFeature({ ...f, blocks: 3 });
    store.setWeekFeature({ ...f, itemId: 240, title: "Mine", blocks: 1 });
    expect(store.weekPlan(W).features.map((x) => [x.itemId, x.blocks])).toEqual([[210, 3], [240, 1]]);
    store.setWeekFeature({ ...f, itemId: 240, title: "Mine", blocks: 0 });
    expect(store.weekPlan(W).features.map((x) => x.itemId)).toEqual([210]);
    expect(() => store.setWeekFeature({ ...f, blocks: 99 })).toThrow(/blocks/);
  });
  it("places a feature on specific blocks; more placements than blocks raises the count, fewer blocks drops the latest placements", () => {
    const { store } = fresh();
    const a = store.setWeekFeature({ ...f, blocks: 1 })!;
    store.placeFeature(a.id, "2026-11-10", "PM", true);
    store.placeFeature(a.id, "2026-11-09", "AM", true);
    expect(store.weekPlan(W).features[0]).toMatchObject({ blocks: 2, slots: [{ date: "2026-11-09", half: "AM" }, { date: "2026-11-10", half: "PM" }] });
    store.placeFeature(a.id, "2026-11-09", "AM", true); // again: no change
    store.setWeekFeature({ ...f, blocks: 1 });
    expect(store.weekPlan(W).features[0]!.slots).toEqual([{ date: "2026-11-09", half: "AM" }]);
    store.placeFeature(a.id, "2026-11-09", "AM", false);
    expect(store.weekPlan(W).features[0]).toMatchObject({ blocks: 1, slots: [] });
    expect(() => store.placeFeature(a.id, "2026-11-17", "AM", true)).toThrow(/week/);
    expect(() => store.placeFeature(999, "2026-11-09", "AM", true)).toThrow();
  });
  it("commits the week, stays editable, and knows when it changed since the commit", () => {
    const { store } = fresh();
    store.setWeekFeature({ ...f, blocks: 2 });
    const c = store.commitWeek(W);
    expect(c.committedAt).toBe(clock.toString({ smallestUnit: "second" }));
    clock = clock.add({ minutes: 5 });
    store.setWeekFeature({ ...f, blocks: 3 });
    const p = store.weekPlan(W);
    expect(p.updatedAt! > p.committedAt!).toBe(true);
    clock = clock.add({ minutes: 5 });
    expect(store.commitWeek(W).committedAt! >= p.updatedAt!).toBe(true);
  });
  it("marks a feature as being broken down (local only), and the reset and export cover the week plan", () => {
    const { store } = fresh();
    store.markBreakdown("CSC", 240, true);
    expect(store.breakdownMarks()).toEqual([{ clientKey: "CSC", itemId: 240, markedAt: clock.toString({ smallestUnit: "second" }) }]);
    store.markBreakdown("CSC", 240, false);
    expect(store.breakdownMarks()).toEqual([]);
    store.setWeekFeature({ ...f, blocks: 2 });
    store.commitWeek(W);
    store.markBreakdown("CSC", 240, true);
    const e = store.exportJson();
    expect(e.weekPlans).toHaveLength(1);
    expect(e.weekFeatures).toHaveLength(1);
    expect(e.breakdownMarks).toHaveLength(1);
    store.reset();
    expect(store.weekPlan(W).features).toEqual([]);
    expect(store.breakdownMarks()).toEqual([]);
  });
});
