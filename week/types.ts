// Core week model types. Pure data, no I/O. See docs/spec.md section 4.

export type Half = "AM" | "PM";
export type WorkWeekday = "Mon" | "Tue" | "Wed" | "Thu";
export type Weekday = WorkWeekday | "Fri";
export type DayPart = "AM" | "PM" | "AllDay";

/** ISO calendar date, e.g. "2026-11-02". */
export type IsoDate = string;
/** ISO 8601 date-time with offset, e.g. "2026-11-02T09:00:00-05:00". */
export type IsoDateTime = string;

export type SourceId = "dataverse" | "outlook" | "google";

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
  half: Half;
  /** "dataverse" for Focus Time patterns, "config" for standing blocks. */
  source: "dataverse" | "config";
  patternId?: string;
};

export type ShowAs = "free" | "tentative" | "busy" | "oof" | "unknown";

export type CalEvent = {
  id: string;
  source: "outlook" | "google";
  title: string;
  /** Timed: ISO date-time with offset. All-day: ISO date. */
  start: string;
  /** Timed: ISO date-time with offset. All-day: ISO date, exclusive. */
  end: string;
  allDay: boolean;
  showAs?: ShowAs;
  isPersonal: boolean;
  responseStatus?: "none" | "organizer" | "accepted" | "tentative" | "declined" | "notResponded";
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
  start: IsoDateTime;
  end: IsoDateTime;
  /** Ordered: Dataverse blocks first, then standing blocks. focus[0] is the one shown. */
  focus: FocusBlock[];
  /** True on Mon–Thu when there is no focus block. Never true on Friday. */
  open: boolean;
  events: PlacedEvent[];
  risks: Risk[];
  /** Longest contiguous gap with no busy item, in minutes. */
  longestFreeMinutes: number;
  /** Every gap with no busy item, in order. */
  freeGaps: FreeGap[];
  busyMeetingMinutes: number;
};

export type Day = {
  date: IsoDate;
  weekday: Weekday;
  kind: "work" | "overflow";
  allDay: CalEvent[];
  /** Events between midnight and the day shape start. */
  early: PlacedEvent[];
  am: Slot;
  pm: Slot;
  /** Events after the usual end, kept visible. */
  evening: PlacedEvent[];
};

export type Week = {
  weekStart: IsoDate;
  timeZone: string;
  days: Day[];
};

export type StandingBlock = { day: WorkWeekday; half: Half; clientKey: string; clientName: string };

export type DayShape = {
  /** "HH:MM" local time. */
  start: string;
  split: string;
  end: string;
  timeZone: string;
};

export type RiskThresholds = {
  meetingWatchMinutes: number;
  meetingAtRiskMinutes: number;
  minFocusWindowMinutes: number;
};

export type WeekConfig = {
  dayShape: DayShape;
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
  fetchedAt: string | null;
  fromCache: boolean;
  /** Board order, top first. */
  items: WorkItem[];
};
