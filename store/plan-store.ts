// Local plan store (D23): SQLite through Node's built-in node:sqlite, under ~/.local/share/coopilot/.
// Holds only Coopilot's own plan (day plans, picks, draft stories) and a few one-time markers.
// Nothing here is ever written to DevOps, Outlook, Google or Dataverse.
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { carryOver } from "../plan/rules.ts";
import { DEFAULT_BLOCKS, validBlocks, type ItemLevel, type Tier } from "../plan/weeklist.ts";
import type { Capture, DayPlan, DraftStory, Note, Pick, PickKind, PlanWeek, Size, ZonedStamp } from "../plan/types.ts";
import type { FlexSession, Half, IsoDate, Unavailable } from "../week/types.ts";

/** Marks a migration that rebuilds a referenced table: run with foreign keys off, then checked (see migrate). */
const FK_OFF = "-- foreign keys off for a table rebuild";

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
  // 4 (step 6c): small state that must survive restarts (the focus timer, its warning points), and focused time.
  `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE focus_log (
     id INTEGER PRIMARY KEY,
     pick_id INTEGER,
     label TEXT NOT NULL,
     started_at TEXT NOT NULL,
     ended_at TEXT NOT NULL,
     seconds INTEGER NOT NULL CHECK (seconds >= 0)
   );
   CREATE INDEX focus_pick ON focus_log(pick_id);`,
  // 5 (step 7): loop rules (who, the item, one loop per rule and thing, the heads-up draft, who closed it),
  // Close out per day, resume notes per client and day, and borrowed time.
  `ALTER TABLE loops ADD COLUMN who TEXT;
   ALTER TABLE loops ADD COLUMN item_id INTEGER;
   ALTER TABLE loops ADD COLUMN rule_key TEXT;
   ALTER TABLE loops ADD COLUMN ref_at TEXT;
   ALTER TABLE loops ADD COLUMN draft TEXT;
   ALTER TABLE loops ADD COLUMN detail TEXT;
   ALTER TABLE loops ADD COLUMN closed_by TEXT;
   CREATE UNIQUE INDEX loops_rule ON loops(rule_key);
   ALTER TABLE day_plans ADD COLUMN closed_out_at TEXT;
   CREATE TABLE resume_notes (
     id INTEGER PRIMARY KEY,
     client_key TEXT NOT NULL,
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     note TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (client_key, date)
   );
   CREATE TABLE borrowed (
     id INTEGER PRIMARY KEY,
     pick_id INTEGER NOT NULL REFERENCES picks(id),
     from_pick_id INTEGER NOT NULL REFERENCES picks(id),
     client_key TEXT NOT NULL,
     title TEXT NOT NULL,
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     minutes INTEGER NOT NULL CHECK (minutes > 0),
     payback TEXT NOT NULL CHECK (payback IN ('tonight','friday','day')),
     payback_date TEXT NOT NULL,
     payback_half TEXT NOT NULL CHECK (payback_half IN ('AM','PM','EVE')),
     created_at TEXT NOT NULL,
     paid_at TEXT,
     paid_by TEXT CHECK (paid_by IN ('picks','me'))
   );`,
  // 6 (step 8): Plan the week. Features committed to a week per client with a number of my blocks, optionally placed
  // on specific blocks; the week's commit; features marked as being broken down (local only).
  `CREATE TABLE week_plans (
     week_start TEXT PRIMARY KEY CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     committed_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE week_features (
     id INTEGER PRIMARY KEY,
     week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     item_type TEXT,
     url TEXT,
     blocks INTEGER NOT NULL CHECK (blocks BETWEEN 1 AND 20),
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (week_start, client_key, item_id)
   );
   CREATE TABLE week_feature_slots (
     feature_id INTEGER NOT NULL REFERENCES week_features(id) ON DELETE CASCADE,
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     half TEXT NOT NULL CHECK (half IN ('AM','PM')),
     PRIMARY KEY (feature_id, date, half)
   );
   CREATE TABLE breakdown_marks (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     marked_at TEXT NOT NULL,
     PRIMARY KEY (client_key, item_id)
   );`,
  // 7 (step 9): quick capture. Captures (an inbox until routed), notes (per client or none), and draft stories that
  // need not sit under a feature: draft_stories is rebuilt with parent_item_id optional, ids kept, so picks still
  // point at the same drafts (foreign keys checked at commit).
  `${FK_OFF}
   CREATE TABLE captures (
     id INTEGER PRIMARY KEY,
     text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
     client_key TEXT,
     created_at TEXT NOT NULL,
     routed_at TEXT,
     routed_as TEXT CHECK (routed_as IN ('loop','draft','note','dismissed')),
     routed_id INTEGER,
     CHECK ((routed_at IS NULL) = (routed_as IS NULL))
   );
   CREATE TABLE notes (
     id INTEGER PRIMARY KEY,
     client_key TEXT,
     text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
     capture_id INTEGER REFERENCES captures(id),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE draft_stories_v7 (
     id INTEGER PRIMARY KEY,
     client_key TEXT NOT NULL,
     parent_item_id INTEGER,
     title TEXT NOT NULL,
     size TEXT NOT NULL CHECK (size IN ('S','M','L')),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   INSERT INTO draft_stories_v7 SELECT id, client_key, parent_item_id, title, size, created_at, updated_at FROM draft_stories ORDER BY id;
   DROP TABLE draft_stories;
   ALTER TABLE draft_stories_v7 RENAME TO draft_stories;`,
  // 8 (step 11): the week plan by client. week_features is rebuilt with ids kept (pins in week_feature_slots still
  // point at them): a level (feature or story), a tier (must or nice), blocks in half steps, a local position that is
  // empty unless reordered by hand (empty follows DevOps stack rank), and a local done mark. Step 8 rows become
  // feature musts in DevOps order; their placements stay as pins (D195).
  `${FK_OFF}
   CREATE TABLE week_features_v8 (
     id INTEGER PRIMARY KEY,
     week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     level TEXT NOT NULL DEFAULT 'feature' CHECK (level IN ('feature','story')),
     tier TEXT NOT NULL DEFAULT 'must' CHECK (tier IN ('must','nice')),
     title TEXT NOT NULL,
     item_type TEXT,
     url TEXT,
     blocks REAL NOT NULL CHECK (blocks BETWEEN 0.5 AND 20 AND blocks * 2 = CAST(blocks * 2 AS INTEGER)),
     position INTEGER,
     done_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (week_start, client_key, item_id)
   );
   INSERT INTO week_features_v8 (id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, position, done_at, created_at, updated_at)
     SELECT id, week_start, client_key, item_id, 'feature', 'must', title, item_type, url, blocks, NULL, NULL, created_at, updated_at FROM week_features ORDER BY id;
   DROP TABLE week_features;
   ALTER TABLE week_features_v8 RENAME TO week_features;`,
];

