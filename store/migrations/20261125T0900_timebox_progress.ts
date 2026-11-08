// TX-1: XS size, time spent and remaining, and check-in answers. Only adds (D468): nullable columns.
//   picks.size_xs, week_features.size_xs, draft_stories.size_xs
//                       1 when the row is XS (30 minutes). The size column holds 'S' then: its CHECK and SQL Server's
//                       nvarchar(1) only take S, M and L, and this way a build from before XS reads the row as S.
//   picks.spent_minutes, picks.remaining_minutes
//                       time spent and left, null until the first check-in answer. Written on every pick of the same
//                       DevOps item, so a carried or re-picked item keeps its progress.
//   timeboxes.settled_as   'done', 'partly' or 'none': the check-in answer that covered this timebox; null: unanswered.
//   timeboxes.settled_at   when it was answered.
//   timeboxes.settle_before the pick's status, spent and remaining before the answer, as JSON, for Undo.
import type { NamedMigration } from "./named.ts";

export const timeboxProgress: NamedMigration = {
  name: "20261125T0900_timebox_progress",
  sqlite: `ALTER TABLE picks ADD COLUMN size_xs INTEGER;
   ALTER TABLE picks ADD COLUMN spent_minutes INTEGER;
   ALTER TABLE picks ADD COLUMN remaining_minutes INTEGER;
   ALTER TABLE week_features ADD COLUMN size_xs INTEGER;
   ALTER TABLE draft_stories ADD COLUMN size_xs INTEGER;
   ALTER TABLE timeboxes ADD COLUMN settled_as TEXT CHECK (settled_as IS NULL OR settled_as IN ('done', 'partly', 'none'));
   ALTER TABLE timeboxes ADD COLUMN settled_at TEXT;
   ALTER TABLE timeboxes ADD COLUMN settle_before TEXT;`,
  sqlserver: `ALTER TABLE picks ADD size_xs int NULL;
ALTER TABLE picks ADD spent_minutes int NULL;
ALTER TABLE picks ADD remaining_minutes int NULL;
ALTER TABLE week_features ADD size_xs int NULL;
ALTER TABLE draft_stories ADD size_xs int NULL;
ALTER TABLE timeboxes ADD settled_as nvarchar(8) NULL CONSTRAINT timeboxes_settled_as_check CHECK (settled_as IS NULL OR settled_as IN ('done', 'partly', 'none'));
ALTER TABLE timeboxes ADD settled_at nvarchar(40) NULL;
ALTER TABLE timeboxes ADD settle_before nvarchar(max) NULL;`,
};
