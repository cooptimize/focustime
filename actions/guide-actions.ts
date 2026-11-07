// UI-5: the Guide's first-day checklist. One read-only action, `guide.checklist`, that says for each of seven checks
// whether it's done, still to do, or skipped in setup. Only states and counts leave the server: never a PAT, a token,
// an identity's name or email, a device or a client's name. Nothing here writes.
import type { SetupState } from "../plan/setup.ts";
import type { ActionResponse } from "./types.ts";

export const CHECK_IDS = ["hours", "clients", "calendars", "devops", "notify", "week", "today"] as const;
export type CheckId = (typeof CHECK_IDS)[number];
/** done, todo, or skipped (a setup step the person chose to skip: optional, shown as "Skipped, any time"). */
export type CheckState = "done" | "todo" | "skipped";
export type Checklist = { demo: boolean; checks: { id: CheckId; state: CheckState }[] };

/** What the checks are read from: setup's record and a few counts. */
export type ChecklistFacts = {
  setup: SetupState;
  /** How many clients have a checked write PAT (devops_identities rows; never the PAT). */
  writeClients: number;
  /** How many devices get push notifications. */
  devices: number;
  teamsMessages: boolean;
  /** This week's or next week's plan is confirmed. */
  weekConfirmed: boolean;
  todayConfirmed: boolean;
};

const step = (s: SetupState[keyof SetupState]): CheckState => (s === "done" ? "done" : s === "skipped" || s === "dismissed" ? "skipped" : "todo");

/** The seven checks, in the order Your first day lists them. */
export function checklist(f: ChecklistFacts): Checklist["checks"] {
  const state: Record<CheckId, CheckState> = {
    hours: step(f.setup.day) === "done" || step(f.setup.blocks) === "done" ? "done" : step(f.setup.day),
    clients: step(f.setup.clients),
    calendars: step(f.setup.calendars),
    devops: f.writeClients > 0 ? "done" : "todo",
    notify: f.devices > 0 || f.teamsMessages ? "done" : "todo",
    week: f.weekConfirmed ? "done" : "todo",
    today: f.todayConfirmed ? "done" : "todo",
  };
  return CHECK_IDS.map((id) => ({ id, state: state[id] }));
}

export type GuideContext = {
  demo: boolean;
  /** Null when the plan store can't be read. */
  facts: () => Promise<ChecklistFacts | null>;
};

export async function guideAction(ctx: GuideContext, input: unknown): Promise<ActionResponse> {
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input) || Object.keys(input).length)) return { ok: false, status: 400, error: "guide.checklist takes no input" };
  // The demo's person is made up: the Guide says what the list would show instead.
  if (ctx.demo) return { ok: true, data: { demo: true, checks: [] } satisfies Checklist };
  const f = await ctx.facts();
  if (!f) return { ok: false, status: 503, error: "Your setup can't be read just now" };
  return { ok: true, data: { demo: false, checks: checklist(f) } satisfies Checklist };
}
