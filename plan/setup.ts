// First-run setup (S1, D451): four short screens a new person sees before Today, never in the way.
//   1. Your day: time zone and working hours (prefilled from Outlook's mailbox settings).
//   2. Your clients: the clients followed in Dataverse, each with DevOps write access or read only.
//   3. Standing blocks (optional; Skip is the default).
//   4. Calendars (optional): connect Google, or skip.
// Only this is stored, per person: each step done, skipped or dismissed (closed). Every screen saves through the
// ordinary settings actions; nothing here is a second copy of a setting. Pure: no I/O.

export const SETUP_STEPS = ["day", "clients", "blocks", "calendars"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export const SETUP_STATUSES = ["done", "skipped", "dismissed"] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];
export type SetupState = Partial<Record<SetupStep, SetupStatus>>;

export const validSetupStep = (s: unknown): s is SetupStep => (SETUP_STEPS as readonly unknown[]).includes(s);
export const validSetupStatus = (s: unknown): s is SetupStatus => (SETUP_STATUSES as readonly unknown[]).includes(s);

export const SETUP_TITLES: Readonly<Record<SetupStep, string>> = { day: "Your day", clients: "Your clients", blocks: "Standing blocks", calendars: "Calendars" };

/** Steps not done yet, in order. Skipped and dismissed steps count as left: the Today line offers them again. */
export const remainingSteps = (s: SetupState): SetupStep[] => SETUP_STEPS.filter((k) => s[k] !== "done");

/** Where the flow opens: the first step not done, or the first step when everything is done (Settings > Setup). */
export const firstRemaining = (s: SetupState): SetupStep => remainingSteps(s)[0] ?? SETUP_STEPS[0];

/**
 * Who sees the flow on opening the app: a real (not demo) person with no setup record at all and no settings of their
 * own yet. Anyone with settings from before S1 counts as set up (they never see it). Once any step has a record the
 * flow doesn't open by itself again; the Today line takes over.
 */
export function showsFlow(o: { demo: boolean; state: SetupState; hasOwnSettings: boolean }): boolean {
  if (o.demo || o.hasOwnSettings) return false;
  return Object.keys(o.state).length === 0;
}

/**
 * The quiet line on Today: "2 setup steps left", or null. Never in demo mode, never for someone set up before S1
 * (settings and no record), never once all four are done.
 */
export function todayLine(o: { demo: boolean; state: SetupState; hasOwnSettings: boolean }): { text: string; step: SetupStep } | null {
  if (o.demo) return null;
  if (o.hasOwnSettings && Object.keys(o.state).length === 0) return null;
  const left = remainingSteps(o.state);
  if (!left.length) return null;
  return { text: `${left.length} setup ${left.length === 1 ? "step" : "steps"} left`, step: left[0]! };
}

/** The step after this one, or null after the last (the Done screen). */
export const nextStep = (s: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.indexOf(s) + 1] ?? null;
export const prevStep = (s: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.indexOf(s) - 1] ?? null;

/**
 * Closing the flow skips the rest: the step on screen and every later one without a record become "dismissed"
 * (earlier steps keep their record). Returns the records to write.
 */
export function dismissFrom(s: SetupState, at: SetupStep): SetupState {
  const out: SetupState = {};
  for (const k of SETUP_STEPS.slice(SETUP_STEPS.indexOf(at))) if (!s[k]) out[k] = "dismissed";
  return out;
}
