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

  it("stores unavailable time and flex sessions; a flex session opens its update follow-up once it has ended", () => {
    const { store } = fresh();
    const u = store.addUnavailable({ date: "2026-11-03", title: "Dentist", start: "2026-11-03T19:00:00Z", end: "2026-11-03T20:00:00Z" });
    expect(store.unavailableBetween("2026-11-02", "2026-11-08").map((x) => x.id)).toEqual([u.id]);
    const f = store.addFlex({ date: "2026-11-07", clientKey: "CSC", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z", itemId: 101 });
    expect(store.flexBetween("2026-11-07", "2026-11-07").map((x) => x.itemId)).toEqual([101]);
    store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T16:00:00Z"));
    expect(store.openFollowUps()).toEqual([]);
    store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T17:00:00Z"));
    store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T18:00:00Z"));
    const followUps = store.openFollowUps();
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ clientKey: "CSC", sourceKind: "flex", sourceId: f.id });
    expect(followUps[0]!.what).toMatch(/update to CSC/);
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

describe("step 6c: follow-ups, timer state, focused time and reset", () => {
  it("closes a follow-up by hand with a note, once", () => {
    const { store } = fresh();
    const f = store.addFlex({ date: "2026-11-07", clientKey: "CSC", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z" });
    const [followUp] = store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T18:00:00Z"));
    expect(followUp?.sourceId).toBe(f.id);
    const closed = store.closeFollowUp(followUp!.id, "Posted in Teams");
    expect(closed).toMatchObject({ closeNote: "Posted in Teams" });
    expect(closed.closedAt).not.toBeNull();
    expect(store.openFollowUps()).toEqual([]);
    expect(store.allFollowUps()).toHaveLength(1);
    expect(() => store.closeFollowUp(followUp!.id, null)).toThrow(/already closed/);
    expect(() => store.closeFollowUp(999, null)).toThrow(/No follow-up/);
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
  it("pins a feature to specific blocks without changing its blocks (step 11)", () => {
    const { store } = fresh();
    const a = store.setWeekFeature({ ...f, blocks: 1 })!;
    store.placeFeature(a.id, "2026-11-10", "PM", true);
    store.placeFeature(a.id, "2026-11-09", "AM", true);
    expect(store.weekPlan(W).features[0]).toMatchObject({ blocks: 1, slots: [{ date: "2026-11-09", half: "AM" }, { date: "2026-11-10", half: "PM" }] });
    store.placeFeature(a.id, "2026-11-09", "AM", true); // again: no change
    store.placeFeature(a.id, "2026-11-09", "AM", false);
    expect(store.weekPlan(W).features[0]).toMatchObject({ blocks: 1, slots: [{ date: "2026-11-10", half: "PM" }] });
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

describe("week plan by client (step 11)", () => {
  const W = "2026-11-09";
  const base = { weekStart: W, clientKey: "CSC", title: "T", itemType: "Feature", url: null };
  it("migration 8 turns committed features into musts and placements into pins, ids kept, with a backup first", () => {
    const dir = mkdtempSync(join(tmpdir(), "coopilot-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 7; v++) {
      old.exec(MIGRATIONS[v - 1]!);
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    old.exec("INSERT INTO week_plans VALUES ('2026-11-09', '2026-11-06T16:00:00-05:00[America/New_York]', '2026-11-06T15:00:00-05:00[America/New_York]', '2026-11-06T16:00:00-05:00[America/New_York]')");
    old.exec(`INSERT INTO week_features (id, week_start, client_key, item_id, title, item_type, url, blocks, position, created_at, updated_at) VALUES
              (7, '2026-11-09', 'CSC', 210, 'Export', 'Feature', NULL, 3, 1, '2026-11-06T15:00:00-05:00[America/New_York]', '2026-11-06T15:00:00-05:00[America/New_York]'),
              (9, '2026-11-09', 'W&C', 300, 'Paging', 'Feature', NULL, 1, 2, '2026-11-06T15:00:00-05:00[America/New_York]', '2026-11-06T15:00:00-05:00[America/New_York]')`);
    old.exec("INSERT INTO week_feature_slots VALUES (7, '2026-11-10', 'PM'), (7, '2026-11-11', 'AM')");
    old.close();
    const store = createPlanStore({ path, now });
    expect(store.schemaVersion()).toBe(MIGRATIONS.length);
    expect(readdirSync(dir).filter((x) => x.startsWith("plan.db.bak-v7-"))).toHaveLength(1);
    const p = store.weekPlan(W);
    expect(p.committedAt).toBe("2026-11-06T16:00:00-05:00[America/New_York]");
    expect(p.features.map((x) => [x.id, x.itemId, x.level, x.tier, x.blocks, x.position, x.doneAt, x.slots.length])).toEqual([
      [7, 210, "feature", "must", 3, null, null, 2],
      [9, 300, "feature", "must", 1, null, null, 0],
    ]);
    store.close();
  });

  it("adds features and stories as musts or nice to haves, sets tier, blocks in half steps, and a done mark", () => {
    const { store } = fresh();
    const a = store.addWeekItem({ ...base, itemId: 210, level: "feature" });
    expect(a).toMatchObject({ level: "feature", tier: "must", blocks: 1, position: null, doneAt: null });
    const b = store.addWeekItem({ ...base, itemId: 501, itemType: "User Story", level: "story", tier: "nice" });
    expect(b).toMatchObject({ level: "story", tier: "nice", blocks: 0.5 });
    // Adding again updates it in place.
    expect(store.addWeekItem({ ...base, itemId: 210, title: "Renamed", level: "feature", tier: "nice", blocks: 2.5 })).toMatchObject({ id: a.id, title: "Renamed", tier: "nice", blocks: 2.5 });
    expect(store.setWeekItemTier(a.id, "must").tier).toBe("must");
    expect(store.setWeekItemBlocks(b.id, 1.5).blocks).toBe(1.5);
    expect(() => store.setWeekItemBlocks(b.id, 0.3)).toThrow(/half steps/);
    expect(() => store.setWeekItemBlocks(b.id, 21)).toThrow(/blocks/);
    expect(store.markWeekItemDone(b.id, true).doneAt).toBe(clock.toString({ smallestUnit: "second" }));
    expect(store.markWeekItemDone(b.id, false).doneAt).toBeNull();
    store.removeWeekItem(b.id);
    expect(store.weekPlan(W).features.map((x) => x.itemId)).toEqual([210]);
    expect(() => store.removeWeekItem(b.id)).toThrow(/No such/);
    expect(store.weekItem(a.id)?.itemId).toBe(210);
  });

  it("keeps a local order per client and tier, resets to DevOps order, and a tier change drops the position", () => {
    const { store } = fresh();
    const ids = [210, 220, 230].map((itemId) => store.addWeekItem({ ...base, itemId, level: "feature" }).id);
    store.addWeekItem({ ...base, clientKey: "W&C", itemId: 300, level: "feature" });
    store.reorderWeekItems(W, "CSC", "must", [{ itemId: 230, position: 1 }, { itemId: 210, position: 2 }]);
    const pos = () => Object.fromEntries(store.weekPlan(W).features.map((x) => [x.itemId, x.position]));
    expect(pos()).toEqual({ 210: 2, 220: null, 230: 1, 300: null });
    expect(() => store.reorderWeekItems(W, "CSC", "nice", [{ itemId: 230, position: 1 }])).toThrow(/nice to have/);
    expect(() => store.reorderWeekItems(W, "W&C", "must", [{ itemId: 210, position: 1 }])).toThrow();
    store.setWeekItemTier(ids[2]!, "nice");
    expect(pos()[230]).toBeNull();
    store.reorderWeekItems(W, "CSC", "must", null);
    expect(pos()).toEqual({ 210: null, 220: null, 230: null, 300: null });
  });
});

describe("quick capture (step 9)", () => {
  it("migration 7 keeps draft stories and the picks that point at them, and lets a draft have no feature", () => {
    const dir = mkdtempSync(join(tmpdir(), "coopilot-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 6; v++) {
      old.exec(MIGRATIONS[v - 1]!);
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    old.exec("INSERT INTO day_plans (date, created_at, updated_at) VALUES ('2026-10-29', 'x', 'x')");
    old.exec("INSERT INTO draft_stories VALUES (5, 'CSC', 210, 'Draft under 210', 'M', 'x', 'x')");
    old.exec(`INSERT INTO picks (id, date, half, client_key, kind, draft_id, title, size, status, position, created_at, updated_at)
              VALUES (1, '2026-10-29', 'AM', 'CSC', 'draft', 5, 'Draft under 210', 'M', 'planned', 0, 'x', 'x')`);
    old.close();
    const store = createPlanStore({ path, now });
    expect(store.schemaVersion()).toBe(MIGRATIONS.length);
    expect(store.drafts()).toEqual([expect.objectContaining({ id: 5, parentItemId: 210, title: "Draft under 210" })]);
    expect(store.picksFor("2026-10-29")[0]).toMatchObject({ kind: "draft", draftId: 5 });
    expect(store.addDraft({ clientKey: "CSC", parentItemId: null, title: "No feature yet", size: "S" }).parentItemId).toBeNull();
    expect(readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-v6-"))).toHaveLength(1);
    store.close();
  });

  it("saves captures to the inbox and routes each once to a follow-up, a draft story, a note, or dismisses it", () => {
    const { store } = fresh();
    const a = store.addCapture({ text: "  Told Dana I'd send the export by Thursday  ", clientKey: "CSC" });
    expect(a).toMatchObject({ text: "Told Dana I'd send the export by Thursday", clientKey: "CSC", routedAt: null });
    const b = store.addCapture({ text: "need to add paging", clientKey: "W&C" });
    const c = store.addCapture({ text: "their CFO prefers email", clientKey: null });
    const d = store.addCapture({ text: "never mind", clientKey: null });
    expect(() => store.addCapture({ text: "   ", clientKey: null })).toThrow(/Type something/);
    expect(store.inbox().map((x) => x.id)).toEqual([d.id, c.id, b.id, a.id]);
    expect(store.inboxCount()).toBe(4);

    const la = store.routeCapture(a.id, { as: "follow_up", clientKey: "CSC", who: "Dana", what: "Send the export", due: "2026-11-05" });
    expect(la).toMatchObject({ routedAs: "follow_up" });
    expect(store.openFollowUps().find((l) => l.id === la.routedId)).toMatchObject({ kind: "capture", who: "Dana", what: "Send the export", due: "2026-11-05", clientKey: "CSC" });
    const db = store.routeCapture(b.id, { as: "draft", clientKey: "W&C", parentItemId: null, title: "Add paging", size: "M" });
    expect(store.getDraft(db.routedId!)).toMatchObject({ clientKey: "W&C", parentItemId: null, title: "Add paging", size: "M" });
    const nc = store.routeCapture(c.id, { as: "draft", clientKey: "Quiddity", parentItemId: null, title: "Their CFO prefers email", size: "S" });
    expect(store.getDraft(nc.routedId!)).toMatchObject({ level: "story", clientKey: "Quiddity" });
    store.routeCapture(d.id, { as: "dismissed" });
    expect(store.inboxCount()).toBe(0);
    expect(() => store.routeCapture(a.id, { as: "dismissed" })).toThrow(/already sorted/);
    // A failed route leaves the capture in the inbox.
    const e = store.addCapture({ text: "x", clientKey: null });
    expect(() => store.routeCapture(e.id, { as: "follow_up", clientKey: null, who: "", what: " ", due: null })).toThrow();
    expect(store.inbox().map((x) => x.id)).toEqual([e.id]);
  });

  it("migration 11 renames loops to follow-ups and moves notes into where I left off, with a backup first", () => {
    const dir = mkdtempSync(join(tmpdir(), "coopilot-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 10; v++) {
      old.exec(MIGRATIONS[v - 1]!);
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    const at = "2026-10-30T16:00:00-04:00[America/New_York]";
    old.exec(`INSERT INTO loops (id, kind, client_key, who, what, opened_at) VALUES (2, 'manual', NULL, 'Dana', 'Send it', '${at}')`);
    old.exec(`INSERT INTO loops (id, kind, client_key, who, what, opened_at, closed_at, close_note, closed_by, rule_key) VALUES (1, 'slip', 'W&C', 'W&C', 'Heads-up', '${at}', '${at}', 'told', 'me', 'slip:x')`);
    old.exec(`INSERT INTO resume_notes (client_key, date, note, created_at, updated_at) VALUES ('CSC', '2026-10-30', 'Left off at mapping', '${at}', '${at}')`);
    old.exec(`INSERT INTO captures (id, text, client_key, created_at, routed_at, routed_as, routed_id) VALUES
              (1, 'CSC wants Git', 'CSC', '${at}', '${at}', 'note', 1), (2, 'caching idea', NULL, '${at}', '${at}', 'note', 2),
              (3, 'told Dana', NULL, '${at}', '${at}', 'loop', 2), (4, 'never mind', NULL, '${at}', '${at}', 'dismissed', NULL), (5, 'to sort', NULL, '${at}', NULL, NULL, NULL)`);
    old.exec(`INSERT INTO notes (id, client_key, text, capture_id, created_at, updated_at) VALUES
              (1, 'CSC', 'CSC wants Git', 1, '${at}', '${at}'), (2, NULL, 'caching idea', 2, '${at}', '${at}'), (3, 'W&C', 'Mark approves timesheets', NULL, '${at}', '${at}'), (4, NULL, 'Read the docs', NULL, '${at}', '${at}')`);
    old.close();
    const store = createPlanStore({ path, now });
    expect(store.schemaVersion()).toBe(MIGRATIONS.length);
    expect(readdirSync(dir).filter((x) => x.startsWith("plan.db.bak-v10-"))).toHaveLength(1);
    // Loops are follow-ups now, ids kept; a closed one counts as done.
    expect(store.allFollowUps().map((f) => [f.id, f.kind, f.outcome, f.byHand]).sort()).toEqual([[1, "slip", "done", false], [2, "manual", null, true]]);
    // Notes with a client join that client's left-off line on their day; appended to one already there.
    expect(store.latestNotes("2026-10-31").CSC?.note).toBe("Left off at mapping · CSC wants Git");
    expect(store.latestNotes("2026-10-31")["W&C"]?.note).toBe("Mark approves timesheets");
    // Notes with no client go back to the inbox: their own capture un-sorted, or a new capture.
    expect(store.inbox().map((c) => c.text).sort()).toEqual(["Read the docs", "caching idea", "to sort"]);
    const ex = store.exportJson() as Record<string, unknown>;
    expect(ex.notes).toBeUndefined();
    expect((ex.captures as { id: number; routedAs: string | null }[]).find((c) => c.id === 1)?.routedAs).toBe("left_off");
    expect((ex.captures as { id: number; routedAs: string | null }[]).find((c) => c.id === 3)?.routedAs).toBe("follow_up");
    store.close();
  });

  it("routes a capture to a draft feature, optionally under an epic", () => {
    const { store } = fresh();
    const c = store.addCapture({ text: "feature: onboarding", clientKey: "CSC" });
    const r = store.routeCapture(c.id, { as: "draft_feature", clientKey: "CSC", parentItemId: 900, title: "Onboarding" });
    expect(r.routedAs).toBe("draft_feature");
    expect(store.getDraft(r.routedId!)).toMatchObject({ level: "feature", parentItemId: 900, title: "Onboarding", size: "M" });
  });
});

describe("timeboxes, own Outlook events and the write log (step 12)", () => {
  const F = { subject: "CSC: Story", body: "x", start: "2026-11-03T14:00:00Z", end: "2026-11-03T15:00:00Z", showAs: "busy" as const, reminder: false as const };
  const box = { date: "2026-11-03", clientKey: "CSC", title: "Story", start: "2026-11-03T09:00:00-05:00", end: "2026-11-03T10:00:00-05:00", outlook: false };

  it("keeps timeboxes across reopen, with a stable uid", () => {
    const { path, store } = fresh();
    const t = store.addTimebox(box);
    expect(t.uid).toMatch(/^tb-[0-9a-f-]{36}$/);
    store.updateTimebox(t.id, { start: "2026-11-03T09:30:00-05:00", end: "2026-11-03T11:00:00-05:00", outlook: true });
    store.close();
    const again = createPlanStore({ path, now });
    expect(again.timeboxesBetween("2026-11-02", "2026-11-06")).toMatchObject([{ uid: t.uid, start: "2026-11-03T09:30:00-05:00", outlook: true, removedAt: null }]);
  });

  it("a removed timebox with a live Outlook event is kept (as removed), so its event can be taken off and undone", () => {
    const { store } = fresh();
    const t = store.addTimebox({ ...box, outlook: true });
    store.recordOwnEvent(t.uid, t.id, "E1", F);
    expect(store.removeTimebox(t.id)).toEqual({ kept: true });
    expect(store.timebox(t.id)!.removedAt).not.toBeNull();
    store.markOwnDeleted(t.uid);
    expect(store.timebox(t.id)!.removedAt).not.toBeNull();
    expect(store.ownEvents()).toEqual([]);
    expect(store.ownEvent(t.uid)!.deletedAt).not.toBeNull();
  });

  it("a timebox never on Outlook is simply deleted", () => {
    const { store } = fresh();
    const t = store.addTimebox(box);
    expect(store.removeTimebox(t.id)).toEqual({ kept: false });
  });

  it("logs a write with its prior values, settles it, and marks it undone", () => {
    const { path, store } = fresh();
    const local = { start: box.start, end: box.end, outlook: false, removedAt: null };
    const w = store.logWrite({ op: "update", uid: "tb-1", eventId: "E1", account: "me@x", calendar: "Calendar", before: F, after: { ...F, start: "2026-11-03T14:30:00Z" }, localBefore: local, localAfter: local, auto: false });
    expect(w.status).toBe("pending");
    store.settleWrite(w.id, { status: "unconfirmed", message: "Couldn't confirm" });
    store.settleWrite(w.id, { status: "confirmed", retry: true });
    const u = store.logWrite({ op: "update", uid: "tb-1", eventId: "E1", account: null, calendar: null, before: null, after: F, localBefore: null, localAfter: null, auto: false, undoOf: w.id });
    store.markUndone(w.id, u.id);
    store.close();
    const again = createPlanStore({ path, now });
    expect(again.writeLog().map((x) => [x.id, x.status, x.attempts, x.undoneBy, x.undoOf])).toEqual([[u.id, "pending", 1, null, w.id], [w.id, "confirmed", 2, u.id, null]]);
    expect(again.writeEntry(w.id)!.before).toEqual(F);
  });

  it("reset empties timeboxes but keeps Coopilot's Outlook events and the audit log", () => {
    const { store } = fresh();
    const t = store.addTimebox({ ...box, outlook: true });
    store.recordOwnEvent(t.uid, t.id, "E1", F);
    store.logWrite({ op: "create", uid: t.uid, eventId: "E1", account: null, calendar: null, before: null, after: F, localBefore: null, localAfter: null, auto: false });
    store.reset();
    expect(store.timeboxesBetween("2026-11-01", "2026-11-30")).toEqual([]);
    expect(store.ownEvents()).toMatchObject([{ uid: t.uid, timeboxId: null, eventId: "E1" }]);
    expect(store.writeLog()).toHaveLength(1);
  });

  it("export includes timeboxes, own events and the write log", () => {
    const { store } = fresh();
    store.addTimebox(box);
    const e = store.exportJson();
    expect([e.timeboxes.length, e.outlookEvents.length, e.writeLog.length]).toEqual([1, 0, 0]);
  });
});
