// WP-3: the request types list a person owns. Only adds (D468). App tables (no person in their keys; who may change the
// list is decided by actions/patterns.ts on every request):
//   patterns_type_lists  gains, for a person's version ("own-<n>"), who made it (a FocusTime user id), the one line of
//                        why, the version it was made from and, for an add, which items need labeling again ("all" or
//                        "other"). Older lists keep these empty and stay as they were.
//   patterns_ignored     the "other" suggestions a person chose to ignore (the name, case folded), who and when. Names
//                        only: no item text, no client.
import type { NamedMigration } from "./named.ts";

export const patternsOwnedList: NamedMigration = {
  name: "20261202T0900_patterns_owned_list",
  sqlite: `ALTER TABLE patterns_type_lists ADD COLUMN made_by TEXT;
   ALTER TABLE patterns_type_lists ADD COLUMN why TEXT;
   ALTER TABLE patterns_type_lists ADD COLUMN base TEXT;
   ALTER TABLE patterns_type_lists ADD COLUMN relabel TEXT;
   CREATE TABLE patterns_ignored (
     name TEXT PRIMARY KEY,
     set_by TEXT NOT NULL,
     set_at TEXT NOT NULL
   );`,
  sqlserver: `ALTER TABLE patterns_type_lists ADD made_by nvarchar(64) NULL,
  why nvarchar(300) NULL,
  base nvarchar(40) NULL,
  relabel nvarchar(10) NULL;
CREATE TABLE patterns_ignored (
  name nvarchar(100) NOT NULL PRIMARY KEY,
  set_by nvarchar(64) NOT NULL,
  set_at nvarchar(40) NOT NULL
);`,
};
