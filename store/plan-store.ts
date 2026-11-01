// Local plan store (D23): SQLite through Node's built-in node:sqlite, under ~/.local/share/coopilot/.
// Holds only Coopilot's own plan (day plans, picks, draft stories) and a few one-time markers.
// Nothing here is ever written to DevOps, Outlook, Google or Dataverse.
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { carryOver } from "../plan/rules.ts";
import { DEFAULT_BLOCKS, validBlocks, type ItemLevel, type Tier } from "../plan/weeklist.ts";
import type { Capture, DayPlan, DraftStory, Pick, PickKind, PlanWeek, Size, ZonedStamp } from "../plan/types.ts";
import type { FlexSession, Half, IsoDate, Unavailable } from "../week/types.ts";
import type { Attendee, Fields, LocalState, OwnEvent, SyncOp, Timebox, WriteEntry, WriteKind, WriteStatus } from "../plan/timebox.ts";
export type { WriteEntry, WriteStatus } from "../plan/timebox.ts";

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
  // 9 (step 12): timeboxes (local, optionally on Outlook), the Outlook events Coopilot created (by marker uid, with the
  // event id and the fields last confirmed), and the audit log of every external write with its prior values.
  `CREATE TABLE timeboxes (
     id INTEGER PRIMARY KEY,
     uid TEXT NOT NULL UNIQUE,
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     client_key TEXT NOT NULL,
     pick_id INTEGER REFERENCES picks(id) ON DELETE SET NULL,
     item_id INTEGER,
     title TEXT NOT NULL,
     url TEXT,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     outlook INTEGER NOT NULL DEFAULT 0 CHECK (outlook IN (0, 1)),
     removed_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX timeboxes_date ON timeboxes (date);
   CREATE TABLE outlook_events (
     uid TEXT PRIMARY KEY,
     timebox_id INTEGER,
     event_id TEXT NOT NULL,
     fields TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT
   );
   CREATE TABLE write_log (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     system TEXT NOT NULL CHECK (system IN ('outlook')),
     op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
     uid TEXT NOT NULL,
     event_id TEXT,
     account TEXT,
     calendar TEXT,
     before TEXT,
     after TEXT,
     local_before TEXT,
     local_after TEXT,
     status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unconfirmed', 'failed', 'refused')),
     message TEXT,
     auto INTEGER NOT NULL DEFAULT 0,
     undo_of INTEGER REFERENCES write_log(id),
     undone_by INTEGER REFERENCES write_log(id),
     attempts INTEGER NOT NULL DEFAULT 1,
     updated_at TEXT NOT NULL
   );`,
  // 10 (step 13): a timebox's show as, a note when it followed a change made in Outlook, and a conflict when both
  // sides changed; what each write was for (timebox, my own event, a help invite, a sync from Outlook); help invites.
  `ALTER TABLE timeboxes ADD COLUMN show_as TEXT NOT NULL DEFAULT 'busy' CHECK (show_as IN ('busy', 'tentative', 'free', 'oof', 'workingElsewhere'));
   ALTER TABLE timeboxes ADD COLUMN outlook_note TEXT;
   ALTER TABLE timeboxes ADD COLUMN conflict TEXT;
   ALTER TABLE write_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'timebox' CHECK (kind IN ('timebox', 'event', 'invite', 'sync'));
   CREATE TABLE invites (
     id INTEGER PRIMARY KEY,
     uid TEXT NOT NULL UNIQUE,
     client_key TEXT NOT NULL,
     item_id INTEGER,
     pick_id INTEGER,
     timebox_id INTEGER,
     title TEXT NOT NULL,
     url TEXT,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     attendees TEXT NOT NULL,
     teams INTEGER NOT NULL CHECK (teams IN (0, 1)),
     note TEXT,
     event_id TEXT,
     status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'cancelled')),
     loop_id INTEGER,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX invites_start ON invites (start_at);`,
  // 11 (step 13.5): loops become follow-ups, with how they ended (closed the loop or not needed), how I told them,
  // a snooze, and where a rule's follow-up came from. Notes are removed: each note with a client joins that client's
  // "where I left off" history on its day (appended when that day already has one); a note with no client goes back
  // to the inbox as an unsorted capture (its own capture, un-sorted, when it came from one). Captures sort into follow-ups, draft stories and draft features. Draft
  // stories gain a level: a draft feature sits under an epic the way a draft story sits under a feature.
  `${FK_OFF}
   ALTER TABLE loops RENAME TO follow_ups;
   DROP INDEX loops_rule;
   CREATE UNIQUE INDEX follow_ups_rule ON follow_ups(rule_key);
   ALTER TABLE follow_ups ADD COLUMN outcome TEXT CHECK (outcome IN ('done', 'not_needed'));
   ALTER TABLE follow_ups ADD COLUMN close_how TEXT CHECK (close_how IN ('teams', 'email', 'devops', 'call'));
   ALTER TABLE follow_ups ADD COLUMN snoozed_until TEXT CHECK (snoozed_until IS NULL OR snoozed_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
   ALTER TABLE follow_ups ADD COLUMN origin TEXT;
   UPDATE follow_ups SET outcome = 'done' WHERE closed_at IS NOT NULL;
   ALTER TABLE invites RENAME COLUMN loop_id TO follow_up_id;
   INSERT INTO resume_notes (client_key, date, note, created_at, updated_at)
     SELECT client_key, substr(created_at, 1, 10), text, created_at, updated_at FROM notes WHERE client_key IS NOT NULL ORDER BY id
     ON CONFLICT(client_key, date) DO UPDATE SET note = resume_notes.note || ' · ' || excluded.note, updated_at = excluded.updated_at;
   CREATE TABLE captures_v11 (
     id INTEGER PRIMARY KEY,
     text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
     client_key TEXT,
     created_at TEXT NOT NULL,
     routed_at TEXT,
     routed_as TEXT CHECK (routed_as IN ('follow_up', 'draft', 'draft_feature', 'left_off', 'dismissed')),
     routed_id INTEGER,
     CHECK ((routed_at IS NULL) = (routed_as IS NULL))
   );
   INSERT INTO captures_v11 SELECT id, text, client_key, created_at, routed_at,
     CASE routed_as WHEN 'loop' THEN 'follow_up' WHEN 'note' THEN 'left_off' ELSE routed_as END, routed_id FROM captures ORDER BY id;
   UPDATE captures_v11 SET routed_at = NULL, routed_as = NULL, routed_id = NULL
     WHERE id IN (SELECT capture_id FROM notes WHERE client_key IS NULL AND capture_id IS NOT NULL);
   INSERT INTO captures_v11 (text, client_key, created_at) SELECT substr(text, 1, 1000), NULL, created_at FROM notes WHERE client_key IS NULL AND capture_id IS NULL ORDER BY id;
   DROP TABLE notes;
   DROP TABLE captures;
   ALTER TABLE captures_v11 RENAME TO captures;
   ALTER TABLE draft_stories ADD COLUMN level TEXT NOT NULL DEFAULT 'story' CHECK (level IN ('story', 'feature'));`,
  // 12 (step 13.5): a follow-up picked into a block is an intention pick tied to its follow-up (size S by default).
  `ALTER TABLE picks ADD COLUMN follow_up_id INTEGER REFERENCES follow_ups(id);`,
];

