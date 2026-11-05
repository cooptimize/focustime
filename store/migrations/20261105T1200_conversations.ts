// CV-1: Conversations, my promises and DevOps follow-through. Only adds (D468). App tables (shared, no user_id; every
// read for a person goes through the conversation store's viewer: only chats they're in now, D521):
//   conversations             one burst of related messages in a client chat: title, living summary, status, owner,
//                             participants, the linked item, who closed it, the "Updated" version and change note, a
//                             meaningful change for the item not suggested yet, the AI's likely item, and where a
//                             migrated one came from (the Request's chat and message).
//   conversation_messages     each stored message's place: its conversation (or none), its role (work, chatter, ack,
//                             unsorted with the reason), and who placed it (the AI, a rule or a person).
//   commitments               who said they'd do what in a conversation, for whom and by when, whether it implies a
//                             DevOps item and its draft, the reminder, the escalation and Take it over; my own are My
//                             promises (a follow-up or Today made from one, Done, Not needed), and the DevOps
//                             draft made for the committer when they open it.
//   conversation_suggestions  a suggested DevOps comment or description change for a linked item, for its owner.
//   chat_ai_days              the pipeline's AI calls per chat and day (the daily cap per chat).
//   app_ai_requests           the pipeline's own AI request log (counted against the app's cap, never a person's).
// User tables: conversation_views (what I last saw of a conversation, and Hide for me); new columns: ai_requests.cap
// (whose cap a request counted against), devops_write_log's conversation, commitment and suggestion (a create or a
// comment from a conversation, so a retry never makes a second), promises.moved_to (the commitment a promise became).
// The Requests and promises tables stay (D468): they stop being written and are dropped in a later release.
import type { NamedMigration } from "./named.ts";

