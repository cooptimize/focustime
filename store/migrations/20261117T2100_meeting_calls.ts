// MC-2: calls that aren't registered, and a short summary on every call. Only adds (D468): two nullable columns.
//   meeting_series.call_kind        NULL for a client call an admin registered (every row before MC-2); 'calendar'
//                                   for one call from the presser's own calendar, 'hand' for one they added by hand.
//                                   Such a row has one occurrence, Upload as its source (nothing reads it in the
//                                   background), the presser as its one reviewer and the Cooptimizers on their invite
//                                   as its attendees. Every list of registered calls leaves them out.
//   meeting_transcripts.summary_json the AI's summary of what was discussed and decided (at most 5 lines), beside the
//                                   transcript it came from, so it goes with it at 30 days. NULL for a call reviewed
//                                   before MC-2 (it opens without one).
import type { NamedMigration } from "./named.ts";

export const meetingCalls: NamedMigration = {
  name: "20261117T2100_meeting_calls",
  sqlite: `ALTER TABLE meeting_series ADD COLUMN call_kind TEXT;
   ALTER TABLE meeting_transcripts ADD COLUMN summary_json TEXT;`,
  sqlserver: `ALTER TABLE meeting_series ADD call_kind nvarchar(20) NULL;
   ALTER TABLE meeting_transcripts ADD summary_json nvarchar(max) NULL;`,
};
