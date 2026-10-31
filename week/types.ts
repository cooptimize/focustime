// Core week model types. Pure data, no I/O. See docs/spec.md section 4.
import type { PtoDay } from "./pto.ts";
import type { DayHours, Span, TimeModel, ViewRange } from "./hours.ts";

/** Morning, afternoon, and the third slot (step 6b): evening working time and flex sessions. */
export type Half = "AM" | "PM" | "EVE";
/** The two halves of the normal workday (focus blocks and standing blocks live here). */
export type MainHalf = "AM" | "PM";
export type WorkWeekday = "Mon" | "Tue" | "Wed" | "Thu";
export type Weekday = WorkWeekday | "Fri" | "Sat" | "Sun";
export type DayPart = "AM" | "PM" | "AllDay";

/** ISO calendar date, e.g. "2026-11-02". */
export type IsoDate = string;
/** ISO 8601 date-time with offset, e.g. "2026-11-02T09:00:00-05:00". */
export type IsoDateTime = string;

/** "pto" is the Dataverse Time Off Tracker read (step 6), reported on its own. */
export type SourceId = "dataverse" | "outlook" | "google" | "pto";

/**
 * A failure's root cause when it is shared beyond one source, so the status bar can name it once (step 6.1):
 * "keyring" = the Secret Service is locked or unavailable; "network" = a host could not be reached (offline,
 * DNS or timeout). Absent for causes that belong to one source (a rejected secret, a missing column, HTTP errors).
 */
export type FailureCause = "keyring" | "network";

export type SourceResult<T> = {
  source: SourceId;
  status: "ok" | "auth_required" | "unreachable" | "misconfigured" | "error";
  fetchedAt: IsoDateTime | null;
  fromCache: boolean;
  /** True when items come from the bundled sample fixture, not a real account. */
  sample?: boolean;
  items: T[];
  message?: string;
  fixAction?: "connect_google" | "connect_microsoft" | "open_settings";
  cause?: FailureCause;
};

/** A Focus Time row after normalization: a recurring weekly pattern. */
export type FocusPattern = {
  id: string;
  clientKey: string;
  clientName: string;
  /** Full account name when it differs from the short name shown. */
  clientFullName?: string;
  startDate: IsoDate;
  /** null means ongoing. Inclusive (Dataverse Date Only). */
  endDate: IsoDate | null;
  active: boolean;
  days: Partial<Record<WorkWeekday, DayPart>>;
};

export type FocusBlock = {
  id: string;
  clientKey: string;
  clientName: string;
  clientFullName?: string;
  date: IsoDate;
  half: MainHalf;
  /** "dataverse" for Focus Time patterns, "config" for standing blocks. */
  source: "dataverse" | "config";
  patternId?: string;
};

/** Outlook showAs. Free and working elsewhere take no time; the rest do (unknown counts as busy). */
export type ShowAs = "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";

export type CalEvent = {
  id: string;
  /** "coopilot": unavailable time blocked in Coopilot (step 6b), busy like a meeting but not a meeting. */
  source: "outlook" | "google" | "coopilot";
  title: string;
  /** Timed: ISO date-time with offset. All-day: ISO date. */
  start: string;
  /** Timed: ISO date-time with offset. All-day: ISO date, exclusive. */
  end: string;
  allDay: boolean;
  showAs?: ShowAs;
  isPersonal: boolean;
  responseStatus?: "none" | "organizer" | "accepted" | "tentative" | "declined" | "notResponded";
  /** Set on unavailable time (source "coopilot"): its plan store id and note. */
  unavailable?: { id: number; note: string | null };
};

/** Time blocked in Coopilot for things on no calendar (step 6b). Counts against capacity like a meeting. */
export type Unavailable = { id: number; title: string; start: IsoDateTime; end: IsoDateTime; note: string | null };

/** Planned work outside working hours (step 6b): local only, never written to a calendar. */
export type FlexSession = {
  id: number;
  clientKey: string;
  start: IsoDateTime;
  end: IsoDateTime;
  itemId: number | null;
  itemTitle: string | null;
  itemUrl: string | null;
  note: string | null;
};

