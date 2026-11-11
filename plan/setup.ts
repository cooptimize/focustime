// First-run setup (S1, D451): four short screens a new person sees before Today, never in the way.
//   1. Your day: time zone and working hours (prefilled from Outlook's mailbox settings).
//   2. Your clients: the clients followed in Dataverse, each with DevOps write access or read only.
//   3. Standing blocks (optional; Skip is the default).
//   4. Calendars (optional): connect Google, or skip.
//   5. Your VM (optional, VM-2): Allow Azure access and Find my VM, or skip. A late step: added after people had already
//      stepped through, so it never opens the flow or the Today line by itself (RF-1's rule holds); Settings › Setup
//      shows it as not done.
// Only this is stored, per person: each step done, skipped or dismissed (closed). Every screen saves through the
// ordinary settings actions; nothing here is a second copy of a setting. Pure: no I/O.

export const SETUP_STEPS = ["day", "clients", "blocks", "calendars", "vm"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export const SETUP_STATUSES = ["done", "skipped", "dismissed"] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];
export type SetupState = Partial<Record<SetupStep, SetupStatus>>;

export const validSetupStep = (s: unknown): s is SetupStep => (SETUP_STEPS as readonly unknown[]).includes(s);
export const validSetupStatus = (s: unknown): s is SetupStatus => (SETUP_STATUSES as readonly unknown[]).includes(s);

export const SETUP_TITLES: Readonly<Record<SetupStep, string>> = { day: "Your day", clients: "Your clients", blocks: "Standing blocks", calendars: "Calendars", vm: "Your VM" };

/** VM-2: steps added after setup shipped. They never open the flow, the Today line or the admin's word by themselves. */
export const LATE_STEPS: ReadonlySet<SetupStep> = new Set<SetupStep>(["vm"]);
/** The steps that were the end of the flow before a late step was added (RF-1: a record on one means "through"). */
export const FORMER_LAST_STEPS: readonly SetupStep[] = ["calendars"];

/** Steps not done yet, in order. Skipped and dismissed steps count as left: the Today line offers them again. */
export const remainingSteps = (s: SetupState): SetupStep[] => SETUP_STEPS.filter((k) => s[k] !== "done");

/** Where the flow opens: the first step not done, or the first step when everything is done (Settings > Setup). */
export const firstRemaining = (s: SetupState): SetupStep => remainingSteps(s)[0] ?? SETUP_STEPS[0];

/**
 * Whether the flow opens by itself, and where: a real (not demo) person who hasn't closed it and still has a step with
 * no record. That's a new person (no rows: people with settings before S1 were recorded done by the migration), or
 * one who signed out halfway (it resumes at the first step without a record). Null: it doesn't open by itself.
 */
export function autoOpen(o: { demo: boolean; state: SetupState }): SetupStep | null {
  if (o.demo) return null;
  if (Object.values(o.state).includes("dismissed")) return null;
  return SETUP_STEPS.find((k) => !o.state[k] && !LATE_STEPS.has(k)) ?? null;
}

/** What's left, in words: "2 setup steps left", opening the flow at the first step not done; or null once all four are done. */
export function leftLine(state: SetupState): { text: string; step: SetupStep } | null {
  const left = remainingSteps(state);
  if (!left.length) return null;
  return { text: `${left.length} setup ${left.length === 1 ? "step" : "steps"} left`, step: left[0]! };
}

/**
 * The quiet line on Today: what's left (`leftLine`), or null. Never in demo mode, never while the flow would open by
 * itself, never once all four are done, and (RF-1) never once the person has stepped through the flow to its end, even
 * with steps skipped: Settings › Setup still says what's left. Closing the flow early keeps the line.
 */
export function todayLine(o: { demo: boolean; state: SetupState; through?: boolean }): { text: string; step: SetupStep } | null {
  if (o.demo || o.through || autoOpen(o)) return null;
  // VM-2: a late step alone never brings the line back.
  const left = remainingSteps(o.state).filter((k) => !LATE_STEPS.has(k));
  if (!left.length) return null;
  return leftLine(o.state);
}

/** RF-1: the plan store's once-mark recording that the person reached the flow's end (the last step done or skipped). */
export const SETUP_THROUGH_MARK = "setup_through";

/** RF-1: recording `status` for `step` reaches the end of the flow: the last step, done or skipped (not closed). */
export const reachesEnd = (step: SetupStep, status: SetupStatus) => step === SETUP_STEPS[SETUP_STEPS.length - 1] && status !== "dismissed";

/** The step after this one, or null after the last (the Done screen). */
export const nextStep = (s: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.indexOf(s) + 1] ?? null;

/**
 * Closing the flow skips the rest: the step on screen and every later one without a record become "dismissed"
 * (earlier steps keep their record). Returns the records to write.
 */
export function dismissFrom(s: SetupState, at: SetupStep): SetupState {
  const out: SetupState = {};
  for (const k of SETUP_STEPS.slice(SETUP_STEPS.indexOf(at))) if (!s[k]) out[k] = "dismissed";
  return out;
}

/** One client on the clients screen: from Dataverse, with its DevOps organization and whose write PAT it has (never the PAT). */
export type SetupClient = { key: string; name: string; org: string | null; write: { name: string; email: string } | null };

export type SetupView = {
  demo: boolean;
  state: SetupState;
  /** Where the flow opens by itself, or null. */
  open: SetupStep | null;
  /** The first step not done (the Today line and Settings > Setup open here). */
  next: SetupStep;
  /** Today's quiet line ("2 setup steps left"), or null (RF-1: also once the person stepped through to the end). */
  line: { text: string; step: SetupStep } | null;
  /** RF-1: what's left whether or not Today shows it, for Settings › Setup; null once every step is done. */
  left: { text: string; step: SetupStep } | null;
  /** RF-1: the person has stepped through the flow to its end at least once. */
  through: boolean;
};

export type SetupPrefill = {
  /** "outlook": your Outlook working hours; "settings": what's saved now (Outlook couldn't say). */
  from: "outlook" | "settings";
  timeZone: string;
  /** Per weekday (mon to sun): spans like "09:00-17:00"; empty is a day off. */
  weekdays: Record<string, string[]>;
  lunch: string;
  note: string | null;
};