/** The tables "Reset local plan" empties (Q37). Markers (reminder and auto-open once a day) are kept. */
const RESET_TABLES = ["notes", "captures", "week_feature_slots", "week_features", "week_plans", "breakdown_marks", "borrowed", "resume_notes", "focus_log", "kv", "loops", "flex_sessions", "unavailable", "picks", "draft_stories", "day_plans"] as const;
export type FocusSegment = { pickId: number | null; label: string; startedAt: string; endedAt: string; seconds: number };

export type NewUnavailable = { date: IsoDate; title: string; start: string; end: string; note?: string | null };
export type NewFlex = { date: IsoDate; clientKey: string; start: string; end: string; itemId?: number | null; itemTitle?: string | null; itemUrl?: string | null; note?: string | null };
/** Something owed to someone (D92). Opened by a rule (step 7, plan/loops.ts), a flex session or by hand. */
export type Loop = {
  id: number;
  kind: string;
  clientKey: string | null;
  /** Who it is owed to (a client name, or what I typed). */
  who: string | null;
  what: string;
  channel: string | null;
  due: string | null;
  sourceKind: string | null;
  sourceId: number | null;
  /** The DevOps item it is about, if any. */
  itemId: number | null;
  /** One loop per rule and thing ("devops_update:<pick>", "slip:<client>:<date>:<n>", "blocked:<client>:<item>"). */
  ruleKey: string | null;
  /** What a later DevOps change is compared with (when the pick was ticked done). */
  refAt: string | null;
  /** A copyable plain-text heads-up (slip loops). */
  draft: string | null;
  /** Rule details: the pick ids a slip loop covers. */
  detail: { picks?: number[] } | null;
  openedAt: string;
  closedAt: string | null;
  closeNote: string | null;
  /** "me" (by hand) or "signal" (a DevOps change proved it). */
  closedBy: "me" | "signal" | null;
};
export type NewRuleLoop = { kind: string; ruleKey: string; clientKey: string | null; who: string; what: string; itemId?: number | null; refAt?: string | null; draft?: string | null; detail?: { picks?: number[] } | null };
export type ResumeNote = { id: number; clientKey: string; date: IsoDate; note: string; updatedAt: string };
/** Borrowed time (step 7): planned focus that slipped, to be made up on a payback day. */
export type { WeekFeature, WeekPlanRecord } from "../plan/types.ts";
import type { WeekFeature, WeekPlanRecord } from "../plan/types.ts";

export type NewWeekFeature = { weekStart: IsoDate; clientKey: string; itemId: number; title: string; itemType: string | null; url: string | null; blocks: number };
export type NewWeekItem = Omit<NewWeekFeature, "blocks"> & { level: ItemLevel; tier?: Tier; blocks?: number };

/** Most blocks one feature can take in a week (ten half-days, a little headroom). */
export const MAX_FEATURE_BLOCKS = 20;

