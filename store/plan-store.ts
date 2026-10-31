// Local plan store (D23): SQLite through Node's built-in node:sqlite, under ~/.local/share/coopilot/.
// Holds only Coopilot's own plan (day plans, picks, draft stories) and a few one-time markers.
// Nothing here is ever written to DevOps, Outlook, Google or Dataverse.
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { carryOver } from "../plan/rules.ts";
import type { DayPlan, DraftStory, Pick, PickKind, PlanWeek, Size, ZonedStamp } from "../plan/types.ts";
import type { Half, IsoDate } from "../week/types.ts";

/** Ordered schema changes. Never edit a shipped one; add a new entry. */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE day_plans (
     date TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     committed_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE draft_stories (
     id INTEGER PRIMARY KEY,
     client_key TEXT NOT NULL,
     parent_item_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     size TEXT NOT NULL CHECK (size IN ('S','M','L')),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE picks (
     id INTEGER PRIMARY KEY,
     date TEXT NOT NULL REFERENCES day_plans(date),
     half TEXT NOT NULL CHECK (half IN ('AM','PM')),
     client_key TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('item','draft','intention')),
     item_id INTEGER,
     draft_id INTEGER REFERENCES draft_stories(id),
     title TEXT NOT NULL,
     item_type TEXT,
     item_url TEXT,
     size TEXT NOT NULL CHECK (size IN ('S','M','L')),
     status TEXT NOT NULL CHECK (status IN ('planned','done','moved','dropped')),
     carried_from INTEGER REFERENCES picks(id),
     notes TEXT,
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     CHECK ((kind = 'item') = (item_id IS NOT NULL)),
     CHECK ((kind = 'draft') = (draft_id IS NOT NULL))
   );
   CREATE INDEX picks_date ON picks(date, half, position);
   CREATE TABLE markers (
     kind TEXT NOT NULL,
     date TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (kind, date)
   );`,
  // 2 (step 6): "ignition" became "Plan the day"; keep the once-a-day markers already set.
  `UPDATE markers SET kind = 'plan_day_auto' WHERE kind = 'ignition_auto';`,
];

export type NewPick = {
  date: IsoDate;
  half: Half;
  clientKey: string;
  kind: PickKind;
  itemId?: number;
  draftId?: number;
  title: string;
  itemType?: string | null;
  itemUrl?: string | null;
  size: Size;
};

type Row = Record<string, string | number | null>;

const toPick = (r: Row): Pick => ({
  id: r.id as number,
  date: r.date as string,
  half: r.half as Half,
  clientKey: r.client_key as string,
  kind: r.kind as PickKind,
  itemId: (r.item_id as number | null) ?? null,
  draftId: (r.draft_id as number | null) ?? null,
  title: r.title as string,
  itemType: (r.item_type as string | null) ?? null,
  itemUrl: (r.item_url as string | null) ?? null,
  size: r.size as Size,
  status: r.status as Pick["status"],
  carriedFrom: (r.carried_from as number | null) ?? null,
  carriedFromDate: (r.carried_from_date as string | null) ?? null,
  notes: (r.notes as string | null) ?? null,
  position: r.position as number,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});
const toPlan = (r: Row): DayPlan => ({ date: r.date as string, committedAt: (r.committed_at as string | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string });
const toDraft = (r: Row): DraftStory => ({ id: r.id as number, clientKey: r.client_key as string, parentItemId: r.parent_item_id as number, title: r.title as string, size: r.size as Size, createdAt: r.created_at as string });

const PICK_SELECT = `SELECT p.*, o.date AS carried_from_date FROM picks p LEFT JOIN picks o ON o.id = p.carried_from`;

export class PlanError extends Error {}

export function createPlanStore(opts: { path: string; now: () => Temporal.ZonedDateTime }) {
  if (opts.path !== ":memory:") mkdirSync(dirname(opts.path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(opts.path);
  if (opts.path !== ":memory:") chmodSync(opts.path, 0o600);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(db, opts.now);

  const stamp = (): ZonedStamp => opts.now().toString({ smallestUnit: "second" });
  const tx = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };

  const getPlan = (date: IsoDate) => {
    const r = db.prepare("SELECT * FROM day_plans WHERE date = ?").get(date) as Row | undefined;
    return r ? toPlan(r) : null;
  };
  const ensurePlan = (date: IsoDate): DayPlan => {
    const at = stamp();
    db.prepare("INSERT INTO day_plans (date, committed_at, created_at, updated_at) VALUES (?, NULL, ?, ?) ON CONFLICT(date) DO NOTHING").run(date, at, at);
    return getPlan(date)!;
  };
  const getPick = (id: number): Pick | null => {
    const r = db.prepare(`${PICK_SELECT} WHERE p.id = ?`).get(id) as Row | undefined;
    return r ? toPick(r) : null;
  };
  const mustPick = (id: number): Pick => {
    const p = getPick(id);
    if (!p) throw new PlanError(`No pick ${id}`);
    return p;
  };
  const nextPosition = (date: IsoDate, half: Half) =>
    ((db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM picks WHERE date = ? AND half = ?").get(date, half) as Row).m as number) + 1;

  function insertPick(p: NewPick, carriedFrom: number | null = null): Pick {
    ensurePlan(p.date);
    const at = stamp();
    const r = db
      .prepare(
        `INSERT INTO picks (date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, NULL, ?, ?, ?)`,
      )
      .run(p.date, p.half, p.clientKey, p.kind, p.itemId ?? null, p.draftId ?? null, p.title, p.itemType ?? null, p.itemUrl ?? null, p.size, carriedFrom, nextPosition(p.date, p.half), at, at);
    return getPick(Number(r.lastInsertRowid))!;
  }

  const picksBetween = (from: IsoDate, to: IsoDate): Pick[] =>
    (db.prepare(`${PICK_SELECT} WHERE p.date >= ? AND p.date <= ? ORDER BY p.date, p.half, p.position`).all(from, to) as Row[]).map(toPick);

  return {
    /** Creates the day plan if missing. */
    start: (date: IsoDate): DayPlan => ensurePlan(date),
    day: getPlan,
    getPick,
    picksFor: (date: IsoDate) => picksBetween(date, date),
    picksBetween,
    carryOverFor(today: IsoDate): Pick[] {
      const from = Temporal.PlainDate.from(today).subtract({ days: 14 }).toString();
      return carryOver(picksBetween(from, today), today);
    },
    addPick: (p: NewPick): Pick => tx(() => insertPick(p)),
    /** Before the day is committed a pick is simply removed; after, it is kept as dropped. */
    removePick(id: number): { result: "deleted" | "dropped"; pick: Pick } {
      return tx(() => {
        const p = mustPick(id);
        const committed = !!getPlan(p.date)?.committedAt;
        const referenced = db.prepare("SELECT 1 FROM picks WHERE carried_from = ?").get(id);
        if (!committed && !referenced && p.carriedFrom === null) {
          db.prepare("DELETE FROM picks WHERE id = ?").run(id);
          return { result: "deleted", pick: p };
        }
        if (p.carriedFrom !== null && !committed) {
          // Carried in this morning and dropped again: hand it back to the day it came from.
          db.prepare("DELETE FROM picks WHERE id = ?").run(id);
          db.prepare("UPDATE picks SET status = 'planned', updated_at = ? WHERE id = ? AND status = 'moved'").run(stamp(), p.carriedFrom);
          return { result: "deleted", pick: p };
        }
        db.prepare("UPDATE picks SET status = 'dropped', updated_at = ? WHERE id = ?").run(stamp(), id);
        return { result: "dropped", pick: mustPick(id) };
      });
    },
    /** Settles a planned pick as dropped and keeps it, whatever the day's commit state (past days). */
    drop(id: number): Pick {
      return tx(() => {
        const p = mustPick(id);
        if (p.status !== "planned") throw new PlanError("Only a planned pick can be dropped");
        db.prepare("UPDATE picks SET status = 'dropped', updated_at = ? WHERE id = ?").run(stamp(), id);
        return mustPick(id);
      });
    },
    setSize(id: number, size: Size): Pick {
      return tx(() => {
        mustPick(id);
        db.prepare("UPDATE picks SET size = ?, updated_at = ? WHERE id = ?").run(size, stamp(), id);
        return mustPick(id);
      });
    },
    /** Same day: change block in place. Another day: the original becomes "moved" and a new pick is carried there. */
    move(id: number, date: IsoDate, half: Half): Pick {
      return tx(() => {
        const p = mustPick(id);
        if (p.status !== "planned") throw new PlanError("Only a planned pick can be moved");
        if (p.date === date) {
          if (p.half === half) return p;
          db.prepare("UPDATE picks SET half = ?, position = ?, updated_at = ? WHERE id = ?").run(half, nextPosition(date, half), stamp(), id);
          return mustPick(id);
        }
        db.prepare("UPDATE picks SET status = 'moved', updated_at = ? WHERE id = ?").run(stamp(), id);
        const base: NewPick = { date, half, clientKey: p.clientKey, kind: p.kind, title: p.title, itemType: p.itemType, itemUrl: p.itemUrl, size: p.size };
        if (p.itemId !== null) base.itemId = p.itemId;
        if (p.draftId !== null) base.draftId = p.draftId;
        return insertPick(base, p.id);
      });
    },
    commit(date: IsoDate): DayPlan {
      return tx(() => {
        ensurePlan(date);
        const at = stamp();
        db.prepare("UPDATE day_plans SET committed_at = ?, updated_at = ? WHERE date = ?").run(at, at, date);
        return getPlan(date)!;
      });
    },
    setDone(id: number, done: boolean): Pick {
      return tx(() => {
        const p = mustPick(id);
        if (p.status !== "planned" && p.status !== "done") throw new PlanError("Only a planned or done pick can be ticked");
        db.prepare("UPDATE picks SET status = ?, updated_at = ? WHERE id = ?").run(done ? "done" : "planned", stamp(), id);
        return mustPick(id);
      });
    },
    addDraft(d: { clientKey: string; parentItemId: number; title: string; size: Size }): DraftStory {
      return tx(() => {
        const at = stamp();
        const r = db.prepare("INSERT INTO draft_stories (client_key, parent_item_id, title, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(d.clientKey, d.parentItemId, d.title, d.size, at, at);
        return toDraft(db.prepare("SELECT * FROM draft_stories WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
      });
    },
    getDraft(id: number): DraftStory | null {
      const r = db.prepare("SELECT * FROM draft_stories WHERE id = ?").get(id) as Row | undefined;
      return r ? toDraft(r) : null;
    },
    drafts: (): DraftStory[] => (db.prepare("SELECT * FROM draft_stories ORDER BY id").all() as Row[]).map(toDraft),
    /** True the first time (kind, date) is marked, false after: "only once a day" across restarts. */
    markOnce(kind: string, date: IsoDate): boolean {
      const r = db.prepare("INSERT INTO markers (kind, date, at) VALUES (?, ?, ?) ON CONFLICT(kind, date) DO NOTHING").run(kind, date, stamp());
      return Number(r.changes) === 1;
    },
    week(dates: IsoDate[]): PlanWeek {
      const out: PlanWeek = {};
      for (const d of dates) {
        const plan = getPlan(d);
        if (plan) out[d] = { committedAt: plan.committedAt, picks: picksBetween(d, d) };
      }
      return out;
    },
    schemaVersion: () => schemaVersion(db),
    exportJson() {
      return {
        exportedAt: stamp(),
        schemaVersion: schemaVersion(db),
        dayPlans: (db.prepare("SELECT * FROM day_plans ORDER BY date").all() as Row[]).map(toPlan),
        picks: (db.prepare(`${PICK_SELECT} ORDER BY p.date, p.half, p.position`).all() as Row[]).map(toPick),
        draftStories: (db.prepare("SELECT * FROM draft_stories ORDER BY id").all() as Row[]).map(toDraft),
      };
    },
    close: () => db.close(),
  };
}

export type PlanStore = ReturnType<typeof createPlanStore>;

function schemaVersion(db: DatabaseSync): number {
  return ((db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as Row).v as number) ?? 0;
}

function migrate(db: DatabaseSync, now: () => Temporal.ZonedDateTime) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const current = schemaVersion(db);
  if (current > MIGRATIONS.length) throw new Error(`Plan store is from a newer Coopilot (schema ${current}); not opening it`);
  for (let v = current + 1; v <= MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v - 1]!);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v, now().toString({ smallestUnit: "second" }));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
