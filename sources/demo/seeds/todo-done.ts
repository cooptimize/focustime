// PK-1: a to-do checked off whose DevOps item is still open, on the last workday, so Close out of that day asks once
// to set it done in DevOps (the demo's writes are simulated). Today stays unplanned for the script; once today is
// planned, ticking a to-do with an item offers the same, from the demo's write identity per client.
import type { DemoSeed } from "./types.ts";

export const todoDoneSeed: DemoSeed = {
  name: "todo-done",
  owner: "PK-1",
  seed: async ({ ctx, lastWorkday }) => {
    const plan = ctx.plan;
    if (!plan) return;
    await plan.start(lastWorkday);
    const p = await plan.addPick({ date: lastWorkday, half: "AM", clientKey: "Harbor", kind: "item", itemId: 2211, title: "Insurance card upload", itemType: "User Story", size: "S" });
    await plan.setDone(p.id, true);
  },
};
