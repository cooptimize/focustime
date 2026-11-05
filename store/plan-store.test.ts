import { localStoreFiles } from "../host/local/files.ts";
import { mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { giveUnowned } from "./claim.ts";
import { MIGRATIONS, openPlanDb, planStoreOn, SOLO_USER, sqliteBackup, type PlanDbOptions, type PlanStore } from "./plan-store.ts";
import { sqliteConn } from "./sql/sqlite.ts";
import { addUsers, forEachDriver, type TestDb } from "../test/db.ts";

/** SQL Server's stand-in for a store's file: "reopen" is a new store on the same test database. */
const ON_SQLSERVER = "sqlserver:";

const NY = "America/New_York";
let clock = Temporal.ZonedDateTime.from("2026-11-02T08:01:00-05:00[America/New_York]");
const now = () => clock;
const item = { half: "AM" as const, clientKey: "Adatum", kind: "item" as const, itemId: 101, title: "Story", itemType: "User Story", itemUrl: "https://dev.azure.com/x/y/_workitems/edit/101", size: "M" as const };

const START = clock;
beforeEach(() => void (clock = START));

await forEachDriver("plan store", (d) => {
let current: TestDb | null = null;
/** On SQL Server, closing a store must not close the test database it shares. */
const onSqlServer = (db: TestDb, o: { now: () => Temporal.ZonedDateTime }): PlanStore => ({ ...planStoreOn(db.conn, { now: o.now, userId: SOLO_USER }), close: async () => {} });
/** A2: opens (and migrates) a store; rows from before migration 24 go to the test's one person, as at a first sign-in. */
async function createPlanStore(o: PlanDbOptions): Promise<PlanStore> {
  if (d.driver === "sqlserver" && o.path === ON_SQLSERVER) return onSqlServer(current!, o);
  if (d.driver === "sqlserver" && o.path === ":memory:") {
    current = await d.open();
    await addUsers(current.conn, SOLO_USER);
    return onSqlServer(current, o);
  }
  const raw = openPlanDb(o);
  const conn = sqliteConn(raw);
  await giveUnowned(conn, SOLO_USER);
  return planStoreOn(conn, { ...o, userId: SOLO_USER, backup: sqliteBackup(raw, o.files) });
}
const fresh = async () => {
  if (d.driver === "sqlserver") return { path: ON_SQLSERVER, store: await await createPlanStore({ path: ":memory:", now }) };
  const path = join(mkdtempSync(join(tmpdir(), "focustime-plan-")), "data", "plan.db");
  return { path, store: await await createPlanStore({ path, now, files: localStoreFiles }) };
};
/** Tests of SQLite itself: its file, its backups and its 26 migrations (SQL Server starts at the baseline). */
const itSqlite = d.driver === "sqlite" ? it : it.skip;

describe("plan store", () => {
  itSqlite("migrates from empty, creates a private file, and records the schema version", async () => {
    const { path, store } = await fresh();
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    await store.close();
    // Re-opening runs nothing again.
    const again = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await again.schemaVersion())).toBe(MIGRATIONS.length);
    await again.close();
  });

  itSqlite("migrates a step 6 store to the time model with a private backup first, keeping every pick (D125)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    mkdirSync(dir, { recursive: true });
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    old.exec(MIGRATIONS[0]!);
    old.exec(MIGRATIONS[1]!);
    old.exec("INSERT INTO schema_migrations VALUES (1, 'x'), (2, 'x')");
    old.exec("INSERT INTO day_plans VALUES ('2026-10-29', '2026-10-29T08:00:00-04:00[America/New_York]', 'x', 'x')");
    old.exec(`INSERT INTO picks (id, date, half, client_key, kind, item_id, title, size, status, position, created_at, updated_at)
              VALUES (1, '2026-10-29', 'AM', 'Adatum', 'item', 101, 'Story', 'M', 'done', 0, 'x', 'x'),
                     (2, '2026-10-29', 'PM', 'Adatum', 'intention', NULL, 'Review', 'S', 'planned', 0, 'x', 'x')`);
    old.exec("UPDATE picks SET carried_from = 1 WHERE id = 2");
    old.close();

    const store = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect((await store.picksFor("2026-10-29")).map((p) => [p.id, p.half, p.status, p.carriedFrom])).toEqual([
      [1, "AM", "done", null],
      [2, "PM", "planned", 1],
    ]);
    (await store.start("2026-11-02"));
    expect((await store.addPick({ ...item, date: "2026-11-02", half: "EVE" })).half).toBe("EVE");
    const backups = readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-v2-"));
    expect(backups).toHaveLength(1);
    expect(statSync(join(dir, backups[0]!)).mode & 0o777).toBe(0o600);
    const bak = new DatabaseSync(join(dir, backups[0]!), { readOnly: true });
    expect((bak.prepare("SELECT COUNT(*) AS n FROM picks").get() as { n: number }).n).toBe(2);
    bak.close();
    await store.close();
    // Opening again makes no second backup.
    await (await createPlanStore({ path, now, files: localStoreFiles })).close();
    expect(readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-"))).toHaveLength(1);
  });

  it("stores unavailable time and flex sessions; a flex session opens its update follow-up once it has ended", async () => {
    const { store } = await fresh();
    const u = (await store.addUnavailable({ date: "2026-11-03", title: "Dentist", start: "2026-11-03T19:00:00Z", end: "2026-11-03T20:00:00Z" }));
    expect((await store.unavailableBetween("2026-11-02", "2026-11-08")).map((x) => x.id)).toEqual([u.id]);
    const f = (await store.addFlex({ date: "2026-11-07", clientKey: "Adatum", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z", itemId: 101 }));
    expect((await store.flexBetween("2026-11-07", "2026-11-07")).map((x) => x.itemId)).toEqual([101]);
    (await store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T16:00:00Z")));
    expect((await store.openFollowUps())).toEqual([]);
    (await store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T17:00:00Z")));
    (await store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T18:00:00Z")));
    const followUps = (await store.openFollowUps());
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ clientKey: "Adatum", sourceKind: "flex", sourceId: f.id });
    expect(followUps[0]!.what).toMatch(/update to Adatum/);
    await expect(store.removeFlex(f.id)).rejects.toThrow();
    expect((await store.removeUnavailable(u.id))).toBe(true);
  });

  itSqlite("refuses a store from a newer FocusTime instead of guessing", async () => {
    const { path, store } = await fresh();
    await store.close();
    const db = new DatabaseSync(path);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(MIGRATIONS.length + 5, "x");
    db.close();
    await expect(createPlanStore({ path, now, files: localStoreFiles })).rejects.toThrow(/newer FocusTime/);
  });

  it("timestamps carry offset and time zone", async () => {
    const { store } = await fresh();
    const plan = (await store.start("2026-11-02"));
    expect(plan.createdAt).toBe("2026-11-02T08:01:00-05:00[America/New_York]");
    expect((await store.commit("2026-11-02")).committedAt).toMatch(/-05:00\[America\/New_York\]$/);
  });

  it("commit and picks persist across a restart", async () => {
    const { path, store } = await fresh();
    (await store.start("2026-11-02"));
    const a = (await store.addPick({ date: "2026-11-02", ...item }));
    (await store.addPick({ date: "2026-11-02", half: "PM", clientKey: "Cooptimize", kind: "intention", title: "Write the planning doc", size: "S" }));
    (await store.setSize(a.id, "L"));
    (await store.commit("2026-11-02"));
    (await store.setDone(a.id, true));
    await store.close();

    const reopened = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await reopened.day("2026-11-02"))?.committedAt).not.toBeNull();
    const picks = (await reopened.picksFor("2026-11-02"));
    expect(picks.map((p) => [p.half, p.title, p.size, p.status])).toEqual([
      ["AM", "Story", "L", "done"],
      ["PM", "Write the planning doc", "S", "planned"],
    ]);
    await reopened.close();
  });

  it("enforces the shape of a pick in the schema too", async () => {
    const { store } = await fresh();
    await expect(store.addPick({ date: "2026-11-02", ...item, size: "XL" as never })).rejects.toThrow();
    await expect(store.addPick({ date: "2026-11-02", half: "AM", clientKey: "Adatum", kind: "item", title: "no id", size: "M" })).rejects.toThrow();
  });

  it("moving to another day carries the pick and settles the original; same day just changes block", async () => {
    const { store } = await fresh();
    const a = (await store.addPick({ date: "2026-11-02", ...item }));
    const inPlace = (await store.move(a.id, "2026-11-02", "PM"));
    expect([inPlace.id, inPlace.half]).toEqual([a.id, "PM"]);
    const fri = (await store.move(a.id, "2026-11-06", "AM"));
    expect(fri).toMatchObject({ date: "2026-11-06", half: "AM", status: "planned", carriedFrom: a.id, carriedFromDate: "2026-11-02", itemId: 101 });
    expect((await store.getPick(a.id))!.status).toBe("moved");
  });

  it("carry-over: yesterday's unfinished picks, carried once", async () => {
    const { store } = await fresh();
    const done = (await store.addPick({ date: "2026-10-29", ...item, title: "done" }));
    const open = (await store.addPick({ date: "2026-10-29", ...item, title: "unfinished" }));
    (await store.commit("2026-10-29"));
    (await store.setDone(done.id, true));
    expect((await store.carryOverFor("2026-11-02")).map((p) => p.title)).toEqual(["unfinished"]);
    (await store.move(open.id, "2026-11-02", "AM"));
    expect((await store.carryOverFor("2026-11-02"))).toEqual([]);
    expect((await store.picksFor("2026-11-02"))[0]).toMatchObject({ title: "unfinished", carriedFromDate: "2026-10-29" });
  });

  it("remove: deleted before commit, kept as dropped after; a carried pick dropped again goes back to its day", async () => {
    const { store } = await fresh();
    const a = (await store.addPick({ date: "2026-11-02", ...item }));
    expect((await store.removePick(a.id)).result).toBe("deleted");
    expect((await store.getPick(a.id))).toBeNull();

    const old = (await store.addPick({ date: "2026-10-29", ...item }));
    (await store.commit("2026-10-29"));
    const carried = (await store.move(old.id, "2026-11-02", "AM"));
    expect((await store.removePick(carried.id)).result).toBe("deleted");
    expect((await store.getPick(old.id))!.status).toBe("planned");
    expect((await store.carryOverFor("2026-11-02"))).toHaveLength(1);

    const b = (await store.addPick({ date: "2026-11-02", ...item }));
    (await store.commit("2026-11-02"));
    expect((await store.removePick(b.id))).toMatchObject({ result: "dropped", pick: { status: "dropped" } });
  });

  it("markOnce is true only the first time, across restarts", async () => {
    const { path, store } = await fresh();
    expect((await store.markOnce("notify", "2026-11-02"))).toBe(true);
    expect((await store.markOnce("notify", "2026-11-02"))).toBe(false);
    await store.close();
    const again = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await again.markOnce("notify", "2026-11-02"))).toBe(false);
    expect((await again.markOnce("notify", "2026-11-03"))).toBe(true);
  });

  it("exports everything to JSON", async () => {
    const { store } = await fresh();
    (await store.addPick({ date: "2026-11-02", ...item }));
    (await store.addDraft({ clientKey: "Adatum", parentItemId: 130, title: "Split the feature", size: "S" }));
    (await store.commit("2026-11-02"));
    const out = JSON.parse(JSON.stringify((await store.exportJson())));
    expect(out.schemaVersion).toBe(MIGRATIONS.length);
    expect(out.dayPlans).toHaveLength(1);
    expect(out.picks[0]).toMatchObject({ itemId: 101, size: "M", status: "planned" });
    expect(out.draftStories[0]).toMatchObject({ parentItemId: 130, title: "Split the feature" });
  });

  it("works for any zone the clock is in", async () => {
    clock = Temporal.ZonedDateTime.from("2026-11-02T08:01:00+01:00[Europe/Paris]");
    const { store } = await fresh();
    expect((await store.start("2026-11-02")).createdAt).toContain("[Europe/Paris]");
    clock = Temporal.ZonedDateTime.from(`2026-11-02T08:01:00-05:00[${NY}]`);
  });
});

describe("step 6c: follow-ups, timer state, focused time and reset", () => {
  it("closes a follow-up by hand with a note, once", async () => {
    const { store } = await fresh();
    const f = (await store.addFlex({ date: "2026-11-07", clientKey: "Adatum", start: "2026-11-07T15:00:00Z", end: "2026-11-07T17:00:00Z" }));
    const [followUp] = (await store.openFlexFollowUps(Temporal.Instant.from("2026-11-07T18:00:00Z")));
    expect(followUp?.sourceId).toBe(f.id);
    const closed = (await store.closeFollowUp(followUp!.id, "Posted in Teams"));
    expect(closed).toMatchObject({ closeNote: "Posted in Teams" });
    expect(closed.closedAt).not.toBeNull();
    expect((await store.openFollowUps())).toEqual([]);
    expect((await store.allFollowUps())).toHaveLength(1);
    await expect(store.closeFollowUp(followUp!.id, null)).rejects.toThrow(/already closed/);
    await expect(store.closeFollowUp(999, null)).rejects.toThrow(/No follow-up/);
  });

  it("keeps small state and focused time across a reopen", async () => {
    const { path, store } = await fresh();
    const p = (await store.addPick({ date: "2026-11-02", ...item }));
    (await store.setState("timer", { kind: "focus", pickId: p.id }));
    (await store.addFocus({ pickId: p.id, label: "Story", startedAt: "2026-11-02T14:00:00Z", endedAt: "2026-11-02T14:25:00Z", seconds: 1500 }));
    (await store.addFocus({ pickId: p.id, label: "Story", startedAt: "2026-11-02T15:00:00Z", endedAt: "2026-11-02T15:10:00Z", seconds: 600 }));
    await store.close();
    const again = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await again.getState("timer"))).toEqual({ kind: "focus", pickId: p.id });
    expect((await again.focusedSeconds([p.id, 999]))).toEqual({ [p.id]: 2100 });
    (await again.setState("timer", null));
    expect((await again.getState("timer"))).toBeNull();
    await again.close();
  });

  itSqlite("reset empties every plan table after a private full backup, and keeps the once-a-day markers (Q37)", async () => {
    const { path, store } = await fresh();
    (await store.addPick({ date: "2026-11-02", ...item }));
    (await store.markOnce("reminder", "2026-11-02"));
    const bak = (await store.reset());
    expect(bak).toMatch(/plan\.db\.bak-reset-\d+T\d+Z$/);
    expect(statSync(bak!).mode & 0o777).toBe(0o600);
    expect((await store.picksFor("2026-11-02"))).toEqual([]);
    expect((await store.markOnce("reminder", "2026-11-02"))).toBe(false);
    // The backup still has the pick.
    const copy = new DatabaseSync(bak!);
    expect((copy.prepare("SELECT COUNT(*) AS n FROM picks").get() as { n: number }).n).toBe(1);
    copy.close();
    expect(readdirSync(join(path, "..")).some((f) => f.includes("bak-reset"))).toBe(true);
  });
});

