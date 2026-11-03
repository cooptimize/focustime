// A2: two people on one plan store cannot see or change each other's rows, in every table. The table list drives the
// test: a table in the database that isn't in USER_TABLES (and isn't an app table) fails it, and so does a user table
// the workload below doesn't fill (so a new table needs a line here, and its scoping is then checked like the rest).
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openPlanDb, planStoreOn, type PlanStore } from "./plan-store.ts";
import { scopeSql, ScopeError, USER_TABLES } from "./scope.ts";
import { createUserSettings } from "./user-settings.ts";
import { starterToml } from "../config/starter.ts";
import { createDemoContext, seedDemo } from "../server/demo.ts";
import { DEMO_TZ } from "../sources/demo/data.ts";

/** Tables that are the app's, not one person's (each keyed by its own id or holding user_id itself). */
const APP_TABLES = ["schema_migrations", "users", "sessions", "auth_requests", "deletions"];

const NOW = "2026-11-02T14:30:00Z";
const zoned = () => Temporal.Instant.from(NOW).toZonedDateTimeISO(DEMO_TZ);
const MON = "2026-11-02";

const tablesOf = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

/** Everything a person can have: the demo's week, plus a row in each table the demo leaves empty. */
async function fill(db: DatabaseSync, userId: string): Promise<PlanStore> {
  const plan = planStoreOn(db, { userId, now: zoned });
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} }, plan });
  await seedDemo(ctx);
  const tag = `${userId}-row`;
  plan.start(MON);
  const pick = plan.addPick({ date: MON, half: "AM", clientKey: "cooptimize", kind: "intention", title: tag, size: "S" });
  plan.makeUp(pick.id, { date: "2026-11-03", half: "AM" }, { minutes: 30, payback: "friday" });
  plan.logAzureWrite({ op: "start", vmId: `/vm/${tag}`, vmName: tag, before: null, after: null, auto: false });
  plan.markBreakdown("cooptimize", 7001, true);
  plan.setDevopsIdentity({ clientKey: "cooptimize", org: "org", id: tag, name: tag, email: `${tag}@example.com`, expires: null });
  const draft = plan.addDraft({ clientKey: "cooptimize", parentItemId: null, title: tag, size: "S", level: "feature" });
  plan.setWeekDraft(MON, draft.id, "must");
  plan.setWeekQuiet(MON, "proseware", true);
  plan.logDevopsWrite({ clientKey: "cooptimize", org: "org", project: "p", op: "create", itemId: null, parentId: null, title: tag, identity: tag, before: {}, after: {}, ops: null, revBefore: null, revAfter: null, commentId: null, draftId: draft.id, followUpId: null, undoOf: null });
  plan.addFlex({ date: MON, clientKey: "cooptimize", start: "18:00", end: "19:00", note: tag });
  plan.addUnavailable({ date: MON, title: tag, start: "12:00", end: "13:00" });
  const box = plan.addTimebox({ date: MON, clientKey: "cooptimize", title: tag, start: "2026-11-02T10:00:00-05:00", end: "2026-11-02T11:00:00-05:00", outlook: true });
  const F = { subject: tag, body: "", start: "2026-11-02T15:00:00Z", end: "2026-11-02T16:00:00Z", showAs: "busy" as const, reminder: false as const };
  plan.recordOwnEvent(box.uid, box.id, `E-${tag}`, F);
  plan.logWrite({ op: "create", uid: box.uid, eventId: `E-${tag}`, account: null, calendar: null, before: null, after: F, localBefore: null, localAfter: null, auto: false });
  plan.addInvite({ uid: `inv-${tag}`, clientKey: "cooptimize", itemId: null, pickId: null, timeboxId: null, title: tag, url: null, start: "2026-11-03T15:00:00Z", end: "2026-11-03T15:30:00Z", attendees: [], teams: false, note: null });
  plan.markOnce("reminder", MON);
  plan.setRoadmapDates("cooptimize", 7001, { start: "2026-11-02", end: "2026-11-20" });
  plan.logTeamsStatus({ op: "set", status: "Busy", minutes: 25, result: "done", message: null });
  createUserSettings({ db, userId, app: { dataverse: null, entra: null, google: null }, person: () => ({ email: `${tag}@example.com`, upn: `${tag}@example.com`, timeZone: null }), setZone: () => {}, defaultZone: DEMO_TZ, now: () => Temporal.Instant.from(NOW) }).seed(starterToml(DEMO_TZ));
  // Only migration 21 writes the dedupe log; a row as it would have left one.
  db.prepare("INSERT INTO dedupe_log (user_id, at, table_name, removed_id, kept_id) VALUES (?, ?, 'week_features', 1, 2)").run(userId, NOW);
  return plan;
}

