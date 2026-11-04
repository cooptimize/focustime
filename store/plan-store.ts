// Local plan store (D23): SQLite through Node's built-in node:sqlite, under ~/.local/share/focustime/.
// Holds only FocusTime's own plan (day plans, picks, draft stories) and a few one-time markers.
// Nothing here is ever written to DevOps, Outlook, Google or Dataverse.
import { USER_SCHEMA_VERSION } from "./user-data.ts";
import type { StoreFiles } from "../host/types.ts";
import { DatabaseSync } from "node:sqlite";
import type { Conn } from "./sql/conn.ts";
import { sqliteConn } from "./sql/sqlite.ts";
import { carryOver } from "../plan/rules.ts";
import { type ItemLevel, type Tier } from "../plan/weeklist.ts";
import { MAX_ESTIMATE_HOURS, validEstimateMinutes, validStorySize, type StorySize } from "../plan/estimate.ts";
import type { Capture, DayPlan, DraftStory, Pick, PickKind, PlanWeek, Size, ZonedStamp } from "../plan/types.ts";
import type { FlexSession, Half, IsoDate, Unavailable } from "../week/types.ts";
import type { Attendee, Fields, LocalState, OwnEvent, SyncOp, Timebox, WriteEntry, WriteKind, WriteStatus } from "../plan/timebox.ts";
import type { DevOpsWriteEntry } from "../plan/devopswrite.ts";
import { NAMED_MIGRATIONS } from "./migrations/index.ts";
import { validSetupStatus, validSetupStep, type SetupState, type SetupStatus, type SetupStep } from "../plan/setup.ts";
import { NAMES_TABLE, pending, type NamedMigration } from "./migrations/named.ts";
export type { WriteEntry, WriteStatus } from "../plan/timebox.ts";

/** Marks a migration that rebuilds a referenced table: run with foreign keys off, then checked (see migrate). */
const FK_OFF = "-- foreign keys off for a table rebuild";

