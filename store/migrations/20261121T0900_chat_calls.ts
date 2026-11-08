// CW-1: co-working calls in registered client chats. Only adds (D468). An app table (no person in it, like
// teams_messages), one row per call: the chat, Graph's call id, when it started and ended (from the call started and
// ended system events the shared poll already reads), and who started it (a user id and tenant only; the name comes
// from the chat's cached members when shown). Never the participants, a recording, a transcript or any message text.
// Rows go with their chat (removed, purged) and two days after the call started; never in an export, a log or an AI
// request.
import type { NamedMigration } from "./named.ts";

export const chatCalls: NamedMigration = {
  name: "20261121T0900_chat_calls",
  sqlite: `CREATE TABLE chat_calls (
     chat_id TEXT NOT NULL,
     call_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     started_at TEXT,
     ended_at TEXT,
     started_by TEXT,
     started_by_tenant TEXT,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (chat_id, call_id)
   );`,
  sqlserver: `CREATE TABLE chat_calls (
  chat_id nvarchar(256) NOT NULL,
  call_id nvarchar(128) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  started_at datetime2(7) NULL,
  ended_at datetime2(7) NULL,
  started_by nvarchar(64) NULL,
  started_by_tenant nvarchar(64) NULL,
  updated_at datetime2(7) NOT NULL,
  CONSTRAINT chat_calls_pk PRIMARY KEY (chat_id, call_id)
);`,
};