/** The tables "Reset local plan" empties (Q37). Markers (reminder and auto-open once a day) are kept. */
const RESET_TABLES = ["timeboxes", "captures", "week_feature_slots", "week_features", "week_plans", "breakdown_marks", "borrowed", "resume_notes", "focus_log", "kv", "follow_ups", "flex_sessions", "unavailable", "picks", "draft_stories", "day_plans"] as const;
export type FocusSegment = { pickId: number | null; label: string; startedAt: string; endedAt: string; seconds: number };

export type NewUnavailable = { date: IsoDate; title: string; start: string; end: string; note?: string | null };
export type NewFlex = { date: IsoDate; clientKey: string; start: string; end: string; itemId?: number | null; itemTitle?: string | null; itemUrl?: string | null; note?: string | null };
/** Something owed to someone (D92). Opened by a rule (step 7, plan/followups.ts), a flex session or by hand. */
export type FollowUp = {
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
  /** One follow-up per rule and thing ("devops_update:<pick>", "slip:<client>:<date>:<n>", "blocked:<client>:<item>"). */
  ruleKey: string | null;
  /** What a later DevOps change is compared with (when the pick was ticked done). */
  refAt: string | null;
  /** A copyable plain-text heads-up (slip follow-ups). */
  draft: string | null;
  /** Rule details: the pick ids a slip follow-up covers. */
  detail: { picks?: number[] } | null;
  openedAt: string;
  closedAt: string | null;
  closeNote: string | null;
  /** "me" (by hand) or "signal" (a DevOps change proved it). */
  closedBy: "me" | "signal" | null;
  /** Step 13.5: how it ended (closed the loop, or not needed), how I told them, a snooze, and a rule's origin. */
  outcome: "done" | "not_needed" | null;
  closeHow: CloseHow | null;
  snoozedUntil: IsoDate | null;
  origin: FollowUpOrigin | null;
  /** Added by me (by hand or from a capture): only these can be deleted. */
  byHand: boolean;
};
import { CLOSE_HOW, type CloseHow, type FollowUpOrigin } from "../plan/types.ts";
export { CLOSE_HOW, type CloseHow, type FollowUpOrigin };
export type FollowUpFields = { clientKey: string | null; who: string | null; what: string; channel: string | null; due: IsoDate | null };
export type NewRuleFollowUp = { kind: string; ruleKey: string; clientKey: string | null; who: string; what: string; itemId?: number | null; refAt?: string | null; draft?: string | null; detail?: { picks?: number[] } | null; origin?: FollowUpOrigin | null };
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
  /** Step 13.5: a follow-up picked into a block (an intention pick tied to it). */
  followUpId?: number | null;
};

