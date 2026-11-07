// AS-2's seed: the assistant's own demo data. AS-2 owns this file (docs/demo/README.md); the scripted answers for the
// demo script live in sources/demo/assistant.ts. One to-do: Export orders to CSV (Northwind #1111, under Order history
// export) on the coming Wednesday afternoon, the day the script's first move sends the date filter to. Then "Move the
// order history export stories to Friday" finds both under that feature, on the server, and moves them with one
// Confirm and one Undo.
import type { DemoSeed } from "./types.ts";

export const assistantSeed: DemoSeed = {
  name: "assistant",
  owner: "AS-2",
  seed: async ({ ctx, today }) => {
    const plan = ctx.plan;
    if (!plan) return;
    // The Wednesday the script's "to Wednesday afternoon" names: the next one after today (a week on, on a Wednesday).
    const t = Temporal.PlainDate.from(today);
    const wed = t.add({ days: (3 - t.dayOfWeek + 7) % 7 || 7 }).toString();
    await plan.addPick({ date: wed, half: "PM", clientKey: "Northwind", kind: "item", itemId: 1111, title: "Export orders to CSV", itemType: "User Story", size: "S" });
  },
};