describe("week plan (step 8)", () => {
  const W = "2026-11-09";
  const f = { weekStart: W, clientKey: "Adatum", itemId: 210, title: "Dana's feature", itemType: "Feature", url: "https://dev.azure.com/x/y/_workitems/edit/210" };
  it("commits features to a week with an estimate in minutes (whole hours); 0 takes it off", async () => {
    const { store } = await fresh();
    expect((await store.weekPlan(W))).toEqual({ weekStart: W, committedAt: null, updatedAt: null, features: [] });
    const a = (await store.setWeekFeature({ ...f, estimate: 480 }));
    expect(a).toMatchObject({ clientKey: "Adatum", itemId: 210, estimate: 480, slots: [] });
    (await store.setWeekFeature({ ...f, estimate: 720 }));
    (await store.setWeekFeature({ ...f, itemId: 240, title: "Mine", estimate: 240 }));
    expect((await store.weekPlan(W)).features.map((x) => [x.itemId, x.estimate])).toEqual([[210, 720], [240, 240]]);
    (await store.setWeekFeature({ ...f, itemId: 240, title: "Mine", estimate: 0 }));
    expect((await store.weekPlan(W)).features.map((x) => x.itemId)).toEqual([210]);
    await expect(store.setWeekFeature({ ...f, estimate: 90 })).rejects.toThrow(/whole hours/);
  });
  it("pins a feature to specific blocks without changing its estimate (step 11)", async () => {
    const { store } = await fresh();
    const a = (await store.setWeekFeature({ ...f, estimate: 240 }))!;
    (await store.placeFeature(a.id, "2026-11-10", "PM", true));
    (await store.placeFeature(a.id, "2026-11-09", "AM", true));
    expect((await store.weekPlan(W)).features[0]).toMatchObject({ estimate: 240, slots: [{ date: "2026-11-09", half: "AM" }, { date: "2026-11-10", half: "PM" }] });
    (await store.placeFeature(a.id, "2026-11-09", "AM", true)); // again: no change
    (await store.placeFeature(a.id, "2026-11-09", "AM", false));
    expect((await store.weekPlan(W)).features[0]).toMatchObject({ estimate: 240, slots: [{ date: "2026-11-10", half: "PM" }] });
    await expect(store.placeFeature(a.id, "2026-11-17", "AM", true)).rejects.toThrow(/week/);
    await expect(store.placeFeature(999, "2026-11-09", "AM", true)).rejects.toThrow();
  });
  it("commits the week, stays editable, and knows when it changed since the commit", async () => {
    const { store } = await fresh();
    (await store.setWeekFeature({ ...f, estimate: 480 }));
    const c = (await store.commitWeek(W));
    expect(c.committedAt).toBe(clock.toString({ smallestUnit: "second" }));
    clock = clock.add({ minutes: 5 });
    (await store.setWeekFeature({ ...f, estimate: 720 }));
    const p = (await store.weekPlan(W));
    expect(p.updatedAt! > p.committedAt!).toBe(true);
    clock = clock.add({ minutes: 5 });
    expect((await store.commitWeek(W)).committedAt! >= p.updatedAt!).toBe(true);
  });
  it("marks a feature as being broken down (local only), and the reset and export cover the week plan", async () => {
    const { store } = await fresh();
    (await store.markBreakdown("Adatum", 240, true));
    expect((await store.breakdownMarks())).toEqual([{ clientKey: "Adatum", itemId: 240, markedAt: clock.toString({ smallestUnit: "second" }) }]);
    (await store.markBreakdown("Adatum", 240, false));
    expect((await store.breakdownMarks())).toEqual([]);
    (await store.setWeekFeature({ ...f, estimate: 480 }));
    (await store.commitWeek(W));
    (await store.markBreakdown("Adatum", 240, true));
    const e = (await store.exportJson());
    expect(e.weekPlans).toHaveLength(1);
    expect(e.weekFeatures).toHaveLength(1);
    expect(e.breakdownMarks).toHaveLength(1);
    (await store.reset());
    expect((await store.weekPlan(W)).features).toEqual([]);
    expect((await store.breakdownMarks())).toEqual([]);
  });
});

