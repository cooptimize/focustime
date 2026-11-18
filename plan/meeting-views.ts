// MC-1: what the meeting actions show the page (Admin, the review, Week's call marker): never a join link, an event or
// online meeting id, or a transcript's words outside the review. Pure types, shared by actions/ and ui/.
import type { CallKind, MeetingNudge, MeetingRole, MeetingSeries, Occurrence, TranscriptSource } from "./meetings.ts";

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
  /** MC-2: null for a registered client call; "calendar" or "hand" for a call that isn't registered. */
  call: CallKind | null;
  /** MC-2: a calendar call whose transcript its reviewer can ask Teams for (an online meeting organized at Cooptimize or unknown). */
  teams: boolean;
};

/** MC-2: one of my other calls as Calls lists it (from my own calendar, kept nowhere): never a link or an address. */
export type OtherCallView = {
  /** The meeting's iCalUId (the same on every attendee's calendar); what Review sends back. */
  key: string;
  name: string;
  startAt: string;
  endAt: string;
  minutes: number;
  /** Everyone on it, me included. */
  people: number;
  /** A Teams meeting organized at Cooptimize (or not known): Get it from Teams is offered. */
  teams: boolean;
  /** Organized outside Cooptimize: only Upload a file. */
  outside: boolean;
  /** Its kept call's occurrence once someone on it pressed Review (that I can see), else null. */
  occurrenceId: number | null;
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
  /**
   * WK-6, meeting.mine only: the occurrence's meeting on the calendar, by its iCalUId (the same on every attendee's
   * calendar), so Day, Week and the block panel tie the call to its meeting by the meeting itself; null when it isn't
   * known (then the same start and end, when only one meeting fits).
   */
  eventKey?: string | null;
};

/** meeting.mine's nudges, with the client's name and the date in words. */
export type MeetingNudgeView = MeetingNudge & { clientName: string; dateLabel: string };