type Row = Record<string, string | number | null>;

const toTimebox = (r: Row): Timebox => ({
  id: r.id as number, uid: r.uid as string, date: r.date as string, clientKey: r.client_key as string, pickId: (r.pick_id as number | null) ?? null, itemId: (r.item_id as number | null) ?? null,
  title: r.title as string, url: (r.url as string | null) ?? null, start: r.start_at as string, end: r.end_at as string, outlook: r.outlook === 1,
  showAs: ((r.show_as as string | null) ?? "busy") as Timebox["showAs"], outlookNote: (r.outlook_note as string | null) ?? null, conflict: json<Timebox["conflict"]>(r.conflict),
  removedAt: (r.removed_at as string | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});
/** A help invite Coopilot sent (step 13). Attendees are Cooptimize staff (name and work email). */
export type Invite = { id: number; uid: string; clientKey: string; itemId: number | null; pickId: number | null; timeboxId: number | null; title: string; url: string | null; start: string; end: string; attendees: Attendee[]; teams: boolean; note: string | null; eventId: string | null; status: "pending" | "sent" | "cancelled"; followUpId: number | null; createdAt: string; updatedAt: string };
const toInvite = (r: Row): Invite => ({
  id: r.id as number, uid: r.uid as string, clientKey: r.client_key as string, itemId: (r.item_id as number | null) ?? null, pickId: (r.pick_id as number | null) ?? null, timeboxId: (r.timebox_id as number | null) ?? null,
  title: r.title as string, url: (r.url as string | null) ?? null, start: r.start_at as string, end: r.end_at as string, attendees: json<Attendee[]>(r.attendees) ?? [], teams: r.teams === 1, note: (r.note as string | null) ?? null,
  eventId: (r.event_id as string | null) ?? null, status: r.status as Invite["status"], followUpId: (r.follow_up_id as number | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});
const json = <T>(v: unknown): T | null => (typeof v === "string" ? (JSON.parse(v) as T) : null);
const toOwn = (r: Row): OwnEvent => ({ uid: r.uid as string, timeboxId: (r.timebox_id as number | null) ?? null, eventId: r.event_id as string, fields: json<Fields>(r.fields)!, deletedAt: (r.deleted_at as string | null) ?? null });
const toWrite = (r: Row): WriteEntry => ({
  id: r.id as number, at: r.at as string, system: "outlook", op: r.op as SyncOp, kind: ((r.kind as string | null) ?? "timebox") as WriteKind, uid: r.uid as string, eventId: (r.event_id as string | null) ?? null,
  account: (r.account as string | null) ?? null, calendar: (r.calendar as string | null) ?? null, before: json<Fields>(r.before), after: json<Fields>(r.after),
  localBefore: json<LocalState>(r.local_before), localAfter: json<LocalState>(r.local_after), status: r.status as WriteStatus, message: (r.message as string | null) ?? null,
  auto: r.auto === 1, undoOf: (r.undo_of as number | null) ?? null, undoneBy: (r.undone_by as number | null) ?? null, attempts: r.attempts as number, updatedAt: r.updated_at as string,
});
export type NewTimebox = { date: IsoDate; clientKey: string; pickId?: number | null; itemId?: number | null; title: string; url?: string | null; start: string; end: string; outlook: boolean; showAs?: Timebox["showAs"]; uid?: string };
export type NewWrite = { op: SyncOp; kind?: WriteKind; status?: WriteStatus; message?: string | null; uid: string; eventId: string | null; account: string | null; calendar: string | null; before: Fields | null; after: Fields | null; localBefore: LocalState | null; localAfter: LocalState | null; auto: boolean; undoOf?: number | null };

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
  followUpId: (r.follow_up_id as number | null) ?? null,
  position: r.position as number,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});
