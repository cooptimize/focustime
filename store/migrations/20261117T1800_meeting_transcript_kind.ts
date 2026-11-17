// PK-1: which kind of transcript an occurrence holds, for the call's page (its note above the proposals and the
// Transcript, and the words where its source is shown) and for the AI step (speakers that aren't named). Only adds
// (D468): transcript_from keeps 'automatic' or 'upload' as before (its CHECK stays), and this column says more:
//   meeting_occurrences.transcript_kind   'pocket' for a Pocket export a reviewer uploaded (no names, no times);
//                                         'teams' for a Teams .vtt or .docx; NULL for rows from before PK-1 (Teams).
// Never a file's name, title or words. Kept after the transcript itself is deleted at 30 days.
import type { NamedMigration } from "./named.ts";

export const meetingTranscriptKind: NamedMigration = {
  name: "20261117T1800_meeting_transcript_kind",
  sqlite: `ALTER TABLE meeting_occurrences ADD COLUMN transcript_kind TEXT;`,
  sqlserver: `ALTER TABLE meeting_occurrences ADD transcript_kind nvarchar(20) NULL;`,
};