export const conversations: NamedMigration = {
  name: "20261105T1200_conversations",
  sqlite: `CREATE TABLE conversations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     title TEXT NOT NULL,
     summary TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'discussion', 'committed', 'tracked', 'resolved', 'closed')),
     owner_id TEXT,
     participants_json TEXT,
     first_at TEXT NOT NULL,
     last_at TEXT NOT NULL,
     last_work_at TEXT NOT NULL,
     wind_down INTEGER NOT NULL DEFAULT 0 CHECK (wind_down IN (0, 1)),
     item_id INTEGER,
     item_url TEXT,
     item_title TEXT,
     closed_by TEXT,
     closed_at TEXT,
     close_reason TEXT,
     version INTEGER NOT NULL DEFAULT 1,
     change_note TEXT,
     item_change_kind TEXT,
     item_change_note TEXT,
     item_change_at TEXT,
     item_change_scope INTEGER NOT NULL DEFAULT 0 CHECK (item_change_scope IN (0, 1)),
     likely_item INTEGER,
     from_chat_id TEXT,
     from_message_id TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX conversations_chat ON conversations (chat_id, status, last_at);
   CREATE INDEX conversations_from ON conversations (from_chat_id, from_message_id);
   CREATE TABLE conversation_messages (
     chat_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     conversation_id INTEGER,
     role TEXT NOT NULL CHECK (role IN ('work', 'chatter', 'ack', 'unsorted')),
     reason TEXT,
     placed_by TEXT NOT NULL DEFAULT 'rule' CHECK (placed_by IN ('ai', 'rule', 'person')),
     placed_by_user TEXT,
     at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (chat_id, message_id)
   );
   CREATE INDEX conversation_messages_conv ON conversation_messages (conversation_id, at);
   CREATE INDEX conversation_messages_role ON conversation_messages (chat_id, role, at);
   CREATE TABLE commitments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id INTEGER,
     chat_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     who_id TEXT,
     who_name TEXT NOT NULL,
     to_id TEXT,
     to_name TEXT,
     what TEXT NOT NULL,
     due_at TEXT,
     due_date TEXT,
     implies_item INTEGER NOT NULL DEFAULT 0 CHECK (implies_item IN (0, 1)),
     state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'followup', 'linked', 'created', 'done', 'not_needed')),
     message_ids_json TEXT NOT NULL,
     follow_up_id INTEGER,
     item_id INTEGER,
     item_url TEXT,
     item_title TEXT,
     on_today TEXT,
     reminded_at TEXT,
     escalated_at TEXT,
     taken_by TEXT,
     taken_at TEXT,
     reason TEXT,
     draft_json TEXT,
     from_promise TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX commitments_who ON commitments (who_id, state);
   CREATE INDEX commitments_conv ON commitments (conversation_id);
   CREATE TABLE conversation_suggestions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id INTEGER NOT NULL,
     item_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('comment', 'description')),
     for_user TEXT,
     body TEXT NOT NULL,
     before_text TEXT,
     after_text TEXT,
     internal_json TEXT,
     state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'posted', 'skipped')),
     write_id INTEGER,
     day TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX conversation_suggestions_item ON conversation_suggestions (item_id, day);
   CREATE INDEX conversation_suggestions_for ON conversation_suggestions (for_user, state);
   CREATE TABLE chat_ai_days (
     chat_id TEXT NOT NULL,
     day TEXT NOT NULL,
     calls INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (chat_id, day)
   );
   CREATE TABLE app_ai_requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     task TEXT NOT NULL,
     client_key TEXT,
     model TEXT NOT NULL,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cost_micros INTEGER NOT NULL DEFAULT 0,
     latency_ms INTEGER NOT NULL DEFAULT 0,
     outcome TEXT NOT NULL,
     detail TEXT
   );
   CREATE INDEX app_ai_requests_at ON app_ai_requests (at);
   CREATE TABLE conversation_views (
     user_id TEXT NOT NULL,
     conversation_id INTEGER NOT NULL,
     seen_version INTEGER NOT NULL DEFAULT 0,
     seen_at TEXT,
     hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
     hidden_at TEXT,
     PRIMARY KEY (user_id, conversation_id)
   );
   ALTER TABLE ai_requests ADD COLUMN cap TEXT NOT NULL DEFAULT 'person';
   ALTER TABLE devops_write_log ADD COLUMN conversation_id INTEGER;
   ALTER TABLE devops_write_log ADD COLUMN commitment_id INTEGER;
   ALTER TABLE devops_write_log ADD COLUMN suggestion_id INTEGER;
   ALTER TABLE promises ADD COLUMN moved_to INTEGER;`,
  sqlserver: `CREATE TABLE conversations (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  chat_id nvarchar(256) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  title nvarchar(200) NOT NULL,
  summary nvarchar(1000) NOT NULL CONSTRAINT conversations_summary_default DEFAULT '',
  status nvarchar(20) NOT NULL CONSTRAINT conversations_status_default DEFAULT 'new' CONSTRAINT conversations_status_check CHECK (status IN ('new', 'discussion', 'committed', 'tracked', 'resolved', 'closed')),
  owner_id nvarchar(64) NULL,
  participants_json nvarchar(max) NULL,
  first_at datetime2(7) NOT NULL,
  last_at datetime2(7) NOT NULL,
  last_work_at datetime2(7) NOT NULL,
  wind_down bit NOT NULL CONSTRAINT conversations_wind_down_default DEFAULT 0,
  item_id int NULL,
  item_url nvarchar(2000) NULL,
  item_title nvarchar(400) NULL,
  closed_by nvarchar(64) NULL,
  closed_at datetime2(7) NULL,
  close_reason nvarchar(400) NULL,
  version int NOT NULL CONSTRAINT conversations_version_default DEFAULT 1,
  change_note nvarchar(200) NULL,
  item_change_kind nvarchar(20) NULL,
  item_change_note nvarchar(400) NULL,
  item_change_at datetime2(7) NULL,
  item_change_scope bit NOT NULL CONSTRAINT conversations_scope_default DEFAULT 0,
  likely_item int NULL,
  from_chat_id nvarchar(256) NULL,
  from_message_id nvarchar(64) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX conversations_chat ON conversations (chat_id, status, last_at);
CREATE INDEX conversations_from ON conversations (from_chat_id, from_message_id);
CREATE TABLE conversation_messages (
  chat_id nvarchar(256) NOT NULL,
  message_id nvarchar(64) NOT NULL,
  conversation_id int NULL,
  role nvarchar(20) NOT NULL CONSTRAINT conversation_messages_role_check CHECK (role IN ('work', 'chatter', 'ack', 'unsorted')),
  reason nvarchar(40) NULL,
  placed_by nvarchar(10) NOT NULL CONSTRAINT conversation_messages_by_default DEFAULT 'rule' CONSTRAINT conversation_messages_by_check CHECK (placed_by IN ('ai', 'rule', 'person')),
  placed_by_user nvarchar(64) NULL,
  at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX conversation_messages_conv ON conversation_messages (conversation_id, at);
CREATE INDEX conversation_messages_role ON conversation_messages (chat_id, role, at);
CREATE TABLE commitments (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  conversation_id int NULL,
  chat_id nvarchar(256) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  who_id nvarchar(64) NULL,
  who_name nvarchar(200) NOT NULL,
  to_id nvarchar(64) NULL,
  to_name nvarchar(200) NULL,
  what nvarchar(200) NOT NULL,
  due_at datetime2(7) NULL,
  due_date nvarchar(10) NULL,
  implies_item bit NOT NULL CONSTRAINT commitments_implies_default DEFAULT 0,
  state nvarchar(20) NOT NULL CONSTRAINT commitments_state_default DEFAULT 'open' CONSTRAINT commitments_state_check CHECK (state IN ('open', 'followup', 'linked', 'created', 'done', 'not_needed')),
  message_ids_json nvarchar(max) NOT NULL,
  follow_up_id int NULL,
  item_id int NULL,
  item_url nvarchar(2000) NULL,
  item_title nvarchar(400) NULL,
  on_today nvarchar(10) NULL,
  reminded_at datetime2(7) NULL,
  escalated_at datetime2(7) NULL,
  taken_by nvarchar(64) NULL,
  taken_at datetime2(7) NULL,
  reason nvarchar(400) NULL,
  draft_json nvarchar(max) NULL,
  from_promise nvarchar(400) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX commitments_who ON commitments (who_id, state);
CREATE INDEX commitments_conv ON commitments (conversation_id);
CREATE TABLE conversation_suggestions (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  conversation_id int NOT NULL,
  item_id int NOT NULL,
  kind nvarchar(20) NOT NULL CONSTRAINT conversation_suggestions_kind_check CHECK (kind IN ('comment', 'description')),
  for_user nvarchar(64) NULL,
  body nvarchar(max) NOT NULL,
  before_text nvarchar(max) NULL,
  after_text nvarchar(max) NULL,
  internal_json nvarchar(max) NULL,
  state nvarchar(20) NOT NULL CONSTRAINT conversation_suggestions_state_default DEFAULT 'open' CONSTRAINT conversation_suggestions_state_check CHECK (state IN ('open', 'posted', 'skipped')),
  write_id int NULL,
  day nvarchar(10) NOT NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL
);
CREATE INDEX conversation_suggestions_item ON conversation_suggestions (item_id, day);
CREATE INDEX conversation_suggestions_for ON conversation_suggestions (for_user, state);
CREATE TABLE chat_ai_days (
  chat_id nvarchar(256) NOT NULL,
  day nvarchar(10) NOT NULL,
  calls int NOT NULL CONSTRAINT chat_ai_days_calls_default DEFAULT 0,
  PRIMARY KEY (chat_id, day)
);
CREATE TABLE app_ai_requests (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  task nvarchar(64) NOT NULL,
  client_key nvarchar(100) NULL,
  model nvarchar(100) NOT NULL,
  input_tokens int NOT NULL CONSTRAINT app_ai_requests_in_default DEFAULT 0,
  output_tokens int NOT NULL CONSTRAINT app_ai_requests_out_default DEFAULT 0,
  cost_micros bigint NOT NULL CONSTRAINT app_ai_requests_cost_default DEFAULT 0,
  latency_ms int NOT NULL CONSTRAINT app_ai_requests_ms_default DEFAULT 0,
  outcome nvarchar(20) NOT NULL,
  detail nvarchar(40) NULL
);
CREATE INDEX app_ai_requests_at ON app_ai_requests (at);
CREATE TABLE conversation_views (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  conversation_id int NOT NULL,
  seen_version int NOT NULL CONSTRAINT conversation_views_seen_default DEFAULT 0,
  seen_at datetime2(7) NULL,
  hidden bit NOT NULL CONSTRAINT conversation_views_hidden_default DEFAULT 0,
  hidden_at datetime2(7) NULL,
  PRIMARY KEY (user_id, conversation_id)
);
ALTER TABLE ai_requests ADD cap nvarchar(10) NOT NULL CONSTRAINT ai_requests_cap_default DEFAULT 'person';
ALTER TABLE devops_write_log ADD conversation_id int NULL, commitment_id int NULL, suggestion_id int NULL;
ALTER TABLE promises ADD moved_to int NULL;`,
};