const toPlan = (r: Row): DayPlan => ({ date: r.date as string, committedAt: (r.committed_at as string | null) ?? null, closedOutAt: (r.closed_out_at as string | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string });
const toDraft = (r: Row): DraftStory => ({ id: r.id as number, clientKey: r.client_key as string, parentItemId: (r.parent_item_id as number | null) ?? null, title: r.title as string, size: r.size as Size, level: ((r.level as string | null) ?? "story") as DraftStory["level"], createdAt: r.created_at as string });

const toCapture = (r: Row): Capture => ({
  id: r.id as number,
  text: r.text as string,
  clientKey: (r.client_key as string | null) ?? null,
  createdAt: r.created_at as string,
  routedAt: (r.routed_at as string | null) ?? null,
  routedAs: (r.routed_as as Capture["routedAs"]) ?? null,
  routedId: (r.routed_id as number | null) ?? null,
});

/** How a capture is sorted (step 9). */
export type CaptureRoute =
  | { as: "follow_up"; clientKey: string | null; who: string; what: string; due: IsoDate | null; channel?: string | null }
  | { as: "draft"; clientKey: string; parentItemId: number | null; title: string; size: Size }
  | { as: "draft_feature"; clientKey: string; parentItemId: number | null; title: string }
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
const toFollowUp = (r: Row): FollowUp => ({
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
  detail: r.detail ? (JSON.parse(r.detail as string) as FollowUp["detail"]) : null,
  openedAt: r.opened_at as string,
  closedAt: (r.closed_at as string | null) ?? null,
  closeNote: (r.close_note as string | null) ?? null,
  closedBy: (r.closed_by as FollowUp["closedBy"]) ?? null,
  outcome: (r.outcome as FollowUp["outcome"]) ?? null,
  closeHow: (r.close_how as CloseHow | null) ?? null,
  snoozedUntil: (r.snoozed_until as string | null) ?? null,
  origin: r.origin ? (JSON.parse(r.origin as string) as FollowUpOrigin) : null,
  byHand: r.kind === "manual" || r.kind === "capture",
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
        `INSERT INTO picks (date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at, follow_up_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, NULL, ?, ?, ?, ?)`,
      )
      .run(p.date, p.half, p.clientKey, p.kind, p.itemId ?? null, p.draftId ?? null, p.title, p.itemType ?? null, p.itemUrl ?? null, p.size, carriedFrom, nextPosition(p.date, p.half), at, at, p.followUpId ?? null);
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
        if (p.followUpId !== null) base.followUpId = p.followUpId;
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
        // Step 13.5: ticking a follow-up pick done closes the loop.
        const fu = (db.prepare("SELECT follow_up_id FROM picks WHERE id = ?").get(id) as Row).follow_up_id as number | null;
        if (done && fu !== null) db.prepare("UPDATE follow_ups SET closed_at = ?, closed_by = 'me', outcome = 'done', close_note = COALESCE(close_note, 'Done as a pick'), snoozed_until = NULL WHERE id = ? AND closed_at IS NULL").run(stamp(), fu);
        return mustPick(id);
      });
    },
    addDraft(d: { clientKey: string; parentItemId: number | null; title: string; size: Size; level?: "story" | "feature" }): DraftStory {
      return tx(() => {
        const at = stamp();
        const r = db.prepare("INSERT INTO draft_stories (client_key, parent_item_id, title, size, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(d.clientKey, d.parentItemId, d.title, d.size, d.level ?? "story", at, at);
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
    /** Removes a flex session that hasn't ended; an ended one has opened its follow-up and stays. */
    removeFlex(id: number): boolean {
      return tx(() => {
        if (db.prepare("SELECT 1 FROM follow_ups WHERE source_kind = 'flex' AND source_id = ?").get(id)) throw new PlanError("This flex session has ended and opened its update follow-up; it stays");
        return Number(db.prepare("DELETE FROM flex_sessions WHERE id = ?").run(id).changes) === 1;
      });
    },
    /**
     * After a flex session ends, a "post the update to <client>" follow-up opens once (D126). Called on reads; returns
     * the follow-ups it opened. The follow-ups UI comes later; the rows are kept until then.
     */
    openFlexFollowUps(now: Temporal.Instant): FollowUp[] {
      return tx(() => {
        const rows = db.prepare("SELECT f.* FROM flex_sessions f LEFT JOIN follow_ups l ON l.source_kind = 'flex' AND l.source_id = f.id WHERE l.id IS NULL").all() as Row[];
        const opened: FollowUp[] = [];
        for (const f of rows.map(toFlex)) {
          if (Temporal.Instant.compare(Temporal.Instant.from(f.end), now) > 0) continue;
          const what = `Post the update to ${f.clientKey}${f.itemTitle ? ` on ${f.itemTitle}` : ""} after the flex session`;
          const r = db.prepare("INSERT INTO follow_ups (kind, client_key, what, source_kind, source_id, opened_at) VALUES ('flex_update', ?, ?, 'flex', ?, ?)").run(f.clientKey, what, f.id, stamp());
          opened.push(toFollowUp(db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(Number(r.lastInsertRowid)) as Row));
        }
        return opened;
      });
    },
    openFollowUps: (): FollowUp[] => (db.prepare("SELECT * FROM follow_ups WHERE closed_at IS NULL ORDER BY opened_at, id").all() as Row[]).map(toFollowUp),
    /** Every follow-up, open first (step 6c follow-ups list). */
    allFollowUps: (): FollowUp[] => (db.prepare("SELECT * FROM follow_ups ORDER BY closed_at IS NOT NULL, opened_at, id").all() as Row[]).map(toFollowUp),
    /**
     * Closes an open follow-up: "Close the loop" by hand (optional how and note), by a signal with its reason, or
     * "Not needed" (closed quietly, not counted as done).
     */
    closeFollowUp(id: number, note: string | null, by: "me" | "signal" = "me", o: { how?: CloseHow | null; outcome?: "done" | "not_needed" } = {}): FollowUp {
      return tx(() => {
        const r = db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as Row | undefined;
        if (!r) throw new PlanError(`No follow-up ${id}`);
        if (r.closed_at) throw new PlanError("That follow-up is already closed");
        db.prepare("UPDATE follow_ups SET closed_at = ?, close_note = ?, closed_by = ?, outcome = ?, close_how = ?, snoozed_until = NULL WHERE id = ?").run(stamp(), note, by, o.outcome ?? "done", o.how ?? null, id);
        return toFollowUp(db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as Row);
      });
    },
    /** Hidden from lists until that day (null wakes it now). */
    snoozeFollowUp(id: number, until: IsoDate | null): FollowUp {
      const r = db.prepare("UPDATE follow_ups SET snoozed_until = ? WHERE id = ? AND closed_at IS NULL").run(until, id);
      if (!Number(r.changes)) throw new PlanError(db.prepare("SELECT 1 FROM follow_ups WHERE id = ?").get(id) ? "That follow-up is already closed" : `No follow-up ${id}`);
      return toFollowUp(db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as Row);
    },
    /** Only follow-ups I added (by hand or from a capture); a rule's follow-up is closed as Not needed instead. */
    deleteFollowUp(id: number): void {
      tx(() => {
        const r = db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as Row | undefined;
        if (!r) throw new PlanError(`No follow-up ${id}`);
        if (!toFollowUp(r).byHand) throw new PlanError("Coopilot opened this one; use Not needed instead");
        db.prepare("UPDATE picks SET follow_up_id = NULL WHERE follow_up_id = ?").run(id);
        db.prepare("UPDATE captures SET routed_id = NULL WHERE routed_as = 'follow_up' AND routed_id = ?").run(id);
        db.prepare("DELETE FROM follow_ups WHERE id = ?").run(id);
      });
    },
    /** Edits client, who, what, channel and due of an open follow-up. */
    editFollowUp(id: number, patch: Partial<FollowUpFields>): FollowUp {
      return tx(() => {
        const r = db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as Row | undefined;
        if (!r) throw new PlanError(`No follow-up ${id}`);
        const f = toFollowUp(r);
        if (f.closedAt) throw new PlanError("That follow-up is already closed");
        const n = { clientKey: f.clientKey, who: f.who, what: f.what, channel: f.channel, due: f.due, ...patch };
        if (!n.what.trim()) throw new PlanError("Say what you owe");
        db.prepare("UPDATE follow_ups SET client_key = ?, who = ?, what = ?, channel = ?, due = ? WHERE id = ?").run(n.clientKey, n.who, n.what, n.channel, n.due, id);
        return toFollowUp(db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as Row);
      });
    },
    getFollowUp(id: number): FollowUp | null {
      const r = db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as Row | undefined;
      return r ? toFollowUp(r) : null;
    },
    /** Opens a rule's follow-up once per rule key (step 7). Null when that key already has a follow-up, open or closed. */
    openRuleFollowUp(l: NewRuleFollowUp): FollowUp | null {
      const r = db
        .prepare("INSERT INTO follow_ups (kind, client_key, who, what, item_id, rule_key, ref_at, draft, detail, origin, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(rule_key) DO NOTHING")
        .run(l.kind, l.clientKey, l.who, l.what, l.itemId ?? null, l.ruleKey, l.refAt ?? null, l.draft ?? null, l.detail ? JSON.stringify(l.detail) : null, l.origin ? JSON.stringify(l.origin) : null, stamp());
      return Number(r.changes) === 1 ? toFollowUp(db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(Number(r.lastInsertRowid)) as Row) : null;
    },
    /** A slip follow-up that is still open takes more slipped picks: its draft and the picks it covers. */
    updateFollowUpDraft(id: number, what: string, draft: string, detail: { picks: number[] }, origin?: FollowUpOrigin | null): void {
      db.prepare("UPDATE follow_ups SET what = ?, draft = ?, detail = ?, origin = COALESCE(?, origin) WHERE id = ? AND closed_at IS NULL").run(what, draft, JSON.stringify(detail), origin ? JSON.stringify(origin) : null, id);
    },
    /** A follow-up added by hand: who, what, optional due date. */
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
    /** Routes a capture once: makes the follow-up, draft story or note and marks the capture, in one transaction. */
    routeCapture(id: number, r: CaptureRoute): Capture {
      return tx(() => {
        const c = db.prepare("SELECT * FROM captures WHERE id = ?").get(id) as Row | undefined;
        if (!c) throw new PlanError("No such capture");
        if (c.routed_at) throw new PlanError("That capture is already sorted");
        const at = stamp();
        let routedId: number | null = null;
        if (r.as === "follow_up") {
          if (!r.what.trim()) throw new PlanError("A follow-up needs what you owe");
          routedId = Number(db.prepare("INSERT INTO follow_ups (kind, client_key, who, what, due, channel, opened_at) VALUES ('capture', ?, ?, ?, ?, ?, ?)").run(r.clientKey, r.who.trim() || null, r.what.trim(), r.due, r.channel ?? null, at).lastInsertRowid);
        } else if (r.as === "draft") {
          if (!r.title.trim()) throw new PlanError("A draft story needs a title");
          routedId = Number(db.prepare("INSERT INTO draft_stories (client_key, parent_item_id, title, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(r.clientKey, r.parentItemId, r.title.trim(), r.size, at, at).lastInsertRowid);
        } else if (r.as === "draft_feature") {
          if (!r.title.trim()) throw new PlanError("A draft feature needs a title");
          routedId = Number(db.prepare("INSERT INTO draft_stories (client_key, parent_item_id, title, size, level, created_at, updated_at) VALUES (?, ?, ?, 'M', 'feature', ?, ?)").run(r.clientKey, r.parentItemId, r.title.trim(), at, at).lastInsertRowid);
        }
        db.prepare("UPDATE captures SET routed_at = ?, routed_as = ?, routed_id = ? WHERE id = ?").run(at, r.as, routedId, id);
        return toCapture(db.prepare("SELECT * FROM captures WHERE id = ?").get(id) as Row);
      });
    },
    addFollowUp(l: { who: string | null; what: string; due: IsoDate | null; clientKey?: string | null; channel?: string | null }): FollowUp {
      const r = db.prepare("INSERT INTO follow_ups (kind, client_key, who, what, due, channel, opened_at) VALUES ('manual', ?, ?, ?, ?, ?, ?)").run(l.clientKey ?? null, l.who || null, l.what, l.due, l.channel ?? null, stamp());
      return toFollowUp(db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
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
          if (p.followUpId !== null) base.followUpId = p.followUpId;
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
        // Coopilot's Outlook events and the audit log stay: they are what lets it find, undo and remove its own events.
        db.exec("UPDATE outlook_events SET timebox_id = NULL");
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
    // ---- Timeboxes and Outlook writes (step 12) ----
    timebox(id: number): Timebox | null {
      const r = db.prepare("SELECT * FROM timeboxes WHERE id = ?").get(id) as Row | undefined;
      return r ? toTimebox(r) : null;
    },
    timeboxByUid(uid: string): Timebox | null {
      const r = db.prepare("SELECT * FROM timeboxes WHERE uid = ?").get(uid) as Row | undefined;
      return r ? toTimebox(r) : null;
    },
    /** Timeboxes on these dates, including removed ones whose Outlook event is still to be taken off. */
    timeboxesBetween(from: IsoDate, to: IsoDate): Timebox[] {
      return (db.prepare("SELECT * FROM timeboxes WHERE date >= ? AND date <= ? ORDER BY date, start_at, id").all(from, to) as Row[]).map(toTimebox);
    },
    addTimebox(t: NewTimebox): Timebox {
      const at = stamp();
      const uid = t.uid ?? `tb-${crypto.randomUUID()}`;
      const r = db
        .prepare("INSERT INTO timeboxes (uid, date, client_key, pick_id, item_id, title, url, start_at, end_at, outlook, show_as, removed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)")
        .run(uid, t.date, t.clientKey, t.pickId ?? null, t.itemId ?? null, t.title, t.url ?? null, t.start, t.end, t.outlook ? 1 : 0, t.showAs ?? "busy", at, at);
      return this.timebox(Number(r.lastInsertRowid))!;
    },
    /** Step 13.6 (D246): several timeboxes in one transaction (Timebox my day); none if one fails. */
    addTimeboxes(list: readonly NewTimebox[]): Timebox[] {
      return tx(() => list.map((t) => this.addTimebox(t)));
    },
    /** Move, resize, retitle, show as, toggle Outlook, put back (removedAt null), or a sync note and conflict (step 13). */
    updateTimebox(id: number, patch: { start?: string; end?: string; date?: IsoDate; title?: string; showAs?: Timebox["showAs"]; outlook?: boolean; removedAt?: string | null; outlookNote?: string | null; conflict?: Timebox["conflict"]; pickId?: number | null }): Timebox {
      const t = this.timebox(id);
      if (!t) throw new PlanError("No such timebox");
      const n = { ...t, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Timebox;
      db.prepare("UPDATE timeboxes SET date = ?, start_at = ?, end_at = ?, title = ?, show_as = ?, outlook = ?, removed_at = ?, outlook_note = ?, conflict = ?, pick_id = ?, updated_at = ? WHERE id = ?").run(
        n.date, n.start, n.end, n.title, n.showAs, n.outlook ? 1 : 0, n.removedAt, n.outlookNote, n.conflict ? JSON.stringify(n.conflict) : null, n.pickId, stamp(), id,
      );
      return this.timebox(id)!;
    },
    /** Remove: kept as removed while its Outlook event still exists (so it can be taken off and undone), else deleted. */
    removeTimebox(id: number): { kept: boolean } {
      const t = this.timebox(id);
      if (!t) throw new PlanError("No such timebox");
      const own = this.ownEvent(t.uid);
      if (own && !own.deletedAt) {
        this.updateTimebox(id, { removedAt: stamp() });
        return { kept: true };
      }
      db.prepare("DELETE FROM timeboxes WHERE id = ?").run(id);
      return { kept: false };
    },
    ownEvent(uid: string): OwnEvent | null {
      const r = db.prepare("SELECT * FROM outlook_events WHERE uid = ?").get(uid) as Row | undefined;
      return r ? toOwn(r) : null;
    },
    /** Every Outlook event Coopilot created and hasn't deleted. */
    ownEvents(): OwnEvent[] {
      return (db.prepare("SELECT * FROM outlook_events WHERE deleted_at IS NULL ORDER BY created_at, uid").all() as Row[]).map(toOwn);
    },
    /** Record a confirmed create or update: the event id and the fields now on Outlook. */
    recordOwnEvent(uid: string, timeboxId: number | null, eventId: string, fields: Fields): void {
      const at = stamp();
      db.prepare(
        `INSERT INTO outlook_events (uid, timebox_id, event_id, fields, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(uid) DO UPDATE SET timebox_id = excluded.timebox_id, event_id = excluded.event_id, fields = excluded.fields, updated_at = excluded.updated_at, deleted_at = NULL`,
      ).run(uid, timeboxId, eventId, JSON.stringify(fields), at, at);
    },
    /** A confirmed delete. A removed timebox stays (as removed) so undo can put it back. */
    markOwnDeleted(uid: string): void {
      const at = stamp();
      db.prepare("UPDATE outlook_events SET deleted_at = ?, updated_at = ? WHERE uid = ?").run(at, at, uid);
    },
    logWrite(w: NewWrite): WriteEntry {
      const at = stamp();
      const r = db
        .prepare(
          `INSERT INTO write_log (at, system, op, kind, uid, event_id, account, calendar, before, after, local_before, local_after, status, message, auto, undo_of, undone_by, attempts, updated_at)
           VALUES (?, 'outlook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`,
        )
        .run(at, w.op, w.kind ?? "timebox", w.uid, w.eventId, w.account, w.calendar, w.before ? JSON.stringify(w.before) : null, w.after ? JSON.stringify(w.after) : null, w.localBefore ? JSON.stringify(w.localBefore) : null, w.localAfter ? JSON.stringify(w.localAfter) : null, w.status ?? "pending", w.message ?? null, w.auto ? 1 : 0, w.undoOf ?? null, at);
      return this.writeEntry(Number(r.lastInsertRowid))!;
    },
    writeEntry(id: number): WriteEntry | null {
      const r = db.prepare("SELECT * FROM write_log WHERE id = ?").get(id) as Row | undefined;
      return r ? toWrite(r) : null;
    },
    /** The result of an attempt (a retry adds one to attempts). */
    settleWrite(id: number, s: { status: WriteStatus; message?: string | null; eventId?: string | null; before?: Fields | null; retry?: boolean }): WriteEntry {
      const w = this.writeEntry(id);
      if (!w) throw new PlanError("No such write");
      db.prepare("UPDATE write_log SET status = ?, message = ?, event_id = ?, before = ?, attempts = attempts + ?, updated_at = ? WHERE id = ?").run(
        s.status, s.message ?? null, s.eventId === undefined ? w.eventId : s.eventId, s.before === undefined ? (w.before ? JSON.stringify(w.before) : null) : s.before ? JSON.stringify(s.before) : null, s.retry ? 1 : 0, stamp(), id,
      );
      return this.writeEntry(id)!;
    },
    markUndone(id: number, by: number): void {
      db.prepare("UPDATE write_log SET undone_by = ?, updated_at = ? WHERE id = ?").run(by, stamp(), id);
    },
    // ---- Help invites (step 13) ----
    /** A help invite about to be sent: pending until Outlook confirms it (then sent, with its event id). */
    addInvite(i: Omit<Invite, "id" | "createdAt" | "updatedAt" | "status" | "followUpId" | "eventId">): Invite {
      const at = stamp();
      db.prepare(
        `INSERT INTO invites (uid, client_key, item_id, pick_id, timebox_id, title, url, start_at, end_at, attendees, teams, note, event_id, status, follow_up_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, ?)
         ON CONFLICT(uid) DO NOTHING`,
      ).run(i.uid, i.clientKey, i.itemId, i.pickId, i.timeboxId, i.title, i.url, i.start, i.end, JSON.stringify(i.attendees), i.teams ? 1 : 0, i.note, at, at);
      return this.invite(i.uid)!;
    },
    invite(uid: string): Invite | null {
      const r = db.prepare("SELECT * FROM invites WHERE uid = ?").get(uid) as Row | undefined;
      return r ? toInvite(r) : null;
    },
    /** Invites (sent and cancelled) that start on or after `from`, by start. */
    invitesFrom(from: string): Invite[] {
      return (db.prepare("SELECT * FROM invites WHERE start_at >= ? ORDER BY start_at, id").all(from) as Row[]).map(toInvite);
    },
    setInvite(uid: string, patch: { status?: Invite["status"]; followUpId?: number | null; eventId?: string | null }): void {
      const i = this.invite(uid);
      if (!i) return;
      db.prepare("UPDATE invites SET status = ?, follow_up_id = ?, event_id = ?, updated_at = ? WHERE uid = ?").run(patch.status ?? i.status, patch.followUpId === undefined ? i.followUpId : patch.followUpId, patch.eventId === undefined ? i.eventId : patch.eventId, stamp(), uid);
    },
    /** Help session follow-ups close once the meeting has ended (step 13). */
    closeHelpFollowUps(now: Temporal.Instant): number {
      const open = (db.prepare("SELECT * FROM follow_ups WHERE kind = 'help' AND closed_at IS NULL AND ref_at IS NOT NULL").all() as Row[]).map(toFollowUp);
      let n = 0;
      for (const l of open) if (Temporal.Instant.compare(Temporal.Instant.from(l.refAt!), now) <= 0) (this.closeFollowUp(l.id, "The help session time has passed", "signal"), n++);
      return n;
    },
    /** The audit log, newest first. */
    writeLog(limit = 100): WriteEntry[] {
      return (db.prepare("SELECT * FROM write_log ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map(toWrite);
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
        followUps: (db.prepare("SELECT * FROM follow_ups ORDER BY id").all() as Row[]).map(toFollowUp),
        resumeNotes: (db.prepare("SELECT * FROM resume_notes ORDER BY date, client_key").all() as Row[]).map(toNote),
        borrowed: (db.prepare("SELECT * FROM borrowed ORDER BY id").all() as Row[]).map(toBorrowed),
        weekPlans: db.prepare("SELECT * FROM week_plans ORDER BY week_start").all() as Row[],
        weekFeatures: (db.prepare("SELECT DISTINCT week_start FROM week_features ORDER BY week_start").all() as Row[]).flatMap((r) => this.weekPlan(r.week_start as string).features),
        breakdownMarks: this.breakdownMarks(),
        captures: (db.prepare("SELECT * FROM captures ORDER BY id").all() as Row[]).map(toCapture),
        timeboxes: (db.prepare("SELECT * FROM timeboxes ORDER BY date, start_at, id").all() as Row[]).map(toTimebox),
        outlookEvents: (db.prepare("SELECT * FROM outlook_events ORDER BY created_at, uid").all() as Row[]).map(toOwn),
        writeLog: (db.prepare("SELECT * FROM write_log ORDER BY id").all() as Row[]).map(toWrite),
        invites: (db.prepare("SELECT * FROM invites ORDER BY id").all() as Row[]).map(toInvite),
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
