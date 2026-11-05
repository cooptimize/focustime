// The week plan per client (musts, nice to haves, a pin), committed. E2: a feature's load comes from its stories on the
// list once one is sized (Harbor's S and S: 2h; Northwind 1110's L and an unsized one: 4h + 2h), else its estimate in
// hours (Northwind 1120: 4h, none set); stories S, M, L or not sized yet. Northwind needs about 2h more than its free
// time (the amber line); the others fit.
import type { DemoSeed } from "./types.ts";

export const weekPlanSeed: DemoSeed = {
  name: "week-plan",
  owner: "DM-1 (step 15)",
  seed: async ({ run, weekStart }) => {
    await run("week.load", { weekStart });
    await run("weekplan.load", { weekStart });
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
  },
};