describe("week plan by client (step 11)", () => {
  const W = "2026-11-09";
  const base = { weekStart: W, clientKey: "Adatum", title: "T", itemType: "Feature", url: null };
  itSqlite("migration 8 turns committed features into musts and placements into pins, ids kept, with a backup first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 7; v++) {
      old.exec(MIGRATIONS[v - 1]!);
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    old.exec("INSERT INTO week_plans VALUES ('2026-11-09', '2026-11-06T16:00:00-05:00[America/New_York]', '2026-11-06T15:00:00-05:00[America/New_York]', '2026-11-06T16:00:00-05:00[America/New_York]')");
    old.exec(`INSERT INTO week_features (id, week_start, client_key, item_id, title, item_type, url, blocks, position, created_at, updated_at) VALUES
              (7, '2026-11-09', 'Adatum', 210, 'Export', 'Feature', NULL, 3, 1, '2026-11-06T15:00:00-05:00[America/New_York]', '2026-11-06T15:00:00-05:00[America/New_York]'),
              (9, '2026-11-09', 'T&W', 300, 'Paging', 'Feature', NULL, 1, 2, '2026-11-06T15:00:00-05:00[America/New_York]', '2026-11-06T15:00:00-05:00[America/New_York]')`);
    old.exec("INSERT INTO week_feature_slots VALUES (7, '2026-11-10', 'PM'), (7, '2026-11-11', 'AM')");
    old.close();
    const store = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect(readdirSync(dir).filter((x) => x.startsWith("plan.db.bak-v7-"))).toHaveLength(1);
    const p = (await store.weekPlan(W));
    expect(p.committedAt).toBe("2026-11-06T16:00:00-05:00[America/New_York]");
    // E2 (migration 28): 3 blocks and 1 block become 12h and 4h.
    expect(p.features.map((x) => [x.id, x.itemId, x.level, x.tier, x.estimate, x.position, x.doneAt, x.slots.length])).toEqual([
      [7, 210, "feature", "must", 720, null, null, 2],
      [9, 300, "feature", "must", 240, null, null, 0],
    ]);
    await store.close();
  });

  itSqlite("migration 19 rounds half-block features up to whole blocks and gives stories a size, ids and pins kept, with a backup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 18; v++) {
      old.exec(MIGRATIONS[v - 1]!);
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    const at = "'2026-11-06T15:00:00-05:00[America/New_York]'";
    old.exec(`INSERT INTO week_features (id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, position, done_at, created_at, updated_at) VALUES
              (3, '2026-11-09', 'Adatum', 210, 'feature', 'must', 'Export', 'Feature', NULL, 1.5, NULL, NULL, ${at}, ${at}),
              (4, '2026-11-09', 'Adatum', 220, 'feature', 'nice', 'Paging', 'Feature', NULL, 0.5, 2, NULL, ${at}, ${at}),
              (5, '2026-11-09', 'Adatum', 230, 'feature', 'must', 'Import', 'Feature', NULL, 2, NULL, NULL, ${at}, ${at}),
              (6, '2026-11-09', 'Adatum', 501, 'story', 'must', 'Story', 'User Story', NULL, 0.5, NULL, ${at}, ${at}, ${at}),
              (8, '2026-11-09', 'Adatum', 502, 'story', 'nice', 'Big story', 'User Story', NULL, 1.5, NULL, NULL, ${at}, ${at})`);
    old.exec("INSERT INTO week_feature_slots VALUES (3, '2026-11-10', 'PM')");
    old.close();
    const store = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect(readdirSync(dir).filter((x) => x.startsWith("plan.db.bak-v18-"))).toHaveLength(1);
    const f = (await store.weekPlan(W)).features;
    // Then E2 (migration 28): whole blocks at 4h each.
    expect(f.map((x) => [x.id, x.level, x.tier, x.estimate, x.size, x.parentId, x.position, !!x.doneAt, x.slots.length])).toEqual([
      [3, "feature", "must", 480, null, null, null, false, 1],
      [4, "feature", "nice", 240, null, null, 2, false, 0],
      [5, "feature", "must", 480, null, null, null, false, 0],
      [6, "story", "must", null, "M", null, null, true, 0],
      [8, "story", "nice", null, "L", null, null, false, 0],
    ]);
    // No fraction survives anywhere in the week plan.
    expect(f.every((x) => x.estimate === null || x.estimate % 60 === 0)).toBe(true);
    await store.close();
  });

  it("adds features (an estimate in whole hours, or none) and stories (S, M, L, or not sized yet) as musts or nice to haves, sets tier and a done mark", async () => {
    const { store } = await fresh();
    const a = (await store.addWeekItem({ ...base, itemId: 210, level: "feature" }));
    expect(a).toMatchObject({ level: "feature", tier: "must", estimate: null, size: null, position: null, doneAt: null });
    const b = (await store.addWeekItem({ ...base, itemId: 501, itemType: "User Story", level: "story", tier: "nice", parentId: 210 }));
    expect(b).toMatchObject({ level: "story", tier: "nice", estimate: null, size: null, parentId: 210 });
    // Adding again updates it in place.
    expect((await store.addWeekItem({ ...base, itemId: 210, title: "Renamed", level: "feature", tier: "nice", estimate: 720 }))).toMatchObject({ id: a.id, title: "Renamed", tier: "nice", estimate: 720 });
    expect((await store.setWeekItemTier(a.id, "must")).tier).toBe("must");
    expect((await store.setWeekItemEstimate(a.id, 360)).estimate).toBe(360);
    expect((await store.setWeekItemEstimate(a.id, 4800)).estimate).toBe(4800);
    expect((await store.setWeekItemEstimate(a.id, null)).estimate).toBeNull();
    await expect(store.setWeekItemEstimate(a.id, 90)).rejects.toThrow(/whole hours/);
    await expect(store.setWeekItemEstimate(a.id, 0)).rejects.toThrow(/whole hours/);
    await expect(store.setWeekItemEstimate(a.id, 4860)).rejects.toThrow(/whole hours/);
    await expect(store.setWeekItemEstimate(b.id, 60)).rejects.toThrow(/size/);
    expect((await store.setWeekItemSize(b.id, "L")).size).toBe("L");
    expect((await store.setWeekItemSize(b.id, null)).size).toBeNull();
    expect((await store.setWeekItemSize(b.id, "L")).size).toBe("L");
    await expect(store.setWeekItemSize(a.id, "S")).rejects.toThrow(/estimate, not a size/);
    (await store.setWeekItemParents(W, [{ clientKey: base.clientKey, itemId: 501, parentId: 220 }]));
    expect((await store.weekItem(b.id))?.parentId).toBe(220);
    expect((await store.markWeekItemDone(b.id, true)).doneAt).toBe(clock.toString({ smallestUnit: "second" }));
    expect((await store.markWeekItemDone(b.id, false)).doneAt).toBeNull();
    (await store.removeWeekItem(b.id));
    expect((await store.weekPlan(W)).features.map((x) => x.itemId)).toEqual([210]);
    await expect(store.removeWeekItem(b.id)).rejects.toThrow(/No such/);
    expect((await store.weekItem(a.id))?.itemId).toBe(210);
  });

  it("keeps a local order per client and tier, resets to DevOps order, and a tier change drops the position", async () => {
    const { store } = await fresh();
    const ids: number[] = [];
    for (const itemId of [210, 220, 230]) ids.push((await store.addWeekItem({ ...base, itemId, level: "feature" })).id);
    (await store.addWeekItem({ ...base, clientKey: "T&W", itemId: 300, level: "feature" }));
    (await store.reorderWeekItems(W, "Adatum", "must", [{ itemId: 230, position: 1 }, { itemId: 210, position: 2 }]));
    const pos = async () => Object.fromEntries((await store.weekPlan(W)).features.map((x) => [x.itemId, x.position]));
    expect((await pos())).toEqual({ 210: 2, 220: null, 230: 1, 300: null });
    await expect(store.reorderWeekItems(W, "Adatum", "nice", [{ itemId: 230, position: 1 }])).rejects.toThrow(/nice to have/);
    await expect(store.reorderWeekItems(W, "T&W", "must", [{ itemId: 210, position: 1 }])).rejects.toThrow();
    (await store.setWeekItemTier(ids[2]!, "nice"));
    expect((await pos())[230]).toBeNull();
    (await store.reorderWeekItems(W, "Adatum", "must", null));
    expect((await pos())).toEqual({ 210: null, 220: null, 230: null, 300: null });
  });
});

