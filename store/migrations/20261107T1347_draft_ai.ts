// CP-1: the AI-prepared version of a captured draft, beside my own text. Only adds (D468). draft_stories gets:
//   ai_state          writing, ready, needs_parent, off or failed; null until prepare ran (or when it was skipped)
//   ai_title, ai_description, ai_acceptance, ai_type, ai_parent_id, ai_parent_reason   the AI version (never my text)
//   ai_note           why it is a plain draft, in plain words ("AI budget reached for this month"); never the input
//   ai_ran_at         when prepare started (an instant), so a "writing" left by a lost request ends
// My own title, description and acceptance stay in their columns: the AI version replaces them only when I accept it.
import type { NamedMigration } from "./named.ts";

export const draftAi: NamedMigration = {
  name: "20261107T1347_draft_ai",
  sqlite: `ALTER TABLE draft_stories ADD COLUMN ai_state TEXT;
   ALTER TABLE draft_stories ADD COLUMN ai_title TEXT;
   ALTER TABLE draft_stories ADD COLUMN ai_description TEXT;
   ALTER TABLE draft_stories ADD COLUMN ai_acceptance TEXT;
   ALTER TABLE draft_stories ADD COLUMN ai_type TEXT;
   ALTER TABLE draft_stories ADD COLUMN ai_parent_id INTEGER;
   ALTER TABLE draft_stories ADD COLUMN ai_parent_reason TEXT;
   ALTER TABLE draft_stories ADD COLUMN ai_note TEXT;
   ALTER TABLE draft_stories ADD COLUMN ai_ran_at TEXT;`,
  sqlserver: `ALTER TABLE draft_stories ADD ai_state nvarchar(16) NULL, ai_title nvarchar(400) NULL, ai_description nvarchar(max) NULL, ai_acceptance nvarchar(max) NULL, ai_type nvarchar(200) NULL, ai_parent_id int NULL, ai_parent_reason nvarchar(400) NULL, ai_note nvarchar(400) NULL, ai_ran_at nvarchar(40) NULL;`,
};
