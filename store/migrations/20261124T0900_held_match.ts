// GD-3: what a held message matched (client key and the word as the message has it, as JSON; null for every other
// message), so each held message can say why it is held, the same for everyone who can see the chat. Only adds (D468).
import type { NamedMigration } from "./named.ts";

export const heldMatch: NamedMigration = {
  name: "20261124T0900_held_match",
  sqlite: `ALTER TABLE conversation_messages ADD COLUMN held_match_json TEXT;`,
  sqlserver: `ALTER TABLE conversation_messages ADD held_match_json nvarchar(max) NULL;`,
};
