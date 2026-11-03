// A3: the plan store's schema on SQL Server, as one baseline: SQLite's 26 migrations (store/plan-store.ts MIGRATIONS)
// folded into the schema they end at, version 26, in T-SQL. Later changes are new entries in SQLSERVER_MIGRATIONS
// (store/sql/migrate.ts runs them: one transaction each, recorded in schema_version, skipped when applied).
//
// Types (docs/azure/A3-report.md): times FocusTime stamps are datetime2(7) in UTC; dates are date; ids are int
// identities (the same numbers as SQLite's); flags are bit; JSON is nvarchar(max) with an ISJSON check. The times a
// person or a calendar gives (a timebox's start and end, an invite's, a flex session's, a follow-up's reference time)
// stay the text they were given, with their offset and zone name (nvarchar(100)), as in SQLite. Every per-person table has user_id first in its
// key or an index, and a foreign key to users.

const USER = "user_id nvarchar(64) NOT NULL REFERENCES users(id)";
const JSON_NULL = (c: string) => `${c} nvarchar(max) NULL CHECK (${c} IS NULL OR ISJSON(${c}) = 1)`;
const JSON_NOT_NULL = (c: string) => `${c} nvarchar(max) NOT NULL CHECK (ISJSON(${c}) = 1)`;

export const BASELINE_VERSION = 26;

