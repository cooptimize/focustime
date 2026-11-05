// Teams presence (step 16.3). Pure rules for two things:
// 1. Focus sets my Teams status: Busy (or Do not disturb for deep focus) while a focus session runs, always with an
//    expiration (the time left plus 5 minutes), cleared when the session stops, ends, pauses or is abandoned. A
//    status I set by hand in Teams during a session wins: FocusTime leaves it alone until the next session.
// 2. Teammates' presence as one plain word. Only availability and activity are read; status messages, out of
//    office notes and work location are never kept. Nothing here is stored or logged.

// ---- words for teammates ----

export const PRESENCE_WORDS = ["Available", "Busy", "In a meeting", "Do not disturb", "Away", "Be right back", "Offline"] as const;
export type PresenceWord = (typeof PRESENCE_WORDS)[number];

const MEETING = new Set(["InAMeeting", "InACall", "InAConferenceCall", "InAGroupCall", "InAOneOnOneCall"]);
const DND = new Set(["DoNotDisturb", "Presenting", "Focusing", "UrgentInterruptionsOnly"]);

/**
 * The one word shown for a person, from Graph's availability and activity. Unknown or missing presence gives null:
 * nothing is shown rather than a guess.
 */
export function presenceWord(availability: unknown, activity: unknown): PresenceWord | null {
  const a = typeof availability === "string" ? availability : "";
  const act = typeof activity === "string" ? activity : "";
  switch (a) {
    case "Available":
    case "AvailableIdle":
      return "Available";
    case "Busy":
    case "BusyIdle":
      return MEETING.has(act) ? "In a meeting" : DND.has(act) ? "Do not disturb" : "Busy";
    case "InAMeeting":
    case "InACall":
      return "In a meeting";
    case "DoNotDisturb":
    case "Presenting":
    case "Focusing":
      return "Do not disturb";
    case "Away":
      return "Away";
    case "BeRightBack":
      return "Be right back";
    case "Offline":
      return "Offline";
    default:
      return null;
  }
}

/** The indicator's look: a CSS class per word (shape and color differ; the word is always there for screen readers and on hover). */
export const PRESENCE_CLASS: Record<PresenceWord, string> = {
  Available: "available",
  Busy: "busy",
  "In a meeting": "meeting",
  "Do not disturb": "dnd",
  Away: "away",
  "Be right back": "away",
  Offline: "offline",
};

/** Sort order inside a tier of Ask to collaborate: available now first, the rest as they were. */
export function availableFirst<T>(list: readonly T[], wordOf: (x: T) => PresenceWord | null): T[] {
  return list.map((x, i) => ({ x, i, a: wordOf(x) === "Available" ? 0 : 1 })).sort((p, q) => p.a - q.a || p.i - q.i).map((p) => p.x);
}

/** The most people asked for at once (Graph allows 650 per request; the UI never shows that many). */
export const MAX_PRESENCE_PEOPLE = 100;
/** The UI refreshes presence this often while it is on screen. */
export const PRESENCE_REFRESH_MS = 2 * 60_000;

// ---- my status during focus ----

/** What FocusTime sets: Busy, or Do not disturb for deep focus. Graph wants the same value as availability and activity. */
export type FocusStatus = "Busy" | "DoNotDisturb";
export type TeamsStatusSettings = { teamsStatus: boolean; plainFocus: "busy" | "none" };
export const DEFAULT_TEAMS_STATUS: TeamsStatusSettings = { teamsStatus: true, plainFocus: "busy" };

/** The timer, as these rules see it. */
export type FocusSession = { kind: "focus" | "break"; startedAt: string; running: boolean; ended: boolean; deep: boolean; plannedMinutes: number; remainingMs: number } | null;

export const EXPIRY_PAD_MINUTES = 5;
/** Graph refuses expirations under 5 minutes for sessions; preferred presence has no stated limit, so stay within a day. */
const MAX_EXPIRY_MINUTES = 24 * 60;

/** The expiration: the session's time left plus 5 minutes, in whole minutes. */
export function expiryMinutes(remainingMs: number): number {
  return Math.min(MAX_EXPIRY_MINUTES, Math.max(EXPIRY_PAD_MINUTES, Math.ceil(Math.max(0, remainingMs) / 60_000) + EXPIRY_PAD_MINUTES));
}

