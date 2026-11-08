// MC-1: meeting capture, the rules. A client's registered weekly call (Admin › Clients › <client> › Meetings), its
// occurrences, where each transcript comes from, when FocusTime looks for it, who may see and confirm what came of it,
// and the proposals the AI pass makes. Pure: no I/O, no clock (the caller passes now).
//
// Only registered meetings (and, later, meetings FocusTime scheduled) are ever read (`mayRead`). A client-hosted
// meeting (organized in another tenant) is Upload: FocusTime reads only what the registrant's own calendar shows of it
// (time, title, join link), never asks Graph for its meeting or transcript.
import type { IsoDate } from "../week/types.ts";

export const MEETING_ROLES = ["status", "planning"] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];
export const ROLE_LABEL: Record<MeetingRole, string> = { status: "Weekly status call", planning: "Planning" };

export const TRANSCRIPT_SOURCES = ["automatic", "upload"] as const;
export type TranscriptSource = (typeof TRANSCRIPT_SOURCES)[number];

/** One registered call of a client: an app table row, shared by its reviewers and attendees. */
export type MeetingSeries = {
  id: number;
  clientKey: string;
  name: string;
  role: MeetingRole;
  /** What FocusTime uses: the detected source unless an admin overrode it. */
  source: TranscriptSource;
  detected: TranscriptSource;
  /** The organizer's tenant as the calendar showed it: ours, another, or not known (a pasted link with no event). */
  organizer: "home" | "other" | "unknown";
  /** The Teams join link from the registrant's calendar (or pasted). Never logged. */
  joinUrl: string;
  /** The series master's id in the registrant's own mailbox (null for a pasted link with no event found). */
  eventId: string | null;
  registrantId: string;
  /** The time pattern: ISO weekday (1 Monday), local start, minutes, the series' zone, every N weeks. */
  weekday: number;
  start: string;
  minutes: number;
  zone: string;
  interval: number;
  /** FocusTime user ids (Entra object ids), lowercase. */
  reviewers: string[];
  attendees: string[];
  /** Graph's onlineMeeting id, looked up once by the join link (Automatic only). */
  onlineMeetingId: string | null;
  createdAt: string;
  removedAt: string | null;
};

export const OCCURRENCE_STATES = ["waiting", "fetching", "ready", "needs_upload", "no_transcript", "reviewed", "failed"] as const;
export type OccurrenceState = (typeof OCCURRENCE_STATES)[number];

/** One dated occurrence of a series. */
export type Occurrence = {
  id: number;
  seriesId: number;
  date: IsoDate;
  startAt: string;
  endAt: string;
  state: OccurrenceState;
  /** When the next Graph check is due (Automatic, while waiting). */
  nextCheckAt: string | null;
  checks: number;
  /** Where the stored transcript came from, and when. */
  transcriptFrom: TranscriptSource | null;
  transcriptAt: string | null;
  /** The AI pass: done, or why not (an AiErrorKind, or "no_ai" when AI is off for the client). */
  aiOutcome: string | null;
  dismissedBy: string | null;
  reviewedBy: string | null;
  updatedAt: string;
};

const lower = (s: string) => s.trim().toLowerCase();
const has = (xs: readonly string[], id: string) => xs.some((x) => lower(x) === lower(id));

/** Registered (and not removed), or one FocusTime scheduled: the only meetings FocusTime may read. */
export function mayRead(m: { registered: MeetingSeries | null; scheduledByFocusTime?: boolean }): boolean {
  return (!!m.registered && !m.registered.removedAt) || m.scheduledByFocusTime === true;
}

/** Automatic for a meeting organized in Cooptimize's tenant; Upload for anyone else's or an unknown organizer. */
export function detectSource(organizerEmail: string | null, homeDomains: readonly string[]): { organizer: MeetingSeries["organizer"]; source: TranscriptSource } {
  const d = organizerEmail?.split("@")[1]?.toLowerCase();
  if (!d) return { organizer: "unknown", source: "upload" };
  const home = homeDomains.some((h) => d === h.toLowerCase() || d.endsWith(`.${h.toLowerCase()}`));
  return home ? { organizer: "home", source: "automatic" } : { organizer: "other", source: "upload" };
}

/** May a transcript be asked of Graph for this series? Only Automatic, home-tenant, registered meetings. */
export const graphReadable = (s: MeetingSeries) => !s.removedAt && s.source === "automatic" && s.organizer !== "other";

export const canView = (s: MeetingSeries, userId: string) => has(s.reviewers, userId) || has(s.attendees, userId);
export const canConfirm = (s: MeetingSeries, userId: string) => has(s.reviewers, userId);

/** The reviewers by default: the registrant, then the client's leads, once each. */
export function defaultReviewers(registrant: string, leads: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of [registrant, ...leads]) if (id && !has(out, id)) out.push(lower(id));
  return out;
}

/** Attendees: only Cooptimize users who have FocusTime, by id; nobody else is stored. */
export function attendeeIds(invite: readonly { email: string | null }[], users: readonly { id: string; emails: readonly string[] }[]): string[] {
  const out: string[] = [];
  for (const a of invite) {
    const e = a.email?.toLowerCase();
    if (!e) continue;
    const u = users.find((x) => x.emails.some((m) => m.toLowerCase() === e));
    if (u && !has(out, u.id)) out.push(lower(u.id));
  }
  return out;
}

