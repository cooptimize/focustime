// CV-2: Who on a follow-up as a person, beside the text. Only adds (D468). follow_ups.who_ref: a small JSON reference
// chosen in the PersonPicker: a Cooptimizer's Entra id and name, or a chat member's id and name for someone outside
// Cooptimize. `who` keeps the text as it was typed or shown, so older builds and older rows read the same; a row with
// no reference is a plain name ("not linked to a person").
import type { NamedMigration } from "./named.ts";

export const followUpWhoRef: NamedMigration = {
  name: "20261106T1030_followup_who_ref",
  sqlite: `ALTER TABLE follow_ups ADD COLUMN who_ref TEXT;`,
  sqlserver: `ALTER TABLE follow_ups ADD who_ref nvarchar(400) NULL;`,
};