/** Ordered schema changes. Never edit a shipped one; add a new entry. */
// Migration numbers, table names and the write logs' kind names are unchanged by the rename (R1): existing stores depend on them.
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
  // 9 (step 12): timeboxes (local, optionally on Outlook), the Outlook events FocusTime created (by marker uid, with the
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
  // 13 (step 14): DevOps writes. A draft created in DevOps keeps its row with the new item (and leaves draft lists);
  // the identity each client's write PAT was checked against (never the PAT); the DevOps audit log with prior values.
  `ALTER TABLE draft_stories ADD COLUMN devops_id INTEGER;
   ALTER TABLE draft_stories ADD COLUMN devops_url TEXT;
   CREATE TABLE devops_identities (
     client_key TEXT PRIMARY KEY,
     org TEXT NOT NULL,
     identity_id TEXT NOT NULL,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     validated_at TEXT NOT NULL,
     expires TEXT CHECK (expires IS NULL OR expires GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
   );
   CREATE TABLE devops_write_log (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     client_key TEXT NOT NULL,
     org TEXT NOT NULL,
     project TEXT NOT NULL,
     op TEXT NOT NULL CHECK (op IN ('state', 'comment', 'create', 'target_date', 'undo_state', 'undo_comment', 'undo_create', 'undo_target_date')),
     item_id INTEGER,
     parent_id INTEGER,
     title TEXT NOT NULL,
     identity TEXT NOT NULL,
     before TEXT NOT NULL,
     after TEXT NOT NULL,
     ops TEXT,
     rev_before INTEGER,
     rev_after INTEGER,
     comment_id INTEGER,
     draft_id INTEGER,
     pick_ids TEXT NOT NULL DEFAULT '[]',
     follow_up_id INTEGER,
     status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unconfirmed', 'failed', 'refused')),
     message TEXT,
     undo_of INTEGER REFERENCES devops_write_log(id),
     undone_by INTEGER REFERENCES devops_write_log(id),
     attempts INTEGER NOT NULL DEFAULT 1,
     updated_at TEXT NOT NULL
   );`,
  // 14: step 16 (D280), Roadmap: one snapshot of done and open stories per owned feature or epic per day.
  `CREATE TABLE delivery_snapshots (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL CHECK (item_id > 0),
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     done INTEGER NOT NULL CHECK (done >= 0),
     open INTEGER NOT NULL CHECK (open >= 0),
     PRIMARY KEY (client_key, item_id, date)
   );`,
  // 15: step 16 (D284), meeting RSVP: write_log rebuilt (ids kept, undo links kept) so kind allows 'rsvp'.
  `${FK_OFF}
   CREATE TABLE write_log_v15 (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     system TEXT NOT NULL CHECK (system IN ('outlook')),
     op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
     kind TEXT NOT NULL DEFAULT 'timebox' CHECK (kind IN ('timebox', 'event', 'invite', 'sync', 'rsvp')),
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
   );
   INSERT INTO write_log_v15 (id, at, system, op, kind, uid, event_id, account, calendar, before, after, local_before, local_after, status, message, auto, undo_of, undone_by, attempts, updated_at)
     SELECT id, at, system, op, kind, uid, event_id, account, calendar, before, after, local_before, local_after, status, message, auto, undo_of, undone_by, attempts, updated_at FROM write_log ORDER BY id;
   DROP TABLE write_log;
   ALTER TABLE write_log_v15 RENAME TO write_log;`,
  // 16: step 15.3, the draft editor: a draft's description, acceptance criteria (stories) and start and target dates
  // (features), written to DevOps by Create in DevOps.
  `ALTER TABLE draft_stories ADD COLUMN description TEXT;
   ALTER TABLE draft_stories ADD COLUMN acceptance TEXT;
   ALTER TABLE draft_stories ADD COLUMN start_date TEXT;
   ALTER TABLE draft_stories ADD COLUMN target_date TEXT;`,
  // 17: step 15.4, my VM: the Azure audit log (power actions; auto-shutdown changes before D475) and account state
  // (who signed in, my VM, a changed schedule to put back), kept by Reset local plan.
  `CREATE TABLE azure_write_log (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     op TEXT NOT NULL CHECK (op IN ('start', 'deallocate', 'shutdown_change', 'shutdown_restore')),
     vm_id TEXT NOT NULL,
     vm_name TEXT NOT NULL,
     before TEXT,
     after TEXT,
     status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed', 'timed_out', 'refused')),
     message TEXT,
     auto INTEGER NOT NULL DEFAULT 0,
     attempts INTEGER NOT NULL DEFAULT 1,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE account_state (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // 18: step 16.3, my Teams status during focus: every set and clear (my own status only; no teammates' presence,
  // which is never stored). Kept by Reset local plan, like the other write logs.
  `CREATE TABLE teams_status_log (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     op TEXT NOT NULL CHECK (op IN ('set', 'clear', 'left')),
     status TEXT,
     minutes INTEGER,
     result TEXT NOT NULL CHECK (result IN ('done', 'failed')),
     message TEXT
   );`,
  // 19: step 16.4 (D334), simple estimating: features take whole blocks (1 to 20) or none (NULL: what their stories add
  // up to); stories take a size (S, M or L) instead of blocks; a parent feature id so a story nests under its feature.
  // Rebuilt with ids kept (pins point at them). Half-block features round up; a story of half a block becomes M, more L.
  `${FK_OFF}
   CREATE TABLE week_features_v19 (
     id INTEGER PRIMARY KEY,
     week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     level TEXT NOT NULL DEFAULT 'feature' CHECK (level IN ('feature','story')),
     tier TEXT NOT NULL DEFAULT 'must' CHECK (tier IN ('must','nice')),
     title TEXT NOT NULL,
     item_type TEXT,
     url TEXT,
     blocks INTEGER CHECK (blocks IS NULL OR (blocks BETWEEN 1 AND 20 AND level = 'feature')),
     size TEXT CHECK (size IS NULL OR (size IN ('S','M','L') AND level = 'story')),
     parent_id INTEGER,
     position INTEGER,
     done_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (week_start, client_key, item_id)
   );
   INSERT INTO week_features_v19 (id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, size, parent_id, position, done_at, created_at, updated_at)
     SELECT id, week_start, client_key, item_id, level, tier, title, item_type, url,
       CASE WHEN level = 'feature' THEN MIN(20, MAX(1, CASE WHEN blocks = CAST(blocks AS INTEGER) THEN CAST(blocks AS INTEGER) ELSE CAST(blocks AS INTEGER) + 1 END)) ELSE NULL END,
       CASE WHEN level = 'story' THEN (CASE WHEN blocks <= 0.5 THEN 'M' ELSE 'L' END) ELSE NULL END,
       NULL, position, done_at, created_at, updated_at
     FROM week_features ORDER BY id;
   DROP TABLE week_features;
   ALTER TABLE week_features_v19 RENAME TO week_features;`,
  // 20: step 17 (D349), Plan ahead: a feature's or epic's dates as I dragged them on the timeline, kept locally until
  // saved to DevOps (then removed). Whole days; end inclusive.
  `CREATE TABLE roadmap_dates (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL CHECK (item_id > 0),
     start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date >= start_date),
     updated_at TEXT NOT NULL,
     PRIMARY KEY (client_key, item_id)
   );`,
  // 21: U3 (D388), week plan duplicates. The same item can't be on a week twice under one client key (UNIQUE since 8),
  // but a client key that only differs in letter case made a second row for the same item. Keep the oldest, move the
  // pins to it, remove the rest, and log each removal in dedupe_log (read back and counted in the server log at start).
  `CREATE TABLE dedupe_log (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     table_name TEXT NOT NULL,
     removed_id INTEGER NOT NULL,
     kept_id INTEGER NOT NULL,
     week_start TEXT,
     client_key TEXT,
     item_id INTEGER
   );
   INSERT INTO dedupe_log (at, table_name, removed_id, kept_id, week_start, client_key, item_id)
     SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'week_features', d.id,
            (SELECT MIN(k.id) FROM week_features k WHERE k.week_start = d.week_start AND lower(k.client_key) = lower(d.client_key) AND k.item_id = d.item_id),
            d.week_start, d.client_key, d.item_id
     FROM week_features d
     WHERE d.id > (SELECT MIN(k.id) FROM week_features k WHERE k.week_start = d.week_start AND lower(k.client_key) = lower(d.client_key) AND k.item_id = d.item_id);
   INSERT OR IGNORE INTO week_feature_slots (feature_id, date, half)
     SELECT l.kept_id, s.date, s.half FROM week_feature_slots s JOIN dedupe_log l ON l.table_name = 'week_features' AND l.removed_id = s.feature_id;
   DELETE FROM week_features WHERE id IN (SELECT removed_id FROM dedupe_log WHERE table_name = 'week_features');`,
  // 22: U6 (D414, D415), Plan the week one client at a time. A draft feature typed in Plan the week sits on that week's
  // list as a must or a nice to have until it is created in DevOps (then it becomes a week item); a client can be
  // marked "Nothing this week". Both local; the week_features records are unchanged.
  `CREATE TABLE week_drafts (
     week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     draft_id INTEGER NOT NULL REFERENCES draft_stories(id) ON DELETE CASCADE,
     tier TEXT NOT NULL CHECK (tier IN ('must', 'nice')),
     created_at TEXT NOT NULL,
     PRIMARY KEY (week_start, draft_id)
   );
   CREATE TABLE week_quiet (
     week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     client_key TEXT NOT NULL,
     marked_at TEXT NOT NULL,
     PRIMARY KEY (week_start, client_key)
   );`,
  // 23: A2, people and sign-in. App-level tables (not one person's plan): who has signed in (the Entra object id is the
  // user id), their server-side sessions (the cookie holds a random id; only its SHA-256 is kept), and sign-ins on their
  // way through Microsoft or Google (state, nonce and PKCE verifier, kept 10 minutes, by the state's hash).
  `CREATE TABLE users (
     id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
     tenant_id TEXT NOT NULL,
     upn TEXT NOT NULL,
     display_name TEXT NOT NULL,
     email TEXT,
     time_zone TEXT,
     created_at TEXT NOT NULL,
     last_sign_in_at TEXT NOT NULL,
     deleted_at TEXT
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
     csrf TEXT NOT NULL,
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE auth_requests (
     state TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('microsoft', 'google')),
     nonce TEXT NOT NULL,
     verifier TEXT NOT NULL,
     user_id TEXT,
     created_at TEXT NOT NULL
   );`,
  // 24: A2, one plan store for everyone. Every plan table gets user_id (the Entra object id of the person the row
  // belongs to), first in every primary and unique key; picks reference their day plan by (user_id, date). Existing
  // rows are kept with user_id '' (no one's yet): the first sign-in that proves it is the store's owner claims them
  // (server/claim.ts). The store adds `user_id = <the session's person>` to every statement (store/scope.ts).
  `${FK_OFF}
   DROP INDEX flex_date;
   DROP INDEX focus_pick;
   DROP INDEX follow_ups_rule;
   DROP INDEX invites_start;
   DROP INDEX picks_date;
   DROP INDEX timeboxes_date;
   DROP INDEX unavailable_date;
   CREATE TABLE account_state_v24 (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
   INSERT INTO account_state_v24 (user_id, key, value, updated_at) SELECT '', key, value, updated_at FROM account_state;
   CREATE TABLE azure_write_log_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('start', 'deallocate', 'shutdown_change', 'shutdown_restore')),
        vm_id TEXT NOT NULL,
        vm_name TEXT NOT NULL,
        before TEXT,
        after TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed', 'timed_out', 'refused')),
        message TEXT,
        auto INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
   INSERT INTO azure_write_log_v24 (user_id, id, at, op, vm_id, vm_name, before, after, status, message, auto, attempts, updated_at) SELECT '', id, at, op, vm_id, vm_name, before, after, status, message, auto, attempts, updated_at FROM azure_write_log;
   CREATE TABLE borrowed_v24 (
        user_id TEXT NOT NULL,
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
      );
   INSERT INTO borrowed_v24 (user_id, id, pick_id, from_pick_id, client_key, title, date, minutes, payback, payback_date, payback_half, created_at, paid_at, paid_by) SELECT '', id, pick_id, from_pick_id, client_key, title, date, minutes, payback, payback_date, payback_half, created_at, paid_at, paid_by FROM borrowed;
   CREATE TABLE breakdown_marks_v24 (
        user_id TEXT NOT NULL,
        client_key TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        marked_at TEXT NOT NULL,
        PRIMARY KEY (user_id, client_key, item_id)
      );
   INSERT INTO breakdown_marks_v24 (user_id, client_key, item_id, marked_at) SELECT '', client_key, item_id, marked_at FROM breakdown_marks;
   CREATE TABLE captures_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
        client_key TEXT,
        created_at TEXT NOT NULL,
        routed_at TEXT,
        routed_as TEXT CHECK (routed_as IN ('follow_up', 'draft', 'draft_feature', 'left_off', 'dismissed')),
        routed_id INTEGER,
        CHECK ((routed_at IS NULL) = (routed_as IS NULL))
      );
   INSERT INTO captures_v24 (user_id, id, text, client_key, created_at, routed_at, routed_as, routed_id) SELECT '', id, text, client_key, created_at, routed_at, routed_as, routed_id FROM captures;
   CREATE TABLE day_plans_v24 (
        user_id TEXT NOT NULL,
        date TEXT CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') NOT NULL,
        committed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_out_at TEXT,
        PRIMARY KEY (user_id, date)
      );
   INSERT INTO day_plans_v24 (user_id, date, committed_at, created_at, updated_at, closed_out_at) SELECT '', date, committed_at, created_at, updated_at, closed_out_at FROM day_plans;
   CREATE TABLE dedupe_log_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        table_name TEXT NOT NULL,
        removed_id INTEGER NOT NULL,
        kept_id INTEGER NOT NULL,
        week_start TEXT,
        client_key TEXT,
        item_id INTEGER
      );
   INSERT INTO dedupe_log_v24 (user_id, id, at, table_name, removed_id, kept_id, week_start, client_key, item_id) SELECT '', id, at, table_name, removed_id, kept_id, week_start, client_key, item_id FROM dedupe_log;
   CREATE TABLE delivery_snapshots_v24 (
        user_id TEXT NOT NULL,
        client_key TEXT NOT NULL,
        item_id INTEGER NOT NULL CHECK (item_id > 0),
        date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        done INTEGER NOT NULL CHECK (done >= 0),
        open INTEGER NOT NULL CHECK (open >= 0),
        PRIMARY KEY (user_id, client_key, item_id, date)
      );
   INSERT INTO delivery_snapshots_v24 (user_id, client_key, item_id, date, done, open) SELECT '', client_key, item_id, date, done, open FROM delivery_snapshots;
   CREATE TABLE devops_identities_v24 (
        user_id TEXT NOT NULL,
        client_key TEXT NOT NULL,
        org TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        validated_at TEXT NOT NULL,
        expires TEXT CHECK (expires IS NULL OR expires GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        PRIMARY KEY (user_id, client_key)
      );
   INSERT INTO devops_identities_v24 (user_id, client_key, org, identity_id, name, email, validated_at, expires) SELECT '', client_key, org, identity_id, name, email, validated_at, expires FROM devops_identities;
   CREATE TABLE devops_write_log_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        client_key TEXT NOT NULL,
        org TEXT NOT NULL,
        project TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('state', 'comment', 'create', 'target_date', 'undo_state', 'undo_comment', 'undo_create', 'undo_target_date')),
        item_id INTEGER,
        parent_id INTEGER,
        title TEXT NOT NULL,
        identity TEXT NOT NULL,
        before TEXT NOT NULL,
        after TEXT NOT NULL,
        ops TEXT,
        rev_before INTEGER,
        rev_after INTEGER,
        comment_id INTEGER,
        draft_id INTEGER,
        pick_ids TEXT NOT NULL DEFAULT '[]',
        follow_up_id INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unconfirmed', 'failed', 'refused')),
        message TEXT,
        undo_of INTEGER REFERENCES devops_write_log(id),
        undone_by INTEGER REFERENCES devops_write_log(id),
        attempts INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
   INSERT INTO devops_write_log_v24 (user_id, id, at, client_key, org, project, op, item_id, parent_id, title, identity, before, after, ops, rev_before, rev_after, comment_id, draft_id, pick_ids, follow_up_id, status, message, undo_of, undone_by, attempts, updated_at) SELECT '', id, at, client_key, org, project, op, item_id, parent_id, title, identity, before, after, ops, rev_before, rev_after, comment_id, draft_id, pick_ids, follow_up_id, status, message, undo_of, undone_by, attempts, updated_at FROM devops_write_log;
   CREATE TABLE draft_stories_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        client_key TEXT NOT NULL,
        parent_item_id INTEGER,
        title TEXT NOT NULL,
        size TEXT NOT NULL CHECK (size IN ('S','M','L')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'story' CHECK (level IN ('story', 'feature')),
        devops_id INTEGER,
        devops_url TEXT,
        description TEXT,
        acceptance TEXT,
        start_date TEXT,
        target_date TEXT
      );
   INSERT INTO draft_stories_v24 (user_id, id, client_key, parent_item_id, title, size, created_at, updated_at, level, devops_id, devops_url, description, acceptance, start_date, target_date) SELECT '', id, client_key, parent_item_id, title, size, created_at, updated_at, level, devops_id, devops_url, description, acceptance, start_date, target_date FROM draft_stories;
   CREATE TABLE flex_sessions_v24 (
        user_id TEXT NOT NULL,
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
   INSERT INTO flex_sessions_v24 (user_id, id, date, client_key, start_at, end_at, item_id, item_title, item_url, note, created_at, updated_at) SELECT '', id, date, client_key, start_at, end_at, item_id, item_title, item_url, note, created_at, updated_at FROM flex_sessions;
   CREATE TABLE focus_log_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        pick_id INTEGER,
        label TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        seconds INTEGER NOT NULL CHECK (seconds >= 0)
      );
   INSERT INTO focus_log_v24 (user_id, id, pick_id, label, started_at, ended_at, seconds) SELECT '', id, pick_id, label, started_at, ended_at, seconds FROM focus_log;
   CREATE TABLE follow_ups_v24 (
        user_id TEXT NOT NULL,
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
        who TEXT,
        item_id INTEGER,
        rule_key TEXT,
        ref_at TEXT,
        draft TEXT,
        detail TEXT,
        closed_by TEXT,
        outcome TEXT CHECK (outcome IN ('done', 'not_needed')),
        close_how TEXT CHECK (close_how IN ('teams', 'email', 'devops', 'call')),
        snoozed_until TEXT CHECK (snoozed_until IS NULL OR snoozed_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        origin TEXT,
        UNIQUE (user_id, source_kind, source_id)
      );
   INSERT INTO follow_ups_v24 (user_id, id, kind, client_key, what, channel, due, source_kind, source_id, opened_at, closed_at, close_note, who, item_id, rule_key, ref_at, draft, detail, closed_by, outcome, close_how, snoozed_until, origin) SELECT '', id, kind, client_key, what, channel, due, source_kind, source_id, opened_at, closed_at, close_note, who, item_id, rule_key, ref_at, draft, detail, closed_by, outcome, close_how, snoozed_until, origin FROM follow_ups;
   CREATE TABLE invites_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        uid TEXT NOT NULL,
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
        follow_up_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, uid)
      );
   INSERT INTO invites_v24 (user_id, id, uid, client_key, item_id, pick_id, timebox_id, title, url, start_at, end_at, attendees, teams, note, event_id, status, follow_up_id, created_at, updated_at) SELECT '', id, uid, client_key, item_id, pick_id, timebox_id, title, url, start_at, end_at, attendees, teams, note, event_id, status, follow_up_id, created_at, updated_at FROM invites;
   CREATE TABLE kv_v24 (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
   INSERT INTO kv_v24 (user_id, key, value, updated_at) SELECT '', key, value, updated_at FROM kv;
   CREATE TABLE markers_v24 (
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        date TEXT NOT NULL,
        at TEXT NOT NULL,
        PRIMARY KEY (user_id, kind, date)
      );
   INSERT INTO markers_v24 (user_id, kind, date, at) SELECT '', kind, date, at FROM markers;
   CREATE TABLE outlook_events_v24 (
        user_id TEXT NOT NULL,
        uid TEXT NOT NULL,
        timebox_id INTEGER,
        event_id TEXT NOT NULL,
        fields TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (user_id, uid)
      );
   INSERT INTO outlook_events_v24 (user_id, uid, timebox_id, event_id, fields, created_at, updated_at, deleted_at) SELECT '', uid, timebox_id, event_id, fields, created_at, updated_at, deleted_at FROM outlook_events;
   CREATE TABLE picks_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
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
        carried_from INTEGER REFERENCES picks(id),
        notes TEXT,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        follow_up_id INTEGER REFERENCES follow_ups(id),
        FOREIGN KEY (user_id, date) REFERENCES day_plans(user_id, date),
        CHECK ((kind = 'item') = (item_id IS NOT NULL)),
        CHECK ((kind = 'draft') = (draft_id IS NOT NULL))
      );
   INSERT INTO picks_v24 (user_id, id, date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at, follow_up_id) SELECT '', id, date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at, follow_up_id FROM picks;
   CREATE TABLE resume_notes_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        client_key TEXT NOT NULL,
        date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, client_key, date)
      );
   INSERT INTO resume_notes_v24 (user_id, id, client_key, date, note, created_at, updated_at) SELECT '', id, client_key, date, note, created_at, updated_at FROM resume_notes;
   CREATE TABLE roadmap_dates_v24 (
        user_id TEXT NOT NULL,
        client_key TEXT NOT NULL,
        item_id INTEGER NOT NULL CHECK (item_id > 0),
        start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date >= start_date),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, client_key, item_id)
      );
   INSERT INTO roadmap_dates_v24 (user_id, client_key, item_id, start_date, end_date, updated_at) SELECT '', client_key, item_id, start_date, end_date, updated_at FROM roadmap_dates;
   CREATE TABLE teams_status_log_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('set', 'clear', 'left')),
        status TEXT,
        minutes INTEGER,
        result TEXT NOT NULL CHECK (result IN ('done', 'failed')),
        message TEXT
      );
   INSERT INTO teams_status_log_v24 (user_id, id, at, op, status, minutes, result, message) SELECT '', id, at, op, status, minutes, result, message FROM teams_status_log;
   CREATE TABLE timeboxes_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        uid TEXT NOT NULL,
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
        updated_at TEXT NOT NULL,
        show_as TEXT NOT NULL DEFAULT 'busy' CHECK (show_as IN ('busy', 'tentative', 'free', 'oof', 'workingElsewhere')),
        outlook_note TEXT,
        conflict TEXT,
        UNIQUE (user_id, uid)
      );
   INSERT INTO timeboxes_v24 (user_id, id, uid, date, client_key, pick_id, item_id, title, url, start_at, end_at, outlook, removed_at, created_at, updated_at, show_as, outlook_note, conflict) SELECT '', id, uid, date, client_key, pick_id, item_id, title, url, start_at, end_at, outlook, removed_at, created_at, updated_at, show_as, outlook_note, conflict FROM timeboxes;
   CREATE TABLE unavailable_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        title TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
   INSERT INTO unavailable_v24 (user_id, id, date, title, start_at, end_at, note, created_at, updated_at) SELECT '', id, date, title, start_at, end_at, note, created_at, updated_at FROM unavailable;
   CREATE TABLE week_drafts_v24 (
        user_id TEXT NOT NULL,
        week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        draft_id INTEGER NOT NULL REFERENCES draft_stories(id) ON DELETE CASCADE,
        tier TEXT NOT NULL CHECK (tier IN ('must', 'nice')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, week_start, draft_id)
      );
   INSERT INTO week_drafts_v24 (user_id, week_start, draft_id, tier, created_at) SELECT '', week_start, draft_id, tier, created_at FROM week_drafts;
   CREATE TABLE week_feature_slots_v24 (
        user_id TEXT NOT NULL,
        feature_id INTEGER NOT NULL REFERENCES week_features(id) ON DELETE CASCADE,
        date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        half TEXT NOT NULL CHECK (half IN ('AM','PM')),
        PRIMARY KEY (user_id, feature_id, date, half)
      );
   INSERT INTO week_feature_slots_v24 (user_id, feature_id, date, half) SELECT '', feature_id, date, half FROM week_feature_slots;
   CREATE TABLE week_features_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        client_key TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        level TEXT NOT NULL DEFAULT 'feature' CHECK (level IN ('feature','story')),
        tier TEXT NOT NULL DEFAULT 'must' CHECK (tier IN ('must','nice')),
        title TEXT NOT NULL,
        item_type TEXT,
        url TEXT,
        blocks INTEGER CHECK (blocks IS NULL OR (blocks BETWEEN 1 AND 20 AND level = 'feature')),
        size TEXT CHECK (size IS NULL OR (size IN ('S','M','L') AND level = 'story')),
        parent_id INTEGER,
        position INTEGER,
        done_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, week_start, client_key, item_id)
      );
   INSERT INTO week_features_v24 (user_id, id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, size, parent_id, position, done_at, created_at, updated_at) SELECT '', id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, size, parent_id, position, done_at, created_at, updated_at FROM week_features;
   CREATE TABLE week_plans_v24 (
        user_id TEXT NOT NULL,
        week_start TEXT CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') NOT NULL,
        committed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, week_start)
      );
   INSERT INTO week_plans_v24 (user_id, week_start, committed_at, created_at, updated_at) SELECT '', week_start, committed_at, created_at, updated_at FROM week_plans;
   CREATE TABLE week_quiet_v24 (
        user_id TEXT NOT NULL,
        week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        client_key TEXT NOT NULL,
        marked_at TEXT NOT NULL,
        PRIMARY KEY (user_id, week_start, client_key)
      );
   INSERT INTO week_quiet_v24 (user_id, week_start, client_key, marked_at) SELECT '', week_start, client_key, marked_at FROM week_quiet;
   CREATE TABLE write_log_v24 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        system TEXT NOT NULL CHECK (system IN ('outlook')),
        op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
        kind TEXT NOT NULL DEFAULT 'timebox' CHECK (kind IN ('timebox', 'event', 'invite', 'sync', 'rsvp')),
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
      );
   INSERT INTO write_log_v24 (user_id, id, at, system, op, kind, uid, event_id, account, calendar, before, after, local_before, local_after, status, message, auto, undo_of, undone_by, attempts, updated_at) SELECT '', id, at, system, op, kind, uid, event_id, account, calendar, before, after, local_before, local_after, status, message, auto, undo_of, undone_by, attempts, updated_at FROM write_log;
   DROP TABLE account_state;
   DROP TABLE azure_write_log;
   DROP TABLE borrowed;
   DROP TABLE breakdown_marks;
   DROP TABLE captures;
   DROP TABLE day_plans;
   DROP TABLE dedupe_log;
   DROP TABLE delivery_snapshots;
   DROP TABLE devops_identities;
   DROP TABLE devops_write_log;
   DROP TABLE draft_stories;
   DROP TABLE flex_sessions;
   DROP TABLE focus_log;
   DROP TABLE follow_ups;
   DROP TABLE invites;
   DROP TABLE kv;
   DROP TABLE markers;
   DROP TABLE outlook_events;
   DROP TABLE picks;
   DROP TABLE resume_notes;
   DROP TABLE roadmap_dates;
   DROP TABLE teams_status_log;
   DROP TABLE timeboxes;
   DROP TABLE unavailable;
   DROP TABLE week_drafts;
   DROP TABLE week_feature_slots;
   DROP TABLE week_features;
   DROP TABLE week_plans;
   DROP TABLE week_quiet;
   DROP TABLE write_log;
   ALTER TABLE account_state_v24 RENAME TO account_state;
   ALTER TABLE azure_write_log_v24 RENAME TO azure_write_log;
   ALTER TABLE borrowed_v24 RENAME TO borrowed;
   ALTER TABLE breakdown_marks_v24 RENAME TO breakdown_marks;
   ALTER TABLE captures_v24 RENAME TO captures;
   ALTER TABLE day_plans_v24 RENAME TO day_plans;
   ALTER TABLE dedupe_log_v24 RENAME TO dedupe_log;
   ALTER TABLE delivery_snapshots_v24 RENAME TO delivery_snapshots;
   ALTER TABLE devops_identities_v24 RENAME TO devops_identities;
   ALTER TABLE devops_write_log_v24 RENAME TO devops_write_log;
   ALTER TABLE draft_stories_v24 RENAME TO draft_stories;
   ALTER TABLE flex_sessions_v24 RENAME TO flex_sessions;
   ALTER TABLE focus_log_v24 RENAME TO focus_log;
   ALTER TABLE follow_ups_v24 RENAME TO follow_ups;
   ALTER TABLE invites_v24 RENAME TO invites;
   ALTER TABLE kv_v24 RENAME TO kv;
   ALTER TABLE markers_v24 RENAME TO markers;
   ALTER TABLE outlook_events_v24 RENAME TO outlook_events;
   ALTER TABLE picks_v24 RENAME TO picks;
   ALTER TABLE resume_notes_v24 RENAME TO resume_notes;
   ALTER TABLE roadmap_dates_v24 RENAME TO roadmap_dates;
   ALTER TABLE teams_status_log_v24 RENAME TO teams_status_log;
   ALTER TABLE timeboxes_v24 RENAME TO timeboxes;
   ALTER TABLE unavailable_v24 RENAME TO unavailable;
   ALTER TABLE week_drafts_v24 RENAME TO week_drafts;
   ALTER TABLE week_feature_slots_v24 RENAME TO week_feature_slots;
   ALTER TABLE week_features_v24 RENAME TO week_features;
   ALTER TABLE week_plans_v24 RENAME TO week_plans;
   ALTER TABLE week_quiet_v24 RENAME TO week_quiet;
   ALTER TABLE write_log_v24 RENAME TO write_log;
   CREATE INDEX flex_date ON flex_sessions(user_id, date);
   CREATE INDEX focus_pick ON focus_log(user_id, pick_id);
   CREATE UNIQUE INDEX follow_ups_rule ON follow_ups(user_id, rule_key);
   CREATE INDEX invites_start ON invites(user_id, start_at);
   CREATE INDEX picks_date ON picks(user_id, date, half, position);
   CREATE INDEX timeboxes_date ON timeboxes(user_id, date);
   CREATE INDEX unavailable_date ON unavailable(user_id, date);
   CREATE INDEX azure_write_log_user ON azure_write_log(user_id);
   CREATE INDEX borrowed_user ON borrowed(user_id);
   CREATE INDEX captures_user ON captures(user_id);
   CREATE INDEX dedupe_log_user ON dedupe_log(user_id);
   CREATE INDEX devops_write_log_user ON devops_write_log(user_id);
   CREATE INDEX draft_stories_user ON draft_stories(user_id);
   CREATE INDEX flex_sessions_user ON flex_sessions(user_id);
   CREATE INDEX focus_log_user ON focus_log(user_id);
   CREATE INDEX follow_ups_user ON follow_ups(user_id);
   CREATE INDEX invites_user ON invites(user_id);
   CREATE INDEX picks_user ON picks(user_id);
   CREATE INDEX resume_notes_user ON resume_notes(user_id);
   CREATE INDEX teams_status_log_user ON teams_status_log(user_id);
   CREATE INDEX timeboxes_user ON timeboxes(user_id);
   CREATE INDEX unavailable_user ON unavailable(user_id);
   CREATE INDEX week_features_user ON week_features(user_id);
   CREATE INDEX write_log_user ON write_log(user_id);`,
  // 25: A2, settings in the database. A person's settings, one row per top-level section of the settings text, in
  // order (config/sections.ts; app-level keys never stored here). And people whose data was deleted: a soft delete
  // (data kept, sign-in refused) becomes a hard delete after 30 days; the row keeps only a hash of the user id.
  `CREATE TABLE user_settings (
     user_id TEXT NOT NULL,
     section TEXT NOT NULL,
     position INTEGER NOT NULL,
     body TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, section)
   );
   CREATE TABLE deletions (
     id INTEGER PRIMARY KEY,
     user_hash TEXT NOT NULL,
     requested_at TEXT NOT NULL,
     hard_deleted_at TEXT
   );`,  // 26: A2, each person's secrets (refresh tokens, DevOps write PATs), sealed with the app's data key
  // (store/user-secrets.ts). Never exported; removed at Delete my data.
  `CREATE TABLE user_secrets (
     user_id TEXT NOT NULL,
     account TEXT NOT NULL,
     sealed TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, account)
   );`,
  // 27: E1 (D438), a feature's estimate in half blocks: blocks 0.5 to 20 in steps of a half (whole blocks stay valid;
  // nothing to convert). SQLite can't change a CHECK in place, so the table is rebuilt with the same rows and ids.
  `${FK_OFF}
   CREATE TABLE week_features_v27 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        client_key TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        level TEXT NOT NULL DEFAULT 'feature' CHECK (level IN ('feature','story')),
        tier TEXT NOT NULL DEFAULT 'must' CHECK (tier IN ('must','nice')),
        title TEXT NOT NULL,
        item_type TEXT,
        url TEXT,
        blocks REAL CHECK (blocks IS NULL OR (blocks BETWEEN 0.5 AND 20 AND blocks * 2 = CAST(blocks * 2 AS INTEGER) AND level = 'feature')),
        size TEXT CHECK (size IS NULL OR (size IN ('S','M','L') AND level = 'story')),
        parent_id INTEGER,
        position INTEGER,
        done_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, week_start, client_key, item_id)
      );
   INSERT INTO week_features_v27 (user_id, id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, size, parent_id, position, done_at, created_at, updated_at)
     SELECT user_id, id, week_start, client_key, item_id, level, tier, title, item_type, url, blocks, size, parent_id, position, done_at, created_at, updated_at FROM week_features;
   DROP TABLE week_features;
   ALTER TABLE week_features_v27 RENAME TO week_features;
   CREATE INDEX week_features_user ON week_features(user_id);`,
  // 28: E2 (D446), estimates in hours. A feature's estimate becomes minutes (whole hours, 1h to 80h): what E1 (half
  // blocks) and step 16.4 (whole blocks) stored converts at 1 block = 4h, to the nearest hour. A pick's size may be
  // empty (not sized yet; it counts as 2h). Both tables are rebuilt with the same rows and ids.
  `${FK_OFF}
   CREATE TABLE week_features_v28 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        client_key TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        level TEXT NOT NULL DEFAULT 'feature' CHECK (level IN ('feature','story')),
        tier TEXT NOT NULL DEFAULT 'must' CHECK (tier IN ('must','nice')),
        title TEXT NOT NULL,
        item_type TEXT,
        url TEXT,
        size TEXT CHECK (size IS NULL OR (size IN ('S','M','L') AND level = 'story')),
        parent_id INTEGER,
        position INTEGER,
        done_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        -- Last, as SQL Server's migration 30 adds it, so both stores export the same columns in the same order.
        estimate INTEGER CHECK (estimate IS NULL OR (estimate BETWEEN 60 AND 4800 AND estimate % 60 = 0 AND level = 'feature')),
        UNIQUE (user_id, week_start, client_key, item_id)
      );
   INSERT INTO week_features_v28 (user_id, id, week_start, client_key, item_id, level, tier, title, item_type, url, size, parent_id, position, done_at, created_at, updated_at, estimate)
     SELECT user_id, id, week_start, client_key, item_id, level, tier, title, item_type, url, size, parent_id, position, done_at, created_at, updated_at,
       CASE WHEN level = 'feature' AND blocks IS NOT NULL THEN MIN(80, MAX(1, CAST(ROUND(blocks * 4) AS INTEGER))) * 60 ELSE NULL END
     FROM week_features;
   DROP TABLE week_features;
   ALTER TABLE week_features_v28 RENAME TO week_features;
   CREATE INDEX week_features_user ON week_features(user_id);
   CREATE TABLE picks_v28 (
        user_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        half TEXT NOT NULL CHECK (half IN ('AM','PM','EVE')),
        client_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('item','draft','intention')),
        item_id INTEGER,
        draft_id INTEGER REFERENCES draft_stories(id),
        title TEXT NOT NULL,
        item_type TEXT,
        item_url TEXT,
        size TEXT CHECK (size IS NULL OR size IN ('S','M','L')),
        status TEXT NOT NULL CHECK (status IN ('planned','done','moved','dropped')),
        carried_from INTEGER REFERENCES picks(id),
        notes TEXT,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        follow_up_id INTEGER REFERENCES follow_ups(id),
        FOREIGN KEY (user_id, date) REFERENCES day_plans(user_id, date),
        CHECK ((kind = 'item') = (item_id IS NOT NULL)),
        CHECK ((kind = 'draft') = (draft_id IS NOT NULL))
      );
   INSERT INTO picks_v28 (user_id, id, date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at, follow_up_id)
     SELECT user_id, id, date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at, follow_up_id FROM picks;
   DROP INDEX picks_date;
   DROP INDEX picks_user;
   DROP TABLE picks;
   ALTER TABLE picks_v28 RENAME TO picks;
   CREATE INDEX picks_date ON picks(user_id, date, half, position);
   CREATE INDEX picks_user ON picks(user_id);`,
];

