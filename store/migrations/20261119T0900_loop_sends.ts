// LP-1: Close the loop by Teams, Email, DevOps comment or Call. Only adds (D468). One user table (user_id first, as
// every user table), in Export my data and removed with the person's data.
//
// loop_sends: one row per attempt to close a loop by sending: which promise (its Inbox key, plan/inbox-items.ts: c<id>
// a promise found in a chat, f<id> one I added), the client, the channel (teams, email, devops, call), how (post, a
// draft, send now, a link I opened myself, a call note), the state (pending while it runs, sent, draft while an Outlook
// draft waits for "I sent it", unconfirmed when Graph took it but the read back didn't show it yet, failed), where it
// went in words ("Northwind delivery chat", "Dana Reyes by email", "#4417"), who it was to (a name, never an address),
// who saw it (counts), the text that went, the link to it (the Teams message, the Outlook draft or message, the
// DevOps write), Graph's own id of the message or draft (for read back and retry only; never logged), and when. It is
// also the audit entry for every send: Settings › Data lists it beside the other write logs. Sent messages can't be
// undone, so there is no undo column; whether the promise was marked kept by it is kept for Undo of that alone.
import type { NamedMigration } from "./named.ts";

export const loopSends: NamedMigration = {
  name: "20261119T0900_loop_sends",
  sqlite: `CREATE TABLE loop_sends (
     user_id TEXT NOT NULL,
     id INTEGER PRIMARY KEY,
     promise_key TEXT NOT NULL,
     client_key TEXT,
     channel TEXT NOT NULL CHECK (channel IN ('teams', 'email', 'devops', 'call')),
     mode TEXT NOT NULL CHECK (mode IN ('post', 'draft', 'send', 'link', 'note', 'comment')),
     state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'draft', 'unconfirmed', 'failed', 'marked')),
     destination TEXT NOT NULL,
     recipient TEXT,
     inside_count INTEGER,
     outside_count INTEGER,
     body TEXT NOT NULL,
     link TEXT,
     graph_ref TEXT,
     write_id INTEGER,
     error TEXT,
     kept INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     sent_at TEXT,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX loop_sends_user_promise ON loop_sends (user_id, promise_key);`,
  sqlserver: `CREATE TABLE loop_sends (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  promise_key nvarchar(24) NOT NULL,
  client_key nvarchar(100) NULL,
  channel nvarchar(10) NOT NULL CONSTRAINT loop_sends_channel CHECK (channel IN ('teams', 'email', 'devops', 'call')),
  mode nvarchar(10) NOT NULL CONSTRAINT loop_sends_mode CHECK (mode IN ('post', 'draft', 'send', 'link', 'note', 'comment')),
  state nvarchar(12) NOT NULL CONSTRAINT loop_sends_state CHECK (state IN ('pending', 'sent', 'draft', 'unconfirmed', 'failed', 'marked')),
  destination nvarchar(200) NOT NULL,
  recipient nvarchar(200) NULL,
  inside_count int NULL,
  outside_count int NULL,
  body nvarchar(max) NOT NULL,
  link nvarchar(1000) NULL,
  graph_ref nvarchar(400) NULL,
  write_id int NULL,
  error nvarchar(500) NULL,
  kept bit NOT NULL CONSTRAINT loop_sends_kept DEFAULT 0,
  created_at nvarchar(64) NOT NULL,
  sent_at nvarchar(64) NULL,
  updated_at nvarchar(64) NOT NULL
);
CREATE INDEX loop_sends_user_promise ON loop_sends (user_id, promise_key);`,
};