describe("quick capture (step 9)", () => {
  itSqlite("migration 7 keeps draft stories and the picks that point at them, and lets a draft have no feature", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 6; v++) {
      old.exec(MIGRATIONS[v - 1]!);
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    old.exec("INSERT INTO day_plans (date, created_at, updated_at) VALUES ('2026-10-29', 'x', 'x')");
    old.exec("INSERT INTO draft_stories VALUES (5, 'Adatum', 210, 'Draft under 210', 'M', 'x', 'x')");
    old.exec(`INSERT INTO picks (id, date, half, client_key, kind, draft_id, title, size, status, position, created_at, updated_at)
              VALUES (1, '2026-10-29', 'AM', 'Adatum', 'draft', 5, 'Draft under 210', 'M', 'planned', 0, 'x', 'x')`);
    old.close();
    const store = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect((await store.drafts())).toEqual([expect.objectContaining({ id: 5, parentItemId: 210, title: "Draft under 210" })]);
    expect((await store.picksFor("2026-10-29"))[0]).toMatchObject({ kind: "draft", draftId: 5 });
    expect((await store.addDraft({ clientKey: "Adatum", parentItemId: null, title: "No feature yet", size: "S" })).parentItemId).toBeNull();
    expect(readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-v6-"))).toHaveLength(1);
    await store.close();
  });

  it("saves captures to the inbox and routes each once to a follow-up, a draft story, a note, or dismisses it", async () => {
    const { store } = await fresh();
    const a = (await store.addCapture({ text: "  Told Dana I'd send the export by Thursday  ", clientKey: "Adatum" }));
    expect(a).toMatchObject({ text: "Told Dana I'd send the export by Thursday", clientKey: "Adatum", routedAt: null });
    const b = (await store.addCapture({ text: "need to add paging", clientKey: "T&W" }));
    const c = (await store.addCapture({ text: "their CFO prefers email", clientKey: null }));
    const d = (await store.addCapture({ text: "never mind", clientKey: null }));
    await expect(store.addCapture({ text: "   ", clientKey: null })).rejects.toThrow(/Type something/);
    expect((await store.inbox()).map((x) => x.id)).toEqual([d.id, c.id, b.id, a.id]);
    expect((await store.inboxCount())).toBe(4);

    const la = (await store.routeCapture(a.id, { as: "follow_up", clientKey: "Adatum", who: "Dana", what: "Send the export", due: "2026-11-05" }));
    expect(la).toMatchObject({ routedAs: "follow_up" });
    expect((await store.openFollowUps()).find((l) => l.id === la.routedId)).toMatchObject({ kind: "capture", who: "Dana", what: "Send the export", due: "2026-11-05", clientKey: "Adatum" });
    const db = (await store.routeCapture(b.id, { as: "draft", clientKey: "T&W", parentItemId: null, title: "Add paging", size: "M" }));
    expect((await store.getDraft(db.routedId!))).toMatchObject({ clientKey: "T&W", parentItemId: null, title: "Add paging", size: "M" });
    const nc = (await store.routeCapture(c.id, { as: "draft", clientKey: "Proseware", parentItemId: null, title: "Their CFO prefers email", size: "S" }));
    expect((await store.getDraft(nc.routedId!))).toMatchObject({ level: "story", clientKey: "Proseware" });
    (await store.routeCapture(d.id, { as: "dismissed" }));
    expect((await store.inboxCount())).toBe(0);
    await expect(store.routeCapture(a.id, { as: "dismissed" })).rejects.toThrow(/already sorted/);
    // A failed route leaves the capture in the inbox.
    const e = (await store.addCapture({ text: "x", clientKey: null }));
    await expect(store.routeCapture(e.id, { as: "follow_up", clientKey: null, who: "", what: " ", due: null })).rejects.toThrow();
    expect((await store.inbox()).map((x) => x.id)).toEqual([e.id]);
  });

  itSqlite("migration 11 renames loops to follow-ups and moves notes into where I left off, with a backup first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 10; v++) {
      old.exec(MIGRATIONS[v - 1]!);
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    const at = "2026-10-30T16:00:00-04:00[America/New_York]";
    old.exec(`INSERT INTO loops (id, kind, client_key, who, what, opened_at) VALUES (2, 'manual', NULL, 'Dana', 'Send it', '${at}')`);
    old.exec(`INSERT INTO loops (id, kind, client_key, who, what, opened_at, closed_at, close_note, closed_by, rule_key) VALUES (1, 'slip', 'T&W', 'T&W', 'Heads-up', '${at}', '${at}', 'told', 'me', 'slip:x')`);
    old.exec(`INSERT INTO resume_notes (client_key, date, note, created_at, updated_at) VALUES ('Adatum', '2026-10-30', 'Left off at mapping', '${at}', '${at}')`);
    old.exec(`INSERT INTO captures (id, text, client_key, created_at, routed_at, routed_as, routed_id) VALUES
              (1, 'Adatum wants Git', 'Adatum', '${at}', '${at}', 'note', 1), (2, 'caching idea', NULL, '${at}', '${at}', 'note', 2),
              (3, 'told Dana', NULL, '${at}', '${at}', 'loop', 2), (4, 'never mind', NULL, '${at}', '${at}', 'dismissed', NULL), (5, 'to sort', NULL, '${at}', NULL, NULL, NULL)`);
    old.exec(`INSERT INTO notes (id, client_key, text, capture_id, created_at, updated_at) VALUES
              (1, 'Adatum', 'Adatum wants Git', 1, '${at}', '${at}'), (2, NULL, 'caching idea', 2, '${at}', '${at}'), (3, 'T&W', 'Mark approves timesheets', NULL, '${at}', '${at}'), (4, NULL, 'Read the docs', NULL, '${at}', '${at}')`);
    old.close();
    const store = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect(readdirSync(dir).filter((x) => x.startsWith("plan.db.bak-v10-"))).toHaveLength(1);
    // Loops are follow-ups now, ids kept; a closed one counts as done.
    expect((await store.allFollowUps()).map((f) => [f.id, f.kind, f.outcome, f.byHand]).sort()).toEqual([[1, "slip", "done", false], [2, "manual", null, true]]);
    // Notes with a client join that client's left-off line on their day; appended to one already there.
    expect((await store.latestNotes("2026-10-31")).Adatum?.note).toBe("Left off at mapping · Adatum wants Git");
    expect((await store.latestNotes("2026-10-31"))["T&W"]?.note).toBe("Mark approves timesheets");
    // Notes with no client go back to the inbox: their own capture un-sorted, or a new capture.
    expect((await store.inbox()).map((c) => c.text).sort()).toEqual(["Read the docs", "caching idea", "to sort"]);
    const ex = (await store.exportJson()) as Record<string, unknown>;
    expect(ex.notes).toBeUndefined();
    expect((ex.captures as { id: number; routedAs: string | null }[]).find((c) => c.id === 1)?.routedAs).toBe("left_off");
    expect((ex.captures as { id: number; routedAs: string | null }[]).find((c) => c.id === 3)?.routedAs).toBe("follow_up");
    await store.close();
  });

  it("routes a capture to a draft feature, optionally under an epic", async () => {
    const { store } = await fresh();
    const c = (await store.addCapture({ text: "feature: onboarding", clientKey: "Adatum" }));
    const r = (await store.routeCapture(c.id, { as: "draft_feature", clientKey: "Adatum", parentItemId: 900, title: "Onboarding" }));
    expect(r.routedAs).toBe("draft_feature");
    expect((await store.getDraft(r.routedId!))).toMatchObject({ level: "feature", parentItemId: 900, title: "Onboarding", size: "M" });
  });
});