/** E2: the feature estimates a migration converts, counted before it runs and logged (never the values). */
export const ESTIMATE_CONVERSION = { sqliteVersion: 28, count: "SELECT COUNT(*) AS n FROM week_features WHERE level = 'feature' AND blocks IS NOT NULL" } as const;

import type { AzureWriteEntry, TeamsStatusEntry } from "../actions/account-types.ts";
import type { Logger } from "../log/logger.ts";
import { scopedDb } from "./scope.ts";
export type { TeamsStatusEntry };
const toTeamsStatus = (r: Row): TeamsStatusEntry => ({
  id: r.id as number, at: r.at as string, op: r.op as TeamsStatusEntry["op"], status: (r.status as TeamsStatusEntry["status"]) ?? null,
  minutes: (r.minutes as number | null) ?? null, result: r.result as TeamsStatusEntry["result"], message: (r.message as string | null) ?? null,
});
export type { AzureWriteEntry };
export type NewAzureWrite = { op: AzureWriteEntry["op"]; vmId: string; vmName: string; before: unknown; after: unknown; auto: boolean };
const toAzureWrite = (r: Row): AzureWriteEntry => ({
  id: r.id as number, at: r.at as string, op: r.op as AzureWriteEntry["op"], vmId: r.vm_id as string, vmName: r.vm_name as string,
  before: r.before ? JSON.parse(r.before as string) : null, after: r.after ? JSON.parse(r.after as string) : null,
  status: r.status as AzureWriteEntry["status"], message: (r.message as string | null) ?? null, auto: !!r.auto, attempts: r.attempts as number, updatedAt: r.updated_at as string,
});

/** The tables "Reset local plan" empties (Q37). Markers (reminder and auto-open once a day) are kept. */
const RESET_TABLES = ["week_drafts", "week_quiet", "timeboxes", "captures", "week_feature_slots", "week_features", "week_plans", "breakdown_marks", "borrowed", "resume_notes", "focus_log", "kv", "follow_ups", "flex_sessions", "unavailable", "picks", "draft_stories", "day_plans"] as const;
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
export type DraftPatch = { clientKey?: string; parentItemId?: number | null; title?: string; size?: Size; description?: string | null; acceptance?: string | null; startDate?: string | null; targetDate?: string | null };
export type FollowUpFields = { clientKey: string | null; who: string | null; what: string; channel: string | null; due: IsoDate | null; itemId: number | null };
export type NewRuleFollowUp = { kind: string; ruleKey: string; clientKey: string | null; who: string; what: string; itemId?: number | null; refAt?: string | null; draft?: string | null; detail?: { picks?: number[] } | null; origin?: FollowUpOrigin | null };
export type ResumeNote = { id: number; clientKey: string; date: IsoDate; note: string; updatedAt: string };
/** Borrowed time (step 7): planned focus that slipped, to be made up on a payback day. */
export type { WeekFeature, WeekPlanRecord } from "../plan/types.ts";
import type { WeekFeature, WeekPlanRecord } from "../plan/types.ts";

export type NewWeekFeature = { weekStart: IsoDate; clientKey: string; itemId: number; title: string; itemType: string | null; url: string | null; /** Minutes (whole hours); 0 takes it off. */ estimate: number };
export type NewWeekItem = Omit<NewWeekFeature, "estimate"> & { level: ItemLevel; tier?: Tier; /** Features: an estimate in minutes (whole hours), or null for 4h. */ estimate?: number | null; size?: StorySize | null; parentId?: number | null };

/** Most hours one feature can take in a week (E2). */
export const MAX_FEATURE_HOURS = MAX_ESTIMATE_HOURS;
const ESTIMATE_ERROR = `an estimate must be whole hours, 1 to ${MAX_ESTIMATE_HOURS}`;

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
  /** E2: null when not sized yet (counts as 2h). */
  size: Size | null;
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
/** A help invite FocusTime sent (step 13). Attendees are Cooptimize staff (name and work email). */
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
  size: (r.size as Size | null) ?? null,
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
const toDraft = (r: Row): DraftStory => ({ id: r.id as number, clientKey: r.client_key as string, parentItemId: (r.parent_item_id as number | null) ?? null, title: r.title as string, size: r.size as Size, level: ((r.level as string | null) ?? "story") as DraftStory["level"], createdAt: r.created_at as string, description: (r.description as string | null) ?? null, acceptance: (r.acceptance as string | null) ?? null, startDate: (r.start_date as string | null) ?? null, targetDate: (r.target_date as string | null) ?? null, ...(r.devops_id != null ? { devopsId: r.devops_id as number, devopsUrl: (r.devops_url as string | null) ?? null } : {}) });
export type DevOpsIdentityRow = { clientKey: string; org: string; id: string; name: string; email: string; validatedAt: string; expires: string | null };
const toIdentity = (r: Row): DevOpsIdentityRow => ({ clientKey: r.client_key as string, org: r.org as string, id: r.identity_id as string, name: r.name as string, email: r.email as string, validatedAt: r.validated_at as string, expires: (r.expires as string | null) ?? null });
const toDevopsWrite = (r: Row): DevOpsWriteEntry => ({
  id: r.id as number, at: r.at as string, clientKey: r.client_key as string, org: r.org as string, project: r.project as string, op: r.op as DevOpsWriteEntry["op"],
  itemId: (r.item_id as number | null) ?? null, parentId: (r.parent_id as number | null) ?? null, title: r.title as string, identity: r.identity as string,
  before: json<Record<string, string | null>>(r.before) ?? {}, after: json<Record<string, string | null>>(r.after) ?? {}, ops: json<DevOpsWriteEntry["ops"]>(r.ops),
  revBefore: (r.rev_before as number | null) ?? null, revAfter: (r.rev_after as number | null) ?? null, commentId: (r.comment_id as number | null) ?? null, draftId: (r.draft_id as number | null) ?? null,
  pickIds: json<number[]>(r.pick_ids) ?? [], followUpId: (r.follow_up_id as number | null) ?? null, status: r.status as DevOpsWriteEntry["status"], message: (r.message as string | null) ?? null,
  undoOf: (r.undo_of as number | null) ?? null, undoneBy: (r.undone_by as number | null) ?? null, attempts: r.attempts as number, updatedAt: r.updated_at as string,
});
export type NewDevOpsWrite = Omit<DevOpsWriteEntry, "id" | "at" | "status" | "message" | "undoneBy" | "attempts" | "updatedAt" | "pickIds"> & { pickIds?: number[] };

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
  | { as: "follow_up"; clientKey: string | null; who: string; what: string; due: IsoDate | null; channel?: string | null; itemId?: number | null }
  | { as: "draft"; clientKey: string; parentItemId: number | null; title: string; size: Size }
  | { as: "draft_feature"; clientKey: string; parentItemId: number | null; title: string; targetDate?: IsoDate | null }
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

/**
 * `files` (the host's, A1): makes the store's folder and keeps the file and its backups private. Absent: the path is
 * used as given (in-memory stores and tests).
 */
export type PlanDbOptions = { path: string; now: () => Temporal.ZonedDateTime; log?: Logger; files?: StoreFiles; /** Tests: the timestamped migrations to apply instead of store/migrations/index.ts. */ named?: readonly NamedMigration[] };

/** The plan store's database, opened and migrated once per process (A2: shared by everyone; each person gets a store on it). */
export function openPlanDb(opts: PlanDbOptions): DatabaseSync {
  if (opts.path !== ":memory:") opts.files?.prepare(opts.path);
  const db = new DatabaseSync(opts.path);
  if (opts.path !== ":memory:") opts.files?.secure(opts.path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const before = sqliteVersion(db);
  migrate(db, opts.now, opts.path, opts.files, opts.log, opts.named);
  // U3 (D388): say how many duplicate week items migration 21 removed (counts only; the rows are in dedupe_log).
  if (before < 21 && opts.log) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM dedupe_log WHERE table_name = 'week_features'").get() as { n: number }).n;
    if (n > 0) opts.log({ source: "plan", op: "dedupe_week_items", count: n });
  }
  return db;
}

/** A plan store on its own SQLite database (tests, demo sessions and scripts): opened, migrated, closed with the store. */
export function createPlanStore(opts: PlanDbOptions & { userId?: string }) {
  const raw = openPlanDb(opts);
  return planStoreOn(sqliteConn(raw), { ...opts, userId: opts.userId ?? SOLO_USER, backup: sqliteBackup(raw, opts.files) });
}

/** A copy of a SQLite store (Reset local plan's backup), 0600. */
export const sqliteBackup = (raw: DatabaseSync, files?: StoreFiles) => async (to: string) => {
  raw.prepare("VACUUM INTO ?").run(to);
  files?.secure(to);
};

/** The person a store opened on its own belongs to when none is named (tests, scripts, the demo's own database). */
export const SOLO_USER = "solo";

/**
 * The plan store on an open connection (A3: SQL Server, or SQLite for the demo). `close` closes the connection (so
 * only its one owner calls it). `backup` (SQLite only) copies the store before Reset local plan; `path` names the copy.
 */