export type Borrowed = {
  id: number;
  /** The pick on the payback day (the moved one). */
  pickId: number;
  /** The pick it slipped from. */
  fromPickId: number;
  clientKey: string;
  title: string;
  /** The day it was borrowed from. */
  date: IsoDate;
  minutes: number;
  payback: "tonight" | "friday" | "day";
  paybackDate: IsoDate;
  paybackHalf: Half;
  createdAt: string;
  paidAt: string | null;
  paidBy: "picks" | "me" | null;
};

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
const toPlan = (r: Row): DayPlan => ({ date: r.date as string, committedAt: (r.committed_at as string | null) ?? null, closedOutAt: (r.closed_out_at as string | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string });
const toDraft = (r: Row): DraftStory => ({ id: r.id as number, clientKey: r.client_key as string, parentItemId: (r.parent_item_id as number | null) ?? null, title: r.title as string, size: r.size as Size, createdAt: r.created_at as string });

const toCapture = (r: Row): Capture => ({
  id: r.id as number,
  text: r.text as string,
  clientKey: (r.client_key as string | null) ?? null,
  createdAt: r.created_at as string,
  routedAt: (r.routed_at as string | null) ?? null,
  routedAs: (r.routed_as as Capture["routedAs"]) ?? null,
  routedId: (r.routed_id as number | null) ?? null,
});
const toNoteRow = (r: Row): Note => ({ id: r.id as number, clientKey: (r.client_key as string | null) ?? null, text: r.text as string, captureId: (r.capture_id as number | null) ?? null, createdAt: r.created_at as string });

/** How a capture is sorted (step 9). */
export type CaptureRoute =
  | { as: "loop"; clientKey: string | null; who: string; what: string; due: IsoDate | null }
  | { as: "draft"; clientKey: string; parentItemId: number | null; title: string; size: Size }
  | { as: "note"; clientKey: string | null; text: string }
  | { as: "dismissed" };
export const MAX_CAPTURE = 1000;

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
  who: (r.who as string | null) ?? null,
  what: r.what as string,
  channel: (r.channel as string | null) ?? null,
  due: (r.due as string | null) ?? null,
  sourceKind: (r.source_kind as string | null) ?? null,
  sourceId: (r.source_id as number | null) ?? null,
  itemId: (r.item_id as number | null) ?? null,
  ruleKey: (r.rule_key as string | null) ?? null,
  refAt: (r.ref_at as string | null) ?? null,
  draft: (r.draft as string | null) ?? null,
  detail: r.detail ? (JSON.parse(r.detail as string) as Loop["detail"]) : null,
  openedAt: r.opened_at as string,
  closedAt: (r.closed_at as string | null) ?? null,
  closeNote: (r.close_note as string | null) ?? null,
  closedBy: (r.closed_by as Loop["closedBy"]) ?? null,
});
const toNote = (r: Row): ResumeNote => ({ id: r.id as number, clientKey: r.client_key as string, date: r.date as string, note: r.note as string, updatedAt: r.updated_at as string });
const toBorrowed = (r: Row): Borrowed => ({
  id: r.id as number,
  pickId: r.pick_id as number,
  fromPickId: r.from_pick_id as number,
  clientKey: r.client_key as string,
  title: r.title as string,
  date: r.date as string,
  minutes: r.minutes as number,
  payback: r.payback as Borrowed["payback"],
  paybackDate: r.payback_date as string,
  paybackHalf: r.payback_half as Half,
  createdAt: r.created_at as string,
  paidAt: (r.paid_at as string | null) ?? null,
  paidBy: (r.paid_by as Borrowed["paidBy"]) ?? null,
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

  /** The week's plan row, created if missing, with its updated time moved on. */
  const touchWeek = (weekStart: IsoDate, at: ZonedStamp) =>
    db.prepare("INSERT INTO week_plans (week_start, committed_at, created_at, updated_at) VALUES (?, NULL, ?, ?) ON CONFLICT(week_start) DO UPDATE SET updated_at = excluded.updated_at").run(weekStart, at, at);
  /** One change to a week item: runs `change`, touches its week; returns the week it is on. */
  const weekItemChange = (id: number, change: (at: ZonedStamp) => unknown): IsoDate =>
    tx(() => {
      const r = db.prepare("SELECT week_start FROM week_features WHERE id = ?").get(id) as Row | undefined;
      if (!r) throw new PlanError("No such item on the week plan");
      const at = stamp();
      change(at);
      touchWeek(r.week_start as string, at);
      return r.week_start as string;
    });

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
    carryOverFor(today: IsoDate, days?: number, pending?: (p: Pick) => boolean): Pick[] {
      const from = Temporal.PlainDate.from(today).subtract({ days: Math.max(14, days ?? 0) }).toString();
      return carryOver(picksBetween(from, today), today, days, pending);
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
    addDraft(d: { clientKey: string; parentItemId: number | null; title: string; size: Size }): DraftStory {
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
    /** Every loop, open first (step 6c loops list). */
    allLoops: (): Loop[] => (db.prepare("SELECT * FROM loops ORDER BY closed_at IS NOT NULL, opened_at, id").all() as Row[]).map(toLoop),
    /** Closes an open loop, by hand ("mark as told") with an optional note, or by a signal with its reason. */
    closeLoop(id: number, note: string | null, by: "me" | "signal" = "me"): Loop {
      return tx(() => {
        const r = db.prepare("SELECT * FROM loops WHERE id = ?").get(id) as Row | undefined;
        if (!r) throw new PlanError(`No loop ${id}`);
        if (r.closed_at) throw new PlanError("That loop is already closed");
        db.prepare("UPDATE loops SET closed_at = ?, close_note = ?, closed_by = ? WHERE id = ?").run(stamp(), note, by, id);
        return toLoop(db.prepare("SELECT * FROM loops WHERE id = ?").get(id) as Row);
      });
    },
    getLoop(id: number): Loop | null {
      const r = db.prepare("SELECT * FROM loops WHERE id = ?").get(id) as Row | undefined;
      return r ? toLoop(r) : null;
    },
    /** Opens a rule's loop once per rule key (step 7). Null when that key already has a loop, open or closed. */
    openRuleLoop(l: NewRuleLoop): Loop | null {
      const r = db
        .prepare("INSERT INTO loops (kind, client_key, who, what, item_id, rule_key, ref_at, draft, detail, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(rule_key) DO NOTHING")
        .run(l.kind, l.clientKey, l.who, l.what, l.itemId ?? null, l.ruleKey, l.refAt ?? null, l.draft ?? null, l.detail ? JSON.stringify(l.detail) : null, stamp());
      return Number(r.changes) === 1 ? toLoop(db.prepare("SELECT * FROM loops WHERE id = ?").get(Number(r.lastInsertRowid)) as Row) : null;
    },
    /** A slip loop that is still open takes more slipped picks: its draft and the picks it covers. */
    updateLoopDraft(id: number, what: string, draft: string, detail: { picks: number[] }): void {
      db.prepare("UPDATE loops SET what = ?, draft = ?, detail = ? WHERE id = ? AND closed_at IS NULL").run(what, draft, JSON.stringify(detail), id);
    },
    /** A loop added by hand: who, what, optional due date. */
    // ---- quick capture (step 9) ----
    /** Saves a capture to the inbox: the plan store only, so it works with every source offline. */
    addCapture(c: { text: string; clientKey: string | null }): Capture {
      const text = c.text.trim();
      if (!text) throw new PlanError("Type something to capture");
      if (text.length > MAX_CAPTURE) throw new PlanError(`A capture is at most ${MAX_CAPTURE} characters`);
      const r = db.prepare("INSERT INTO captures (text, client_key, created_at) VALUES (?, ?, ?)").run(text, c.clientKey, stamp());
      return toCapture(db.prepare("SELECT * FROM captures WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
    },
    getCapture(id: number): Capture | null {
      const r = db.prepare("SELECT * FROM captures WHERE id = ?").get(id) as Row | undefined;
      return r ? toCapture(r) : null;
    },
    /** Captures not routed yet, newest first. */
    inbox: (): Capture[] => (db.prepare("SELECT * FROM captures WHERE routed_at IS NULL ORDER BY id DESC").all() as Row[]).map(toCapture),
    inboxCount: (): number => (db.prepare("SELECT COUNT(*) AS n FROM captures WHERE routed_at IS NULL").get() as Row).n as number,
    /** Routes a capture once: makes the loop, draft story or note and marks the capture, in one transaction. */
    routeCapture(id: number, r: CaptureRoute): Capture {
      return tx(() => {
        const c = db.prepare("SELECT * FROM captures WHERE id = ?").get(id) as Row | undefined;
        if (!c) throw new PlanError("No such capture");
        if (c.routed_at) throw new PlanError("That capture is already sorted");
        const at = stamp();
        let routedId: number | null = null;
        if (r.as === "loop") {
          if (!r.what.trim()) throw new PlanError("A loop needs what you owe");
          routedId = Number(db.prepare("INSERT INTO loops (kind, client_key, who, what, due, opened_at) VALUES ('capture', ?, ?, ?, ?, ?)").run(r.clientKey, r.who.trim(), r.what.trim(), r.due, at).lastInsertRowid);
        } else if (r.as === "draft") {
          if (!r.title.trim()) throw new PlanError("A draft story needs a title");
          routedId = Number(db.prepare("INSERT INTO draft_stories (client_key, parent_item_id, title, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(r.clientKey, r.parentItemId, r.title.trim(), r.size, at, at).lastInsertRowid);
        } else if (r.as === "note") {
          if (!r.text.trim()) throw new PlanError("A note needs text");
          routedId = Number(db.prepare("INSERT INTO notes (client_key, text, capture_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(r.clientKey, r.text.trim(), id, at, at).lastInsertRowid);
        }
        db.prepare("UPDATE captures SET routed_at = ?, routed_as = ?, routed_id = ? WHERE id = ?").run(at, r.as, routedId, id);
        return toCapture(db.prepare("SELECT * FROM captures WHERE id = ?").get(id) as Row);
      });
    },
    /** Notes, newest first; by client ("" for notes with none) and words in the text, any case. */
    notes(f: { clientKey?: string | null; query?: string } = {}): Note[] {
      const where: string[] = [];
      const args: (string | null)[] = [];
      if (f.clientKey === null) where.push("client_key IS NULL");
      else if (f.clientKey !== undefined) (where.push("client_key = ?"), args.push(f.clientKey));
      for (const w of (f.query ?? "").trim().split(/\s+/).filter(Boolean)) {
        where.push("text LIKE ? ESCAPE '\\'");
        args.push(`%${w.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
      }
      return (db.prepare(`SELECT * FROM notes${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC`).all(...args) as Row[]).map(toNoteRow);
    },
    deleteNote(id: number): boolean {
      return Number(db.prepare("DELETE FROM notes WHERE id = ?").run(id).changes) > 0;
    },
    addLoop(l: { who: string; what: string; due: IsoDate | null; clientKey?: string | null }): Loop {
      const r = db.prepare("INSERT INTO loops (kind, client_key, who, what, due, opened_at) VALUES ('manual', ?, ?, ?, ?, ?)").run(l.clientKey ?? null, l.who, l.what, l.due, stamp());
      return toLoop(db.prepare("SELECT * FROM loops WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
    },
    // ---- Close out, resume notes and borrowed time (step 7) ----
    /** Marks Close out done for a day (creating the day plan if there is none). */
    closeOut(date: IsoDate): DayPlan {
      return tx(() => {
        ensurePlan(date);
        const at = stamp();
        db.prepare("UPDATE day_plans SET closed_out_at = ?, updated_at = ? WHERE date = ?").run(at, at, date);
        return getPlan(date)!;
      });
    },
    /** One note per client and day: writing again the same day replaces it; an empty note removes that day's. */
    setResumeNote(clientKey: string, date: IsoDate, note: string): ResumeNote | null {
      if (!note) {
        db.prepare("DELETE FROM resume_notes WHERE client_key = ? AND date = ?").run(clientKey, date);
        return null;
      }
      const at = stamp();
      db.prepare("INSERT INTO resume_notes (client_key, date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_key, date) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at").run(clientKey, date, note, at, at);
      return toNote(db.prepare("SELECT * FROM resume_notes WHERE client_key = ? AND date = ?").get(clientKey, date) as Row);
    },
    /** The latest note per client (on or before `upTo` when given): the one that wins. */
    latestNotes(upTo?: IsoDate): Record<string, ResumeNote> {
      const rows = (db.prepare("SELECT * FROM resume_notes WHERE date <= ? ORDER BY date, updated_at, id").all(upTo ?? "9999-12-31") as Row[]).map(toNote);
      return Object.fromEntries(rows.map((n) => [n.clientKey, n]));
    },
    notesOn: (date: IsoDate): ResumeNote[] => (db.prepare("SELECT * FROM resume_notes WHERE date = ? ORDER BY client_key").all(date) as Row[]).map(toNote),
    noteHistory: (clientKey: string): ResumeNote[] => (db.prepare("SELECT * FROM resume_notes WHERE client_key = ? ORDER BY date DESC").all(clientKey) as Row[]).map(toNote),
    /**
     * "I'll make it up": the pick moves to the payback day and slot, and borrowed time is recorded against the
     * moved pick, in one transaction.
     */
    makeUp(id: number, to: { date: IsoDate; half: Half }, b: { minutes: number; payback: Borrowed["payback"] }): { pick: Pick; borrowed: Borrowed } {
      return tx(() => {
        const p = mustPick(id);
        if (p.status !== "planned") throw new PlanError("Only a planned pick can be made up");
        if (p.date === to.date && p.half === to.half) throw new PlanError("That is where the pick already is");
        let moved: Pick;
        if (p.date === to.date) {
          db.prepare("UPDATE picks SET half = ?, position = ?, updated_at = ? WHERE id = ?").run(to.half, nextPosition(to.date, to.half), stamp(), id);
          moved = mustPick(id);
        } else {
          db.prepare("UPDATE picks SET status = 'moved', updated_at = ? WHERE id = ?").run(stamp(), id);
          const base: NewPick = { date: to.date, half: to.half, clientKey: p.clientKey, kind: p.kind, title: p.title, itemType: p.itemType, itemUrl: p.itemUrl, size: p.size };
          if (p.itemId !== null) base.itemId = p.itemId;
          if (p.draftId !== null) base.draftId = p.draftId;
          moved = insertPick(base, p.id);
        }
        const r = db
          .prepare("INSERT INTO borrowed (pick_id, from_pick_id, client_key, title, date, minutes, payback, payback_date, payback_half, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(moved.id, p.id, p.clientKey, p.title, p.date, b.minutes, b.payback, to.date, to.half, stamp());
        return { pick: moved, borrowed: toBorrowed(db.prepare("SELECT * FROM borrowed WHERE id = ?").get(Number(r.lastInsertRowid)) as Row) };
      });
    },
    /**
     * Borrowed time is paid once its payback pick is done, following the pick if it was moved on again. Called on
     * reads; returns the records it marked paid.
     */
    settleBorrowed(): Borrowed[] {
      return tx(() => {
        const paid: Borrowed[] = [];
        for (const b of (db.prepare("SELECT * FROM borrowed WHERE paid_at IS NULL").all() as Row[]).map(toBorrowed)) {
          let id: number | null = b.pickId;
          for (let hops = 0; id !== null && hops < 50; hops++) {
            const p = getPick(id);
            if (p?.status === "done") {
              db.prepare("UPDATE borrowed SET paid_at = ?, paid_by = 'picks' WHERE id = ?").run(stamp(), b.id);
              paid.push({ ...b, paidAt: stamp(), paidBy: "picks" });
              break;
            }
            id = p?.status === "moved" ? ((db.prepare("SELECT id FROM picks WHERE carried_from = ? ORDER BY id DESC").get(id) as Row | undefined)?.id as number | undefined) ?? null : null;
          }
        }
        return paid;
      });
    },
    payBorrowed(id: number): Borrowed {
      return tx(() => {
        const r = db.prepare("SELECT * FROM borrowed WHERE id = ?").get(id) as Row | undefined;
        if (!r) throw new PlanError(`No borrowed time ${id}`);
        if (r.paid_at) throw new PlanError("That is already paid");
        db.prepare("UPDATE borrowed SET paid_at = ?, paid_by = 'me' WHERE id = ?").run(stamp(), id);
        return toBorrowed(db.prepare("SELECT * FROM borrowed WHERE id = ?").get(id) as Row);
      });
    },
    /** Borrowed records from days in a range, plus every unpaid one. */
    borrowedFor: (from: IsoDate, to: IsoDate): Borrowed[] =>
      (db.prepare("SELECT * FROM borrowed WHERE (date >= ? AND date <= ?) OR paid_at IS NULL ORDER BY date, id").all(from, to) as Row[]).map(toBorrowed),
    /** The pick a moved pick went to (the latest one carried from it), for "moved to Wed PM". */
    movedTo(id: number): Pick | null {
      const r = db.prepare(`${PICK_SELECT} WHERE p.carried_from = ? ORDER BY p.id DESC`).get(id) as Row | undefined;
      return r ? toPick(r) : null;
    },
    /** Small JSON state that survives restarts (the focus timer). null removes it. */
    getState<T>(key: string): T | null {
      const r = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
      return r ? (JSON.parse(r.value as string) as T) : null;
    },
    setState(key: string, value: unknown): void {
      if (value === null) db.prepare("DELETE FROM kv WHERE key = ?").run(key);
      else db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, JSON.stringify(value), stamp());
    },
    /** Records focused time (step 6c); pickId null for a plain timer. */
    addFocus(s: FocusSegment): void {
      if (s.seconds <= 0) return;
      db.prepare("INSERT INTO focus_log (pick_id, label, started_at, ended_at, seconds) VALUES (?, ?, ?, ?, ?)").run(s.pickId, s.label, s.startedAt, s.endedAt, Math.round(s.seconds));
    },
    /** Focused seconds per pick for these picks. */
    focusedSeconds(pickIds: readonly number[]): Record<number, number> {
      if (!pickIds.length) return {};
      const rows = db.prepare(`SELECT pick_id, SUM(seconds) AS s FROM focus_log WHERE pick_id IN (${pickIds.map(() => "?").join(",")}) GROUP BY pick_id`).all(...pickIds) as Row[];
      return Object.fromEntries(rows.map((r) => [r.pick_id as number, r.s as number]));
    },
    /**
     * Reset local plan (Q37): a full copy first (plan.db.bak-reset-<stamp>, 0600), then every plan table emptied in one
     * transaction. Returns the backup path. Not available for an in-memory store's backup (tests get null).
     */
    reset(): string | null {
      let bak: string | null = null;
      if (opts.path !== ":memory:") {
        bak = `${opts.path}.bak-reset-${opts.now().toInstant().toString().replace(/[^0-9TZ]/g, "")}`;
        db.prepare("VACUUM INTO ?").run(bak);
        chmodSync(bak, 0o600);
      }
      tx(() => {
        for (const t of RESET_TABLES) db.exec(`DELETE FROM ${t}`);
      });
      return bak;
    },
    // ---- Plan the week (step 8) ----
    weekPlan(weekStart: IsoDate): WeekPlanRecord {
      const plan = db.prepare("SELECT * FROM week_plans WHERE week_start = ?").get(weekStart) as Row | undefined;
      const rows = db.prepare("SELECT * FROM week_features WHERE week_start = ? ORDER BY id").all(weekStart) as Row[];
      const slots = db.prepare("SELECT s.* FROM week_feature_slots s JOIN week_features f ON f.id = s.feature_id WHERE f.week_start = ? ORDER BY s.date, s.half").all(weekStart) as Row[];
      const features = rows.map((r): WeekFeature => ({
        id: r.id as number,
        weekStart: r.week_start as string,
        clientKey: r.client_key as string,
        itemId: r.item_id as number,
        level: r.level as "feature" | "story",
        tier: r.tier as "must" | "nice",
        title: r.title as string,
        itemType: (r.item_type as string | null) ?? null,
        url: (r.url as string | null) ?? null,
        blocks: r.blocks as number,
        slots: slots.filter((x) => x.feature_id === r.id).map((x) => ({ date: x.date as string, half: x.half as "AM" | "PM" })),
        doneAt: (r.done_at as string | null) ?? null,
        position: (r.position as number | null) ?? null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      }));
      const latest = [plan?.updated_at as string | undefined, ...features.map((x) => x.updatedAt)].filter((x): x is string => !!x).sort((a, b) => Temporal.Instant.compare(Temporal.ZonedDateTime.from(a).toInstant(), Temporal.ZonedDateTime.from(b).toInstant())).at(-1);
      return { weekStart, committedAt: (plan?.committed_at as string | null) ?? null, updatedAt: latest ?? null, features };
    },
    /** Step 8's call: a feature on a week with a number of blocks (a must when new); 0 blocks takes it off. */
    setWeekFeature(f: NewWeekFeature): WeekFeature | null {
      if (f.blocks === 0) {
        const row = db.prepare("SELECT id FROM week_features WHERE week_start = ? AND client_key = ? AND item_id = ?").get(f.weekStart, f.clientKey, f.itemId) as Row | undefined;
        if (row) this.removeWeekItem(row.id as number);
        return null;
      }
      return this.addWeekItem({ ...f, level: "feature" });
    },
    /**
     * Put a feature or story on a client's week list (step 11), or update it if there: title, type and link always;
     * tier and blocks when given. New items are musts with the level's default blocks unless told otherwise.
     */
    addWeekItem(f: NewWeekItem): WeekFeature {
      if (f.blocks !== undefined && !validBlocks(f.blocks)) throw new PlanError(`blocks must be 0.5 to ${MAX_FEATURE_BLOCKS} in half steps`);
      return tx(() => {
        const at = stamp();
        const row = db.prepare("SELECT id, tier FROM week_features WHERE week_start = ? AND client_key = ? AND item_id = ?").get(f.weekStart, f.clientKey, f.itemId) as Row | undefined;
        touchWeek(f.weekStart, at);
        let id: number;
        if (row) {
          id = row.id as number;
          db.prepare("UPDATE week_features SET title = ?, item_type = ?, url = ?, level = ?, updated_at = ? WHERE id = ?").run(f.title, f.itemType, f.url, f.level, at, id);
          if (f.blocks !== undefined) db.prepare("UPDATE week_features SET blocks = ? WHERE id = ?").run(f.blocks, id);
          if (f.tier && f.tier !== row.tier) db.prepare("UPDATE week_features SET tier = ?, position = NULL WHERE id = ?").run(f.tier, id);
        } else {
          id = Number(
            db
              .prepare("INSERT INTO week_features (week_start, client_key, item_id, level, tier, title, item_type, url, blocks, position, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)")
              .run(f.weekStart, f.clientKey, f.itemId, f.level, f.tier ?? "must", f.title, f.itemType, f.url, f.blocks ?? DEFAULT_BLOCKS[f.level], at, at).lastInsertRowid,
          );
        }
        return this.weekPlan(f.weekStart).features.find((x) => x.id === id)!;
      });
    },
    /** Must or nice to have; changing tier puts it back in DevOps order within the new tier. */
    setWeekItemTier(id: number, tier: "must" | "nice"): WeekFeature {
      const w = weekItemChange(id, (at) => db.prepare("UPDATE week_features SET tier = ?, position = CASE WHEN tier = ? THEN position ELSE NULL END, updated_at = ? WHERE id = ?").run(tier, tier, at, id));
      return this.weekPlan(w).features.find((x) => x.id === id)!;
    },
    setWeekItemBlocks(id: number, blocks: number): WeekFeature {
      if (!validBlocks(blocks)) throw new PlanError(`blocks must be 0.5 to ${MAX_FEATURE_BLOCKS} in half steps`);
      const w = weekItemChange(id, (at) => db.prepare("UPDATE week_features SET blocks = ?, updated_at = ? WHERE id = ?").run(blocks, at, id));
      return this.weekPlan(w).features.find((x) => x.id === id)!;
    },
    /** A local done mark (on) or taking it back (off). */
    markWeekItemDone(id: number, on: boolean): WeekFeature {
      const w = weekItemChange(id, (at) => db.prepare("UPDATE week_features SET done_at = ?, updated_at = ? WHERE id = ?").run(on ? at : null, at, id));
      return this.weekPlan(w).features.find((x) => x.id === id)!;
    },
    /**
     * A local order for one client's tier: positions 1..n for the items given (the rest of the tier follows in DevOps
     * order). `null` resets the client's whole list (both tiers) to DevOps order. Never written back to DevOps.
     */
    reorderWeekItems(weekStart: IsoDate, clientKey: string, tier: "must" | "nice", order: readonly { itemId: number; position: number }[] | null): WeekPlanRecord {
      tx(() => {
        const at = stamp();
        if (order === null) db.prepare("UPDATE week_features SET position = NULL, updated_at = ? WHERE week_start = ? AND client_key = ? AND position IS NOT NULL").run(at, weekStart, clientKey);
        else
          for (const o of order) {
            if (!Number.isInteger(o.position) || o.position < 1) throw new PlanError("position must be a whole number from 1");
            const r = db.prepare("UPDATE week_features SET position = ?, updated_at = ? WHERE week_start = ? AND client_key = ? AND tier = ? AND item_id = ?").run(o.position, at, weekStart, clientKey, tier, o.itemId);
            if (Number(r.changes) !== 1) throw new PlanError(`#${o.itemId} isn't a ${tier === "must" ? "must" : "nice to have"} on this client's week`);
          }
        touchWeek(weekStart, at);
      });
      return this.weekPlan(weekStart);
    },
    /** Take an item off the week list (its pins go with it). */
    removeWeekItem(id: number): void {
      tx(() => {
        const r = db.prepare("SELECT week_start FROM week_features WHERE id = ?").get(id) as Row | undefined;
        if (!r) throw new PlanError("No such item on the week plan");
        db.prepare("DELETE FROM week_features WHERE id = ?").run(id);
        touchWeek(r.week_start as string, stamp());
      });
    },
    weekItem(id: number): WeekFeature | null {
      const r = db.prepare("SELECT week_start FROM week_features WHERE id = ?").get(id) as Row | undefined;
      return r ? (this.weekPlan(r.week_start as string).features.find((x) => x.id === id) ?? null) : null;
    },
    /** Pin a week item to a block of its week (on) or unpin it (off). Pins don't change its blocks (step 11). */
    placeFeature(featureId: number, date: IsoDate, half: "AM" | "PM", on: boolean): WeekFeature {
      return tx(() => {
        const r = db.prepare("SELECT * FROM week_features WHERE id = ?").get(featureId) as Row | undefined;
        if (!r) throw new PlanError("No such feature on the week plan");
        const week = r.week_start as string;
        const offset = Temporal.PlainDate.from(week).until(Temporal.PlainDate.from(date)).days;
        if (offset < 0 || offset > 6) throw new PlanError("That block isn't in the feature's week");
        const at = stamp();
        if (on) db.prepare("INSERT INTO week_feature_slots (feature_id, date, half) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(featureId, date, half);
        else db.prepare("DELETE FROM week_feature_slots WHERE feature_id = ? AND date = ? AND half = ?").run(featureId, date, half);
        db.prepare("UPDATE week_features SET updated_at = ? WHERE id = ?").run(at, featureId);
        touchWeek(week, at);
        return this.weekPlan(week).features.find((x) => x.id === featureId)!;
      });
    },
    commitWeek(weekStart: IsoDate): WeekPlanRecord {
      tx(() => {
        const at = stamp();
        touchWeek(weekStart, at);
        db.prepare("UPDATE week_plans SET committed_at = ?, updated_at = ? WHERE week_start = ?").run(at, at, weekStart);
      });
      return this.weekPlan(weekStart);
    },
    /** Committed features per week for these weeks (the week view and Plan the day). */
    weekFeaturesFor(weekStarts: readonly IsoDate[]): WeekFeature[] {
      return [...new Set(weekStarts)].flatMap((w) => this.weekPlan(w).features);
    },
    markBreakdown(clientKey: string, itemId: number, on: boolean): void {
      if (on) db.prepare("INSERT INTO breakdown_marks (client_key, item_id, marked_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(clientKey, itemId, stamp());
      else db.prepare("DELETE FROM breakdown_marks WHERE client_key = ? AND item_id = ?").run(clientKey, itemId);
    },
    breakdownMarks: (): { clientKey: string; itemId: number; markedAt: ZonedStamp }[] =>
      (db.prepare("SELECT * FROM breakdown_marks ORDER BY marked_at, client_key, item_id").all() as Row[]).map((r) => ({ clientKey: r.client_key as string, itemId: r.item_id as number, markedAt: r.marked_at as string })),
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
        resumeNotes: (db.prepare("SELECT * FROM resume_notes ORDER BY date, client_key").all() as Row[]).map(toNote),
        borrowed: (db.prepare("SELECT * FROM borrowed ORDER BY id").all() as Row[]).map(toBorrowed),
        weekPlans: db.prepare("SELECT * FROM week_plans ORDER BY week_start").all() as Row[],
        weekFeatures: (db.prepare("SELECT DISTINCT week_start FROM week_features ORDER BY week_start").all() as Row[]).flatMap((r) => this.weekPlan(r.week_start as string).features),
        breakdownMarks: this.breakdownMarks(),
        captures: (db.prepare("SELECT * FROM captures ORDER BY id").all() as Row[]).map(toCapture),
        notes: (db.prepare("SELECT * FROM notes ORDER BY id").all() as Row[]).map(toNoteRow),
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
    // A table rebuild (SQLite's documented procedure): foreign keys off around it, then checked before commit.
    const rebuild = MIGRATIONS[v - 1]!.trimStart().startsWith(FK_OFF);
    if (rebuild) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v - 1]!);
      if (rebuild && db.prepare("PRAGMA foreign_key_check").all().length) throw new Error(`Plan store migration ${v} would break references; not applied`);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v, now().toString({ smallestUnit: "second" }));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      if (rebuild) db.exec("PRAGMA foreign_keys = ON");
    }
  }
}
