// QC-1: a draft at any level the client's process has. Only adds (D468): draft_stories keeps level (story or
// feature, its CHECK unchanged, so an older build still reads every row) and gets beside it
//   item_type   the process's own type name chosen in the New form ("Epic", a level above it), or null (the default)
//   assign_to   the email the draft is for when it isn't me, or null (me)
// An older build reads an epic draft as a feature draft and creates it as me; nothing it reads breaks.
import type { NamedMigration } from "./named.ts";

export const draftItemType: NamedMigration = {
  name: "20261130T0900_draft_item_type",
  sqlite: `ALTER TABLE draft_stories ADD COLUMN item_type TEXT;
   ALTER TABLE draft_stories ADD COLUMN assign_to TEXT;`,
  sqlserver: `ALTER TABLE draft_stories ADD item_type nvarchar(200) NULL, assign_to nvarchar(320) NULL;`,
};