export function planStoreOn(conn: Conn, opts: { now: () => Temporal.ZonedDateTime; userId: string; path?: string; backup?: (to: string) => Promise<void> }) {
  // A2: every statement below is this person's only (store/scope.ts); nothing here names user_id itself.
  const db = scopedDb(conn, opts.userId, () => opts.now().timeZoneId);

  const stamp = (): ZonedStamp => opts.now().toString({ smallestUnit: "second" });
  /** Every write runs in a transaction (joined when the caller has one open). */
  const tx = <T>(fn: () => Promise<T>): Promise<T> => db.tx(fn);

  /** The week's plan row, created if missing, with its updated time moved on. */
  const touchWeek = async (weekStart: IsoDate, at: ZonedStamp) =>
    (await db.run("INSERT INTO week_plans (week_start, committed_at, created_at, updated_at) VALUES (?, NULL, ?, ?) ON CONFLICT(week_start) DO UPDATE SET updated_at = excluded.updated_at", weekStart, at, at));
  /** One change to a week item: runs `change`, touches its week; returns the week it is on. */
  const weekItemChange = (id: number, change: (at: ZonedStamp) => Promise<unknown>): Promise<IsoDate> =>
    tx(async () => {
      const r = (await db.get("SELECT week_start FROM week_features WHERE id = ?", id)) as Row | undefined;
      if (!r) throw new PlanError("No such item on the week plan");
      const at = stamp();
      await change(at);
      (await touchWeek(r.week_start as string, at));
      return r.week_start as string;
    });

  const getPlan = async (date: IsoDate): Promise<DayPlan | null> => {
    const r = (await db.get("SELECT * FROM day_plans WHERE date = ?", date)) as Row | undefined;
    return r ? toPlan(r) : null;
  };
  const ensurePlan = async (date: IsoDate): Promise<DayPlan> => {
    const at = stamp();
    (await db.run("INSERT INTO day_plans (date, committed_at, created_at, updated_at) VALUES (?, NULL, ?, ?) ON CONFLICT(date) DO NOTHING", date, at, at));
    return (await getPlan(date))!;
  };
  const getPick = async (id: number): Promise<Pick | null> => {
    const r = (await db.get(`${PICK_SELECT} WHERE p.id = ?`, id)) as Row | undefined;
    return r ? toPick(r) : null;
  };
  const mustPick = async (id: number): Promise<Pick> => {
    const p = (await getPick(id));
    if (!p) throw new PlanError(`No pick ${id}`);
    return p;
  };
  const nextPosition = async (date: IsoDate, half: Half): Promise<number> =>
    (((await db.get("SELECT COALESCE(MAX(position), 0) AS m FROM picks WHERE date = ? AND half = ?", date, half)) as Row).m as number) + 1;

  async function insertPick(p: NewPick, carriedFrom: number | null = null): Promise<Pick> {
    (await ensurePlan(p.date));
    const at = stamp();
    const r = (await db.run(`INSERT INTO picks (date, half, client_key, kind, item_id, draft_id, title, item_type, item_url, size, status, carried_from, notes, position, created_at, updated_at, follow_up_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, NULL, ?, ?, ?, ?)`, p.date, p.half, p.clientKey, p.kind, p.itemId ?? null, p.draftId ?? null, p.title, p.itemType ?? null, p.itemUrl ?? null, p.size, carriedFrom, (await nextPosition(p.date, p.half)), at, at, p.followUpId ?? null));
    return (await getPick(r.lastId!))!;
  }

  const picksBetween = async (from: IsoDate, to: IsoDate): Promise<Pick[]> =>
    ((await db.all(`${PICK_SELECT} WHERE p.date >= ? AND p.date <= ? ORDER BY p.date, p.half, p.position`, from, to)) as Row[]).map(toPick);

  return {
    /** Creates the day plan if missing. */
    start: async (date: IsoDate): Promise<DayPlan> => (await ensurePlan(date)),
    day: getPlan,
    /** The day plans from one date to another (A3: read once for the carry-over target). */
    dayPlansBetween: async (from: IsoDate, to: IsoDate): Promise<DayPlan[]> => ((await db.all("SELECT * FROM day_plans WHERE date >= ? AND date <= ? ORDER BY date", from, to)) as Row[]).map(toPlan),
    getPick,
    picksFor: (date: IsoDate) => picksBetween(date, date),
    picksBetween,
    async carryOverFor(today: IsoDate, days?: number, pending?: (p: Pick) => boolean): Promise<Pick[]> {
      const from = Temporal.PlainDate.from(today).subtract({ days: Math.max(14, days ?? 0) }).toString();
      return carryOver((await picksBetween(from, today)), today, days, pending);
    },
    addPick: async (p: NewPick): Promise<Pick> => tx(async () => (await insertPick(p))),
    /** Before the day is committed a pick is simply removed; after, it is kept as dropped. */
    async removePick(id: number): Promise<{ result: "deleted" | "dropped"; pick: Pick }> {
      return tx(async () => {
        const p = (await mustPick(id));
        const committed = !!(await getPlan(p.date))?.committedAt;
        const referenced = (await db.get("SELECT 1 FROM picks WHERE carried_from = ?", id));
        if (!committed && !referenced && p.carriedFrom === null) {
          (await db.run("DELETE FROM picks WHERE id = ?", id));
          return { result: "deleted", pick: p };
        }
        if (p.carriedFrom !== null && !committed) {
          // Carried in this morning and dropped again: hand it back to the day it came from.
          (await db.run("DELETE FROM picks WHERE id = ?", id));
          (await db.run("UPDATE picks SET status = 'planned', updated_at = ? WHERE id = ? AND status = 'moved'", stamp(), p.carriedFrom));
          return { result: "deleted", pick: p };
        }
        (await db.run("UPDATE picks SET status = 'dropped', updated_at = ? WHERE id = ?", stamp(), id));
        return { result: "dropped", pick: (await mustPick(id)) };
      });
    },
    /** Settles a planned pick as dropped and keeps it, whatever the day's commit state (past days). */
    async drop(id: number): Promise<Pick> {
      return tx(async () => {
        const p = (await mustPick(id));
        if (p.status !== "planned") throw new PlanError("Only a planned pick can be dropped");
        (await db.run("UPDATE picks SET status = 'dropped', updated_at = ? WHERE id = ?", stamp(), id));
        return (await mustPick(id));
      });
    },
    async setSize(id: number, size: Size | null): Promise<Pick> {
      return tx(async () => {
        (await mustPick(id));
        (await db.run("UPDATE picks SET size = ?, updated_at = ? WHERE id = ?", size, stamp(), id));
        return (await mustPick(id));
      });
    },
    /** Same day: change block in place. Another day: the original becomes "moved" and a new pick is carried there. */
    async move(id: number, date: IsoDate, half: Half): Promise<Pick> {
      return tx(async () => {
        const p = (await mustPick(id));
        if (p.status !== "planned") throw new PlanError("Only a planned pick can be moved");
        if (p.date === date) {
          if (p.half === half) return p;
          (await db.run("UPDATE picks SET half = ?, position = ?, updated_at = ? WHERE id = ?", half, (await nextPosition(date, half)), stamp(), id));
          return (await mustPick(id));
        }
        (await db.run("UPDATE picks SET status = 'moved', updated_at = ? WHERE id = ?", stamp(), id));
        const base: NewPick = { date, half, clientKey: p.clientKey, kind: p.kind, title: p.title, itemType: p.itemType, itemUrl: p.itemUrl, size: p.size };
        if (p.itemId !== null) base.itemId = p.itemId;
        if (p.draftId !== null) base.draftId = p.draftId;
        if (p.followUpId !== null) base.followUpId = p.followUpId;
        return (await insertPick(base, p.id));
      });
    },
    async commit(date: IsoDate): Promise<DayPlan> {
      return tx(async () => {
        (await ensurePlan(date));
        const at = stamp();
        (await db.run("UPDATE day_plans SET committed_at = ?, updated_at = ? WHERE date = ?", at, at, date));
        return (await getPlan(date))!;
      });
    },
    async setDone(id: number, done: boolean): Promise<Pick> {
      return tx(async () => {
        const p = (await mustPick(id));
        if (p.status !== "planned" && p.status !== "done") throw new PlanError("Only a planned or done pick can be ticked");
        (await db.run("UPDATE picks SET status = ?, updated_at = ? WHERE id = ?", done ? "done" : "planned", stamp(), id));
        // Step 13.5: ticking a follow-up pick done closes the loop.
        const fu = ((await db.get("SELECT follow_up_id FROM picks WHERE id = ?", id)) as Row).follow_up_id as number | null;
        if (done && fu !== null) (await db.run("UPDATE follow_ups SET closed_at = ?, closed_by = 'me', outcome = 'done', close_note = COALESCE(close_note, 'Done as a pick'), snoozed_until = NULL WHERE id = ? AND closed_at IS NULL", stamp(), fu));
        return (await mustPick(id));
      });
    },
    async addDraft(d: { clientKey: string; parentItemId: number | null; title: string; size: Size; level?: "story" | "feature" }): Promise<DraftStory> {
      return tx(async () => {
        const at = stamp();
        const r = (await db.run("INSERT INTO draft_stories (client_key, parent_item_id, title, size, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", d.clientKey, d.parentItemId, d.title, d.size, d.level ?? "story", at, at));
        return toDraft((await db.get("SELECT * FROM draft_stories WHERE id = ?", r.lastId!)) as Row);
      });
    },
    async getDraft(id: number): Promise<DraftStory | null> {
      const r = (await db.get("SELECT * FROM draft_stories WHERE id = ?", id)) as Row | undefined;
      return r ? toDraft(r) : null;
    },
    /** Step 14.5 (D257): a parent for a draft before it is created in DevOps. Checked by the caller. */
    async setDraftParent(id: number, parentItemId: number): Promise<DraftStory> {
      return tx(async () => {
        const r = (await db.run("UPDATE draft_stories SET parent_item_id = ?, updated_at = ? WHERE id = ? AND devops_id IS NULL", parentItemId, stamp(), id));
        if (!r.changes) throw new PlanError("No such draft, or it is already in DevOps");
        return toDraft((await db.get("SELECT * FROM draft_stories WHERE id = ?", id)) as Row);
      });
    },
    /** Step 15.3: the draft editor's edits (checked by the caller). A new client clears the parent; refused while a pick uses it. */
    async updateDraft(id: number, patch: DraftPatch): Promise<DraftStory> {
      return tx(async () => {
        const r = (await db.get("SELECT * FROM draft_stories WHERE id = ?", id)) as Row | undefined;
        if (!r || r.devops_id != null) throw new PlanError("No such draft, or it is already in DevOps");
        const d = toDraft(r);
        const moved = patch.clientKey !== undefined && patch.clientKey !== d.clientKey;
        if (moved && ((await db.get("SELECT COUNT(*) AS n FROM picks WHERE draft_id = ? AND status IN ('planned','done')", id)) as { n: number }).n > 0)
          throw new PlanError("A pick uses this draft. Drop the pick first, then change the client");
        const n = { ...d, parentItemId: moved && patch.parentItemId === undefined ? null : d.parentItemId, ...patch };
        (await db.run("UPDATE draft_stories SET client_key = ?, parent_item_id = ?, title = ?, size = ?, description = ?, acceptance = ?, start_date = ?, target_date = ?, updated_at = ? WHERE id = ?", n.clientKey, n.parentItemId, n.title, n.size, n.description ?? null, n.acceptance ?? null, n.startDate ?? null, n.targetDate ?? null, stamp(), id));
        if (moved) (await db.run("UPDATE picks SET client_key = ? WHERE draft_id = ?", n.clientKey, id));
        // A planned pick of the draft shows its new title.
        if (n.title !== d.title) (await db.run("UPDATE picks SET title = ?, updated_at = ? WHERE draft_id = ? AND status = 'planned'", n.title, stamp(), id));
        return toDraft((await db.get("SELECT * FROM draft_stories WHERE id = ?", id)) as Row);
      });
    },
    /** Step 14.5: delete a local draft no pick uses (local only; DevOps is never touched). */
    async removeDraft(id: number): Promise<void> {
      await tx(async () => {
        const d = (await db.get("SELECT * FROM draft_stories WHERE id = ?", id)) as Row | undefined;
        if (!d) throw new PlanError("No such draft");
        if (d.devops_id != null) throw new PlanError("That draft is already in DevOps");
        const used = (await db.get("SELECT COUNT(*) AS n FROM picks WHERE draft_id = ?", id)) as { n: number };
        if (used.n > 0) throw new PlanError("A pick uses this draft. Drop the pick first, then delete the draft");
        (await db.run("DELETE FROM draft_stories WHERE id = ?", id));
      });
    },
    /** Drafts not yet created in DevOps (step 14: a created one leaves every draft list). */
    drafts: async (): Promise<DraftStory[]> => ((await db.all("SELECT * FROM draft_stories WHERE devops_id IS NULL ORDER BY id")) as Row[]).map(toDraft),
    /** U6: every draft, created in DevOps or not (a week-list draft feature turns into its week item once created). */
    allDrafts: async (): Promise<DraftStory[]> => ((await db.all("SELECT * FROM draft_stories ORDER BY id")) as Row[]).map(toDraft),
    /**
     * Step 14: a draft now exists in DevOps. The draft keeps its row with the new item, and its picks become item picks
     * for the new id (title, type, link), so the plan keeps them. Returns those pick ids, for undo.
     */
    async markDraftCreated(id: number, item: { itemId: number; url: string; title: string; type: string }): Promise<number[]> {
      return tx(async () => {
        const d = (await db.get("SELECT * FROM draft_stories WHERE id = ?", id)) as Row | undefined;
        if (!d) throw new PlanError("No such draft");
        if (d.devops_id != null) throw new PlanError("That draft is already in DevOps");
        const at = stamp();
        (await db.run("UPDATE draft_stories SET devops_id = ?, devops_url = ?, updated_at = ? WHERE id = ?", item.itemId, item.url, at, id));
        const picks = ((await db.all("SELECT id FROM picks WHERE draft_id = ?", id)) as Row[]).map((r) => r.id as number);
        (await db.run("UPDATE picks SET kind = 'item', item_id = ?, draft_id = NULL, title = ?, item_type = ?, item_url = ?, updated_at = ? WHERE draft_id = ?", item.itemId, item.title, item.type, item.url, at, id));
        return picks;
      });
    },
    /** Undo of a create (step 14): the draft is back, and the picks that were moved to the item point at it again. */
    async restoreDraft(id: number, pickIds: readonly number[]): Promise<void> {
      await tx(async () => {
        const d = (await db.get("SELECT * FROM draft_stories WHERE id = ?", id)) as Row | undefined;
        if (!d || d.devops_id == null) return;
        const at = stamp();
        for (const p of pickIds) (await db.run("UPDATE picks SET kind = 'draft', draft_id = ?, item_id = NULL, title = ?, item_type = NULL, item_url = NULL, updated_at = ? WHERE id = ? AND item_id = ?", id, d.title as string, at, p, d.devops_id as number));
        (await db.run("UPDATE draft_stories SET devops_id = NULL, devops_url = NULL, updated_at = ? WHERE id = ?", at, id));
      });
    },
    // ---- DevOps write identities and the DevOps audit log (step 14) ----
    async devopsIdentity(clientKey: string): Promise<DevOpsIdentityRow | null> {
      const r = (await db.get("SELECT * FROM devops_identities WHERE client_key = ?", clientKey)) as Row | undefined;
      return r ? toIdentity(r) : null;
    },
    devopsIdentities: async (): Promise<DevOpsIdentityRow[]> => ((await db.all("SELECT * FROM devops_identities ORDER BY client_key")) as Row[]).map(toIdentity),
    async setDevopsIdentity(i: Omit<DevOpsIdentityRow, "validatedAt">): Promise<DevOpsIdentityRow> {
      return tx(async () => {
        (await db.run(`INSERT INTO devops_identities (client_key, org, identity_id, name, email, validated_at, expires) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(client_key) DO UPDATE SET org = excluded.org, identity_id = excluded.identity_id, name = excluded.name, email = excluded.email, validated_at = excluded.validated_at, expires = excluded.expires`, i.clientKey, i.org, i.id, i.name, i.email, stamp(), i.expires));
        return (await this.devopsIdentity(i.clientKey))!;
      });
    },
    async clearDevopsIdentity(clientKey: string): Promise<void> {
      (await db.run("DELETE FROM devops_identities WHERE client_key = ?", clientKey));
    },
    async logDevopsWrite(w: NewDevOpsWrite): Promise<DevOpsWriteEntry> {
      return tx(async () => {
        const at = stamp();
        const r = (await db.run(`INSERT INTO devops_write_log (at, client_key, org, project, op, item_id, parent_id, title, identity, before, after, ops, rev_before, rev_after, comment_id, draft_id, pick_ids, follow_up_id, status, message, undo_of, undone_by, attempts, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, 1, ?)`, at, w.clientKey, w.org, w.project, w.op, w.itemId, w.parentId, w.title, w.identity, JSON.stringify(w.before), JSON.stringify(w.after), w.ops ? JSON.stringify(w.ops) : null, w.revBefore, w.revAfter, w.commentId, w.draftId, JSON.stringify(w.pickIds ?? []), w.followUpId, w.undoOf, at));
        return (await this.devopsWrite(r.lastId!))!;
      });
    },
    async devopsWrite(id: number): Promise<DevOpsWriteEntry | null> {
      const r = (await db.get("SELECT * FROM devops_write_log WHERE id = ?", id)) as Row | undefined;
      return r ? toDevopsWrite(r) : null;
    },
    async settleDevopsWrite(id: number, s: { status: DevOpsWriteEntry["status"]; message?: string | null; itemId?: number | null; revBefore?: number | null; revAfter?: number | null; commentId?: number | null; before?: Record<string, string | null>; pickIds?: number[]; retry?: boolean }): Promise<DevOpsWriteEntry> {
      return tx(async () => {
        const w = (await this.devopsWrite(id));
        if (!w) throw new PlanError("No such write");
        (await db.run("UPDATE devops_write_log SET status = ?, message = ?, item_id = ?, rev_before = ?, rev_after = ?, comment_id = ?, before = ?, pick_ids = ?, attempts = attempts + ?, updated_at = ? WHERE id = ?", s.status, s.message ?? null, s.itemId === undefined ? w.itemId : s.itemId, s.revBefore === undefined ? w.revBefore : s.revBefore, s.revAfter === undefined ? w.revAfter : s.revAfter,
          s.commentId === undefined ? w.commentId : s.commentId, JSON.stringify(s.before ?? w.before), JSON.stringify(s.pickIds ?? w.pickIds), s.retry ? 1 : 0, stamp(), id,));
        return (await this.devopsWrite(id))!;
      });
    },
    async markDevopsUndone(id: number, by: number): Promise<void> {
      (await db.run("UPDATE devops_write_log SET undone_by = ?, updated_at = ? WHERE id = ?", by, stamp(), id));
    },
    async devopsWriteLog(limit = 100): Promise<DevOpsWriteEntry[]> {
      return ((await db.all("SELECT * FROM devops_write_log ORDER BY id DESC LIMIT ?", limit)) as Row[]).map(toDevopsWrite);
    },
    // ---- unavailable time and flex sessions (step 6b) ----
    unavailableBetween: async (from: IsoDate, to: IsoDate): Promise<Unavailable[]> =>
      ((await db.all("SELECT * FROM unavailable WHERE date >= ? AND date <= ? ORDER BY date, start_at, id", from, to)) as Row[]).map(toUnavailable),
    async addUnavailable(u: NewUnavailable): Promise<Unavailable> {
      return tx(async () => {
        const at = stamp();
        const r = (await db.run("INSERT INTO unavailable (date, title, start_at, end_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", u.date, u.title, u.start, u.end, u.note ?? null, at, at));
        return toUnavailable((await db.get("SELECT * FROM unavailable WHERE id = ?", r.lastId!)) as Row);
      });
    },
    async getUnavailable(id: number): Promise<Unavailable | null> {
      const r = (await db.get("SELECT * FROM unavailable WHERE id = ?", id)) as Row | undefined;
      return r ? toUnavailable(r) : null;
    },
    async removeUnavailable(id: number): Promise<boolean> {
      return Number((await db.run("DELETE FROM unavailable WHERE id = ?", id)).changes) === 1;
    },
    flexBetween: async (from: IsoDate, to: IsoDate): Promise<FlexSession[]> =>
      ((await db.all("SELECT * FROM flex_sessions WHERE date >= ? AND date <= ? ORDER BY date, start_at, id", from, to)) as Row[]).map(toFlex),
    /** Flex sessions in a range with the date each is on (A3: read once where a plain rule asks about several days). */
    flexDays: async (from: IsoDate, to: IsoDate): Promise<{ date: IsoDate; flex: FlexSession }[]> =>
      ((await db.all("SELECT * FROM flex_sessions WHERE date >= ? AND date <= ? ORDER BY date, start_at, id", from, to)) as Row[]).map((r) => ({ date: r.date as string, flex: toFlex(r) })),
    async addFlex(f: NewFlex): Promise<FlexSession> {
      return tx(async () => {
        const at = stamp();
        const r = (await db.run("INSERT INTO flex_sessions (date, client_key, start_at, end_at, item_id, item_title, item_url, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", f.date, f.clientKey, f.start, f.end, f.itemId ?? null, f.itemTitle ?? null, f.itemUrl ?? null, f.note ?? null, at, at));
        return toFlex((await db.get("SELECT * FROM flex_sessions WHERE id = ?", r.lastId!)) as Row);
      });
    },
    async getFlex(id: number): Promise<FlexSession | null> {
      const r = (await db.get("SELECT * FROM flex_sessions WHERE id = ?", id)) as Row | undefined;
      return r ? toFlex(r) : null;
    },
    /** Removes a flex session that hasn't ended; an ended one has opened its follow-up and stays. */
    async removeFlex(id: number): Promise<boolean> {
      return tx(async () => {
        if ((await db.get("SELECT 1 FROM follow_ups WHERE source_kind = 'flex' AND source_id = ?", id))) throw new PlanError("This flex session has ended and opened its update follow-up; it stays");
        return Number((await db.run("DELETE FROM flex_sessions WHERE id = ?", id)).changes) === 1;
      });
    },
    /**
     * After a flex session ends, a "post the update to <client>" follow-up opens once (D126). Called on reads; returns
     * the follow-ups it opened. The follow-ups UI comes later; the rows are kept until then.
     */
    async openFlexFollowUps(now: Temporal.Instant): Promise<FollowUp[]> {
      return tx(async () => {
        const rows = (await db.all("SELECT f.* FROM flex_sessions f LEFT JOIN follow_ups l ON l.source_kind = 'flex' AND l.source_id = f.id WHERE l.id IS NULL")) as Row[];
        const opened: FollowUp[] = [];
        for (const f of rows.map(toFlex)) {
          if (Temporal.Instant.compare(Temporal.Instant.from(f.end), now) > 0) continue;
          const what = `Post the update to ${f.clientKey}${f.itemTitle ? ` on ${f.itemTitle}` : ""} after the flex session`;
          const r = (await db.run("INSERT INTO follow_ups (kind, client_key, what, source_kind, source_id, opened_at) VALUES ('flex_update', ?, ?, 'flex', ?, ?)", f.clientKey, what, f.id, stamp()));
          opened.push(toFollowUp((await db.get("SELECT * FROM follow_ups WHERE id = ?", r.lastId!)) as Row));
        }
        return opened;
      });
    },
    openFollowUps: async (): Promise<FollowUp[]> => ((await db.all("SELECT * FROM follow_ups WHERE closed_at IS NULL ORDER BY opened_at, id")) as Row[]).map(toFollowUp),
    /** Every follow-up, open first (step 6c follow-ups list). */
    allFollowUps: async (): Promise<FollowUp[]> => ((await db.all("SELECT * FROM follow_ups ORDER BY CASE WHEN closed_at IS NULL THEN 0 ELSE 1 END, opened_at, id")) as Row[]).map(toFollowUp),
    /**
     * Closes an open follow-up: "Close the loop" by hand (optional how and note), by a signal with its reason, or
     * "Not needed" (closed quietly, not counted as done).
     */
    async closeFollowUp(id: number, note: string | null, by: "me" | "signal" = "me", o: { how?: CloseHow | null; outcome?: "done" | "not_needed" } = {}): Promise<FollowUp> {
      return tx(async () => {
        const r = (await db.get("SELECT * FROM follow_ups WHERE id = ?", id)) as Row | undefined;
        if (!r) throw new PlanError(`No follow-up ${id}`);
        if (r.closed_at) throw new PlanError("That follow-up is already closed");
        (await db.run("UPDATE follow_ups SET closed_at = ?, close_note = ?, closed_by = ?, outcome = ?, close_how = ?, snoozed_until = NULL WHERE id = ?", stamp(), note, by, o.outcome ?? "done", o.how ?? null, id));
        return toFollowUp((await db.get("SELECT * FROM follow_ups WHERE id = ?", id)) as Row);
      });
    },
    /** Hidden from lists until that day (null wakes it now). */
    async snoozeFollowUp(id: number, until: IsoDate | null): Promise<FollowUp> {
      return tx(async () => {
        const r = (await db.run("UPDATE follow_ups SET snoozed_until = ? WHERE id = ? AND closed_at IS NULL", until, id));
        if (!Number(r.changes)) throw new PlanError((await db.get("SELECT 1 FROM follow_ups WHERE id = ?", id)) ? "That follow-up is already closed" : `No follow-up ${id}`);
        return toFollowUp((await db.get("SELECT * FROM follow_ups WHERE id = ?", id)) as Row);
      });
    },
    /** Only follow-ups I added (by hand or from a capture); a rule's follow-up is closed as Not needed instead. */
    async deleteFollowUp(id: number): Promise<void> {
      await tx(async () => {
        const r = (await db.get("SELECT * FROM follow_ups WHERE id = ?", id)) as Row | undefined;
        if (!r) throw new PlanError(`No follow-up ${id}`);
        if (!toFollowUp(r).byHand) throw new PlanError("FocusTime opened this one; use Not needed instead");
        (await db.run("UPDATE picks SET follow_up_id = NULL WHERE follow_up_id = ?", id));
        (await db.run("UPDATE captures SET routed_id = NULL WHERE routed_as = 'follow_up' AND routed_id = ?", id));
        (await db.run("DELETE FROM follow_ups WHERE id = ?", id));
      });
    },
    /** Edits client, who, what, channel and due of an open follow-up. */
    async editFollowUp(id: number, patch: Partial<FollowUpFields>): Promise<FollowUp> {
      return tx(async () => {
        const r = (await db.get("SELECT * FROM follow_ups WHERE id = ?", id)) as Row | undefined;
        if (!r) throw new PlanError(`No follow-up ${id}`);
        const f = toFollowUp(r);
        if (f.closedAt) throw new PlanError("That follow-up is already closed");
        // Step 15.2: a new client clears the linked item (an item belongs to one client).
        const moved = patch.clientKey !== undefined && patch.clientKey !== f.clientKey && patch.itemId === undefined;
        const n = { clientKey: f.clientKey, who: f.who, what: f.what, channel: f.channel, due: f.due, itemId: moved ? null : f.itemId, ...patch };
        if (!n.what.trim()) throw new PlanError("Say what you owe");
        if (n.itemId && !n.clientKey) throw new PlanError("A work item needs the client it belongs to");
        (await db.run("UPDATE follow_ups SET client_key = ?, who = ?, what = ?, channel = ?, due = ?, item_id = ? WHERE id = ?", n.clientKey, n.who, n.what, n.channel, n.due, n.itemId, id));
        return toFollowUp((await db.get("SELECT * FROM follow_ups WHERE id = ?", id)) as Row);
      });
    },
    async getFollowUp(id: number): Promise<FollowUp | null> {
      const r = (await db.get("SELECT * FROM follow_ups WHERE id = ?", id)) as Row | undefined;
      return r ? toFollowUp(r) : null;
    },
    /** Opens a rule's follow-up once per rule key (step 7). Null when that key already has a follow-up, open or closed. */
    async openRuleFollowUp(l: NewRuleFollowUp): Promise<FollowUp | null> {
      return tx(async () => {
        const r = (await db.run("INSERT INTO follow_ups (kind, client_key, who, what, item_id, rule_key, ref_at, draft, detail, origin, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(rule_key) DO NOTHING", l.kind, l.clientKey, l.who, l.what, l.itemId ?? null, l.ruleKey, l.refAt ?? null, l.draft ?? null, l.detail ? JSON.stringify(l.detail) : null, l.origin ? JSON.stringify(l.origin) : null, stamp()));
        return Number(r.changes) === 1 ? toFollowUp((await db.get("SELECT * FROM follow_ups WHERE id = ?", r.lastId!)) as Row) : null;
      });
    },
    /** A slip follow-up that is still open takes more slipped picks: its draft and the picks it covers. */
    async updateFollowUpDraft(id: number, what: string, draft: string, detail: { picks: number[] }, origin?: FollowUpOrigin | null): Promise<void> {
      (await db.run("UPDATE follow_ups SET what = ?, draft = ?, detail = ?, origin = COALESCE(?, origin) WHERE id = ? AND closed_at IS NULL", what, draft, JSON.stringify(detail), origin ? JSON.stringify(origin) : null, id));
    },
    /** A follow-up added by hand: who, what, optional due date. */
    // ---- quick capture (step 9) ----
    /** Saves a capture to the inbox: the plan store only, so it works with every source offline. */
    async addCapture(c: { text: string; clientKey: string | null }): Promise<Capture> {
      return tx(async () => {
        const text = c.text.trim();
        if (!text) throw new PlanError("Type something to capture");
        if (text.length > MAX_CAPTURE) throw new PlanError(`A capture is at most ${MAX_CAPTURE} characters`);
        const r = (await db.run("INSERT INTO captures (text, client_key, created_at) VALUES (?, ?, ?)", text, c.clientKey, stamp()));
        return toCapture((await db.get("SELECT * FROM captures WHERE id = ?", r.lastId!)) as Row);
      });
    },
    async getCapture(id: number): Promise<Capture | null> {
      const r = (await db.get("SELECT * FROM captures WHERE id = ?", id)) as Row | undefined;
      return r ? toCapture(r) : null;
    },
    /** Captures not routed yet, newest first. */
    inbox: async (): Promise<Capture[]> => ((await db.all("SELECT * FROM captures WHERE routed_at IS NULL ORDER BY id DESC")) as Row[]).map(toCapture),
    inboxCount: async (): Promise<number> => ((await db.get("SELECT COUNT(*) AS n FROM captures WHERE routed_at IS NULL")) as Row).n as number,
    /** Routes a capture once: makes the follow-up, draft story or note and marks the capture, in one transaction. */
    async routeCapture(id: number, r: CaptureRoute): Promise<Capture> {
      return tx(async () => {
        const c = (await db.get("SELECT * FROM captures WHERE id = ?", id)) as Row | undefined;
        if (!c) throw new PlanError("No such capture");
        if (c.routed_at) throw new PlanError("That capture is already sorted");
        const at = stamp();
        let routedId: number | null = null;
        if (r.as === "follow_up") {
          if (!r.what.trim()) throw new PlanError("A follow-up needs what you owe");
          routedId = Number((await db.run("INSERT INTO follow_ups (kind, client_key, who, what, due, channel, item_id, opened_at) VALUES ('capture', ?, ?, ?, ?, ?, ?, ?)", r.clientKey, r.who.trim() || null, r.what.trim(), r.due, r.channel ?? null, r.clientKey ? (r.itemId ?? null) : null, at)).lastId);
        } else if (r.as === "draft") {
          if (!r.title.trim()) throw new PlanError("A draft story needs a title");
          routedId = Number((await db.run("INSERT INTO draft_stories (client_key, parent_item_id, title, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", r.clientKey, r.parentItemId, r.title.trim(), r.size, at, at)).lastId);
        } else if (r.as === "draft_feature") {
          if (!r.title.trim()) throw new PlanError("A draft feature needs a title");
          routedId = Number((await db.run("INSERT INTO draft_stories (client_key, parent_item_id, title, size, level, target_date, created_at, updated_at) VALUES (?, ?, ?, 'M', 'feature', ?, ?, ?)", r.clientKey, r.parentItemId, r.title.trim(), r.targetDate ?? null, at, at)).lastId);
        }
        (await db.run("UPDATE captures SET routed_at = ?, routed_as = ?, routed_id = ? WHERE id = ?", at, r.as, routedId, id));
        return toCapture((await db.get("SELECT * FROM captures WHERE id = ?", id)) as Row);
      });
    },
    async addFollowUp(l: { who: string | null; what: string; due: IsoDate | null; clientKey?: string | null; channel?: string | null; itemId?: number | null }): Promise<FollowUp> {
      return tx(async () => {
        const r = (await db.run("INSERT INTO follow_ups (kind, client_key, who, what, due, channel, item_id, opened_at) VALUES ('manual', ?, ?, ?, ?, ?, ?, ?)", l.clientKey ?? null, l.who || null, l.what, l.due, l.channel ?? null, l.itemId ?? null, stamp()));
        return toFollowUp((await db.get("SELECT * FROM follow_ups WHERE id = ?", r.lastId!)) as Row);
      });
    },
    // ---- Close out, resume notes and borrowed time (step 7) ----
    /** Marks Close out done for a day (creating the day plan if there is none). */
    async closeOut(date: IsoDate): Promise<DayPlan> {
      return tx(async () => {
        (await ensurePlan(date));
        const at = stamp();
        (await db.run("UPDATE day_plans SET closed_out_at = ?, updated_at = ? WHERE date = ?", at, at, date));
        return (await getPlan(date))!;
      });
    },
    /** One note per client and day: writing again the same day replaces it; an empty note removes that day's. */
    async setResumeNote(clientKey: string, date: IsoDate, note: string): Promise<ResumeNote | null> {
      return tx(async () => {
        if (!note) {
          (await db.run("DELETE FROM resume_notes WHERE client_key = ? AND date = ?", clientKey, date));
          return null;
        }
        const at = stamp();
        (await db.run("INSERT INTO resume_notes (client_key, date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_key, date) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at", clientKey, date, note, at, at));
        return toNote((await db.get("SELECT * FROM resume_notes WHERE client_key = ? AND date = ?", clientKey, date)) as Row);
      });
    },
    /** The latest note per client (on or before `upTo` when given): the one that wins. */
    async latestNotes(upTo?: IsoDate): Promise<Record<string, ResumeNote>> {
      const rows = ((await db.all("SELECT * FROM resume_notes WHERE date <= ? ORDER BY date, updated_at, id", upTo ?? "9999-12-31")) as Row[]).map(toNote);
      return Object.fromEntries(rows.map((n) => [n.clientKey, n]));
    },
    notesOn: async (date: IsoDate): Promise<ResumeNote[]> => ((await db.all("SELECT * FROM resume_notes WHERE date = ? ORDER BY client_key", date)) as Row[]).map(toNote),
    noteHistory: async (clientKey: string): Promise<ResumeNote[]> => ((await db.all("SELECT * FROM resume_notes WHERE client_key = ? ORDER BY date DESC", clientKey)) as Row[]).map(toNote),
    /**
     * "I'll make it up": the pick moves to the payback day and slot, and borrowed time is recorded against the
     * moved pick, in one transaction.
     */
    async makeUp(id: number, to: { date: IsoDate; half: Half }, b: { minutes: number; payback: Borrowed["payback"] }): Promise<{ pick: Pick; borrowed: Borrowed }> {
      return tx(async () => {
        const p = (await mustPick(id));
        if (p.status !== "planned") throw new PlanError("Only a planned pick can be made up");
        if (p.date === to.date && p.half === to.half) throw new PlanError("That is where the pick already is");
        let moved: Pick;
        if (p.date === to.date) {
          (await db.run("UPDATE picks SET half = ?, position = ?, updated_at = ? WHERE id = ?", to.half, (await nextPosition(to.date, to.half)), stamp(), id));
          moved = (await mustPick(id));
        } else {
          (await db.run("UPDATE picks SET status = 'moved', updated_at = ? WHERE id = ?", stamp(), id));
          const base: NewPick = { date: to.date, half: to.half, clientKey: p.clientKey, kind: p.kind, title: p.title, itemType: p.itemType, itemUrl: p.itemUrl, size: p.size };
          if (p.itemId !== null) base.itemId = p.itemId;
          if (p.draftId !== null) base.draftId = p.draftId;
          if (p.followUpId !== null) base.followUpId = p.followUpId;
          moved = (await insertPick(base, p.id));
        }
        const r = (await db.run("INSERT INTO borrowed (pick_id, from_pick_id, client_key, title, date, minutes, payback, payback_date, payback_half, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", moved.id, p.id, p.clientKey, p.title, p.date, b.minutes, b.payback, to.date, to.half, stamp()));
        return { pick: moved, borrowed: toBorrowed((await db.get("SELECT * FROM borrowed WHERE id = ?", r.lastId!)) as Row) };
      });
    },
    /**
     * Borrowed time is paid once its payback pick is done, following the pick if it was moved on again. Called on
     * reads; returns the records it marked paid.
     */
    async settleBorrowed(): Promise<Borrowed[]> {
      return tx(async () => {
        const paid: Borrowed[] = [];
        for (const b of ((await db.all("SELECT * FROM borrowed WHERE paid_at IS NULL")) as Row[]).map(toBorrowed)) {
          let id: number | null = b.pickId;
          for (let hops = 0; id !== null && hops < 50; hops++) {
            const p = (await getPick(id));
            if (p?.status === "done") {
              (await db.run("UPDATE borrowed SET paid_at = ?, paid_by = 'picks' WHERE id = ?", stamp(), b.id));
              paid.push({ ...b, paidAt: stamp(), paidBy: "picks" });
              break;
            }
            id = p?.status === "moved" ? (((await db.get("SELECT id FROM picks WHERE carried_from = ? ORDER BY id DESC", id)) as Row | undefined)?.id as number | undefined) ?? null : null;
          }
        }
        return paid;
      });
    },
    async payBorrowed(id: number): Promise<Borrowed> {
      return tx(async () => {
        const r = (await db.get("SELECT * FROM borrowed WHERE id = ?", id)) as Row | undefined;
        if (!r) throw new PlanError(`No borrowed time ${id}`);
        if (r.paid_at) throw new PlanError("That is already paid");
        (await db.run("UPDATE borrowed SET paid_at = ?, paid_by = 'me' WHERE id = ?", stamp(), id));
        return toBorrowed((await db.get("SELECT * FROM borrowed WHERE id = ?", id)) as Row);
      });
    },
    /** Borrowed records from days in a range, plus every unpaid one. */
    borrowedFor: async (from: IsoDate, to: IsoDate): Promise<Borrowed[]> =>
      ((await db.all("SELECT * FROM borrowed WHERE (date >= ? AND date <= ?) OR paid_at IS NULL ORDER BY date, id", from, to)) as Row[]).map(toBorrowed),
    /** Picks by id (A3: the follow-up rules read the ones they need once). */
    async picksByIds(ids: readonly number[]): Promise<Pick[]> {
      const out: Pick[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        out.push(...((await db.all(`${PICK_SELECT} WHERE p.id IN (${part.map(() => "?").join(", ")})`, ...part)) as Row[]).map(toPick));
      }
      return out;
    },
    /** The picks carried from these picks (where moved ones went), oldest first. */
    async picksCarriedFrom(ids: readonly number[]): Promise<Pick[]> {
      const out: Pick[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        out.push(...((await db.all(`${PICK_SELECT} WHERE p.carried_from IN (${part.map(() => "?").join(", ")}) ORDER BY p.id`, ...part)) as Row[]).map(toPick));
      }
      return out;
    },
    /** The pick a moved pick went to (the latest one carried from it), for "moved to Wed PM". */
    async movedTo(id: number): Promise<Pick | null> {
      const r = (await db.get(`${PICK_SELECT} WHERE p.carried_from = ? ORDER BY p.id DESC`, id)) as Row | undefined;
      return r ? toPick(r) : null;
    },
    // ---- my VM and who signed in (step 15.4) ----
    async logAzureWrite(w: NewAzureWrite): Promise<AzureWriteEntry> {
      return tx(async () => {
        const at = stamp();
        const r = (await db.run("INSERT INTO azure_write_log (at, op, vm_id, vm_name, before, after, status, message, auto, attempts, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, 1, ?)", at, w.op, w.vmId, w.vmName, w.before === null ? null : JSON.stringify(w.before), w.after === null ? null : JSON.stringify(w.after), w.auto ? 1 : 0, at));
        return (await this.azureWrite(r.lastId!))!;
      });
    },
    async azureWrite(id: number): Promise<AzureWriteEntry | null> {
      const r = (await db.get("SELECT * FROM azure_write_log WHERE id = ?", id)) as Row | undefined;
      return r ? toAzureWrite(r) : null;
    },
    async settleAzureWrite(id: number, s: { status: AzureWriteEntry["status"]; message?: string | null; after?: unknown; retry?: boolean }): Promise<AzureWriteEntry> {
      return tx(async () => {
        const w = (await this.azureWrite(id));
        if (!w) throw new PlanError("No such write");
        (await db.run("UPDATE azure_write_log SET status = ?, message = ?, after = ?, attempts = attempts + ?, updated_at = ? WHERE id = ?", s.status, s.message ?? null, s.after === undefined ? (w.after === null ? null : JSON.stringify(w.after)) : JSON.stringify(s.after), s.retry ? 1 : 0, stamp(), id,));
        return (await this.azureWrite(id))!;
      });
    },
    async azureWriteLog(limit = 100): Promise<AzureWriteEntry[]> {
      return ((await db.all("SELECT * FROM azure_write_log ORDER BY id DESC LIMIT ?", limit)) as Row[]).map(toAzureWrite);
    },
    // ---- my Teams status during focus (step 16.3) ----
    async logTeamsStatus(e: Omit<TeamsStatusEntry, "id" | "at">): Promise<TeamsStatusEntry> {
      return tx(async () => {
        const r = (await db.run("INSERT INTO teams_status_log (at, op, status, minutes, result, message) VALUES (?, ?, ?, ?, ?, ?)", stamp(), e.op, e.status, e.minutes, e.result, e.message));
        return toTeamsStatus((await db.get("SELECT * FROM teams_status_log WHERE id = ?", r.lastId!)) as Row);
      });
    },
    async teamsStatusLog(limit = 100): Promise<TeamsStatusEntry[]> {
      return ((await db.all("SELECT * FROM teams_status_log ORDER BY id DESC LIMIT ?", limit)) as Row[]).map(toTeamsStatus);
    },
    /** Account state (step 15.4): who signed in, my VM, a changed schedule. Not emptied by Reset local plan. null removes. */
    async accountState<T>(key: string): Promise<T | null> {
      const r = (await db.get("SELECT value FROM account_state WHERE key = ?", key)) as Row | undefined;
      return r ? (JSON.parse(r.value as string) as T) : null;
    },
    async setAccountState(key: string, value: unknown): Promise<void> {
      return tx(async () => {
        if (value === null) (await db.run("DELETE FROM account_state WHERE key = ?", key));
        else (await db.run("INSERT INTO account_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", key, JSON.stringify(value), stamp()));
      });
    },
    /** Small JSON state that survives restarts (the focus timer). null removes it. */
    async getState<T>(key: string): Promise<T | null> {
      const r = (await db.get("SELECT value FROM kv WHERE key = ?", key)) as Row | undefined;
      return r ? (JSON.parse(r.value as string) as T) : null;
    },
    async setState(key: string, value: unknown): Promise<void> {
      return tx(async () => {
        if (value === null) (await db.run("DELETE FROM kv WHERE key = ?", key));
        else (await db.run("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", key, JSON.stringify(value), stamp()));
      });
    },
    /** Records focused time (step 6c); pickId null for a plain timer. */
    async addFocus(s: FocusSegment): Promise<void> {
      if (s.seconds <= 0) return;
      (await db.run("INSERT INTO focus_log (pick_id, label, started_at, ended_at, seconds) VALUES (?, ?, ?, ?, ?)", s.pickId, s.label, s.startedAt, s.endedAt, Math.round(s.seconds)));
    },
    /** Focused seconds per pick for these picks. */
    async focusedSeconds(pickIds: readonly number[]): Promise<Record<number, number>> {
      if (!pickIds.length) return {};
      const rows = (await db.all(`SELECT pick_id, SUM(seconds) AS s FROM focus_log WHERE pick_id IN (${pickIds.map(() => "?").join(",")}) GROUP BY pick_id`, ...pickIds)) as Row[];
      return Object.fromEntries(rows.map((r) => [r.pick_id as number, r.s as number]));
    },
    /**
     * Reset local plan (Q37): a full copy first (plan.db.bak-reset-<stamp>, 0600), then every plan table emptied in one
     * transaction. Returns the backup path. Not available for an in-memory store's backup (tests get null).
     */
    async reset(): Promise<string | null> {
      let bak: string | null = null;
      if (opts.path && opts.path !== ":memory:") {
        bak = `${opts.path}.bak-reset-${opts.now().toInstant().toString().replace(/[^0-9TZ]/g, "")}`;
        if (!opts.backup) throw new PlanError("This store can't be copied before a reset");
        await opts.backup(bak);
      }
      await tx(async () => {
        // FocusTime's Outlook events and the audit log stay: they are what lets it find, undo and remove its own events.
        (await db.run("UPDATE outlook_events SET timebox_id = NULL"));
        for (const t of RESET_TABLES) (await db.run(`DELETE FROM ${t}`));
      });
      return bak;
    },
    // ---- Plan the week (step 8) ----
    async weekPlan(weekStart: IsoDate): Promise<WeekPlanRecord> {
      const plan = (await db.get("SELECT * FROM week_plans WHERE week_start = ?", weekStart)) as Row | undefined;
      const rows = (await db.all("SELECT * FROM week_features WHERE week_start = ? ORDER BY id", weekStart)) as Row[];
      const slots = (await db.all("SELECT s.* FROM week_feature_slots s JOIN week_features f ON f.id = s.feature_id WHERE f.week_start = ? ORDER BY s.date, s.half", weekStart)) as Row[];
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
        estimate: (r.estimate as number | null) ?? null,
        size: (r.size as StorySize | null) ?? null,
        parentId: (r.parent_id as number | null) ?? null,
        slots: slots.filter((x) => x.feature_id === r.id).map((x) => ({ date: x.date as string, half: x.half as "AM" | "PM" })),
        doneAt: (r.done_at as string | null) ?? null,
        position: (r.position as number | null) ?? null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      }));
      const latest = [plan?.updated_at as string | undefined, ...features.map((x) => x.updatedAt)].filter((x): x is string => !!x).sort((a, b) => Temporal.Instant.compare(Temporal.ZonedDateTime.from(a).toInstant(), Temporal.ZonedDateTime.from(b).toInstant())).at(-1);
      return { weekStart, committedAt: (plan?.committed_at as string | null) ?? null, updatedAt: latest ?? null, features };
    },
    /** Step 8's call: a feature on a week with an estimate (a must when new); 0 takes it off. */
    async setWeekFeature(f: NewWeekFeature): Promise<WeekFeature | null> {
      return tx(async () => {
        if (f.estimate === 0) {
          const row = (await db.get("SELECT id FROM week_features WHERE week_start = ? AND client_key = ? AND item_id = ?", f.weekStart, f.clientKey, f.itemId)) as Row | undefined;
          if (row) (await this.removeWeekItem(row.id as number));
          return null;
        }
        return (await this.addWeekItem({ ...f, level: "feature" }));
      });
    },
    /**
     * Put a feature or story on a client's week list (step 11), or update it if there: title, type and link always;
     * tier, estimate and size when given. New items are musts with no estimate (4h) or size unless told otherwise.
     */
    async addWeekItem(f: NewWeekItem): Promise<WeekFeature> {
      if (f.level === "feature" && f.estimate != null && !validEstimateMinutes(f.estimate)) throw new PlanError(ESTIMATE_ERROR);
      if (f.level === "story" && f.size != null && !validStorySize(f.size)) throw new PlanError("size must be S, M or L");
      return tx(async () => {
        const at = stamp();
        // U3 (D388): never a second row for the same item, even under a client key in another letter case.
        const row = (await db.get("SELECT id, tier, level FROM week_features WHERE week_start = ? AND lower(client_key) = lower(?) AND item_id = ? ORDER BY id LIMIT 1", f.weekStart, f.clientKey, f.itemId)) as Row | undefined;
        (await touchWeek(f.weekStart, at));
        let id: number;
        const estimate = f.level === "feature" ? (f.estimate ?? null) : null;
        const size = f.level === "story" ? (f.size ?? null) : null;
        if (row) {
          id = row.id as number;
          (await db.run("UPDATE week_features SET title = ?, item_type = ?, url = ?, level = ?, updated_at = ? WHERE id = ?", f.title, f.itemType, f.url, f.level, at, id));
          if (row.level !== f.level) (await db.run("UPDATE week_features SET estimate = ?, size = ? WHERE id = ?", estimate, size, id));
          else if (f.level === "feature" && f.estimate !== undefined) (await db.run("UPDATE week_features SET estimate = ? WHERE id = ?", estimate, id));
          else if (f.level === "story" && f.size !== undefined) (await db.run("UPDATE week_features SET size = ? WHERE id = ?", size, id));
          if (f.parentId !== undefined) (await db.run("UPDATE week_features SET parent_id = ? WHERE id = ?", f.parentId, id));
          if (f.tier && f.tier !== row.tier) (await db.run("UPDATE week_features SET tier = ?, position = NULL WHERE id = ?", f.tier, id));
        } else {
          id = Number(
            (await db.run("INSERT INTO week_features (week_start, client_key, item_id, level, tier, title, item_type, url, estimate, size, parent_id, position, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)", f.weekStart, f.clientKey, f.itemId, f.level, f.tier ?? "must", f.title, f.itemType, f.url, estimate, size, f.parentId ?? null, at, at)).lastId,
          );
        }
        return (await this.weekPlan(f.weekStart)).features.find((x) => x.id === id)!;
      });
    },
    /** Must or nice to have; changing tier puts it back in DevOps order within the new tier. */
    async setWeekItemTier(id: number, tier: "must" | "nice"): Promise<WeekFeature> {
      return tx(async () => {
        const w = (await weekItemChange(id, async (at) => (await db.run("UPDATE week_features SET tier = ?, position = CASE WHEN tier = ? THEN position ELSE NULL END, updated_at = ? WHERE id = ?", tier, tier, at, id))));
        return (await this.weekPlan(w)).features.find((x) => x.id === id)!;
      });
    },
    /** A feature's estimate in minutes (whole hours, 1h to 80h), or null for 4h (E2). Stories have a size. */
    async setWeekItemEstimate(id: number, minutes: number | null): Promise<WeekFeature> {
      return tx(async () => {
        if (minutes !== null && !validEstimateMinutes(minutes)) throw new PlanError(ESTIMATE_ERROR);
        const row = (await db.get("SELECT level FROM week_features WHERE id = ?", id)) as Row | undefined;
        if (row && row.level !== "feature") throw new PlanError("A story has a size (S, M or L), not an estimate");
        const w = (await weekItemChange(id, async (at) => (await db.run("UPDATE week_features SET estimate = ?, updated_at = ? WHERE id = ?", minutes, at, id))));
        return (await this.weekPlan(w)).features.find((x) => x.id === id)!;
      });
    },
    /** A story's size on the week list (step 16.4), or null to clear it (E2: unsized counts as 2h). */
    async setWeekItemSize(id: number, size: StorySize | null): Promise<WeekFeature> {
      return tx(async () => {
        if (size !== null && !validStorySize(size)) throw new PlanError("size must be S, M or L");
        const row = (await db.get("SELECT level FROM week_features WHERE id = ?", id)) as Row | undefined;
        if (row && row.level !== "story") throw new PlanError("A feature has an estimate, not a size");
        const w = (await weekItemChange(id, async (at) => (await db.run("UPDATE week_features SET size = ?, updated_at = ? WHERE id = ?", size, at, id))));
        return (await this.weekPlan(w)).features.find((x) => x.id === id)!;
      });
    },
    /** Parent features as DevOps says now, for stories on a week's lists (no change to updated_at: not a plan edit). */
    async setWeekItemParents(weekStart: IsoDate, parents: readonly { clientKey: string; itemId: number; parentId: number | null }[]): Promise<void> {
      await tx(async () => {
        for (const p of parents) await db.run("UPDATE week_features SET parent_id = ? WHERE week_start = ? AND client_key = ? AND item_id = ? AND level = 'story' AND parent_id IS DISTINCT FROM ?", p.parentId, weekStart, p.clientKey, p.itemId, p.parentId);
      });
    },
    /** A local done mark (on) or taking it back (off). */
    async markWeekItemDone(id: number, on: boolean): Promise<WeekFeature> {
      return tx(async () => {
        const w = (await weekItemChange(id, async (at) => (await db.run("UPDATE week_features SET done_at = ?, updated_at = ? WHERE id = ?", on ? at : null, at, id))));
        return (await this.weekPlan(w)).features.find((x) => x.id === id)!;
      });
    },
    /**
     * A local order for one client's tier: positions 1..n for the items given (the rest of the tier follows in DevOps
     * order). `null` resets the client's whole list (both tiers) to DevOps order. Never written back to DevOps.
     */
    async reorderWeekItems(weekStart: IsoDate, clientKey: string, tier: "must" | "nice", order: readonly { itemId: number; position: number }[] | null): Promise<WeekPlanRecord> {
      await tx(async () => {
        const at = stamp();
        if (order === null) (await db.run("UPDATE week_features SET position = NULL, updated_at = ? WHERE week_start = ? AND client_key = ? AND position IS NOT NULL", at, weekStart, clientKey));
        else
          for (const o of order) {
            if (!Number.isInteger(o.position) || o.position < 1) throw new PlanError("position must be a whole number from 1");
            const r = (await db.run("UPDATE week_features SET position = ?, updated_at = ? WHERE week_start = ? AND client_key = ? AND tier = ? AND item_id = ?", o.position, at, weekStart, clientKey, tier, o.itemId));
            if (Number(r.changes) !== 1) throw new PlanError(`#${o.itemId} isn't a ${tier === "must" ? "must" : "nice to have"} on this client's week`);
          }
        (await touchWeek(weekStart, at));
      });
      return (await this.weekPlan(weekStart));
    },
    /** Take an item off the week list (its pins go with it). */
    async removeWeekItem(id: number): Promise<void> {
      await tx(async () => {
        const r = (await db.get("SELECT week_start FROM week_features WHERE id = ?", id)) as Row | undefined;
        if (!r) throw new PlanError("No such item on the week plan");
        (await db.run("DELETE FROM week_features WHERE id = ?", id));
        (await touchWeek(r.week_start as string, stamp()));
      });
    },
    async weekItem(id: number): Promise<WeekFeature | null> {
      const r = (await db.get("SELECT week_start FROM week_features WHERE id = ?", id)) as Row | undefined;
      return r ? ((await this.weekPlan(r.week_start as string)).features.find((x) => x.id === id) ?? null) : null;
    },
    /** Pin a week item to a block of its week (on) or unpin it (off). Pins don't change its estimate (step 11). */
    async placeFeature(featureId: number, date: IsoDate, half: "AM" | "PM", on: boolean): Promise<WeekFeature> {
      return tx(async () => {
        const r = (await db.get("SELECT * FROM week_features WHERE id = ?", featureId)) as Row | undefined;
        if (!r) throw new PlanError("No such feature on the week plan");
        const week = r.week_start as string;
        const offset = Temporal.PlainDate.from(week).until(Temporal.PlainDate.from(date)).days;
        if (offset < 0 || offset > 6) throw new PlanError("That block isn't in the feature's week");
        const at = stamp();
        if (on) (await db.run("INSERT INTO week_feature_slots (feature_id, date, half) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", featureId, date, half));
        else (await db.run("DELETE FROM week_feature_slots WHERE feature_id = ? AND date = ? AND half = ?", featureId, date, half));
        (await db.run("UPDATE week_features SET updated_at = ? WHERE id = ?", at, featureId));
        (await touchWeek(week, at));
        return (await this.weekPlan(week)).features.find((x) => x.id === featureId)!;
      });
    },
    async commitWeek(weekStart: IsoDate): Promise<WeekPlanRecord> {
      await tx(async () => {
        const at = stamp();
        (await touchWeek(weekStart, at));
        (await db.run("UPDATE week_plans SET committed_at = ?, updated_at = ? WHERE week_start = ?", at, at, weekStart));
      });
      return (await this.weekPlan(weekStart));
    },
    /** Committed features per week for these weeks (the week view and Plan the day). */
    async weekFeaturesFor(weekStarts: readonly IsoDate[]): Promise<WeekFeature[]> {
      const out: WeekFeature[] = [];
      for (const w of new Set(weekStarts)) out.push(...(await this.weekPlan(w)).features);
      return out;
    },
    /** U6: draft features on a week's list, with their tier, in the order they were added. */
    weekDrafts: async (weekStart: IsoDate): Promise<{ draftId: number; tier: "must" | "nice" }[]> =>
      ((await db.all("SELECT draft_id, tier FROM week_drafts WHERE week_start = ? ORDER BY created_at, draft_id", weekStart)) as Row[]).map((r) => ({ draftId: r.draft_id as number, tier: r.tier as "must" | "nice" })),
    /** U6: put a draft feature on a week's list as a must or a nice to have, or take it off (null). */
    async setWeekDraft(weekStart: IsoDate, draftId: number, tier: "must" | "nice" | null): Promise<void> {
      return tx(async () => {
        if (tier === null) {
          (await db.run("DELETE FROM week_drafts WHERE week_start = ? AND draft_id = ?", weekStart, draftId));
          return;
        }
        const d = (await db.get("SELECT level FROM draft_stories WHERE id = ?", draftId)) as Row | undefined;
        if (!d) throw new PlanError("No such draft");
        if (d.level !== "feature") throw new PlanError("Only a draft feature goes on the week list");
        (await db.run("INSERT INTO week_drafts (week_start, draft_id, tier, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(week_start, draft_id) DO UPDATE SET tier = excluded.tier", weekStart, draftId, tier, stamp()));
      });
    },
    /** U6: clients marked "Nothing this week" for a week. */
    weekQuiet: async (weekStart: IsoDate): Promise<string[]> => ((await db.all("SELECT client_key FROM week_quiet WHERE week_start = ? ORDER BY client_key", weekStart)) as Row[]).map((r) => r.client_key as string),
    async setWeekQuiet(weekStart: IsoDate, clientKey: string, on: boolean): Promise<void> {
      return tx(async () => {
        if (on) (await db.run("INSERT INTO week_quiet (week_start, client_key, marked_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", weekStart, clientKey, stamp()));
        else (await db.run("DELETE FROM week_quiet WHERE week_start = ? AND client_key = ?", weekStart, clientKey));
      });
    },
    async markBreakdown(clientKey: string, itemId: number, on: boolean): Promise<void> {
      return tx(async () => {
        if (on) (await db.run("INSERT INTO breakdown_marks (client_key, item_id, marked_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", clientKey, itemId, stamp()));
        else (await db.run("DELETE FROM breakdown_marks WHERE client_key = ? AND item_id = ?", clientKey, itemId));
      });
    },
    breakdownMarks: async (): Promise<{ clientKey: string; itemId: number; markedAt: ZonedStamp }[]> =>
      ((await db.all("SELECT * FROM breakdown_marks ORDER BY marked_at, client_key, item_id")) as Row[]).map((r) => ({ clientKey: r.client_key as string, itemId: r.item_id as number, markedAt: r.marked_at as string })),
    /** True the first time (kind, date) is marked, false after: "only once a day" across restarts. */
    async markOnce(kind: string, date: IsoDate): Promise<boolean> {
      const r = (await db.run("INSERT INTO markers (kind, date, at) VALUES (?, ?, ?) ON CONFLICT(kind, date) DO NOTHING", kind, date, stamp()));
      return Number(r.changes) === 1;
    },
    /** Every date marked with this kind (A3: read once where a plain rule asks about several). */
    markedDates: async (kind: string): Promise<Set<IsoDate>> => new Set(((await db.all("SELECT date FROM markers WHERE kind = ?", kind)) as Row[]).map((r) => r.date as string)),
    /** The weeks whose plan is committed (A3: read once where a plain rule asks about several). */
    committedWeeks: async (): Promise<Set<IsoDate>> => new Set(((await db.all("SELECT week_start FROM week_plans WHERE committed_at IS NOT NULL")) as Row[]).map((r) => r.week_start as string)),
    /** Whether (kind, date) was marked (step 15.4: the morning VM prompt dismissed for the day). */
    async marked(kind: string, date: IsoDate): Promise<boolean> {
      return !!(await db.get("SELECT 1 FROM markers WHERE kind = ? AND date = ?", kind, date));
    },
    async week(dates: IsoDate[]): Promise<PlanWeek> {
      const out: PlanWeek = {};
      for (const d of dates) {
        const plan = (await getPlan(d));
        if (plan) out[d] = { committedAt: plan.committedAt, closedOutAt: plan.closedOutAt, picks: (await picksBetween(d, d)) };
      }
      return out;
    },
    // ---- Timeboxes and Outlook writes (step 12) ----
    async timebox(id: number): Promise<Timebox | null> {
      const r = (await db.get("SELECT * FROM timeboxes WHERE id = ?", id)) as Row | undefined;
      return r ? toTimebox(r) : null;
    },
    async timeboxByUid(uid: string): Promise<Timebox | null> {
      const r = (await db.get("SELECT * FROM timeboxes WHERE uid = ?", uid)) as Row | undefined;
      return r ? toTimebox(r) : null;
    },
    /** Timeboxes on these dates, including removed ones whose Outlook event is still to be taken off. */
    async timeboxesBetween(from: IsoDate, to: IsoDate): Promise<Timebox[]> {
      return ((await db.all("SELECT * FROM timeboxes WHERE date >= ? AND date <= ? ORDER BY date, start_at, id", from, to)) as Row[]).map(toTimebox);
    },
    async addTimebox(t: NewTimebox): Promise<Timebox> {
      return tx(async () => {
        const at = stamp();
        const uid = t.uid ?? `tb-${crypto.randomUUID()}`;
        const r = (await db.run("INSERT INTO timeboxes (uid, date, client_key, pick_id, item_id, title, url, start_at, end_at, outlook, show_as, removed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)", uid, t.date, t.clientKey, t.pickId ?? null, t.itemId ?? null, t.title, t.url ?? null, t.start, t.end, t.outlook ? 1 : 0, t.showAs ?? "busy", at, at));
        return (await this.timebox(r.lastId!))!;
      });
    },
    /** Step 13.6 (D246): several timeboxes in one transaction (Timebox my day); none if one fails. */
    async addTimeboxes(list: readonly NewTimebox[]): Promise<Timebox[]> {
      return tx(async () => {
        const out: Timebox[] = [];
        for (const t of list) out.push(await this.addTimebox(t));
        return out;
      });
    },
    /** Move, resize, retitle, show as, toggle Outlook, put back (removedAt null), or a sync note and conflict (step 13). */
    async updateTimebox(id: number, patch: { start?: string; end?: string; date?: IsoDate; title?: string; showAs?: Timebox["showAs"]; outlook?: boolean; removedAt?: string | null; outlookNote?: string | null; conflict?: Timebox["conflict"]; pickId?: number | null }): Promise<Timebox> {
      return tx(async () => {
        const t = (await this.timebox(id));
        if (!t) throw new PlanError("No such timebox");
        const n = { ...t, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Timebox;
        (await db.run("UPDATE timeboxes SET date = ?, start_at = ?, end_at = ?, title = ?, show_as = ?, outlook = ?, removed_at = ?, outlook_note = ?, conflict = ?, pick_id = ?, updated_at = ? WHERE id = ?", n.date, n.start, n.end, n.title, n.showAs, n.outlook ? 1 : 0, n.removedAt, n.outlookNote, n.conflict ? JSON.stringify(n.conflict) : null, n.pickId, stamp(), id,));
        return (await this.timebox(id))!;
      });
    },
    /** Remove: kept as removed while its Outlook event still exists (so it can be taken off and undone), else deleted. */
    async removeTimebox(id: number): Promise<{ kept: boolean }> {
      return tx(async () => {
        const t = (await this.timebox(id));
        if (!t) throw new PlanError("No such timebox");
        const own = (await this.ownEvent(t.uid));
        if (own && !own.deletedAt) {
          (await this.updateTimebox(id, { removedAt: stamp() }));
          return { kept: true };
        }
        (await db.run("DELETE FROM timeboxes WHERE id = ?", id));
        return { kept: false };
      });
    },
    async ownEvent(uid: string): Promise<OwnEvent | null> {
      const r = (await db.get("SELECT * FROM outlook_events WHERE uid = ?", uid)) as Row | undefined;
      return r ? toOwn(r) : null;
    },
    /** Every Outlook event FocusTime created and hasn't deleted. */
    async ownEvents(): Promise<OwnEvent[]> {
      return ((await db.all("SELECT * FROM outlook_events WHERE deleted_at IS NULL ORDER BY created_at, uid")) as Row[]).map(toOwn);
    },
    /** Record a confirmed create or update: the event id and the fields now on Outlook. */
    async recordOwnEvent(uid: string, timeboxId: number | null, eventId: string, fields: Fields): Promise<void> {
      const at = stamp();
      (await db.run(`INSERT INTO outlook_events (uid, timebox_id, event_id, fields, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(uid) DO UPDATE SET timebox_id = excluded.timebox_id, event_id = excluded.event_id, fields = excluded.fields, updated_at = excluded.updated_at, deleted_at = NULL`, uid, timeboxId, eventId, JSON.stringify(fields), at, at));
    },
    /** A confirmed delete. A removed timebox stays (as removed) so undo can put it back. */
    async markOwnDeleted(uid: string): Promise<void> {
      const at = stamp();
      (await db.run("UPDATE outlook_events SET deleted_at = ?, updated_at = ? WHERE uid = ?", at, at, uid));
    },
    async logWrite(w: NewWrite): Promise<WriteEntry> {
      return tx(async () => {
        const at = stamp();
        const r = (await db.run(`INSERT INTO write_log (at, system, op, kind, uid, event_id, account, calendar, before, after, local_before, local_after, status, message, auto, undo_of, undone_by, attempts, updated_at)
             VALUES (?, 'outlook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`, at, w.op, w.kind ?? "timebox", w.uid, w.eventId, w.account, w.calendar, w.before ? JSON.stringify(w.before) : null, w.after ? JSON.stringify(w.after) : null, w.localBefore ? JSON.stringify(w.localBefore) : null, w.localAfter ? JSON.stringify(w.localAfter) : null, w.status ?? "pending", w.message ?? null, w.auto ? 1 : 0, w.undoOf ?? null, at));
        return (await this.writeEntry(r.lastId!))!;
      });
    },
    async writeEntry(id: number): Promise<WriteEntry | null> {
      const r = (await db.get("SELECT * FROM write_log WHERE id = ?", id)) as Row | undefined;
      return r ? toWrite(r) : null;
    },
    /** The result of an attempt (a retry adds one to attempts). */
    async settleWrite(id: number, s: { status: WriteStatus; message?: string | null; eventId?: string | null; before?: Fields | null; retry?: boolean }): Promise<WriteEntry> {
      return tx(async () => {
        const w = (await this.writeEntry(id));
        if (!w) throw new PlanError("No such write");
        (await db.run("UPDATE write_log SET status = ?, message = ?, event_id = ?, before = ?, attempts = attempts + ?, updated_at = ? WHERE id = ?", s.status, s.message ?? null, s.eventId === undefined ? w.eventId : s.eventId, s.before === undefined ? (w.before ? JSON.stringify(w.before) : null) : s.before ? JSON.stringify(s.before) : null, s.retry ? 1 : 0, stamp(), id,));
        return (await this.writeEntry(id))!;
      });
    },
    async markUndone(id: number, by: number): Promise<void> {
      (await db.run("UPDATE write_log SET undone_by = ?, updated_at = ? WHERE id = ?", by, stamp(), id));
    },
    // ---- Help invites (step 13) ----
    /** A help invite about to be sent: pending until Outlook confirms it (then sent, with its event id). */
    async addInvite(i: Omit<Invite, "id" | "createdAt" | "updatedAt" | "status" | "followUpId" | "eventId">): Promise<Invite> {
      return tx(async () => {
        const at = stamp();
        (await db.run(`INSERT INTO invites (uid, client_key, item_id, pick_id, timebox_id, title, url, start_at, end_at, attendees, teams, note, event_id, status, follow_up_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, ?)
           ON CONFLICT(uid) DO NOTHING`, i.uid, i.clientKey, i.itemId, i.pickId, i.timeboxId, i.title, i.url, i.start, i.end, JSON.stringify(i.attendees), i.teams ? 1 : 0, i.note, at, at));
        return (await this.invite(i.uid))!;
      });
    },
    async invite(uid: string): Promise<Invite | null> {
      const r = (await db.get("SELECT * FROM invites WHERE uid = ?", uid)) as Row | undefined;
      return r ? toInvite(r) : null;
    },
    /** Invites (sent and cancelled) that start on or after `from`, by start. */
    async invitesFrom(from: string): Promise<Invite[]> {
      return ((await db.all("SELECT * FROM invites WHERE start_at >= ? ORDER BY start_at, id", from)) as Row[]).map(toInvite);
    },
    async setInvite(uid: string, patch: { status?: Invite["status"]; followUpId?: number | null; eventId?: string | null }): Promise<void> {
      return tx(async () => {
        const i = (await this.invite(uid));
        if (!i) return;
        (await db.run("UPDATE invites SET status = ?, follow_up_id = ?, event_id = ?, updated_at = ? WHERE uid = ?", patch.status ?? i.status, patch.followUpId === undefined ? i.followUpId : patch.followUpId, patch.eventId === undefined ? i.eventId : patch.eventId, stamp(), uid));
      });
    },
    /** Help session follow-ups close once the meeting has ended (step 13). */
    async closeHelpFollowUps(now: Temporal.Instant): Promise<number> {
      return tx(async () => {
        const open = ((await db.all("SELECT * FROM follow_ups WHERE kind = 'help' AND closed_at IS NULL AND ref_at IS NOT NULL")) as Row[]).map(toFollowUp);
        let n = 0;
        for (const l of open) if (Temporal.Instant.compare(Temporal.Instant.from(l.refAt!), now) <= 0) ((await this.closeFollowUp(l.id, "The help session time has passed", "signal")), n++);
        return n;
      });
    },
    /** The audit log, newest first. */
    /**
     * Step 16 (D280): today's done and open counts per item, one row per item per day (a later load that day
     * replaces it); rows older than 120 days are dropped.
     */
    async recordSnapshots(date: IsoDate, rows: readonly { clientKey: string; itemId: number; done: number; open: number }[]): Promise<void> {
      await tx(async () => {
        for (const r of rows) await db.run("INSERT INTO delivery_snapshots (client_key, item_id, date, done, open) VALUES (?, ?, ?, ?, ?) ON CONFLICT (client_key, item_id, date) DO UPDATE SET done = excluded.done, open = excluded.open", r.clientKey, r.itemId, date, r.done, r.open);
        (await db.run("DELETE FROM delivery_snapshots WHERE date < ?", Temporal.PlainDate.from(date).subtract({ days: 120 }).toString()));
      });
    },
    /** Snapshots from a date on, per item ("<client>:<id>"), oldest first. */
    async snapshotsFrom(from: IsoDate): Promise<Map<string, { date: IsoDate; done: number; open: number }[]>> {
      const out = new Map<string, { date: IsoDate; done: number; open: number }[]>();
      for (const r of (await db.all("SELECT * FROM delivery_snapshots WHERE date >= ? ORDER BY date", from)) as Row[]) {
        const k = `${r.client_key as string}:${r.item_id as number}`;
        if (!out.has(k)) out.set(k, []);
        out.get(k)!.push({ date: r.date as string, done: r.done as number, open: r.open as number });
      }
      return out;
    },
    /** Step 17: dates dragged on Plan ahead's timeline, per item ("<client>:<id>"). */
    async roadmapDates(): Promise<Map<string, { start: IsoDate; end: IsoDate }>> {
      const out = new Map<string, { start: IsoDate; end: IsoDate }>();
      for (const r of (await db.all("SELECT * FROM roadmap_dates")) as Row[]) out.set(`${r.client_key as string}:${r.item_id as number}`, { start: r.start_date as string, end: r.end_date as string });
      return out;
    },
    /** Keep dragged dates (null clears them: back to DevOps or the estimate). */
    async setRoadmapDates(clientKey: string, itemId: number, dates: { start: IsoDate; end: IsoDate } | null): Promise<void> {
      return tx(async () => {
        if (!dates) {
          (await db.run("DELETE FROM roadmap_dates WHERE client_key = ? AND item_id = ?", clientKey, itemId));
          return;
        }
        if (dates.end < dates.start) throw new PlanError("The end date is before the start date");
        (await db.run("INSERT INTO roadmap_dates (client_key, item_id, start_date, end_date, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (client_key, item_id) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date, updated_at = excluded.updated_at", clientKey, itemId, dates.start, dates.end, stamp()));
      });
    },
    /** S1 (D451): first-run setup, each step done, skipped or dismissed. Empty: never started. */
    async setupState(): Promise<SetupState> {
      const out: SetupState = {};
      for (const r of (await db.all("SELECT step, status FROM setup_state")) as Row[]) if (validSetupStep(r.step) && validSetupStatus(r.status)) out[r.step] = r.status;
      return out;
    },
    async setSetupStep(step: SetupStep, status: SetupStatus): Promise<void> {
      if (!validSetupStep(step) || !validSetupStatus(status)) throw new PlanError("Unknown setup step");
      return tx(async () => void (await db.run("INSERT INTO setup_state (step, status, updated_at) VALUES (?, ?, ?) ON CONFLICT (step) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at", step, status, stamp())));
    },
    /** Forgets the setup record (Settings > Setup > Start over; the dev reset): the flow shows again on the next open. */
    async resetSetup(): Promise<void> {
      return tx(async () => void (await db.run("DELETE FROM setup_state")));
    },
    async writeLog(limit = 100): Promise<WriteEntry[]> {
      return ((await db.all("SELECT * FROM write_log ORDER BY id DESC LIMIT ?", limit)) as Row[]).map(toWrite);
    },
    schemaVersion: () => schemaVersion(conn),
    async exportJson() {
      const weeks = ((await db.all("SELECT DISTINCT week_start FROM week_features ORDER BY week_start")) as Row[]).map((r) => r.week_start as string);
      const weekFeatures: WeekFeature[] = [];
      for (const w of weeks) weekFeatures.push(...(await this.weekPlan(w)).features);
      return {
        exportedAt: stamp(),
        // The user tables' version (the same from SQLite and SQL Server; store/user-data.ts).
        schemaVersion: USER_SCHEMA_VERSION,
        dayPlans: ((await db.all("SELECT * FROM day_plans ORDER BY date")) as Row[]).map(toPlan),
        picks: ((await db.all(`${PICK_SELECT} ORDER BY p.date, p.half, p.position`)) as Row[]).map(toPick),
        draftStories: ((await db.all("SELECT * FROM draft_stories ORDER BY id")) as Row[]).map(toDraft),
        unavailable: ((await db.all("SELECT * FROM unavailable ORDER BY date, start_at, id")) as Row[]).map(toUnavailable),
        flexSessions: ((await db.all("SELECT * FROM flex_sessions ORDER BY date, start_at, id")) as Row[]).map(toFlex),
        followUps: ((await db.all("SELECT * FROM follow_ups ORDER BY id")) as Row[]).map(toFollowUp),
        resumeNotes: ((await db.all("SELECT * FROM resume_notes ORDER BY date, client_key")) as Row[]).map(toNote),
        borrowed: ((await db.all("SELECT * FROM borrowed ORDER BY id")) as Row[]).map(toBorrowed),
        weekPlans: (await db.all("SELECT * FROM week_plans ORDER BY week_start")) as Row[],
        weekFeatures,
        breakdownMarks: (await this.breakdownMarks()),
        weekDrafts: (await db.all("SELECT * FROM week_drafts ORDER BY week_start, created_at, draft_id")) as Row[],
        weekQuiet: (await db.all("SELECT * FROM week_quiet ORDER BY week_start, client_key")) as Row[],
        captures: ((await db.all("SELECT * FROM captures ORDER BY id")) as Row[]).map(toCapture),
        timeboxes: ((await db.all("SELECT * FROM timeboxes ORDER BY date, start_at, id")) as Row[]).map(toTimebox),
        outlookEvents: ((await db.all("SELECT * FROM outlook_events ORDER BY created_at, uid")) as Row[]).map(toOwn),
        writeLog: ((await db.all("SELECT * FROM write_log ORDER BY id")) as Row[]).map(toWrite),
        invites: ((await db.all("SELECT * FROM invites ORDER BY id")) as Row[]).map(toInvite),
        devopsIdentities: (await this.devopsIdentities()),
        devopsWriteLog: ((await db.all("SELECT * FROM devops_write_log ORDER BY id")) as Row[]).map(toDevopsWrite),
        azureWriteLog: ((await db.all("SELECT * FROM azure_write_log ORDER BY id")) as Row[]).map(toAzureWrite),
        teamsStatusLog: ((await db.all("SELECT * FROM teams_status_log ORDER BY id")) as Row[]).map(toTeamsStatus),
        roadmapDates: [...(await this.roadmapDates())].map(([k, d]) => ({ item: k, ...d })),
      };
    },
    close: () => conn.close(),
  };
}

