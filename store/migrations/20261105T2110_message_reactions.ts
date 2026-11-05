// CV-2: reactions under a message in Show messages. Only adds (D468). teams_messages.reactions_json: each reaction's
// emoji and how many gave it, as Graph returned them when the message was last read (a reaction changes Graph's
// lastModifiedDateTime, so the next read replaces them). Never who reacted. Older builds ignore the column.
import type { NamedMigration } from "./named.ts";

export const messageReactions: NamedMigration = {
  name: "20261105T2110_message_reactions",
  sqlite: `ALTER TABLE teams_messages ADD COLUMN reactions_json TEXT;`,
  sqlserver: `ALTER TABLE teams_messages ADD reactions_json nvarchar(1000) NULL;`,
};
