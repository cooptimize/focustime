// First-run setup (S1, D451): the flow's own actions. Each screen saves through the ordinary actions (settings.save
// "hours" and "standing", devops.set_write_pat, auth.connect_google); these only read what the screens show and keep
// the per-person record of each step (done, skipped or dismissed). Never in demo mode.
import type { AppConfig } from "../config/schema.ts";
import { autoOpen, dismissFrom, firstRemaining, SETUP_STEPS, todayLine, validSetupStatus, validSetupStep, type SetupClient, type SetupPrefill, type SetupState, type SetupStep, type SetupView } from "../plan/setup.ts";
export type { SetupClient, SetupPrefill, SetupView };
import type { WorkingHours } from "../plan/collab.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { WEEKDAY_KEYS, type Span } from "../week/hours.ts";
import { userZone } from "../week/zone.ts";
import type { ActionResponse } from "./types.ts";

export const SETUP_ACTIONS = ["setup.load", "setup.prefill", "setup.mark", "setup.reset"] as const;
export type SetupAction = (typeof SETUP_ACTIONS)[number];

export type SetupContext = {
  plan: PlanStore | undefined;
  demo: boolean;
  /** S1 (D452): local, dev, prod or demo. Start over is refused on prod. */
  env: string;
  config: () => Promise<AppConfig | null>;
  /** The clients I follow in Dataverse with their DevOps org (no PAT); null when Dataverse can't say. */
  clients: (cfg: AppConfig) => Promise<SetupClient[] | null>;
  /** My working hours from Outlook (getSchedule on my own address: my mailbox settings); null when Outlook can't say. */
  workingHours: (cfg: AppConfig) => Promise<WorkingHours | null>;
};

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
const FULL_DAY: Record<string, string> = { mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };
const span = (s: Span) => `${s.start}-${s.end}`;

/** The day screen's values: Outlook's working hours when it has them, else the saved hours; lunch is always the saved one. */
export function prefillFrom(cfg: AppConfig, wh: WorkingHours | null): SetupPrefill {
  const h = cfg.week.hours;
  const lunch = h.lunch ? span(h.lunch) : "";
  if (wh && wh.start < wh.end)
    return { from: "outlook", timeZone: wh.zone, lunch, note: null, weekdays: Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, wh.days.includes(FULL_DAY[k]!) ? [`${wh.start}-${wh.end}`] : []])) };
  return {
    from: "settings",
    timeZone: userZone(cfg),
    lunch,
    note: "Outlook didn't share your working hours, so these are your current settings. Change anything that's off.",
    weekdays: Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, h.weekdays[k].map(span)])),
  };
}

export function setupView(demo: boolean, state: SetupState): SetupView {
  return { demo, state, open: autoOpen({ demo, state }), next: firstRemaining(state), line: todayLine({ demo, state }) };
}

export async function setupAction(ctx: SetupContext, action: SetupAction, input: unknown): Promise<ActionResponse> {
  const o = (typeof input === "object" && input !== null && !Array.isArray(input) ? input : null) as Record<string, unknown> | null;
  if (!o) return bad("input must be an object");
  // Demo mode never shows setup and keeps no record of it.
  if (ctx.demo) return action === "setup.load" ? { ok: true, data: { ...setupView(true, {}), clients: [], clientsProblem: null } } : bad("Setup isn't part of the demo", 403);
  const plan = ctx.plan;
  if (!plan) return bad("The plan store isn't available, so setup can't be saved", 503);
  switch (action) {
    case "setup.load": {
      if (Object.keys(o).some((k) => k !== "clients")) return bad("setup.load takes { clients? }");
      const view = setupView(false, await plan.setupState());
      if (o.clients !== true) return { ok: true, data: view };
      const cfg = await ctx.config();
      const clients = cfg ? await ctx.clients(cfg).catch(() => null) : null;
      return {
        ok: true,
        data: {
          ...view,
          clients: clients ?? [],
          clientsProblem: clients ? null : "FocusTime couldn't read your clients from Dataverse just now. You can skip this and add DevOps write access later in Settings > Clients.",
        },
      };
    }
    case "setup.prefill": {
      if (Object.keys(o).length) return bad("setup.prefill takes {}");
      const cfg = await ctx.config();
      if (!cfg) return bad("Your settings can't be read", 503);
      const wh = await ctx.workingHours(cfg).catch(() => null);
      return { ok: true, data: prefillFrom(cfg, wh) };
    }
    case "setup.mark": {
      for (const k of Object.keys(o)) if (k !== "step" && k !== "status" && k !== "closeFrom") return bad(`unknown input field ${k}`);
      if (o.closeFrom !== undefined) {
        // Closing the flow skips the rest: this step and every later one without a record.
        if (!validSetupStep(o.closeFrom)) return bad(`closeFrom must be one of ${SETUP_STEPS.join(", ")}`);
        const add = dismissFrom(await plan.setupState(), o.closeFrom);
        for (const [step, status] of Object.entries(add)) await plan.setSetupStep(step as SetupStep, status);
      } else {
        if (!validSetupStep(o.step)) return bad(`step must be one of ${SETUP_STEPS.join(", ")}`);
        if (!validSetupStatus(o.status) || o.status === "dismissed") return bad("status must be done or skipped");
        await plan.setSetupStep(o.step, o.status);
      }
      return { ok: true, data: setupView(false, await plan.setupState()) };
    }
    case "setup.reset": {
      if (Object.keys(o).length) return bad("setup.reset takes {}");
      // Start over is for trying the flow again on dev or locally; prod keeps people's record.
      if (ctx.env === "prod") return bad("Start over isn't available in production. Use Run setup again", 403);
      await plan.resetSetup();
      return { ok: true, data: setupView(false, {}) };
    }
  }
}
