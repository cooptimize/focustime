// AP-2: AI sorts asks, and Promises. Only adds (D468). An ask gets the AI's sort: whether it was sorted (or the error
// kind that stopped it, for "Not sorted: <reason>"), when, the kind, urgency, the draft item's type, title and
// description, the likely existing item with its confidence, the one-sentence reason, and "Show it anyway" for one the
// AI marked as needing no action. promises keeps my own messages the promise rules matched: what, to whom, due, the
// ask it answers, the AI's reason (or none when sorted without AI), and how it ended (a follow-up, a linked item, done
// or dismissed).
import type { NamedMigration } from "./named.ts";

export const asksAiPromises: NamedMigration = {
  name: "20261104T2000_asks_ai_promises",
  sqlite: `ALTER TABLE asks ADD COLUMN ai_status TEXT;
   ALTER TABLE asks ADD COLUMN ai_at TEXT;
   ALTER TABLE asks ADD COLUMN ai_kind TEXT;
   ALTER TABLE asks ADD COLUMN ai_urgency TEXT;
   ALTER TABLE asks ADD COLUMN ai_item_type TEXT;
   ALTER TABLE asks ADD COLUMN ai_title TEXT;
   ALTER TABLE asks ADD COLUMN ai_description TEXT;
   ALTER TABLE asks ADD COLUMN ai_item_id INTEGER;
   ALTER TABLE asks ADD COLUMN ai_item_confidence REAL;
   ALTER TABLE asks ADD COLUMN ai_reason TEXT;
   ALTER TABLE asks ADD COLUMN ai_shown INTEGER NOT NULL DEFAULT 0 CHECK (ai_shown IN (0, 1));
   CREATE TABLE promises (
     user_id TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     phrase TEXT,
     what TEXT NOT NULL,
     due TEXT,
     to_whom TEXT,
     answers_message_id TEXT,
     ai_status TEXT,
     ai_reason TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'followup', 'linked', 'done', 'dismissed')),
     follow_up_id INTEGER,
     item_id INTEGER,
     item_url TEXT,
     item_title TEXT,
     resolved_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, chat_id, message_id)
   );
   CREATE INDEX promises_status ON promises (user_id, status);`,
  sqlserver: `ALTER TABLE asks ADD ai_status nvarchar(20) NULL,
  ai_at datetime2(7) NULL,
  ai_kind nvarchar(20) NULL,
  ai_urgency nvarchar(20) NULL,
  ai_item_type nvarchar(20) NULL,
  ai_title nvarchar(200) NULL,
  ai_description nvarchar(2000) NULL,
  ai_item_id int NULL,
  ai_item_confidence float NULL,
  ai_reason nvarchar(400) NULL,
  ai_shown bit NOT NULL CONSTRAINT asks_ai_shown_default DEFAULT 0;
CREATE TABLE promises (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  chat_id nvarchar(256) NOT NULL,
  message_id nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  phrase nvarchar(100) NULL,
  what nvarchar(200) NOT NULL,
  due nvarchar(10) NULL,
  to_whom nvarchar(200) NULL,
  answers_message_id nvarchar(64) NULL,
  ai_status nvarchar(20) NULL,
  ai_reason nvarchar(400) NULL,
  status nvarchar(20) NOT NULL CONSTRAINT promises_status_default DEFAULT 'open' CONSTRAINT promises_status_check CHECK (status IN ('open', 'followup', 'linked', 'done', 'dismissed')),
  follow_up_id int NULL,
  item_id int NULL,
  item_url nvarchar(2000) NULL,
  item_title nvarchar(400) NULL,
  resolved_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, chat_id, message_id)
);
CREATE INDEX promises_status ON promises (user_id, status);`,
};