describe("timeboxes, own Outlook events and the write log (step 12)", () => {
  const F = { subject: "Adatum: Story", body: "x", start: "2026-11-03T14:00:00Z", end: "2026-11-03T15:00:00Z", showAs: "busy" as const, reminder: false as const };
  const box = { date: "2026-11-03", clientKey: "Adatum", title: "Story", start: "2026-11-03T09:00:00-05:00", end: "2026-11-03T10:00:00-05:00", outlook: false };

  it("keeps timeboxes across reopen, with a stable uid", async () => {
    const { path, store } = await fresh();
    const t = (await store.addTimebox(box));
    expect(t.uid).toMatch(/^tb-[0-9a-f-]{36}$/);
    (await store.updateTimebox(t.id, { start: "2026-11-03T09:30:00-05:00", end: "2026-11-03T11:00:00-05:00", outlook: true }));
    await store.close();
    const again = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await again.timeboxesBetween("2026-11-02", "2026-11-06"))).toMatchObject([{ uid: t.uid, start: "2026-11-03T09:30:00-05:00", outlook: true, removedAt: null }]);
  });

  it("a removed timebox with a live Outlook event is kept (as removed), so its event can be taken off and undone", async () => {
    const { store } = await fresh();
    const t = (await store.addTimebox({ ...box, outlook: true }));
    (await store.recordOwnEvent(t.uid, t.id, "E1", F));
    expect((await store.removeTimebox(t.id))).toEqual({ kept: true });
    expect((await store.timebox(t.id))!.removedAt).not.toBeNull();
    (await store.markOwnDeleted(t.uid));
    expect((await store.timebox(t.id))!.removedAt).not.toBeNull();
    expect((await store.ownEvents())).toEqual([]);
    expect((await store.ownEvent(t.uid))!.deletedAt).not.toBeNull();
  });

  it("a timebox never on Outlook is simply deleted", async () => {
    const { store } = await fresh();
    const t = (await store.addTimebox(box));
    expect((await store.removeTimebox(t.id))).toEqual({ kept: false });
  });

  it("logs a write with its prior values, settles it, and marks it undone", async () => {
    const { path, store } = await fresh();
    const local = { start: box.start, end: box.end, outlook: false, removedAt: null };
    const w = (await store.logWrite({ op: "update", uid: "tb-1", eventId: "E1", account: "me@x", calendar: "Calendar", before: F, after: { ...F, start: "2026-11-03T14:30:00Z" }, localBefore: local, localAfter: local, auto: false }));
    expect(w.status).toBe("pending");
    (await store.settleWrite(w.id, { status: "unconfirmed", message: "Couldn't confirm" }));
    (await store.settleWrite(w.id, { status: "confirmed", retry: true }));
    const u = (await store.logWrite({ op: "update", uid: "tb-1", eventId: "E1", account: null, calendar: null, before: null, after: F, localBefore: null, localAfter: null, auto: false, undoOf: w.id }));
    (await store.markUndone(w.id, u.id));
    await store.close();
    const again = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await again.writeLog()).map((x) => [x.id, x.status, x.attempts, x.undoneBy, x.undoOf])).toEqual([[u.id, "pending", 1, null, w.id], [w.id, "confirmed", 2, u.id, null]]);
    expect((await again.writeEntry(w.id))!.before).toEqual(F);
  });

  itSqlite("migration 15 rebuilds the write log keeping every row and undo link, and then takes RSVP writes (D284)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 14; v++) {
      old.exec(MIGRATIONS[v - 1]!.replace(/^\s*-- foreign keys off for a table rebuild/, ""));
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    old.exec(`INSERT INTO write_log (id, at, system, op, kind, uid, event_id, before, after, status, auto, undo_of, undone_by, attempts, updated_at)
              VALUES (1, 'x', 'outlook', 'create', 'timebox', 'tb-1', 'E1', NULL, '{}', 'confirmed', 0, NULL, 2, 1, 'x'),
                     (2, 'x', 'outlook', 'delete', 'timebox', 'tb-1', 'E1', '{}', NULL, 'confirmed', 0, 1, NULL, 1, 'x')`);
    old.close();
    const store = await createPlanStore({ path, now, files: localStoreFiles });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect((await store.writeLog()).map((x) => [x.id, x.kind, x.undoOf, x.undoneBy])).toEqual([[2, "timebox", 1, null], [1, "timebox", null, 2]]);
    const r = (await store.logWrite({ op: "update", kind: "rsvp", uid: "rsvp:M1", eventId: "M1", account: null, calendar: null, before: { ...F, response: "notResponded" }, after: { ...F, response: "accepted", comment: "See you there" }, localBefore: null, localAfter: null, auto: false }));
    expect((await store.writeEntry(r.id))).toMatchObject({ kind: "rsvp", after: { response: "accepted", comment: "See you there" } });
    await store.close();
  });

  it("reset empties timeboxes but keeps FocusTime's Outlook events and the audit log", async () => {
    const { store } = await fresh();
    const t = (await store.addTimebox({ ...box, outlook: true }));
    (await store.recordOwnEvent(t.uid, t.id, "E1", F));
    (await store.logWrite({ op: "create", uid: t.uid, eventId: "E1", account: null, calendar: null, before: null, after: F, localBefore: null, localAfter: null, auto: false }));
    (await store.reset());
    expect((await store.timeboxesBetween("2026-11-01", "2026-11-30"))).toEqual([]);
    expect((await store.ownEvents())).toMatchObject([{ uid: t.uid, timeboxId: null, eventId: "E1" }]);
    expect((await store.writeLog())).toHaveLength(1);
  });

  it("export includes timeboxes, own events and the write log", async () => {
    const { store } = await fresh();
    (await store.addTimebox(box));
    const e = (await store.exportJson());
    expect([e.timeboxes.length, e.outlookEvents.length, e.writeLog.length]).toEqual([1, 0, 0]);
  });
});

