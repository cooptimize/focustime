// MC-1: meeting capture. Only adds (D468). App tables (shared, no person in their keys; every read for a person goes
// through the meeting store's viewer: only the series they review or attend):
//   meeting_series       a client's registered call: name, role, transcript source (detected and used), organizer's
//                        tenant (ours, another, unknown), the join link and the registrant's event id, the weekly
//                        pattern, reviewers and attendees (FocusTime user ids only), the cached online meeting id.
//   meeting_occurrences  one dated occurrence: its instants, state, when to check Graph next, where the transcript
//                        came from, the AI pass's outcome, who dismissed or reviewed it.
//   meeting_transcripts  the transcript's lines, per occurrence: client data, deleted after 30 days by the retention
//                        purge (with the proposals' quotes); never logged or exported.
//   meeting_proposals    what the AI pass proposed (a gap, a commitment, a comment), its quotes (deleted at 30 days),
//                        state, and what the confirm made (write log id, item, shared commitment).
import type { NamedMigration } from "./named.ts";

export const meetings: NamedMigration = {
  name: "20261116T0900_meetings",
  sqlite: `CREATE TABLE meeting_series (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_key TEXT NOT NULL,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('status', 'planning')),
     source TEXT NOT NULL CHECK (source IN ('automatic', 'upload')),
     detected TEXT NOT NULL CHECK (detected IN ('automatic', 'upload')),
     organizer TEXT NOT NULL CHECK (organizer IN ('home', 'other', 'unknown')),
     join_url TEXT NOT NULL,
     event_id TEXT,
     registrant_id TEXT NOT NULL,
     weekday INTEGER NOT NULL,
     start_time TEXT NOT NULL,
     minutes INTEGER NOT NULL,
     zone TEXT NOT NULL,
     interval_weeks INTEGER NOT NULL DEFAULT 1,
     reviewers_json TEXT NOT NULL,
     attendees_json TEXT NOT NULL,
     online_meeting_id TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     removed_at TEXT
   );
   CREATE INDEX meeting_series_client ON meeting_series (client_key, removed_at);
   CREATE TABLE meeting_occurrences (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     series_id INTEGER NOT NULL,
     day TEXT NOT NULL,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('waiting', 'fetching', 'ready', 'needs_upload', 'no_transcript', 'reviewed', 'failed')),
     next_check_at TEXT,
     checks INTEGER NOT NULL DEFAULT 0,
     transcript_from TEXT CHECK (transcript_from IN ('automatic', 'upload')),
     transcript_at TEXT,
     ai_outcome TEXT,
     dismissed_by TEXT,
     reviewed_by TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (series_id, day)
   );
   CREATE INDEX meeting_occurrences_due ON meeting_occurrences (state, next_check_at);
   CREATE TABLE meeting_transcripts (
     occurrence_id INTEGER PRIMARY KEY,
     lines_json TEXT NOT NULL,
     line_count INTEGER NOT NULL,
     source TEXT NOT NULL CHECK (source IN ('automatic', 'upload')),
     uploaded_by TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE meeting_proposals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     occurrence_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('gap', 'commitment', 'comment')),
     body_json TEXT NOT NULL,
     quotes_json TEXT,
     state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'skipped', 'confirmed', 'failed')),
     result_json TEXT,
     decided_by TEXT,
     decided_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX meeting_proposals_occurrence ON meeting_proposals (occurrence_id);`,
  sqlserver: `CREATE TABLE meeting_series (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  name nvarchar(200) NOT NULL,
  role nvarchar(20) NOT NULL CONSTRAINT meeting_series_role_check CHECK (role IN ('status', 'planning')),
  source nvarchar(20) NOT NULL CONSTRAINT meeting_series_source_check CHECK (source IN ('automatic', 'upload')),
  detected nvarchar(20) NOT NULL CONSTRAINT meeting_series_detected_check CHECK (detected IN ('automatic', 'upload')),
  organizer nvarchar(20) NOT NULL CONSTRAINT meeting_series_organizer_check CHECK (organizer IN ('home', 'other', 'unknown')),
  join_url nvarchar(4000) NOT NULL,
  event_id nvarchar(1000) NULL,
  registrant_id nvarchar(64) NOT NULL,
  weekday int NOT NULL,
  start_time nvarchar(10) NOT NULL,
  minutes int NOT NULL,
  zone nvarchar(64) NOT NULL,
  interval_weeks int NOT NULL CONSTRAINT meeting_series_interval_default DEFAULT 1,
  reviewers_json nvarchar(4000) NOT NULL,
  attendees_json nvarchar(4000) NOT NULL,
  online_meeting_id nvarchar(1000) NULL,
  created_at nvarchar(40) NOT NULL,
  updated_at nvarchar(40) NOT NULL,
  removed_at nvarchar(40) NULL
);
CREATE INDEX meeting_series_client ON meeting_series (client_key, removed_at);
CREATE TABLE meeting_occurrences (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  series_id int NOT NULL,
  day nvarchar(10) NOT NULL,
  start_at nvarchar(40) NOT NULL,
  end_at nvarchar(40) NOT NULL,
  state nvarchar(20) NOT NULL CONSTRAINT meeting_occurrences_state_check CHECK (state IN ('waiting', 'fetching', 'ready', 'needs_upload', 'no_transcript', 'reviewed', 'failed')),
  next_check_at nvarchar(40) NULL,
  checks int NOT NULL CONSTRAINT meeting_occurrences_checks_default DEFAULT 0,
  transcript_from nvarchar(20) NULL CONSTRAINT meeting_occurrences_from_check CHECK (transcript_from IN ('automatic', 'upload')),
  transcript_at nvarchar(40) NULL,
  ai_outcome nvarchar(40) NULL,
  dismissed_by nvarchar(64) NULL,
  reviewed_by nvarchar(64) NULL,
  created_at nvarchar(40) NOT NULL,
  updated_at nvarchar(40) NOT NULL,
  CONSTRAINT meeting_occurrences_one_a_day UNIQUE (series_id, day)
);
CREATE INDEX meeting_occurrences_due ON meeting_occurrences (state, next_check_at);
CREATE TABLE meeting_transcripts (
  occurrence_id int NOT NULL PRIMARY KEY,
  lines_json nvarchar(max) NOT NULL,
  line_count int NOT NULL,
  source nvarchar(20) NOT NULL CONSTRAINT meeting_transcripts_source_check CHECK (source IN ('automatic', 'upload')),
  uploaded_by nvarchar(64) NULL,
  created_at nvarchar(40) NOT NULL
);
CREATE TABLE meeting_proposals (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  occurrence_id int NOT NULL,
  kind nvarchar(20) NOT NULL CONSTRAINT meeting_proposals_kind_check CHECK (kind IN ('gap', 'commitment', 'comment')),
  body_json nvarchar(max) NOT NULL,
  quotes_json nvarchar(max) NULL,
  state nvarchar(20) NOT NULL CONSTRAINT meeting_proposals_state_default DEFAULT 'open' CONSTRAINT meeting_proposals_state_check CHECK (state IN ('open', 'skipped', 'confirmed', 'failed')),
  result_json nvarchar(2000) NULL,
  decided_by nvarchar(64) NULL,
  decided_at nvarchar(40) NULL,
  created_at nvarchar(40) NOT NULL
);
CREATE INDEX meeting_proposals_occurrence ON meeting_proposals (occurrence_id);`,
};
