// Demo mode (step 15, D272): a whole action context built from fictional data, with its own plan store in memory and
// its config held in memory. It is given no fetch, keyring, writer, link launcher or export, and dispatch refuses
// every outward action while it is on, so nothing leaves FocusTime and nothing real is read or written.
import { parseConfig } from "../config/schema.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { dispatch } from "../actions/dispatch.ts";
import { createDemoSources } from "../sources/demo/sources.ts";
import { DEMO_CONFIG, DEMO_TZ } from "../sources/demo/data.ts";
import { createPlanStore, type PlanStore } from "../store/plan-store.ts";
import { mondayOf } from "../week/dates.ts";
import { createDemoAzure, DEMO_VM_ID } from "../sources/demo/azure.ts";
import { createDemoFeedbackDevOps, type DemoFeedbackParent } from "../sources/demo/feedback.ts";
import { createFeedbackService } from "../actions/feedback-actions.ts";
import { DEMO_PERSON } from "../sources/demo/azure.ts";

export type DemoControl = { on: boolean; set: (on: boolean) => Promise<void> };

export function createDemoContext(opts: { now: () => string; demo: DemoControl; /** A2 tests: a store on a shared database. */ plan?: PlanStore; /** F1 checks: the pretend feature's state. */ feedbackParent?: DemoFeedbackParent }): ActionContext {
  let text = DEMO_CONFIG;
  const sources = createDemoSources(opts.now);
  const plan = opts.plan ?? createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(opts.now()).toZonedDateTimeISO(DEMO_TZ) });
  // Step 15.4: a fictional signed-in person and VM, simulated (no Azure calls).
  const demoAzure = createDemoAzure();
  // F1: Send feedback against a pretend backlog in memory (nothing leaves FocusTime).
  const feedback = createFeedbackService({ devops: createDemoFeedbackDevOps({ parent: opts.feedbackParent ?? "ok" }), mode: "live", env: "demo", local: false, demo: true, now: () => Date.parse(opts.now()), log: () => {}, sleep: async () => {} });
  return {
    loadConfig: async () => ({ path: "Demo data (in memory, not your config file)", parsed: parseConfig(text) }),
    // Theme or view changes in demo mode stay in memory: the real config file is never touched.
    writeConfig: async (edit) => {
      const next = edit(text);
      const parsed = parseConfig(next);
      if (!parsed.ok) return { ok: false, parsed };
      text = next;
      return { ok: true, parsed, backup: "" };
    },
    makeDataverse: () => sources.dataverse,
    makeOutlook: () => sources.outlook,
    makeGoogle: () => sources.google,
    makeDevOps: () => sources.devops,
    saveSystemUserId: async () => {},
    now: opts.now,
    plan,
    demo: opts.demo,
    account: () => demoAzure.account,
    azure: demoAzure.azure,
    feedback: { service: feedback, sender: async () => ({ name: DEMO_PERSON.name, email: DEMO_PERSON.email }) },
  };
}

/**
 * A believable week to demo: the week plan per client (musts, nice to haves, a pin), follow-ups (one overdue, one due
 * today), a resume note and a capture to sort. Seeded through the app's own actions, so every rule applies. Today's
 * day is left unplanned, so the walkthrough can plan it.
 */
