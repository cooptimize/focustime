// TP-1: work templates and the four lines. Only adds (D468).
//   work_templates      app table, one row (id 1): the team's templates as JSON (types with their hints, examples and
//                       typical stories; the choice lists), a version that moves on every save (so two admins editing at
//                       once never overwrite each other) and who saved last. Seeded once from plan/work-templates.ts;
//                       after that the team's edits are what counts. Every change is also an admin_audit row.
//   work_template_uses  app table: one row per item created with a request type: the tag, when, and whether all four
//                       lines were filled. Counts only for Admin › Work templates: no person, no client, no item id or text.
//   draft_stories.brief user table column: a draft's request type, four lines and their choices as JSON (null: none).
//                       An older build ignores it and creates the draft without them; nothing it reads breaks.
import type { NamedMigration } from "./named.ts";

export const workTemplates: NamedMigration = {
  name: "20261203T0900_work_templates",
  sqlite: `CREATE TABLE work_templates (
     id INTEGER NOT NULL PRIMARY KEY,
     doc TEXT NOT NULL,
     version INTEGER NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT
   );
   CREATE TABLE work_template_uses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tag TEXT NOT NULL,
     created_at TEXT NOT NULL,
     complete INTEGER NOT NULL
   );
   CREATE INDEX work_template_uses_tag ON work_template_uses (tag);
   ALTER TABLE draft_stories ADD COLUMN brief TEXT;`,
  sqlserver: `CREATE TABLE work_templates (
  id int NOT NULL,
  doc nvarchar(max) NOT NULL,
  version int NOT NULL,
  updated_at nvarchar(40) NOT NULL,
  updated_by nvarchar(200) NULL,
  CONSTRAINT work_templates_pk PRIMARY KEY (id)
);
CREATE TABLE work_template_uses (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tag nvarchar(60) NOT NULL,
  created_at nvarchar(40) NOT NULL,
  complete bit NOT NULL
);
CREATE INDEX work_template_uses_tag ON work_template_uses (tag);
ALTER TABLE draft_stories ADD brief nvarchar(max) NULL;`,
};