/** An ISO 8601 duration for Graph's expirationDuration: "PT55M", "PT1H5M". */
export function isoDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h ? `${h}H` : ""}${m || !h ? `${m}M` : ""}`;
}

/** The request body for setUserPreferredPresence. */
export function setBody(status: FocusStatus, minutes: number): { availability: FocusStatus; activity: FocusStatus; expirationDuration: string } {
  return { availability: status, activity: status, expirationDuration: isoDuration(minutes) };
}

/** What my status should be now: Busy or Do not disturb while focus runs (per Settings), else nothing (automatic). */
export function focusGoal(s: FocusSession, settings: TeamsStatusSettings): FocusStatus | null {
  if (!settings.teamsStatus || !s || s.kind !== "focus" || !s.running || s.ended) return null;
  if (s.deep) return "DoNotDisturb";
  return settings.plainFocus === "busy" ? "Busy" : null;
}

/**
 * What FocusTime last did to my status, kept in the plan store (kv "teams_status") so a restart can still clear it.
 * `key` says what the last set was for (session, length, status), so an extend or a switch to deep focus sets again.
 */
export type TeamsStatusState = {
  session: string | null;
  set: FocusStatus | null;
  key: string | null;
  setAt: string | null;
  until: string | null;
  /** I changed my status in Teams during this session: hands off until the next one. */
  manual: boolean;
  /** The last failure (plain words), and when, for a quiet retry. */
  error: string | null;
  errorAt: string | null;
  checkedAt: string | null;
};
export const NO_TEAMS_STATUS: TeamsStatusState = { session: null, set: null, key: null, setAt: null, until: null, manual: false, error: null, errorAt: null, checkedAt: null };

export type TeamsStep = { do: "set"; status: FocusStatus; minutes: number; key: string } | { do: "clear" } | { do: "none" };

/** After a failure, wait this long before trying again. */
export const RETRY_MS = 60_000;
/** While a status is set, read my presence this often to notice a change made in Teams. */
export const CHECK_MS = 60_000;

const ms = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

/** The next step: set (new session, longer session, deep or plain changed, resumed), clear (session over), or nothing. */
export function teamsStep(state: TeamsStatusState, s: FocusSession, settings: TeamsStatusSettings, now: string): TeamsStep {
  if (state.errorAt && ms(now) - ms(state.errorAt) < RETRY_MS) return { do: "none" };
  const goal = focusGoal(s, settings);
  const sameSession = !!s && state.session === s.startedAt;
  // Over, paused, a break or turned off: back to automatic, unless I took over in Teams (then it's mine to keep).
  if (!goal) return state.set && !state.manual ? { do: "clear" } : { do: "none" };
  if (sameSession && state.manual) return { do: "none" };
  const key = `${s!.startedAt}|${s!.plannedMinutes}|${goal}`;
  if (state.set === goal && state.key === key && sameSession) return { do: "none" };
  return { do: "set", status: goal, minutes: expiryMinutes(s!.remainingMs), key };
}

/** The state after a step succeeded. */
export function afterStep(state: TeamsStatusState, step: TeamsStep, s: FocusSession, now: string): TeamsStatusState {
  if (step.do === "set") {
    const newSession = state.session !== s?.startedAt;
    return { ...state, session: s?.startedAt ?? null, set: step.status, key: step.key, setAt: now, until: Temporal.Instant.from(now).add({ minutes: step.minutes }).toString(), manual: newSession ? false : state.manual, error: null, errorAt: null, checkedAt: now };
  }
  if (step.do === "clear") return { ...NO_TEAMS_STATUS, session: s?.startedAt ?? null, manual: false };
  return state;
}

/** Availability values that count as what FocusTime set (Teams may show a meeting or a presentation under Busy or DND). */
const SAME: Record<FocusStatus, ReadonlySet<string>> = {
  Busy: new Set(["Busy", "BusyIdle", "InAMeeting", "InACall"]),
  DoNotDisturb: new Set(["DoNotDisturb", "Presenting", "Focusing"]),
};

/** Whether to read my presence now (a status is set by FocusTime, not taken over, and not read for a minute). */
export function checkDue(state: TeamsStatusState, now: string): boolean {
  if (!state.set || state.manual) return false;
  return !state.checkedAt || ms(now) - ms(state.checkedAt) >= CHECK_MS;
}

/**
 * Did I change my status in Teams? Read at least a minute after FocusTime set it: an availability other than the one
 * set (or its meeting forms). Offline or unknown says nothing (no Teams client signed in, not a choice).
 */
export function manualChange(state: TeamsStatusState, availability: unknown, now: string): boolean {
  if (!state.set || state.manual || !state.setAt) return false;
  if (ms(now) - ms(state.setAt) < CHECK_MS) return false;
  if (typeof availability !== "string" || availability === "Offline" || availability === "PresenceUnknown" || !availability) return false;
  return !SAME[state.set].has(availability);
}

/** Words for my status, for the focus screen: "Teams: Busy until 10:45". */
export const STATUS_WORD: Record<FocusStatus, string> = { Busy: "Busy", DoNotDisturb: "Do not disturb" };
