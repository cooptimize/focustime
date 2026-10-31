// Local plan store (D23): SQLite through Node's built-in node:sqlite, under ~/.local/share/coopilot/.
// Holds only Coopilot's own plan (day plans, picks, draft stories) and a few one-time markers.
// Nothing here is ever written to DevOps, Outlook, Google or Dataverse.
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { carryOver } from "../plan/rules.ts";
import type { DayPlan, DraftStory, Pick, PickKind, PlanWeek, Size, ZonedStamp } from "../plan/types.ts";
import type { FlexSession, Half, IsoDate, Unavailable } from "../week/types.ts";

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
  // 3 (step 6b): picks can sit in the evening slot (EVE); unavailable time, flex sessions and loops.
  `CREATE TABLE picks_v3 (
     id INTEGER PRIMARY KEY,
     date TEXT NOT NULL REFERENCES day_plans(date),
     half TEXT NOT NULL CHECK (half IN ('AM','PM','EVE')),
     client_key TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('item','draft','intention')),
     item_id INTEGER,
     draft_id INTEGER REFERENCES draft_stories(id),
     title TEXT NOT NULL,
     item_type TEXT,
     item_url TEXT,
     size TEXT NOT NULL CHECK (size IN ('S','M','L')),
     status TEXT NOT NULL CHECK (status IN ('planned','done','moved','dropped')),
     carried_from INTEGER REFERENCES picks_v3(id),
     notes TEXT,
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     CHECK ((kind = 'item') = (item_id IS NOT NULL)),
     CHECK ((kind = 'draft') = (draft_id IS NOT NULL))
   );
   INSERT INTO picks_v3 SELECT id, date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at FROM picks ORDER BY id;
   DROP INDEX picks_date;
   DROP TABLE picks;
   ALTER TABLE picks_v3 RENAME TO picks;
   CREATE INDEX picks_date ON picks(date, half, position);
   CREATE TABLE unavailable (
     id INTEGER PRIMARY KEY,
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     title TEXT NOT NULL,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     note TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX unavailable_date ON unavailable(date);
   CREATE TABLE flex_sessions (
     id INTEGER PRIMARY KEY,
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     client_key TEXT NOT NULL,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     item_id INTEGER,
     item_title TEXT,
     item_url TEXT,
     note TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX flex_date ON flex_sessions(date);
   CREATE TABLE loops (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL,
     client_key TEXT,
     what TEXT NOT NULL,
     channel TEXT,
     due TEXT,
     source_kind TEXT,
     source_id INTEGER,
     opened_at TEXT NOT NULL,
     closed_at TEXT,
     close_note TEXT,
     UNIQUE (source_kind, source_id)
   );`,
];

export type NewUnavailable = { date: IsoDate; title: string; start: string; end: string; note?: string | null };
export type NewFlex = { date: IsoDate; clientKey: string; start: string; end: string; itemId?: number | null; itemTitle?: string | null; itemUrl?: string | null; note?: string | null };
/** Something owed to someone (D92). Stored now, shown with the loops UI later. */
export type Loop = { id: number; kind: string; clientKey: string | null; what: string; channel: string | null; due: string | null; sourceKind: string | null; sourceId: number | null; openedAt: string; closedAt: string | null };

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

const toUnavailable = (r: Row): Unavailable => ({ id: r.id as number, title: r.title as string, start: r.start_at as string, end: r.end_at as string, note: (r.note as string | null) ?? null });
const toFlex = (r: Row): FlexSession => ({
  id: r.id as number,
  clientKey: r.client_key as string,
  start: r.start_at as string,
  end: r.end_at as string,
  itemId: (r.item_id as number | null) ?? null,
  itemTitle: (r.item_title as string | null) ?? null,
  itemUrl: (r.item_url as string | null) ?? null,
  note: (r.note as string | null) ?? null,
});
const toLoop = (r: Row): Loop => ({
  id: r.id as number,
  kind: r.kind as string,
  clientKey: (r.client_key as string | null) ?? null,
  what: r.what as string,
  channel: (r.channel as string | null) ?? null,
  due: (r.due as string | null) ?? null,
  sourceKind: (r.source_kind as string | null) ?? null,
  sourceId: (r.source_id as number | null) ?? null,
  openedAt: r.opened_at as string,
  closedAt: (r.closed_at as string | null) ?? null,
});

const PICK_SELECT = `SELECT p.*, o.date AS carried_from_date FROM picks p LEFT JOIN picks o ON o.id = p.carried_from`;

export class PlanError extends Error {}

