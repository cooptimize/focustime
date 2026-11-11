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

export type OccurrenceView = { id: number; seriesId: number; date: string; startAt: string; endAt: string; state: Occurrence["state"]; transcriptFrom: TranscriptSource | null; proposals: number; open: number; aiOutcome: string | null; aiMessage: string | null };

/** meeting.mine's nudges, with the client's name and the date in words. */
export type MeetingNudgeView = MeetingNudge & { clientName: string; dateLabel: string };
