// T-2: delivery chats. A person registers Teams group chats for a client (Settings > Clients); the first is the primary.
// One row per chat: a chat belongs to one client of one person (the key is the person and the chat). The members are a
// cache (names, addresses and tenants, never messages), read when the Clients section opens or on Refresh, with the time
// they were read.
import type { NamedMigration } from "./named.ts";

export const deliveryChats: NamedMigration = {
  name: "20261104T0100_delivery_chats",
  sqlite: `CREATE TABLE delivery_chats (
     user_id TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     display_name TEXT NOT NULL,
     web_url TEXT,
     is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
     position INTEGER NOT NULL,
     members_json TEXT,
     members_fetched_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, chat_id)
   );
   CREATE INDEX delivery_chats_client ON delivery_chats (user_id, client_key, position);`,
  sqlserver: `CREATE TABLE delivery_chats (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  chat_id nvarchar(256) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  display_name nvarchar(400) NOT NULL,
  web_url nvarchar(2000) NULL,
  is_primary bit NOT NULL CONSTRAINT delivery_chats_primary_default DEFAULT 0,
  position int NOT NULL,
  members_json nvarchar(max) NULL,
  members_fetched_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);
CREATE INDEX delivery_chats_client ON delivery_chats (user_id, client_key, position);`,
};