export type PlanStore = ReturnType<typeof planStoreOn>;

/** The schema version of a store: SQLite's migrations table, or SQL Server's schema_version (store/sql/migrate.ts). */
export async function schemaVersion(conn: Conn): Promise<number> {
  const table = conn.dialect === "sqlserver" ? "schema_version" : "schema_migrations";
  return (((await conn.get(`SELECT COALESCE(MAX(version), 0) AS v FROM ${table}`)) as Row | undefined)?.v as number) ?? 0;
}

function sqliteVersion(db: DatabaseSync): number {
  return ((db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as Row).v as number) ?? 0;
}

/** Where the copy taken before a migration goes: plan.db.bak-v<from>-<stamp>, next to the store, 0600. */
export const backupPath = (path: string, from: number, stamp: string) => `${path}.bak-v${from}-${stamp.replace(/[^0-9TZ]/g, "")}`;

function migrate(db: DatabaseSync, now: () => Temporal.ZonedDateTime, path = ":memory:", files?: StoreFiles, log?: Logger, named: readonly NamedMigration[] = NAMED_MIGRATIONS) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.exec(`CREATE TABLE IF NOT EXISTS ${NAMES_TABLE} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const current = sqliteVersion(db);
  if (current > MIGRATIONS.length) throw new Error(`Plan store is from a newer FocusTime (schema ${current}); not opening it`);
  // S1 (D458): the timestamped migrations still to apply, after every numbered one, in name order.
  const todo = pending(named, new Set((db.prepare(`SELECT name FROM ${NAMES_TABLE}`).all() as { name: string }[]).map((r) => r.name)));
  // A store with data gets a full copy before any schema change (D125).
  if (current > 0 && (current < MIGRATIONS.length || todo.length) && path !== ":memory:") {
    const bak = backupPath(path, current, now().toInstant().toString());
    db.prepare("VACUUM INTO ?").run(bak);
    files?.secure(bak);
  }
  for (let v = current + 1; v <= MIGRATIONS.length; v++) {
    // A table rebuild (SQLite's documented procedure): foreign keys off around it, then checked before commit.
    const rebuild = MIGRATIONS[v - 1]!.trimStart().startsWith(FK_OFF);
    if (rebuild) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      const converting = v === ESTIMATE_CONVERSION.sqliteVersion ? Number((db.prepare(ESTIMATE_CONVERSION.count).get() as { n: number }).n) : null;
      db.exec(MIGRATIONS[v - 1]!);
      if (converting !== null) log?.({ source: "database", op: "convert_estimates", count: converting });
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
  for (const m of todo) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sqlite);
      db.prepare(`INSERT INTO ${NAMES_TABLE} (name, applied_at) VALUES (?, ?)`).run(m.name, now().toString({ smallestUnit: "second" }));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
