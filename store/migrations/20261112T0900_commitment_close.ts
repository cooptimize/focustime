// IB-1 slice 2: Close the loop on a promise found in a chat. Promises are never read-only, so a chat promise records
// how I told them (Teams, Email, DevOps, Call; optional) and a note when I close the loop, as a follow-up always has.
// Only adds (D468): two nullable columns on commitments; an older build ignores them.
import type { NamedMigration } from "./named.ts";

export const commitmentClose: NamedMigration = {
  name: "20261112T0900_commitment_close",
  sqlite: `ALTER TABLE commitments ADD COLUMN close_how TEXT CHECK (close_how IN ('teams', 'email', 'devops', 'call'));
   ALTER TABLE commitments ADD COLUMN close_note TEXT;`,
  sqlserver: `ALTER TABLE commitments ADD close_how nvarchar(10) NULL CONSTRAINT commitments_close_how_check CHECK (close_how IN ('teams', 'email', 'devops', 'call')), close_note nvarchar(500) NULL;`,
};
