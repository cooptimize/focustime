// Shared polling (D514 to D518): one copy of each Teams message and one Request per message, for everyone who follows
// the client and is in the chat. App tables (no user_id; reads are gated by chat membership in actions, never by
// store/scope.ts):
//   client_chats         a client's registered Teams chats (registered once, by a Cooptimizer who follows the client and
//                        is in the chat), with the poll state: the watermark (newest lastModifiedDateTime seen), the last
//                        poll and the last successful fetch, the token used, and "needs reconnecting".
//   teams_messages       one row per message, whoever reads it.
//   requests             one row per message the rules picked out, with its shared state and the AI's sort.
//   client_chat_changes  who registered, relabelled or removed a chat, and when.
// The per-user rows (delivery_chats, chat_messages, asks) are copied in, deduped: a chat keeps the earliest
// registration's client and label; a Request takes the state of the most recent action across people, and the AI sort
// of the most recent sort. The per-user tables stay (D468: migrations only add); they stop being written and are
// dropped in a later release.
import type { NamedMigration } from "./named.ts";

export const sharedRequests: NamedMigration = {
  name: "20261104T2100_shared_requests",
  sqlite: `CREATE TABLE client_chats (
     chat_id TEXT NOT NULL PRIMARY KEY,
     client_key TEXT NOT NULL,
     chat_kind TEXT NOT NULL DEFAULT 'delivery' CHECK (chat_kind IN ('delivery', 'customer')),
     display_name TEXT NOT NULL,
     web_url TEXT,
     position INTEGER NOT NULL DEFAULT 0,
     members_json TEXT,
     members_fetched_at TEXT,
     registered_by TEXT NOT NULL,
     registered_at TEXT NOT NULL,
     read_since TEXT NOT NULL,
     seen_at TEXT,
     polled_at TEXT,
     fetched_at TEXT,
     retry_at TEXT,
     failures INTEGER NOT NULL DEFAULT 0,
     poll_state TEXT CHECK (poll_state IN ('ok', 'via', 'reconnect', 'retry')),
     poll_note TEXT,
     token_user TEXT,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX client_chats_client ON client_chats (client_key, position);
   CREATE TABLE teams_messages (
     chat_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     sender_id TEXT,
     sender_name TEXT,
     sender_tenant TEXT,
     created_at TEXT NOT NULL,
     modified_at TEXT NOT NULL,
     body_html TEXT,
     body_text TEXT NOT NULL,
     has_image INTEGER NOT NULL DEFAULT 0 CHECK (has_image IN (0, 1)),
     has_file INTEGER NOT NULL DEFAULT 0 CHECK (has_file IN (0, 1)),
     reply_to_id TEXT,
     mentions_json TEXT,
     fetched_at TEXT NOT NULL,
     PRIMARY KEY (chat_id, message_id)
   );
   CREATE INDEX teams_messages_time ON teams_messages (chat_id, created_at);
   CREATE TABLE requests (
     chat_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     match_rule TEXT NOT NULL,
     rule_detail TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'created', 'linked', 'handled', 'dismissed')),
     item_id INTEGER,
     item_url TEXT,
     item_title TEXT,
     note TEXT,
     write_id INTEGER,
     resolved_at TEXT,
     resolved_by TEXT,
     assignee TEXT,
     ai_status TEXT,
     ai_at TEXT,
     ai_by TEXT,
     ai_kind TEXT,
     ai_urgency TEXT,
     ai_item_type TEXT,
     ai_title TEXT,
     ai_description TEXT,
     ai_item_id INTEGER,
     ai_item_confidence REAL,
     ai_reason TEXT,
     ai_shown INTEGER NOT NULL DEFAULT 0 CHECK (ai_shown IN (0, 1)),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (chat_id, message_id)
   );
   CREATE INDEX requests_status ON requests (client_key, status);
   CREATE TABLE client_chat_changes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     by_user TEXT NOT NULL,
     client_key TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     change TEXT NOT NULL CHECK (change IN ('added', 'kind', 'removed', 'migrated'))
   );
   INSERT INTO client_chats (chat_id, client_key, chat_kind, display_name, web_url, position, members_json, members_fetched_at, registered_by, registered_at, read_since, seen_at, polled_at, fetched_at, failures, updated_at)
     SELECT chat_id, client_key, COALESCE(chat_kind, 'delivery'), display_name, web_url, position, members_json, members_fetched_at, user_id, created_at,
       COALESCE(since, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), seen, polled, polled, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     FROM (SELECT d.*, MIN(asks_since) OVER (PARTITION BY chat_id) AS since, MAX(asks_seen_at) OVER (PARTITION BY chat_id) AS seen, MAX(asks_polled_at) OVER (PARTITION BY chat_id) AS polled,
             ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at, user_id) AS n FROM delivery_chats d) WHERE n = 1;
   INSERT INTO client_chat_changes (at, by_user, client_key, chat_id, change)
     SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), registered_by, client_key, chat_id, 'migrated' FROM client_chats;
   INSERT INTO teams_messages (chat_id, message_id, client_key, sender_id, sender_tenant, created_at, modified_at, body_text, has_image, has_file, reply_to_id, fetched_at)
     SELECT chat_id, message_id, client_key, author_id, author_tenant, created_at, created_at, body_text, has_image, has_file, reply_to_id, created_at
     FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY chat_id, message_id ORDER BY user_id) AS n FROM chat_messages m) WHERE n = 1;
   INSERT INTO requests (chat_id, message_id, client_key, match_rule, rule_detail, status, item_id, item_url, item_title, note, write_id, resolved_at, resolved_by, created_at, updated_at)
     SELECT chat_id, message_id, client_key, ask_rule, rule_detail, status, item_id, item_url, item_title, note, write_id, resolved_at, CASE WHEN status = 'open' THEN NULL ELSE user_id END, created_at, updated_at
     FROM (SELECT a.*, ROW_NUMBER() OVER (PARTITION BY chat_id, message_id ORDER BY updated_at DESC, user_id) AS n FROM asks a) WHERE n = 1;
   UPDATE requests SET (ai_status, ai_at, ai_by, ai_kind, ai_urgency, ai_item_type, ai_title, ai_description, ai_item_id, ai_item_confidence, ai_reason, ai_shown) = (
       SELECT s.ai_status, s.ai_at, s.user_id, s.ai_kind, s.ai_urgency, s.ai_item_type, s.ai_title, s.ai_description, s.ai_item_id, s.ai_item_confidence, s.ai_reason, s.ai_shown
       FROM (SELECT a.*, ROW_NUMBER() OVER (PARTITION BY chat_id, message_id ORDER BY ai_at DESC, user_id) AS n FROM asks a WHERE a.ai_status IS NOT NULL) s
       WHERE s.n = 1 AND s.chat_id = requests.chat_id AND s.message_id = requests.message_id)
     WHERE EXISTS (SELECT 1 FROM asks a WHERE a.chat_id = requests.chat_id AND a.message_id = requests.message_id AND a.ai_status IS NOT NULL);`,
  sqlserver: `CREATE TABLE client_chats (
  chat_id nvarchar(256) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  chat_kind nvarchar(20) NOT NULL CONSTRAINT client_chats_kind_default DEFAULT 'delivery' CONSTRAINT client_chats_kind_check CHECK (chat_kind IN ('delivery', 'customer')),
  display_name nvarchar(400) NOT NULL,
  web_url nvarchar(2000) NULL,
  position int NOT NULL CONSTRAINT client_chats_position_default DEFAULT 0,
  members_json nvarchar(max) NULL,
  members_fetched_at datetime2(7) NULL,
  registered_by nvarchar(64) NOT NULL,
  registered_at datetime2(7) NOT NULL,
  read_since datetime2(7) NOT NULL,
  seen_at datetime2(7) NULL,
  polled_at datetime2(7) NULL,
  fetched_at datetime2(7) NULL,
  retry_at datetime2(7) NULL,
  failures int NOT NULL CONSTRAINT client_chats_failures_default DEFAULT 0,
  poll_state nvarchar(20) NULL CONSTRAINT client_chats_state_check CHECK (poll_state IN ('ok', 'via', 'reconnect', 'retry')),
  poll_note nvarchar(400) NULL,
  token_user nvarchar(64) NULL,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX client_chats_client ON client_chats (client_key, position);
CREATE TABLE teams_messages (
  chat_id nvarchar(256) NOT NULL,
  message_id nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  sender_id nvarchar(64) NULL,
  sender_name nvarchar(200) NULL,
  sender_tenant nvarchar(64) NULL,
  created_at datetime2(7) NOT NULL,
  modified_at datetime2(7) NOT NULL,
  body_html nvarchar(max) NULL,
  body_text nvarchar(max) NOT NULL,
  has_image bit NOT NULL CONSTRAINT teams_messages_image_default DEFAULT 0,
  has_file bit NOT NULL CONSTRAINT teams_messages_file_default DEFAULT 0,
  reply_to_id nvarchar(64) NULL,
  mentions_json nvarchar(max) NULL,
  fetched_at datetime2(7) NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX teams_messages_time ON teams_messages (chat_id, created_at);
CREATE TABLE requests (
  chat_id nvarchar(256) NOT NULL,
  message_id nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  match_rule nvarchar(20) NOT NULL,
  rule_detail nvarchar(100) NULL,
  status nvarchar(20) NOT NULL CONSTRAINT requests_status_default DEFAULT 'open' CONSTRAINT requests_status_check CHECK (status IN ('open', 'created', 'linked', 'handled', 'dismissed')),
  item_id int NULL,
  item_url nvarchar(2000) NULL,
  item_title nvarchar(400) NULL,
  note nvarchar(1000) NULL,
  write_id int NULL,
  resolved_at datetime2(7) NULL,
  resolved_by nvarchar(64) NULL,
  assignee nvarchar(64) NULL,
  ai_status nvarchar(40) NULL,
  ai_at datetime2(7) NULL,
  ai_by nvarchar(64) NULL,
  ai_kind nvarchar(20) NULL,
  ai_urgency nvarchar(20) NULL,
  ai_item_type nvarchar(20) NULL,
  ai_title nvarchar(200) NULL,
  ai_description nvarchar(2000) NULL,
  ai_item_id int NULL,
  ai_item_confidence float NULL,
  ai_reason nvarchar(400) NULL,
  ai_shown bit NOT NULL CONSTRAINT requests_shown_default DEFAULT 0,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX requests_status ON requests (client_key, status);
CREATE TABLE client_chat_changes (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  by_user nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  chat_id nvarchar(256) NOT NULL,
  change nvarchar(20) NOT NULL CONSTRAINT client_chat_changes_check CHECK (change IN ('added', 'kind', 'removed', 'migrated'))
);
INSERT INTO client_chats (chat_id, client_key, chat_kind, display_name, web_url, position, members_json, members_fetched_at, registered_by, registered_at, read_since, seen_at, polled_at, fetched_at, failures, updated_at)
  SELECT chat_id, client_key, COALESCE(chat_kind, 'delivery'), display_name, web_url, position, members_json, members_fetched_at, user_id, created_at,
    COALESCE(since, SYSUTCDATETIME()), seen, polled, polled, 0, SYSUTCDATETIME()
  FROM (SELECT d.*, MIN(asks_since) OVER (PARTITION BY chat_id) AS since, MAX(asks_seen_at) OVER (PARTITION BY chat_id) AS seen, MAX(asks_polled_at) OVER (PARTITION BY chat_id) AS polled,
          ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at, user_id) AS n FROM delivery_chats d) x WHERE n = 1;
INSERT INTO client_chat_changes (at, by_user, client_key, chat_id, change)
  SELECT SYSUTCDATETIME(), registered_by, client_key, chat_id, 'migrated' FROM client_chats;
INSERT INTO teams_messages (chat_id, message_id, client_key, sender_id, sender_tenant, created_at, modified_at, body_text, has_image, has_file, reply_to_id, fetched_at)
  SELECT chat_id, message_id, client_key, author_id, author_tenant, created_at, created_at, body_text, has_image, has_file, reply_to_id, created_at
  FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY chat_id, message_id ORDER BY user_id) AS n FROM chat_messages m) x WHERE n = 1;
INSERT INTO requests (chat_id, message_id, client_key, match_rule, rule_detail, status, item_id, item_url, item_title, note, write_id, resolved_at, resolved_by, created_at, updated_at)
  SELECT chat_id, message_id, client_key, ask_rule, rule_detail, status, item_id, item_url, item_title, note, write_id, resolved_at, CASE WHEN status = 'open' THEN NULL ELSE user_id END, created_at, updated_at
  FROM (SELECT a.*, ROW_NUMBER() OVER (PARTITION BY chat_id, message_id ORDER BY updated_at DESC, user_id) AS n FROM asks a) x WHERE n = 1;
UPDATE r SET ai_status = s.ai_status, ai_at = s.ai_at, ai_by = s.user_id, ai_kind = s.ai_kind, ai_urgency = s.ai_urgency, ai_item_type = s.ai_item_type, ai_title = s.ai_title,
    ai_description = s.ai_description, ai_item_id = s.ai_item_id, ai_item_confidence = s.ai_item_confidence, ai_reason = s.ai_reason, ai_shown = s.ai_shown
  FROM requests r
  JOIN (SELECT a.*, ROW_NUMBER() OVER (PARTITION BY chat_id, message_id ORDER BY ai_at DESC, user_id) AS n FROM asks a WHERE a.ai_status IS NOT NULL) s
    ON s.n = 1 AND s.chat_id = r.chat_id AND s.message_id = r.message_id;`,
};
