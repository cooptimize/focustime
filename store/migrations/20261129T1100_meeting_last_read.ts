// MC-1c: the meeting job's last look for an occurrence's transcript, for Admin › Clients › <client> › Meetings' one line
// of proof. Only adds (D468). An app table's column like the rest of meeting_occurrences:
//   meeting_occurrences.last_read   JSON: { kind: found | not_yet | no_token | busy | failed, by: a FocusTime user id
//                                   (whose sign-in read it, or who needs to sign in again) or null, at: an instant }.
//                                   Never a token, a link, a meeting id or transcript text.
import type { NamedMigration } from "./named.ts";

export const meetingLastRead: NamedMigration = {
  name: "20261129T1100_meeting_last_read",
  sqlite: `ALTER TABLE meeting_occurrences ADD COLUMN last_read TEXT;`,
  sqlserver: `ALTER TABLE meeting_occurrences ADD last_read nvarchar(400) NULL;`,
};
