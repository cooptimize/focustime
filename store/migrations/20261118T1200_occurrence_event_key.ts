// WK-6: a kept call's meeting, by the meeting itself. Only adds (D468). An app table's column like the rest of
// meeting_occurrences:
//   meeting_occurrences.event_key   the occurrence's iCalUId on the calendar (the same on every attendee's calendar,
//                                   different for each occurrence of a series), read with the series' instances by the
//                                   meeting job. Only an id: never a title, a link, an address or a time. Null for an
//                                   occurrence kept before WK-6, laid out from a pattern, or of a call with no meeting.
import type { NamedMigration } from "./named.ts";

export const occurrenceEventKey: NamedMigration = {
  name: "20261118T1200_occurrence_event_key",
  sqlite: `ALTER TABLE meeting_occurrences ADD COLUMN event_key TEXT;`,
  sqlserver: `ALTER TABLE meeting_occurrences ADD event_key nvarchar(2000) NULL;`,
};
