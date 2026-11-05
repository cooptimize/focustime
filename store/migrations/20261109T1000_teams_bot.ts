// TB-1: the FocusTime bot in Teams. Only adds (D468). Two user tables (user_id first in every key), both left out of
// the export (store/user-data.ts NOT_EXPORTED): they are Teams' plumbing, rebuilt by the person's next message.
//
// teams_bot_chats: the person's 1:1 chat with the bot (its conversation id, the service URL Teams gave and the
// tenant), kept from their first message so later steps can message them; nothing is sent from it in TB-1. One row
// per person. removed_at when they uninstall the app.
//
// teams_bot_cards: one row per proposal card the bot sent: the card's message id (to update it), the proposal's title
// (the outcome card names it), its state and the result card shown once it is settled. A tap claims the row (open to
// running) in one UPDATE, so a double tap or Teams' retry runs the confirm once; a later tap gets the stored result.
// Never a message's text.
import type { NamedMigration } from "./named.ts";

export const teamsBot: NamedMigration = {
  name: "20261109T1000_teams_bot",
  sqlite: `CREATE TABLE teams_bot_chats (
     user_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     service_url TEXT NOT NULL,
     tenant_id TEXT NOT NULL,
     bot_id TEXT NOT NULL,
     first_at TEXT NOT NULL,
     seen_at TEXT NOT NULL,
     removed_at TEXT,
     PRIMARY KEY (user_id)
   );
   CREATE TABLE teams_bot_cards (
     user_id TEXT NOT NULL,
     proposal_id TEXT NOT NULL,
     activity_id TEXT,
     title TEXT NOT NULL,
     state TEXT NOT NULL,
     card_json TEXT,
     expires_at TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, proposal_id)
   );
   CREATE INDEX teams_bot_cards_expires ON teams_bot_cards (user_id, expires_at);`,
  sqlserver: `CREATE TABLE teams_bot_chats (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  conversation_id nvarchar(400) NOT NULL,
  service_url nvarchar(400) NOT NULL,
  tenant_id nvarchar(64) NOT NULL,
  bot_id nvarchar(200) NOT NULL,
  first_at nvarchar(40) NOT NULL,
  seen_at nvarchar(40) NOT NULL,
  removed_at nvarchar(40) NULL,
  CONSTRAINT pk_teams_bot_chats PRIMARY KEY (user_id)
);
CREATE TABLE teams_bot_cards (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  proposal_id nvarchar(100) NOT NULL,
  activity_id nvarchar(200) NULL,
  title nvarchar(300) NOT NULL,
  state nvarchar(20) NOT NULL,
  card_json nvarchar(max) NULL,
  expires_at nvarchar(40) NOT NULL,
  created_at nvarchar(40) NOT NULL,
  updated_at nvarchar(40) NOT NULL,
  CONSTRAINT pk_teams_bot_cards PRIMARY KEY (user_id, proposal_id)
);
CREATE INDEX teams_bot_cards_expires ON teams_bot_cards (user_id, expires_at);`,
};