describe("Roadmap snapshots (step 16, D280)", () => {
  it("keeps one row per item per day, the latest of the day, and drops rows older than 120 days", async () => {
    const s = await createPlanStore({ path: ":memory:", now: () => Temporal.ZonedDateTime.from("2026-11-02T09:00:00-06:00[America/Chicago]") });
    await s.recordSnapshots("2026-06-01", [{ clientKey: "Fabrikam", itemId: 10, done: 0, open: 9 }]);
    await s.recordSnapshots("2026-10-26", [{ clientKey: "Fabrikam", itemId: 10, done: 2, open: 7 }, { clientKey: "Contoso", itemId: 10, done: 1, open: 1 }]);
    await s.recordSnapshots("2026-11-02", [{ clientKey: "Fabrikam", itemId: 10, done: 3, open: 6 }]);
    await s.recordSnapshots("2026-11-02", [{ clientKey: "Fabrikam", itemId: 10, done: 4, open: 5 }]);
    const all = (await s.snapshotsFrom("2026-01-01"));
    expect(all.get("Fabrikam:10")).toEqual([{ date: "2026-10-26", done: 2, open: 7 }, { date: "2026-11-02", done: 4, open: 5 }]);
    expect(all.get("Contoso:10")).toEqual([{ date: "2026-10-26", done: 1, open: 1 }]);
    expect((await s.snapshotsFrom("2026-11-01")).get("Fabrikam:10")).toHaveLength(1);
  });

  it("step 17 (migration 20): dates dragged on Plan ahead are kept per item, replaced, cleared and exported", async () => {
    const s = await createPlanStore({ path: ":memory:", now });
    expect((await s.roadmapDates()).size).toBe(0);
    await s.setRoadmapDates("Fabrikam", 10, { start: "2026-11-09", end: "2026-12-04" });
    await s.setRoadmapDates("Fabrikam", 10, { start: "2026-11-16", end: "2026-12-11" });
    await s.setRoadmapDates("Contoso", 10, { start: "2026-11-02", end: "2026-11-02" });
    expect(Object.fromEntries((await s.roadmapDates()))).toEqual({ "Fabrikam:10": { start: "2026-11-16", end: "2026-12-11" }, "Contoso:10": { start: "2026-11-02", end: "2026-11-02" } });
    await expect(s.setRoadmapDates("Fabrikam", 11, { start: "2026-11-10", end: "2026-11-09" })).rejects.toThrow(/before the start/);
    expect((await s.exportJson()).roadmapDates).toContainEqual({ item: "Fabrikam:10", start: "2026-11-16", end: "2026-12-11" });
    await s.setRoadmapDates("Fabrikam", 10, null);
    expect([...(await s.roadmapDates()).keys()]).toEqual(["Contoso:10"]);
  });
});

