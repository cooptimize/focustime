// KB-1: which standards an AI-prepared draft used. Only adds (D468): one nullable column on draft_stories, JSON (commit,
// titles and links, overrides); an older build ignores it.
import type { NamedMigration } from "./named.ts";

export const draftAiStandards: NamedMigration = {
  name: "20261124T1010_draft_ai_standards",
  sqlite: `ALTER TABLE draft_stories ADD COLUMN ai_standards TEXT;`,
  sqlserver: `ALTER TABLE draft_stories ADD ai_standards nvarchar(max) NULL;`,
};
