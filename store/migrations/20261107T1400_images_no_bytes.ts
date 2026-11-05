// CV-4: chat images are no longer kept in FocusTime. They are read from Teams when someone looks at one (with the
// viewer's own token) or when the AI describes them, and never stored. Only adds and clears (D468): rows that still
// hold bytes get bytes NULL and go back to pending (their byte_size and type stay); the count is logged, never the
// values. Two columns are added for the AI's short description (at most 120 characters, shown only to chat members).
// The bytes column itself is dropped in a later release, once no running revision writes it (images-bytes.test.ts
// fails if any code writes it until then).
import type { NamedMigration } from "./named.ts";

export const imagesNoBytes: NamedMigration = {
  name: "20261107T1400_images_no_bytes",
  count: { op: "images_bytes_cleared", sql: "SELECT COUNT(*) AS n FROM teams_message_images WHERE bytes IS NOT NULL" },
  sqlite: `UPDATE teams_message_images SET bytes = NULL, state = 'pending', attempts = 0 WHERE bytes IS NOT NULL;
   ALTER TABLE teams_message_images ADD COLUMN description TEXT;
   ALTER TABLE teams_message_images ADD COLUMN described_at TEXT;`,
  sqlserver: `UPDATE teams_message_images SET bytes = NULL, state = 'pending', attempts = 0 WHERE bytes IS NOT NULL;
ALTER TABLE teams_message_images ADD description nvarchar(200) NULL, described_at datetime2(7) NULL;`,
};