describe("week plan duplicates (U3, D388)", () => {
  const W = "2026-11-09";
  itSqlite("migration 21 keeps the oldest row for an item under a client key in another letter case, moves its pins, and logs the removal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 20; v++) {
      const sql = MIGRATIONS[v - 1]!;
      if (sql.trimStart().startsWith("PRAGMA foreign_keys")) old.exec("PRAGMA foreign_keys = OFF");
      old.exec(sql);
      old.exec("PRAGMA foreign_keys = ON");
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    const at = "2026-11-06T15:00:00-05:00[America/New_York]";
    old.prepare("INSERT INTO week_plans VALUES (?, NULL, ?, ?)").run(W, at, at);
    const ins = old.prepare("INSERT INTO week_features (id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, size, parent_id, position, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'feature', 'must', 'Export', 'Feature', NULL, 2, NULL, NULL, NULL, NULL, ?, ?)");
    ins.run(3, W, "Adatum", 210, at, at);
    ins.run(5, W, "adatum", 210, at, at);
    ins.run(6, W, "Adatum", 211, at, at);
    old.exec("INSERT INTO week_feature_slots VALUES (5, '2026-11-10', 'PM')");
    old.close();
    const logged: { op: string; count?: number }[] = [];
    const store = await createPlanStore({ path, now, files: localStoreFiles, log: (r) => logged.push(r) });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    const p = (await store.weekPlan(W));
    expect(p.features.map((f) => [f.id, f.itemId, f.slots.length]).sort()).toEqual([
      [3, 210, 1],
      [6, 211, 0],
    ]);
    // Then E2's migration 28 converts the two features left with an estimate in blocks.
    // CV-4's named migration logs how many image rows it cleared (none here).
    expect(logged).toEqual([{ source: "database", op: "convert_estimates", count: 2 }, { source: "database", op: "images_bytes_cleared", count: 0 }, { source: "plan", op: "dedupe_week_items", count: 1 }]);
    const db = new DatabaseSync(path);
    expect(db.prepare("SELECT removed_id, kept_id, item_id FROM dedupe_log").all().map((r) => ({ ...r }))).toEqual([{ removed_id: 5, kept_id: 3, item_id: 210 }]);
    db.close();
  });

  itSqlite("migration 28 (E2) turns estimates in blocks into minutes at 1 block = 4h, logs the count, leaves the rest; picks may be unsized", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-plan-"));
    const path = join(dir, "plan.db");
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let v = 1; v <= 27; v++) {
      const sql = MIGRATIONS[v - 1]!;
      old.exec("PRAGMA foreign_keys = OFF");
      old.exec(sql);
      old.exec("PRAGMA foreign_keys = ON");
      old.prepare("INSERT INTO schema_migrations VALUES (?, 'x')").run(v);
    }
    const at = "2026-11-06T15:00:00-05:00[America/New_York]";
    old.prepare("INSERT INTO week_plans (user_id, week_start, committed_at, created_at, updated_at) VALUES ('', ?, NULL, ?, ?)").run(W, at, at);
    const ins = old.prepare("INSERT INTO week_features (user_id, id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, size, parent_id, position, done_at, created_at, updated_at) VALUES ('', ?, ?, 'Adatum', ?, ?, 'must', 'T', NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?)");
    ins.run(1, W, 210, "feature", 0.5, null, at, at); // E1: half a block
    ins.run(2, W, 211, "feature", 2.5, null, at, at); // E1
    ins.run(3, W, 212, "feature", 3, null, at, at); // step 16.4: whole blocks
    ins.run(4, W, 213, "feature", null, null, at, at); // no estimate
    ins.run(5, W, 501, "story", null, "S", at, at);
    old.prepare("INSERT INTO day_plans (user_id, date, committed_at, created_at, updated_at, closed_out_at) VALUES ('', ?, NULL, ?, ?, NULL)").run(W, at, at);
    old.prepare("INSERT INTO picks (user_id, id, date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at, follow_up_id) VALUES ('', 9, ?, 'AM', 'Adatum', 'intention', NULL, NULL, 'Kept', NULL, NULL, 'L', 'planned', NULL, NULL, 1, ?, ?, NULL)").run(W, at, at);
    old.close();
    const logged: { op: string; count?: number }[] = [];
    const store = await createPlanStore({ path, now, files: localStoreFiles, log: (r) => logged.push(r) });
    expect((await store.schemaVersion())).toBe(MIGRATIONS.length);
    expect(readdirSync(dir).filter((x) => x.startsWith("plan.db.bak-v27-"))).toHaveLength(1);
    expect(logged).toContainEqual({ source: "database", op: "convert_estimates", count: 3 });
    const f = (await store.weekPlan(W)).features;
    expect(f.map((x) => [x.id, x.level, x.estimate, x.size])).toEqual([
      [1, "feature", 120, null],
      [2, "feature", 600, null],
      [3, "feature", 720, null],
      [4, "feature", null, null],
      [5, "story", null, "S"],
    ]);
    // New data is minutes already, and a pick can be added with no size.
    expect((await store.setWeekItemEstimate(4, 360)).estimate).toBe(360);
    expect((await store.getPick(9))?.size).toBe("L");
    const p = (await store.addPick({ date: W, half: "PM", clientKey: "Adatum", kind: "intention", title: "Not sized", size: null }));
    expect(p.size).toBeNull();
    expect((await store.setSize(p.id, "M")).size).toBe("M");
    expect((await store.setSize(p.id, null)).size).toBeNull();
    await store.close();
  });

  it("adding an item already on the week (any letter case of the client key) updates that row instead of adding a second", async () => {
    const store = await createPlanStore({ path: ":memory:", now });
    const a = (await store.addWeekItem({ weekStart: W, clientKey: "Adatum", itemId: 210, title: "Export", itemType: "Feature", url: null, level: "feature" }));
    const b = (await store.addWeekItem({ weekStart: W, clientKey: "Adatum", itemId: 210, title: "Export v2", itemType: "Feature", url: null, level: "feature" }));
    const c = (await store.addWeekItem({ weekStart: W, clientKey: "adatum", itemId: 210, title: "Export v3", itemType: "Feature", url: null, level: "feature" }));
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect((await store.weekPlan(W)).features).toHaveLength(1);
    expect((await store.weekPlan(W)).features[0]!.title).toBe("Export v3");
  });
});
});
