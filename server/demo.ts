// Demo mode (step 15, D272): a whole action context built from fictional data, with its own plan store in memory and
// its config held in memory. It is given no fetch, keyring, writer, link launcher or export, and dispatch refuses
// every outward action while it is on, so nothing leaves Coopilot and nothing real is read or written.
import { parseConfig } from "../config/schema.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { dispatch } from "../actions/dispatch.ts";
import { createDemoSources } from "../sources/demo/sources.ts";
import { DEMO_CONFIG, DEMO_TZ } from "../sources/demo/data.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { mondayOf } from "../week/dates.ts";
import { createDemoAzure, DEMO_VM_ID } from "../sources/demo/azure.ts";

export type DemoControl = { on: boolean; set: (on: boolean) => Promise<void> };

export function createDemoContext(opts: { now: () => string; demo: DemoControl }): ActionContext {
  let text = DEMO_CONFIG;
  const sources = createDemoSources(opts.now);
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(opts.now()).toZonedDateTimeISO(DEMO_TZ) });
  // Step 15.4: a fictional signed-in person and VM, simulated (no Azure calls).
  const demoAzure = createDemoAzure();
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
  const list: [string, number, "must" | "nice", number][] = [
    ["Cooptimize", 4410, "must", 0.5],
    ["Northwind", 1110, "must", 1.5],
    ["Northwind", 1120, "must", 0.5],
    ["Northwind", 1130, "nice", 0.5],
    ["Harbor", 2210, "must", 1],
    ["Atlas", 3310, "must", 0.5],
    ["Atlas", 3330, "nice", 0.5],
  ];
  for (const [clientKey, itemId, tier, blocks] of list) await run("weekplan.add", { weekStart, clientKey, itemId, tier, blocks });
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
  ];
  [-21, -14, -7].forEach((n, i) => ctx.plan?.recordSnapshots(day(n), history.map(([clientKey, itemId, c]) => ({ clientKey, itemId, done: c[i]![0], open: c[i]![1] }))));
}
