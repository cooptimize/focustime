// The week plan per client (features and their stories, a pin). CF-1: nothing is confirmed; adding is enough. E2: a feature's load comes from its stories on the
// list once one is sized (Harbor's S and S: 2h; Northwind 1110's L and an unsized one: 4h + 1h), else its estimate in
// hours (Northwind 1120: 4h, none set); stories S, M, L or not sized yet. Northwind needs about 2h more than its free
// time (the amber line); the others fit.
import type { DemoSeed } from "./types.ts";

export const weekPlanSeed: DemoSeed = {
  name: "week-plan",
  owner: "DM-1 (step 15)",
  seed: async ({ run, weekStart }) => {
    await run("week.load", { weekStart });
    await run("weekplan.load", { weekStart });
    const list: [string, number, { hours?: number; size?: "XS" | "S" | "M" | "L" }][] = [
      ["Cooptimize", 4410, { hours: 4 }],
      ["Cooptimize", 4411, { size: "S" }],
      ["Cooptimize", 4412, { size: "S" }],
      ["Northwind", 1110, { hours: 8 }],
      ["Northwind", 1111, { size: "L" }],
      ["Northwind", 1112, {}],
      ["Northwind", 1120, {}],
      ["Northwind", 1130, { size: "M" }],
      ["Harbor", 2210, { hours: 4 }],
      ["Harbor", 2211, { size: "S" }],
      ["Harbor", 2212, { size: "S" }],
      ["Atlas", 3311, { size: "S" }],
      ["Atlas", 3330, { size: "S" }],
    ];
    for (const [clientKey, itemId, est] of list) await run("weekplan.add", { weekStart, clientKey, itemId, ...est });
    await run("weekplan.place", { weekStart, clientKey: "Cooptimize", itemId: 4410, date: weekStart, half: "AM", on: true });
  },
};
