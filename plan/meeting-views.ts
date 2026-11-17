// MC-1: what the meeting actions show the page (Admin, the review, Week's call marker): never a join link, an event or
// online meeting id, or a transcript's words outside the review. Pure types, shared by actions/ and ui/.
import type { MeetingNudge, MeetingRole, MeetingSeries, Occurrence, TranscriptSource } from "./meetings.ts";

/** A series as Admin and the review show it: never the join link, the event id or the online meeting id. */
export type SeriesView = {
  id: number;
  clientKey: string;
  clientName: string;
  name: string;
  role: MeetingRole;
  roleLabel: string;
  source: TranscriptSource;
  detected: TranscriptSource;
  organizer: MeetingSeries["organizer"];
  when: string;
  weekday: number;
  start: string;
  minutes: number;
  zone: string;
  reviewers: { id: string; name: string }[];
  attendees: number;
  mine: { review: boolean; attend: boolean };
  /** MC-1c: Admin's one line of proof: the latest call's transcript, read when and through whose sign-in, or why not. */
  lastRead?: string;
};

export type OccurrenceView = {
  id: number; seriesId: number; date: string; startAt: string; endAt: string; state: Occurrence["state"]; transcriptFrom: TranscriptSource | null; proposals: number; open: number; aiOutcome: string | null;
  /** MC-1d: "The AI step failed: <why>" (call-words' aiFailedLine), or null for a pass that ran or none yet. */
  aiMessage: string | null;
  /** MC-1d: after a failed pass, what happens next (FocusTime trying again, stopped, or a person to fix it first). */
  aiNext: string | null;
  /** MC-1d: when FocusTime tries the failed pass again by itself (only where the job runs: production), else null. */
  retryAt: string | null;
  /** MC-1d: a stored transcript to read (kept 30 days): the Transcript view and Propose again need one. */
  hasTranscript: boolean;
  /** MC-1d: the transcript was found but couldn't be read (needs_upload, "Couldn't read the transcript"). */
  readFailed: boolean;
};

/** meeting.mine's nudges, with the client's name and the date in words. */
export type MeetingNudgeView = MeetingNudge & { clientName: string; dateLabel: string };
