// T-2.1: a client's Teams chats have a kind: its Delivery team chat (the internal Cooptimize team) and its Customer
// collaboration chat (the team with the client's key people), at most one of each (D488). Only adds a column; rows
// from before have none and take one when read (plan/chats.ts kindsOf). is_primary is no longer used; it stays until a
// later release drops it (D468).
import type { NamedMigration } from "./named.ts";

export const deliveryChatKind: NamedMigration = {
  name: "20261104T0400_delivery_chat_kind",
  sqlite: `ALTER TABLE delivery_chats ADD COLUMN chat_kind TEXT CHECK (chat_kind IN ('delivery', 'customer'));`,
  sqlserver: `ALTER TABLE delivery_chats ADD chat_kind nvarchar(20) NULL CONSTRAINT delivery_chats_kind_check CHECK (chat_kind IN ('delivery', 'customer'));`,
};
