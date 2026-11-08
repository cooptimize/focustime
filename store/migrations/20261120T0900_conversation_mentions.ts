// GD-2: which other clients a conversation's messages name (client keys as JSON, null for most), for the
// "mentions <client>" tag shown to whoever can already see the conversation; and on a suggested follow-through
// comment, whether the AI's text had another client's name replaced (the card says so). Only adds (D468): two
// nullable columns.
import type { NamedMigration } from "./named.ts";

export const conversationMentions: NamedMigration = {
  name: "20261120T0900_conversation_mentions",
  sqlite: `ALTER TABLE conversations ADD COLUMN mentions_json TEXT;
   ALTER TABLE conversation_suggestions ADD COLUMN names_removed INTEGER;`,
  sqlserver: `ALTER TABLE conversations ADD mentions_json nvarchar(1000) NULL;
ALTER TABLE conversation_suggestions ADD names_removed bit NULL;`,
};