/** An event as it falls inside one bucket of one day, clipped to that bucket. */
export type PlacedEvent = {
  event: CalEvent;
  /** Clipped start and end inside the bucket. */
  clipStart: IsoDateTime;
  clipEnd: IsoDateTime;
  minutesInside: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type FreeGap = { start: IsoDateTime; end: IsoDateTime; minutes: number };

export type RiskRule =
  | "meeting_load"
  | "personal_conflict"
  | "out_of_office"
  | "all_day_busy"
  | "no_focus_window"
  | "double_booked_block";
export type Severity = "watch" | "at_risk";

export type Risk = { rule: RiskRule; severity: Severity; reason: string };

export type Slot = {
  date: IsoDate;
  half: Half;
  /** Working bounds (nominal hours on a day without any, so cards keep their shape). */
  start: IsoDateTime;
  end: IsoDateTime;
  /** What the card's timeline shows: the working bounds widened by the week's view range (D123). */
  view: { start: IsoDateTime; end: IsoDateTime };
  /** Working time inside the slot (lunch excluded; evening spans and flex sessions in EVE). Capacity counts only this. */
  windows: { start: IsoDateTime; end: IsoDateTime }[];
  /** No working time in this slot (a day off, or a weekend day with only a flex session in EVE). */
  off: boolean;
  /** Flex sessions that start in this slot. */
  flex: FlexSession[];
  /** Ordered: Dataverse blocks first, then standing blocks. focus[0] is the one shown. */
  focus: FocusBlock[];
  /** True on Mon–Thu when there is no focus block and the slot has working time. Never true on Friday, weekends or EVE. */
  open: boolean;
  events: PlacedEvent[];
  risks: Risk[];
  /** Longest contiguous gap with no busy item, in minutes. */
  longestFreeMinutes: number;
  /** Every gap with no busy item, in order. */
  freeGaps: FreeGap[];
  busyMeetingMinutes: number;
  /** The day is a PTO day (D105): the whole half-day is off, so it has no free time and raises no risks. */
  pto: boolean;
};

export type Day = {
  date: IsoDate;
  weekday: Weekday;
  kind: "work" | "overflow" | "weekend";
  allDay: CalEvent[];
  /** Events before the first card's timeline starts. */
  early: PlacedEvent[];
  am: Slot;
  pm: Slot;
  /** The third slot: evening working time and flex sessions outside the normal day (step 6b); null when none. */
  eve: Slot | null;
  /** Events after the last card's timeline ends, kept visible. */
  evening: PlacedEvent[];
  /** Working hours of the day after any override (step 6b). */
  hours: DayHours;
  /** Minutes of flex sessions on this day. */
  flexMinutes: number;
  /** PTO from Dataverse (step 6); null when none. A full PTO day has no risks. */
  pto: PtoDay | null;
};

export type Week = {
  weekStart: IsoDate;
  timeZone: string;
  /** Mon to Fri, plus Saturday and Sunday only when something is on them (step 6b). */
  days: Day[];
  /** The hours the timelines show (D123): the mode from config and the range after widening. */
  range: { mode: ViewRange; start: Span["start"]; end: Span["end"]; expanded: boolean };
};

export type StandingBlock = { day: WorkWeekday; half: MainHalf; clientKey: string; clientName: string };

export type RiskThresholds = {
  meetingWatchMinutes: number;
  meetingAtRiskMinutes: number;
  minFocusWindowMinutes: number;
};

export type WeekConfig = {
  /** The time model (step 6b): working hours, lunch, overrides. Replaces the soft day shape. */
  hours: TimeModel;
  thresholds: RiskThresholds;
  standingBlocks: StandingBlock[];
};

/** An Azure DevOps work item assigned to me, normalized. Never carries a PAT or identity. */
export type WorkItem = {
  id: number;
  title: string;
  type: string;
  state: string;
  /** Proposed, InProgress or Resolved (Completed and Removed are never shown). */
  stateCategory: string;
  /** From the project's backlog categories: story (requirement, task, bug) can be picked, portfolio can't, other is on no backlog. */
  level: "story" | "portfolio" | "other";
  /** Board order from the project's process (StackRank or BacklogPriority); null when unset. */
  order: number | null;
  parentId: number | null;
  changedAt: string;
  url: string;
};

export type ClientWorkStatus = "ok" | "identity_missing" | "not_set_up" | "auth_failed" | "no_access" | "unreachable" | "error";

/** One client's DevOps result. Each client is fetched and fails on its own. */
export type ClientWork = {
  clientKey: string;
  clientName: string;
  status: ClientWorkStatus;
  message?: string;
  cause?: FailureCause;
  fetchedAt: string | null;
  fromCache: boolean;
  /** Board order, top first. */
  items: WorkItem[];
  /** Open children (any assignee) of my portfolio items, up to two levels down, for picking at story level. */
  children: WorkItem[];
};