/** Checks after an Automatic occurrence ends: every 15 minutes for 3 hours, then hourly to 12 hours, then Upload. */
export const FAST_CHECK_MINUTES = 15;
export const FAST_CHECK_HOURS = 3;
export const GIVE_UP_HOURS = 12;

/** When to look for the transcript next, or null when it's time to stop looking and ask for an upload. */
export function nextCheck(endAt: string, nowIso: string): string | null {
  const end = Date.parse(endAt);
  const now = Date.parse(nowIso);
  if (now < end) return new Date(end + 5 * 60_000).toISOString();
  const since = now - end;
  if (since >= GIVE_UP_HOURS * 3_600_000) return null;
  const step = since < FAST_CHECK_HOURS * 3_600_000 ? FAST_CHECK_MINUTES * 60_000 : 3_600_000;
  return new Date(now + step).toISOString();
}

/** Occurrences of a weekly pattern from `from` to `to` (dates), each with its instants in the series' zone. */
export function occurrencesBetween(s: Pick<MeetingSeries, "weekday" | "start" | "minutes" | "zone" | "interval" | "createdAt">, from: IsoDate, to: IsoDate): { date: IsoDate; startAt: string; endAt: string }[] {
  const out: { date: IsoDate; startAt: string; endAt: string }[] = [];
  const anchor = Temporal.Instant.from(s.createdAt).toZonedDateTimeISO(s.zone).toPlainDate();
  let d = Temporal.PlainDate.from(from);
  const end = Temporal.PlainDate.from(to);
  while (Temporal.PlainDate.compare(d, end) <= 0) {
    if (d.dayOfWeek === s.weekday) {
      const weeks = Math.floor(anchor.until(d, { largestUnit: "days" }).days / 7);
      if (s.interval <= 1 || ((weeks % s.interval) + s.interval) % s.interval === 0) {
        const start = d.toZonedDateTime({ timeZone: s.zone, plainTime: Temporal.PlainTime.from(s.start) });
        out.push({ date: d.toString(), startAt: start.toInstant().toString(), endAt: start.add({ minutes: s.minutes }).toInstant().toString() });
      }
    }
    d = d.add({ days: 1 });
  }
  return out;
}

// ---- Proposals (the AI pass's output, after the server checked it) ----

export type Quote = { n: number; speaker: string; at: string; text: string };

export type GapProposal = { kind: "gap"; type: string; parentId: number | null; parentTitle: string | null; title: string; description: string; lines: number[] };
export type CommitmentProposal = {
  kind: "commitment";
  who: string;
  /** A Cooptimizer's FocusTime id (an attendee); null for someone from the client. */
  whoId: string | null;
  side: "cooptimize" | "client";
  what: string;
  toName: string | null;
  due: IsoDate | null;
  lines: number[];
};
export type CommentProposal = { kind: "comment"; itemId: number; itemTitle: string; itemType: string; note: "decision" | "next_step" | "status"; text: string; inReport: boolean; lines: number[] };
/** GD-2: `namesRemoved` when the AI's text had another client's name replaced by "another client" (the card says so). */
export type ProposalBody = (GapProposal | CommitmentProposal | CommentProposal) & { namesRemoved?: boolean };
export const PROPOSAL_KINDS = ["gap", "commitment", "comment"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATES = ["open", "skipped", "confirmed", "failed"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export type Proposal = {
  id: number;
  occurrenceId: number;
  kind: ProposalKind;
  body: ProposalBody;
  /** Deleted with the transcript at 30 days (null after). */
  quotes: Quote[] | null;
  state: ProposalState;
  /** What the confirm made: the DevOps write's log id and item, or the shared commitment. */
  result: { writeId?: number; itemId?: number; commitmentId?: number; draftId?: number; message?: string } | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

/** The order the review shows: gaps, then commitments, then comments (each in the AI's order). */
export const proposalOrder = (a: Proposal, b: Proposal) => PROPOSAL_KINDS.indexOf(a.kind) - PROPOSAL_KINDS.indexOf(b.kind) || a.id - b.id;

/** "Will appear in Kat's Monday report": a comment on a feature-tier item (Kat's report lists feature comments). */
export const inKatsReport = (itemType: string, featureTypes: ReadonlySet<string>) => featureTypes.has(itemType);

// ---- Nudges ----

export type MeetingNudge = { kind: "review" | "upload"; key: string; occurrenceId: number; seriesId: number; clientKey: string; meeting: string; date: IsoDate };

/** What a reviewer should hear about now: proposals ready to review, or a transcript to upload. Once each by key. */
export function nudgesFor(userId: string, series: readonly MeetingSeries[], occs: readonly Occurrence[]): MeetingNudge[] {
  const out: MeetingNudge[] = [];
  for (const o of occs) {
    const s = series.find((x) => x.id === o.seriesId);
    if (!s || s.removedAt || !canConfirm(s, userId) || o.dismissedBy) continue;
    if (o.state === "ready") out.push({ kind: "review", key: `meeting_review:${o.id}`, occurrenceId: o.id, seriesId: s.id, clientKey: s.clientKey, meeting: s.name, date: o.date });
    else if (o.state === "needs_upload") out.push({ kind: "upload", key: `meeting_upload:${o.id}`, occurrenceId: o.id, seriesId: s.id, clientKey: s.clientKey, meeting: s.name, date: o.date });
  }
  return out;
}

/** Raw transcripts and their quotes are kept this long (HK-4's purge); proposals and results stay. */
export const TRANSCRIPT_DAYS = 30;