/** Every row of one person, per table (raw, so nothing is filtered by what is being tested). */
const rowsOf = (db: DatabaseSync, userId: string) => Object.fromEntries(USER_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY rowid`).all(userId)]));

/** What a person's store shows: every read that takes no argument or a week's dates. */
function view(p: PlanStore): unknown {
  const ex = p.exportJson() as Record<string, unknown>;
  delete ex.exportedAt;
  return {
    ex,
    inbox: p.inbox(),
    drafts: p.allDrafts(),
    follow: p.allFollowUps(),
    week: p.weekPlan(MON),
    weekDrafts: p.weekDrafts(MON),
    quiet: p.weekQuiet(MON),
    picks: p.picksBetween(MON, "2026-11-08"),
    boxes: p.timeboxesBetween(MON, "2026-11-08"),
    flex: p.flexBetween(MON, "2026-11-08"),
    unavailable: p.unavailableBetween(MON, "2026-11-08"),
    marks: p.breakdownMarks(),
    timer: p.getState("timer"),
    identity: p.accountState("ms_identity"),
    focused: p.focusedSeconds(p.picksFor(MON).map((x) => x.id)),
    marked: p.marked("reminder", MON),
    snapshots: p.snapshotsFrom(MON),
    own: p.ownEvents(),
    invites: p.invitesFrom(MON),
  };
}

describe("per-user scoping (A2)", () => {
  it("covers every table: each is a user table with user_id first in its keys, or an app table", () => {
    const db = openPlanDb({ path: ":memory:", now: zoned });
    for (const t of tablesOf(db)) {
      if (APP_TABLES.includes(t)) continue;
      expect(USER_TABLES, `table ${t} is neither a user table nor an app table`).toContain(t);
      const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; pk: number }[];
      expect(cols[0], t).toMatchObject({ name: "user_id", notnull: 1 });
      // A natural primary key starts with user_id; an integer id is its own (global) key.
      const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
      if (pk.length > 1 || (pk.length === 1 && pk[0]!.name !== "id")) expect(pk[0]!.name, t).toBe("user_id");
      for (const ix of db.prepare(`PRAGMA index_list(${t})`).all() as { name: string; unique: number }[]) {
        const first = (db.prepare(`PRAGMA index_info(${ix.name})`).all() as { name: string }[])[0];
        expect(first?.name, `${t} index ${ix.name}`).toBe("user_id");
      }
    }
    for (const t of USER_TABLES) expect(tablesOf(db), t).toContain(t);
  });

  it("two people: neither sees the other's rows, and nothing one does changes the other's, in every table", async () => {
    const db = openPlanDb({ path: ":memory:", now: zoned });
    const a = await fill(db, "user-a");
    const before = rowsOf(db, "user-a");
    // The workload must reach every table, or the table isn't tested.
    for (const t of USER_TABLES) expect(before[t]!.length, `nothing in ${t} for user-a: add it to fill()`).toBeGreaterThan(0);
    const aView = view(a);

    // B starts empty: nothing of A's shows.
    const b = planStoreOn(db, { userId: "user-b", now: zoned });
    const empty = view(b);
    const fresh = planStoreOn(openPlanDb({ path: ":memory:", now: zoned }), { userId: "user-b", now: zoned });
    expect(empty).toEqual(view(fresh));

    // B does everything A did, then aims every id-taking change at A's ids, then resets.
    await fill(db, "user-b");
    const ids = [...new Set(Object.values(before).flatMap((rows) => (rows as { id?: unknown }[]).map((r) => r.id)).filter((v): v is number => typeof v === "number"))];
    const bAny = b as unknown as Record<string, (...x: unknown[]) => unknown>;
    const skip = new Set(["close", "reset", "exportJson", "schemaVersion"]);
    let tried = 0;
    for (const [name, fn] of Object.entries(bAny)) {
      if (typeof fn !== "function" || skip.has(name)) continue;
      for (const id of ids) {
        for (const args of [[id], [id, true], [id, null], [id, { date: MON, half: "AM" }], [id, MON, "AM", true], [id, "done"], [id, "must"]]) {
          tried++;
          try {
            fn.apply(b, args);
          } catch {
            // Refused or not found: what we want.
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(1000);
    b.reset();
    expect(rowsOf(db, "user-a")).toEqual(before);
    expect(view(a)).toEqual(aView);
    // And A's reset leaves B's rows alone.
    await fill(db, "user-b");
    const bRows = rowsOf(db, "user-b");
    a.reset();
    expect(rowsOf(db, "user-b")).toEqual(bRows);
  });

  it("a store needs a person, and the person can't come from a statement", () => {
    const db = openPlanDb({ path: ":memory:", now: zoned });
    expect(() => planStoreOn(db, { userId: "", now: zoned })).toThrow(ScopeError);
    expect(() => scopeSql("INSERT INTO kv (user_id, key, value) VALUES (?, ?, ?)")).toThrow(ScopeError);
  });
});
