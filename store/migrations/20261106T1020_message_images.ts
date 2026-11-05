// CV-2: images pasted into a client chat (Graph hostedContents), fetched on the server with a chat member's own token
// and served only through FocusTime's endpoint to members of that chat. Only adds (D468). An app table, one row per
// image of a message (its place in the body): the hosted content id as Graph gave it, its state (pending, ok,
// skipped: not PNG, JPEG or GIF, over 10 MB or unreadable; failed: Graph refused, tried again later), the bytes with
// their metadata stripped (EXIF, GPS, text chunks, comments) and the type read from the bytes. Rows go with their
// message (expiry, purge, an edit that changes the body); never in an export, a log or an AI request.
import type { NamedMigration } from "./named.ts";

export const messageImages: NamedMigration = {
  name: "20261106T1020_message_images",
  sqlite: `CREATE TABLE teams_message_images (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     position INTEGER NOT NULL,
     hosted_id TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ok', 'skipped', 'failed')),
     reason TEXT,
     content_type TEXT,
     byte_size INTEGER,
     bytes BLOB,
     attempts INTEGER NOT NULL DEFAULT 0,
     fetched_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX teams_message_images_place ON teams_message_images (chat_id, message_id, position);`,
  sqlserver: `CREATE TABLE teams_message_images (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  chat_id nvarchar(256) NOT NULL,
  message_id nvarchar(64) NOT NULL,
  position int NOT NULL,
  hosted_id nvarchar(2000) NOT NULL,
  state nvarchar(10) NOT NULL CONSTRAINT teams_message_images_state_default DEFAULT 'pending' CONSTRAINT teams_message_images_state_check CHECK (state IN ('pending', 'ok', 'skipped', 'failed')),
  reason nvarchar(40) NULL,
  content_type nvarchar(20) NULL,
  byte_size int NULL,
  bytes varbinary(max) NULL,
  attempts int NOT NULL CONSTRAINT teams_message_images_attempts_default DEFAULT 0,
  fetched_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL
);
CREATE UNIQUE INDEX teams_message_images_place ON teams_message_images (chat_id, message_id, position);`,
};