export function createPlanStore(opts: { path: string; now: () => Temporal.ZonedDateTime }) {
  if (opts.path !== ":memory:") mkdirSync(dirname(opts.path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(opts.path);
  if (opts.path !== ":memory:") chmodSync(opts.path, 0o600);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(db, opts.now, opts.path);

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
    // ---- unavailable time and flex sessions (step 6b) ----
    unavailableBetween: (from: IsoDate, to: IsoDate): Unavailable[] =>
      (db.prepare("SELECT * FROM unavailable WHERE date >= ? AND date <= ? ORDER BY date, start_at, id").all(from, to) as Row[]).map(toUnavailable),
    addUnavailable(u: NewUnavailable): Unavailable {
      const at = stamp();
      const r = db.prepare("INSERT INTO unavailable (date, title, start_at, end_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(u.date, u.title, u.start, u.end, u.note ?? null, at, at);
      return toUnavailable(db.prepare("SELECT * FROM unavailable WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
    },
    getUnavailable(id: number): Unavailable | null {
      const r = db.prepare("SELECT * FROM unavailable WHERE id = ?").get(id) as Row | undefined;
      return r ? toUnavailable(r) : null;
    },
    removeUnavailable(id: number): boolean {
      return Number(db.prepare("DELETE FROM unavailable WHERE id = ?").run(id).changes) === 1;
    },
    flexBetween: (from: IsoDate, to: IsoDate): FlexSession[] =>
      (db.prepare("SELECT * FROM flex_sessions WHERE date >= ? AND date <= ? ORDER BY date, start_at, id").all(from, to) as Row[]).map(toFlex),
    addFlex(f: NewFlex): FlexSession {
      const at = stamp();
      const r = db
        .prepare("INSERT INTO flex_sessions (date, client_key, start_at, end_at, item_id, item_title, item_url, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(f.date, f.clientKey, f.start, f.end, f.itemId ?? null, f.itemTitle ?? null, f.itemUrl ?? null, f.note ?? null, at, at);
      return toFlex(db.prepare("SELECT * FROM flex_sessions WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
    },
    getFlex(id: number): FlexSession | null {
      const r = db.prepare("SELECT * FROM flex_sessions WHERE id = ?").get(id) as Row | undefined;
      return r ? toFlex(r) : null;
    },
    /** Removes a flex session that hasn't ended; an ended one has opened its loop and stays. */
    removeFlex(id: number): boolean {
      return tx(() => {
        if (db.prepare("SELECT 1 FROM loops WHERE source_kind = 'flex' AND source_id = ?").get(id)) throw new PlanError("This flex session has ended and opened its update loop; it stays");
        return Number(db.prepare("DELETE FROM flex_sessions WHERE id = ?").run(id).changes) === 1;
      });
    },
    /**
     * After a flex session ends, a "post the update to <client>" loop opens once (D126). Called on reads; returns
     * the loops it opened. The loops UI comes later; the rows are kept until then.
     */
    openFlexLoops(now: Temporal.Instant): Loop[] {
      return tx(() => {
        const rows = db.prepare("SELECT f.* FROM flex_sessions f LEFT JOIN loops l ON l.source_kind = 'flex' AND l.source_id = f.id WHERE l.id IS NULL").all() as Row[];
        const opened: Loop[] = [];
        for (const f of rows.map(toFlex)) {
          if (Temporal.Instant.compare(Temporal.Instant.from(f.end), now) > 0) continue;
          const what = `Post the update to ${f.clientKey}${f.itemTitle ? ` on ${f.itemTitle}` : ""} after the flex session`;
          const r = db.prepare("INSERT INTO loops (kind, client_key, what, source_kind, source_id, opened_at) VALUES ('flex_update', ?, ?, 'flex', ?, ?)").run(f.clientKey, what, f.id, stamp());
          opened.push(toLoop(db.prepare("SELECT * FROM loops WHERE id = ?").get(Number(r.lastInsertRowid)) as Row));
        }
        return opened;
      });
    },
    openLoops: (): Loop[] => (db.prepare("SELECT * FROM loops WHERE closed_at IS NULL ORDER BY opened_at, id").all() as Row[]).map(toLoop),
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
        unavailable: (db.prepare("SELECT * FROM unavailable ORDER BY date, start_at, id").all() as Row[]).map(toUnavailable),
        flexSessions: (db.prepare("SELECT * FROM flex_sessions ORDER BY date, start_at, id").all() as Row[]).map(toFlex),
        loops: (db.prepare("SELECT * FROM loops ORDER BY id").all() as Row[]).map(toLoop),
      };
    },
    close: () => db.close(),
  };
}

export type PlanStore = ReturnType<typeof createPlanStore>;

function schemaVersion(db: DatabaseSync): number {
  return ((db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as Row).v as number) ?? 0;
}

/** Where the copy taken before a migration goes: plan.db.bak-v<from>-<stamp>, next to the store, 0600. */
export const backupPath = (path: string, from: number, stamp: string) => `${path}.bak-v${from}-${stamp.replace(/[^0-9TZ]/g, "")}`;

function migrate(db: DatabaseSync, now: () => Temporal.ZonedDateTime, path = ":memory:") {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const current = schemaVersion(db);
  if (current > MIGRATIONS.length) throw new Error(`Plan store is from a newer Coopilot (schema ${current}); not opening it`);
  // A store with data gets a full copy before any schema change (D125).
  if (current > 0 && current < MIGRATIONS.length && path !== ":memory:") {
    const bak = backupPath(path, current, now().toInstant().toString());
    db.prepare("VACUUM INTO ?").run(bak);
    chmodSync(bak, 0o600);
  }
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
