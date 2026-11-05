// IB-1: my marks on Inbox items, for every kind in one place. Only adds (D468). A user table (user_id first in its
// key), in Export my data and removed with the person's data.
//
// inbox_marks: one row per item key (plan/inbox-items.ts: c<id> a promise found in a chat, f<id> a promise I added or
// a rule opened, v<id> a conversation, s<id> a send, k<id> a capture, d<id> a draft): when I first saw it (a promise
// stops being New), until when it's snoozed (an instant; snoozing never changes a due date), and when I hid it.
// Conversations keep Hide for me in conversation_views (CV-1) and former follow-ups keep their own snoozed_until, so a
// rollback to the build before IB-1 loses nothing but the snoozes of chat promises and conversations.
//
// The data step: every promise open now (my open follow-ups and my open chat commitments) counts as seen, so the first
// Needs you after the release holds only what is new from then on, never everything at once.
import type { NamedMigration } from "./named.ts";

export const inboxMarks: NamedMigration = {
  name: "20261110T0900_inbox_marks",
  sqlite: `CREATE TABLE inbox_marks (
     user_id TEXT NOT NULL,
     item_key TEXT NOT NULL,
     seen_at TEXT,
     snoozed_until TEXT,
     hidden_at TEXT,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, item_key)
   );
   INSERT INTO inbox_marks (user_id, item_key, seen_at, updated_at)
     SELECT user_id, 'f' || id, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     FROM follow_ups WHERE closed_at IS NULL;
   INSERT INTO inbox_marks (user_id, item_key, seen_at, updated_at)
     SELECT u.id, 'c' || k.id, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     FROM commitments k JOIN users u ON LOWER(u.id) = LOWER(k.who_id)
     WHERE k.state = 'open';`,
  sqlserver: `CREATE TABLE inbox_marks (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  item_key nvarchar(24) NOT NULL,
  seen_at nvarchar(40) NULL,
  snoozed_until nvarchar(40) NULL,
  hidden_at nvarchar(40) NULL,
  updated_at nvarchar(40) NOT NULL,
  CONSTRAINT pk_inbox_marks PRIMARY KEY (user_id, item_key)
);
INSERT INTO inbox_marks (user_id, item_key, seen_at, updated_at)
  SELECT user_id, CONCAT('f', id), CONVERT(nvarchar(40), SYSUTCDATETIME(), 127) + 'Z', CONVERT(nvarchar(40), SYSUTCDATETIME(), 127) + 'Z'
  FROM follow_ups WHERE closed_at IS NULL;
INSERT INTO inbox_marks (user_id, item_key, seen_at, updated_at)
  SELECT u.id, CONCAT('c', k.id), CONVERT(nvarchar(40), SYSUTCDATETIME(), 127) + 'Z', CONVERT(nvarchar(40), SYSUTCDATETIME(), 127) + 'Z'
  FROM commitments k JOIN users u ON LOWER(u.id) = LOWER(k.who_id)
  WHERE k.state = 'open';`,
};
