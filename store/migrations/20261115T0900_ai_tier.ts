// AI-F1: the tier each AI request actually used ("standard" or "flex"), so its cost is read at the right price.
// Only adds (D468): one column on the person's log and one on the app's pipeline log, standard for older rows.
import type { NamedMigration } from "./named.ts";

export const aiTier: NamedMigration = {
  name: "20261115T0900_ai_tier",
  sqlite: `ALTER TABLE ai_requests ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard';
   ALTER TABLE app_ai_requests ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard';`,
  sqlserver: `ALTER TABLE ai_requests ADD tier nvarchar(10) NOT NULL CONSTRAINT ai_requests_tier_default DEFAULT 'standard';
ALTER TABLE app_ai_requests ADD tier nvarchar(10) NOT NULL CONSTRAINT app_ai_requests_tier_default DEFAULT 'standard';`,
};
