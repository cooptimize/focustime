// AP-1: Asks. Only adds (D468). A registered delivery chat gets "Read for asks" (off by default) and the reading
// state: since when (switching on starts from now, no backfill), the newest message seen, when it was last read, and
// a throttle wait with its failure count and a plain status for Settings > Connections. chat_messages keeps the new
// messages of those chats, only the listed fields (plain text, HTML stripped); an unmatched one is deleted after 14
// days. asks keeps the messages the rules matched, with the rule and the resolution (created, linked, handled,
// dismissed), the DevOps item and the write that made it, so a retry never makes a second item. devops_write_log gets
// the ask a create came from.
import type { NamedMigration } from "./named.ts";

export const asks: NamedMigration = {
  name: "20261104T1200_asks",
  sqlite: `ALTER TABLE delivery_chats ADD COLUMN asks_on INTEGER NOT NULL DEFAULT 0 CHECK (asks_on IN (0, 1));
   ALTER TABLE delivery_chats ADD COLUMN asks_since TEXT;
   ALTER TABLE delivery_chats ADD COLUMN asks_seen_at TEXT;
   ALTER TABLE delivery_chats ADD COLUMN asks_polled_at TEXT;
   ALTER TABLE delivery_chats ADD COLUMN asks_retry_at TEXT;
   ALTER TABLE delivery_chats ADD COLUMN asks_failures INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE delivery_chats ADD COLUMN asks_status TEXT;
   CREATE TABLE chat_messages (
     user_id TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     author_id TEXT,
     author_tenant TEXT,
     created_at TEXT NOT NULL,
     body_text TEXT NOT NULL,
     has_image INTEGER NOT NULL DEFAULT 0 CHECK (has_image IN (0, 1)),
     has_file INTEGER NOT NULL DEFAULT 0 CHECK (has_file IN (0, 1)),
     reply_to_id TEXT,
     PRIMARY KEY (user_id, chat_id, message_id)
   );
   CREATE INDEX chat_messages_time ON chat_messages (user_id, chat_id, created_at);
   CREATE TABLE asks (
     user_id TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     ask_rule TEXT NOT NULL,
     rule_detail TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'created', 'linked', 'handled', 'dismissed')),
     item_id INTEGER,
     item_url TEXT,
     item_title TEXT,
     note TEXT,
     write_id INTEGER,
     resolved_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, chat_id, message_id)
   );
   CREATE INDEX asks_status ON asks (user_id, status);
   ALTER TABLE devops_write_log ADD COLUMN ask_chat_id TEXT;
   ALTER TABLE devops_write_log ADD COLUMN ask_message_id TEXT;`,
  sqlserver: `ALTER TABLE delivery_chats ADD asks_on bit NOT NULL CONSTRAINT delivery_chats_asks_on_default DEFAULT 0,
  asks_since datetime2(7) NULL,
  asks_seen_at datetime2(7) NULL,
  asks_polled_at datetime2(7) NULL,
  asks_retry_at datetime2(7) NULL,
  asks_failures int NOT NULL CONSTRAINT delivery_chats_asks_failures_default DEFAULT 0,
  asks_status nvarchar(400) NULL;
CREATE TABLE chat_messages (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  chat_id nvarchar(256) NOT NULL,
  message_id nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  author_id nvarchar(64) NULL,
  author_tenant nvarchar(64) NULL,
  created_at datetime2(7) NOT NULL,
  body_text nvarchar(max) NOT NULL,
  has_image bit NOT NULL CONSTRAINT chat_messages_image_default DEFAULT 0,
  has_file bit NOT NULL CONSTRAINT chat_messages_file_default DEFAULT 0,
  reply_to_id nvarchar(64) NULL,
  PRIMARY KEY (user_id, chat_id, message_id)
);
CREATE INDEX chat_messages_time ON chat_messages (user_id, chat_id, created_at);
CREATE TABLE asks (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  chat_id nvarchar(256) NOT NULL,
  message_id nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  ask_rule nvarchar(20) NOT NULL,
  rule_detail nvarchar(100) NULL,
  status nvarchar(20) NOT NULL CONSTRAINT asks_status_default DEFAULT 'open' CONSTRAINT asks_status_check CHECK (status IN ('open', 'created', 'linked', 'handled', 'dismissed')),
  item_id int NULL,
  item_url nvarchar(2000) NULL,
  item_title nvarchar(400) NULL,
  note nvarchar(1000) NULL,
  write_id int NULL,
  resolved_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, chat_id, message_id)
);
CREATE INDEX asks_status ON asks (user_id, status);
ALTER TABLE devops_write_log ADD ask_chat_id nvarchar(256) NULL, ask_message_id nvarchar(64) NULL;`,
};
