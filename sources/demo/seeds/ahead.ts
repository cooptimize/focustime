// AH-1: three changes pending in Ahead: a start date, an owner, and a target date that changed in DevOps since editing
// began (the fictional earlier value), so the review shows a conflict.
import type { DemoSeed } from "./types.ts";

export const aheadSeed: DemoSeed = {
  name: "ahead-changes",
  owner: "DM-1 (AH-1)",
  seed: async ({ ctx, me }) => {
    const plan = ctx.plan;
    if (!plan) return;
    await plan.stageAheadChange({ clientKey: "Northwind", itemId: 1150, field: "start", value: "2026-11-16", half: "PM", baseRev: 1, baseValue: null });
    await plan.stageAheadChange({ clientKey: "Northwind", itemId: 1113, field: "assignee", value: { email: me.email.toLowerCase(), name: me.name }, half: null, baseRev: 1, baseValue: { email: "priya.shah@example.com", name: "Priya Shah" } });
    await plan.stageAheadChange({ clientKey: "Northwind", itemId: 1140, field: "target", value: "2026-12-23", half: "PM", baseRev: 1, baseValue: "2026-12-04" });
  },
};
