// IB-1 slice 3: a FocusTime admin can mark a registered client chat as a Social chat. Its messages skip the AI pass
// entirely and are filed as chatter (This is work still moves one into its own conversation). Only adds (D468): one
// column with a default; an older build ignores it and keeps sorting the chat as before.
import type { NamedMigration } from "./named.ts";

export const chatSocial: NamedMigration = {
  name: "20261113T0900_chat_social",
  sqlite: `ALTER TABLE client_chats ADD COLUMN social INTEGER NOT NULL DEFAULT 0 CHECK (social IN (0, 1));`,
  sqlserver: `ALTER TABLE client_chats ADD social bit NOT NULL CONSTRAINT client_chats_social_default DEFAULT 0;`,
};
