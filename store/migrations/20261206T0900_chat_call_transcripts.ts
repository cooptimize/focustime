// MC-2c: a chat call's transcript-is-ready event. Only adds (D468): two nullable columns on CW-1's chat_calls.
// Named after the newest migration so it runs after chat_calls (20261121T1000) in name order.
//   chat_calls.transcript_at   when Teams posted the latest transcript-is-ready event for that call in that chat
//                              (the event message's time); NULL while none came. A call with one is kept 14 days
//                              from its start (Calls' window), one without 48 hours, as before.
//   chat_calls.transcript_id   the event's callTranscriptICalUid (an id, nothing else); NULL when it carried none.
// Never the organizer, a name, the message body or any transcript text. Rows still go with their chat.
import type { NamedMigration } from "./named.ts";

export const chatCallTranscripts: NamedMigration = {
  name: "20261206T0900_chat_call_transcripts",
  sqlite: `ALTER TABLE chat_calls ADD COLUMN transcript_at TEXT;
   ALTER TABLE chat_calls ADD COLUMN transcript_id TEXT;`,
  sqlserver: `ALTER TABLE chat_calls ADD transcript_at datetime2(7) NULL;
   ALTER TABLE chat_calls ADD transcript_id nvarchar(1000) NULL;`,
};