export async function seedDemo(ctx: ActionContext): Promise<void> {
  const tz = DEMO_TZ;
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate();
  const weekStart = mondayOf(today.toString());
  const day = (n: number) => today.add({ days: n }).toString();
  const run = async (action: string, input: Record<string, unknown>) => {
    const r = await dispatch(ctx, { action, input });
    if (!r.ok) throw new Error(`demo seed ${action}: ${r.error}`);
    return r.data as Record<string, unknown>;
  };
  // Signed in as the fictional person, with the demo VM confirmed as theirs.
  await run("auth.status", {});
  await run("vm.choose", { vmId: DEMO_VM_ID });
  await run("week.load", { weekStart });
  await run("weekplan.load", { weekStart });
  // E2: a feature's load comes from its stories on the list once one is sized (Harbor's S and S: 2h; Northwind 1110's
  // L and an unsized one: 4h + 2h), else its estimate in hours (Northwind 1120: 4h, none set); stories S, M, L or not
  // sized yet. Northwind needs about 2h more than its free time (the amber line); the others fit.
  const list: [string, number, "must" | "nice", { hours?: number; size?: "S" | "M" | "L" }][] = [
    ["Cooptimize", 4410, "must", { hours: 4 }],
    ["Cooptimize", 4411, "must", { size: "S" }],
    ["Cooptimize", 4412, "must", { size: "S" }],
    ["Northwind", 1110, "must", { hours: 8 }],
    ["Northwind", 1111, "must", { size: "L" }],
    ["Northwind", 1112, "must", {}],
    ["Northwind", 1120, "must", {}],
    ["Northwind", 1130, "nice", { size: "M" }],
    ["Harbor", 2210, "must", { hours: 4 }],
    ["Harbor", 2211, "must", { size: "S" }],
    ["Harbor", 2212, "must", { size: "S" }],
    ["Atlas", 3311, "must", { size: "S" }],
    ["Atlas", 3330, "nice", { size: "S" }],
  ];
  for (const [clientKey, itemId, tier, est] of list) await run("weekplan.add", { weekStart, clientKey, itemId, tier, ...est });
  await run("weekplan.place", { weekStart, clientKey: "Cooptimize", itemId: 4410, date: weekStart, half: "AM", on: true });
  await run("weekplan.commit", { weekStart });
  await run("followup.add", { clientKey: "Cooptimize", who: "Jordan Lee", what: "Reply about the proposal timeline", channel: "teams", due: day(-1) });
  await run("followup.add", { clientKey: "Northwind", who: "Dana Morales", what: "Send the export spec for review", channel: "email", due: day(0) });
  await run("followup.add", { clientKey: "Harbor", who: "Chris Park", what: "Confirm the intake form go-live date", channel: "teams", due: day(1) });
  await run("followup.add", { clientKey: "Atlas", who: "Morgan Diaz", what: "Share the delay alert mockups", channel: "email", due: day(3) });
  await run("note.set", { clientKey: "Northwind", date: day(0), note: "CSV export works for orders. Next: the date filter." });
  await run("capture.add", { text: "Ask Harbor about single sign-on for the intake form", clientKey: "Harbor" });
  // Step 16 (Roadmap): three weeks of daily counts for the features I own, so the trend and signal show (today's comes
  // from the first Roadmap read).
  const history: [string, number, [number, number][]][] = [
    ["Northwind", 1110, [[0, 3], [0, 4], [1, 3]]],
    ["Harbor", 2210, [[0, 6], [1, 5], [2, 4]]],
    ["Cooptimize", 4410, [[0, 2], [0, 2], [0, 2]]],
    ["Cooptimize", 4430, [[0, 4], [1, 3], [2, 2]]],
    ["Northwind", 1140, [[0, 2], [0, 2], [0, 2]]],
    ["Northwind", 1150, [[0, 1], [0, 1], [0, 1]]],
    ["Harbor", 2240, [[0, 2], [1, 1], [2, 0]]],
  ];
  // Step 17 (slice 3): the last 2 weeks for Plan ahead's planned against worked: committed week plans and focused time
  // on picks settled as dropped (nothing carries over into today, and no DevOps update follow-up opens).
  const plan = ctx.plan;
  if (plan) {
    const past: [number, [string, number, string, number][], [string, number, string, number, number][]][] = [
      [-14, [["Northwind", 1110, "Order history export", 1]], [["Northwind", 1114, "Order export API endpoint", 1, 220]]],
      [-7, [["Northwind", 1110, "Order history export", 2], ["Harbor", 2210, "Patient intake form", 1], ["Cooptimize", 4410, "Internal reporting refresh", 1]], [["Northwind", 1111, "Export orders to CSV", 1, 200], ["Harbor", 2211, "Insurance card upload", 3, 60]]],
    ];
    for (const [n, features, picks] of past) {
      const ws = Temporal.PlainDate.from(weekStart).add({ days: n }).toString();
      for (const [clientKey, itemId, title, blocks] of features) (await plan.addWeekItem({ weekStart: ws, clientKey, itemId, title, itemType: "Feature", url: null, level: "feature", tier: "must", estimate: blocks * 240 }));
      (await plan.commitWeek(ws));
      for (const [clientKey, itemId, title, dayN, minutes] of picks) {
        const date = Temporal.PlainDate.from(ws).add({ days: dayN }).toString();
        const pick = (await plan.addPick({ date, half: "AM", clientKey, kind: "item", itemId, title, itemType: "User Story", size: "L" }));
        const start = Temporal.ZonedDateTime.from({ timeZone: tz, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), hour: 9 });
        (await plan.addFocus({ pickId: pick.id, label: title, startedAt: start.toString(), endedAt: start.add({ minutes }).toString(), seconds: minutes * 60 }));
        (await plan.drop(pick.id));
      }
    }
  }
  for (const [i, n] of [-21, -14, -7].entries()) await ctx.plan?.recordSnapshots(day(n), history.map(([clientKey, itemId, c]) => ({ clientKey, itemId, done: c[i]![0], open: c[i]![1] })));
}