export const BASELINE = `
CREATE TABLE users (
  id nvarchar(64) NOT NULL PRIMARY KEY CHECK (LEN(id) >= 1),
  tenant_id nvarchar(64) NOT NULL,
  upn nvarchar(320) NOT NULL,
  display_name nvarchar(256) NOT NULL,
  email nvarchar(320) NULL,
  time_zone nvarchar(64) NULL,
  created_at datetime2(7) NOT NULL,
  last_sign_in_at datetime2(7) NOT NULL,
  deleted_at datetime2(7) NULL
);

-- Sessions and sign-ins in progress: app tables. A demo session's person has no users row, so no reference here.
CREATE TABLE sessions (
  id nvarchar(64) NOT NULL PRIMARY KEY,
  user_id nvarchar(64) NOT NULL,
  demo bit NOT NULL DEFAULT 0,
  csrf nvarchar(64) NOT NULL,
  created_at datetime2(7) NOT NULL,
  last_seen_at datetime2(7) NOT NULL,
  expires_at datetime2(7) NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE auth_requests (
  state nvarchar(64) NOT NULL PRIMARY KEY,
  kind nvarchar(16) NOT NULL CHECK (kind IN ('microsoft', 'google')),
  nonce nvarchar(128) NOT NULL,
  verifier nvarchar(128) NOT NULL,
  user_id nvarchar(64) NULL,
  created_at datetime2(7) NOT NULL
);

CREATE TABLE deletions (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  user_hash char(64) NOT NULL,
  requested_at datetime2(7) NOT NULL,
  hard_deleted_at datetime2(7) NULL
);

CREATE TABLE day_plans (
  ${USER},
  date date NOT NULL,
  committed_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  closed_out_at datetime2(7) NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE draft_stories (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  parent_item_id int NULL,
  title nvarchar(max) NOT NULL,
  size nvarchar(1) NOT NULL CHECK (size IN ('S','M','L')),
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  level nvarchar(16) NOT NULL DEFAULT 'story' CHECK (level IN ('story', 'feature')),
  devops_id int NULL,
  devops_url nvarchar(max) NULL,
  description nvarchar(max) NULL,
  acceptance nvarchar(max) NULL,
  start_date date NULL,
  target_date date NULL
);
CREATE INDEX draft_stories_user ON draft_stories(user_id, id);

CREATE TABLE follow_ups (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  kind nvarchar(32) NOT NULL,
  client_key nvarchar(100) NULL,
  what nvarchar(max) NOT NULL,
  channel nvarchar(200) NULL,
  due date NULL,
  source_kind nvarchar(32) NULL,
  source_id int NULL,
  opened_at datetime2(7) NOT NULL,
  closed_at datetime2(7) NULL,
  close_note nvarchar(max) NULL,
  who nvarchar(400) NULL,
  item_id int NULL,
  rule_key nvarchar(400) NULL,
  ref_at nvarchar(100) NULL,
  draft nvarchar(max) NULL,
  ${JSON_NULL("detail")},
  closed_by nvarchar(16) NULL,
  outcome nvarchar(16) NULL CHECK (outcome IN ('done', 'not_needed')),
  close_how nvarchar(16) NULL CHECK (close_how IN ('teams', 'email', 'devops', 'call')),
  snoozed_until date NULL,
  ${JSON_NULL("origin")}
);
CREATE INDEX follow_ups_user ON follow_ups(user_id, closed_at);
-- SQLite's unique keys allow any number of NULLs; SQL Server's filtered indexes do the same.
CREATE UNIQUE INDEX follow_ups_rule ON follow_ups(user_id, rule_key) WHERE rule_key IS NOT NULL;
CREATE UNIQUE INDEX follow_ups_source ON follow_ups(user_id, source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE week_features (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  week_start date NOT NULL,
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  level nvarchar(16) NOT NULL DEFAULT 'feature' CHECK (level IN ('feature','story')),
  tier nvarchar(8) NOT NULL DEFAULT 'must' CHECK (tier IN ('must','nice')),
  title nvarchar(max) NOT NULL,
  item_type nvarchar(100) NULL,
  url nvarchar(max) NULL,
  blocks int NULL,
  size nvarchar(1) NULL,
  parent_id int NULL,
  position int NULL,
  done_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  CONSTRAINT week_features_blocks CHECK (blocks IS NULL OR (blocks BETWEEN 1 AND 20 AND level = 'feature')),
  CONSTRAINT week_features_size CHECK (size IS NULL OR (size IN ('S','M','L') AND level = 'story')),
  CONSTRAINT week_features_item UNIQUE (user_id, week_start, client_key, item_id)
);

CREATE TABLE picks (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  date date NOT NULL,
  half nvarchar(3) NOT NULL CHECK (half IN ('AM','PM','EVE')),
  client_key nvarchar(100) NOT NULL,
  kind nvarchar(16) NOT NULL CHECK (kind IN ('item','draft','intention')),
  item_id int NULL,
  draft_id int NULL REFERENCES draft_stories(id),
  title nvarchar(max) NOT NULL,
  item_type nvarchar(100) NULL,
  item_url nvarchar(max) NULL,
  size nvarchar(1) NOT NULL CHECK (size IN ('S','M','L')),
  status nvarchar(16) NOT NULL CHECK (status IN ('planned','done','moved','dropped')),
  carried_from int NULL REFERENCES picks(id),
  notes nvarchar(max) NULL,
  position int NOT NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  follow_up_id int NULL REFERENCES follow_ups(id),
  CONSTRAINT picks_day FOREIGN KEY (user_id, date) REFERENCES day_plans(user_id, date),
  CONSTRAINT picks_item CHECK ((kind = 'item' AND item_id IS NOT NULL) OR (kind <> 'item' AND item_id IS NULL)),
  CONSTRAINT picks_draft CHECK ((kind = 'draft' AND draft_id IS NOT NULL) OR (kind <> 'draft' AND draft_id IS NULL))
);
CREATE INDEX picks_date ON picks(user_id, date, half, position);
CREATE INDEX picks_carried ON picks(user_id, carried_from);

CREATE TABLE borrowed (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  pick_id int NOT NULL REFERENCES picks(id),
  from_pick_id int NOT NULL REFERENCES picks(id),
  client_key nvarchar(100) NOT NULL,
  title nvarchar(max) NOT NULL,
  date date NOT NULL,
  minutes int NOT NULL CHECK (minutes > 0),
  payback nvarchar(16) NOT NULL CHECK (payback IN ('tonight','friday','day')),
  payback_date date NOT NULL,
  payback_half nvarchar(3) NOT NULL CHECK (payback_half IN ('AM','PM','EVE')),
  created_at datetime2(7) NOT NULL,
  paid_at datetime2(7) NULL,
  paid_by nvarchar(8) NULL CHECK (paid_by IN ('picks','me'))
);
CREATE INDEX borrowed_user ON borrowed(user_id, date);

CREATE TABLE timeboxes (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  uid nvarchar(200) NOT NULL,
  date date NOT NULL,
  client_key nvarchar(100) NOT NULL,
  pick_id int NULL REFERENCES picks(id) ON DELETE SET NULL,
  item_id int NULL,
  title nvarchar(max) NOT NULL,
  url nvarchar(max) NULL,
  start_at nvarchar(100) NOT NULL,
  end_at nvarchar(100) NOT NULL,
  outlook bit NOT NULL DEFAULT 0,
  removed_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  show_as nvarchar(32) NOT NULL DEFAULT 'busy' CHECK (show_as IN ('busy', 'tentative', 'free', 'oof', 'workingElsewhere')),
  outlook_note nvarchar(max) NULL,
  ${JSON_NULL("conflict")},
  CONSTRAINT timeboxes_uid UNIQUE (user_id, uid)
);
CREATE INDEX timeboxes_date ON timeboxes(user_id, date);

CREATE TABLE week_feature_slots (
  ${USER},
  feature_id int NOT NULL REFERENCES week_features(id) ON DELETE CASCADE,
  date date NOT NULL,
  half nvarchar(3) NOT NULL CHECK (half IN ('AM','PM')),
  PRIMARY KEY (user_id, feature_id, date, half)
);

CREATE TABLE week_drafts (
  ${USER},
  week_start date NOT NULL,
  draft_id int NOT NULL REFERENCES draft_stories(id) ON DELETE CASCADE,
  tier nvarchar(8) NOT NULL CHECK (tier IN ('must', 'nice')),
  created_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, week_start, draft_id)
);

CREATE TABLE account_state (
  ${USER},
  [key] nvarchar(200) NOT NULL,
  ${JSON_NOT_NULL("value")},
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, [key])
);

CREATE TABLE azure_write_log (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  op nvarchar(32) NOT NULL CHECK (op IN ('start', 'deallocate', 'shutdown_change', 'shutdown_restore')),
  vm_id nvarchar(1000) NOT NULL,
  vm_name nvarchar(200) NOT NULL,
  ${JSON_NULL("before")},
  ${JSON_NULL("after")},
  status nvarchar(16) NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed', 'timed_out', 'refused')),
  message nvarchar(max) NULL,
  auto bit NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 1,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX azure_write_log_user ON azure_write_log(user_id, id);

CREATE TABLE breakdown_marks (
  ${USER},
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  marked_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, client_key, item_id)
);

CREATE TABLE captures (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  text nvarchar(1000) NOT NULL CHECK (LEN(text) >= 1),
  client_key nvarchar(100) NULL,
  created_at datetime2(7) NOT NULL,
  routed_at datetime2(7) NULL,
  routed_as nvarchar(16) NULL CHECK (routed_as IN ('follow_up', 'draft', 'draft_feature', 'left_off', 'dismissed')),
  routed_id int NULL,
  CONSTRAINT captures_routed CHECK ((routed_at IS NULL AND routed_as IS NULL) OR (routed_at IS NOT NULL AND routed_as IS NOT NULL))
);
CREATE INDEX captures_user ON captures(user_id, routed_at);

CREATE TABLE dedupe_log (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  table_name nvarchar(64) NOT NULL,
  removed_id int NOT NULL,
  kept_id int NOT NULL,
  week_start date NULL,
  client_key nvarchar(100) NULL,
  item_id int NULL
);
CREATE INDEX dedupe_log_user ON dedupe_log(user_id, id);

CREATE TABLE delivery_snapshots (
  ${USER},
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL CHECK (item_id > 0),
  date date NOT NULL,
  done int NOT NULL CHECK (done >= 0),
  [open] int NOT NULL CHECK ([open] >= 0),
  PRIMARY KEY (user_id, client_key, item_id, date)
);
CREATE INDEX delivery_snapshots_date ON delivery_snapshots(user_id, date);

CREATE TABLE devops_identities (
  ${USER},
  client_key nvarchar(100) NOT NULL,
  org nvarchar(200) NOT NULL,
  identity_id nvarchar(200) NOT NULL,
  name nvarchar(400) NOT NULL,
  email nvarchar(320) NOT NULL,
  validated_at datetime2(7) NOT NULL,
  expires date NULL,
  PRIMARY KEY (user_id, client_key)
);

CREATE TABLE devops_write_log (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  org nvarchar(200) NOT NULL,
  project nvarchar(400) NOT NULL,
  op nvarchar(32) NOT NULL CHECK (op IN ('state', 'comment', 'create', 'target_date', 'undo_state', 'undo_comment', 'undo_create', 'undo_target_date')),
  item_id int NULL,
  parent_id int NULL,
  title nvarchar(max) NOT NULL,
  [identity] nvarchar(400) NOT NULL,
  ${JSON_NOT_NULL("before")},
  ${JSON_NOT_NULL("after")},
  ${JSON_NULL("ops")},
  rev_before int NULL,
  rev_after int NULL,
  comment_id int NULL,
  draft_id int NULL,
  pick_ids nvarchar(max) NOT NULL DEFAULT '[]' CHECK (ISJSON(pick_ids) = 1),
  follow_up_id int NULL,
  status nvarchar(16) NOT NULL CHECK (status IN ('pending', 'confirmed', 'unconfirmed', 'failed', 'refused')),
  message nvarchar(max) NULL,
  undo_of int NULL REFERENCES devops_write_log(id),
  undone_by int NULL,
  attempts int NOT NULL DEFAULT 1,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX devops_write_log_user ON devops_write_log(user_id, id);

CREATE TABLE flex_sessions (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  date date NOT NULL,
  client_key nvarchar(100) NOT NULL,
  start_at nvarchar(100) NOT NULL,
  end_at nvarchar(100) NOT NULL,
  item_id int NULL,
  item_title nvarchar(max) NULL,
  item_url nvarchar(max) NULL,
  note nvarchar(max) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX flex_date ON flex_sessions(user_id, date);

CREATE TABLE focus_log (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  pick_id int NULL,
  label nvarchar(max) NOT NULL,
  started_at datetime2(7) NOT NULL,
  ended_at datetime2(7) NOT NULL,
  seconds int NOT NULL CHECK (seconds >= 0)
);
CREATE INDEX focus_pick ON focus_log(user_id, pick_id);

CREATE TABLE invites (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  uid nvarchar(200) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  item_id int NULL,
  pick_id int NULL,
  timebox_id int NULL,
  title nvarchar(max) NOT NULL,
  url nvarchar(max) NULL,
  start_at nvarchar(100) NOT NULL,
  end_at nvarchar(100) NOT NULL,
  ${JSON_NOT_NULL("attendees")},
  teams bit NOT NULL,
  note nvarchar(max) NULL,
  event_id nvarchar(max) NULL,
  status nvarchar(16) NOT NULL CHECK (status IN ('pending', 'sent', 'cancelled')),
  follow_up_id int NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  CONSTRAINT invites_uid UNIQUE (user_id, uid)
);
CREATE INDEX invites_start ON invites(user_id, start_at);

CREATE TABLE kv (
  ${USER},
  [key] nvarchar(200) NOT NULL,
  ${JSON_NOT_NULL("value")},
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, [key])
);

CREATE TABLE markers (
  ${USER},
  kind nvarchar(100) NOT NULL,
  date nvarchar(200) NOT NULL,
  at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, kind, date)
);

CREATE TABLE outlook_events (
  ${USER},
  uid nvarchar(200) NOT NULL,
  timebox_id int NULL,
  event_id nvarchar(max) NOT NULL,
  ${JSON_NOT_NULL("fields")},
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  deleted_at datetime2(7) NULL,
  PRIMARY KEY (user_id, uid)
);

CREATE TABLE resume_notes (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  date date NOT NULL,
  note nvarchar(max) NOT NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  CONSTRAINT resume_notes_day UNIQUE (user_id, client_key, date)
);

CREATE TABLE roadmap_dates (
  ${USER},
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL CHECK (item_id > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, client_key, item_id),
  CONSTRAINT roadmap_dates_order CHECK (end_date >= start_date)
);

CREATE TABLE teams_status_log (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  op nvarchar(8) NOT NULL CHECK (op IN ('set', 'clear', 'left')),
  status nvarchar(32) NULL,
  minutes int NULL,
  result nvarchar(8) NOT NULL CHECK (result IN ('done', 'failed')),
  message nvarchar(max) NULL
);
CREATE INDEX teams_status_log_user ON teams_status_log(user_id, id);

CREATE TABLE unavailable (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  date date NOT NULL,
  title nvarchar(max) NOT NULL,
  start_at nvarchar(100) NOT NULL,
  end_at nvarchar(100) NOT NULL,
  note nvarchar(max) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX unavailable_date ON unavailable(user_id, date);

CREATE TABLE user_secrets (
  ${USER},
  account nvarchar(200) NOT NULL,
  sealed nvarchar(max) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, account)
);

CREATE TABLE user_settings (
  ${USER},
  section nvarchar(100) NOT NULL,
  position int NOT NULL,
  body nvarchar(max) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, section)
);

CREATE TABLE week_plans (
  ${USER},
  week_start date NOT NULL,
  committed_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, week_start)
);

CREATE TABLE week_quiet (
  ${USER},
  week_start date NOT NULL,
  client_key nvarchar(100) NOT NULL,
  marked_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, week_start, client_key)
);

CREATE TABLE write_log (
  ${USER},
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  system nvarchar(16) NOT NULL CHECK (system IN ('outlook')),
  op nvarchar(16) NOT NULL CHECK (op IN ('create', 'update', 'delete')),
  kind nvarchar(16) NOT NULL DEFAULT 'timebox' CHECK (kind IN ('timebox', 'event', 'invite', 'sync', 'rsvp')),
  uid nvarchar(200) NOT NULL,
  event_id nvarchar(max) NULL,
  account nvarchar(320) NULL,
  calendar nvarchar(max) NULL,
  ${JSON_NULL("before")},
  ${JSON_NULL("after")},
  ${JSON_NULL("local_before")},
  ${JSON_NULL("local_after")},
  status nvarchar(16) NOT NULL CHECK (status IN ('pending', 'confirmed', 'unconfirmed', 'failed', 'refused')),
  message nvarchar(max) NULL,
  auto bit NOT NULL DEFAULT 0,
  undo_of int NULL REFERENCES write_log(id),
  undone_by int NULL,
  attempts int NOT NULL DEFAULT 1,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX write_log_user ON write_log(user_id, uid);
`;
