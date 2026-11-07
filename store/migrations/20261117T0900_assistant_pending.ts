// AS-2: the question the assistant is waiting on, kept on its own turn (what it asked, the choices built from my data,
// what each choice answers) so my next message can answer it for 10 minutes. Only adds (D468): one nullable column.
import type { NamedMigration } from "./named.ts";

export const assistantPending: NamedMigration = {
  name: "20261117T0900_assistant_pending",
  sqlite: `ALTER TABLE assistant_turns ADD COLUMN pending_json TEXT;`,
  sqlserver: `ALTER TABLE assistant_turns ADD pending_json nvarchar(max) NULL;`,
};
