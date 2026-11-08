// WK-3 (DP-0): a Deployment is a kind of to-do. Only adds (D468): four nullable columns on picks.
//   picks.todo_kind     'deployment', or null for a plain to-do. Separate from `kind` (what the pick points at: an
//                       item, a draft or an intention), so a story can be a deployment too, and an older build that
//                       doesn't know the column reads the row as the plain to-do it also is.
//   picks.window_start  the deployment's window on the pick's date, local "HH:MM" in the person's zone; with
//   picks.window_end    window_end ("HH:MM", up to "24:00") after it. Both or neither; a deployment needs both.
//                       Local times, not instants, so a move to another day keeps the window.
//   picks.links         the DevOps items a deployment covers, as JSON [{ "id": 123, "title": "…" }], or null.
//                       Only ids and titles of the pick's own client's items; never another client's.
// The note of what's going uses the existing picks.notes.
import type { NamedMigration } from "./named.ts";

export const pickDeployments: NamedMigration = {
  name: "20261120T0900_pick_deployments",
  sqlite: `ALTER TABLE picks ADD COLUMN todo_kind TEXT CHECK (todo_kind IS NULL OR todo_kind IN ('deployment'));
   ALTER TABLE picks ADD COLUMN window_start TEXT CHECK (window_start IS NULL OR length(window_start) = 5);
   ALTER TABLE picks ADD COLUMN window_end TEXT CHECK (window_end IS NULL OR length(window_end) = 5);
   ALTER TABLE picks ADD COLUMN links TEXT;`,
  sqlserver: `ALTER TABLE picks ADD todo_kind nvarchar(16) NULL CONSTRAINT picks_todo_kind_check CHECK (todo_kind IS NULL OR todo_kind IN ('deployment'));
ALTER TABLE picks ADD window_start nvarchar(5) NULL CONSTRAINT picks_window_start_check CHECK (window_start IS NULL OR len(window_start) = 5);
ALTER TABLE picks ADD window_end nvarchar(5) NULL CONSTRAINT picks_window_end_check CHECK (window_end IS NULL OR len(window_end) = 5);
ALTER TABLE picks ADD links nvarchar(max) NULL;`,
};
