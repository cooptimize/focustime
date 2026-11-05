// UI-B: unfinished picks. On this week's earlier days (suggested in each client's next block, and Cooptimize's, with no
// block left this week, in Unfinished from earlier days), and DM-1: on the last workday before today, so a Monday demo
// has them too (from an earlier week they are listed as From last week, D677).
import type { DemoSeed } from "./types.ts";

type Left = [day: number, half: "AM" | "PM", clientKey: string, itemId: number, title: string, size: "S" | "M" | "L" | null];

export const unfinishedSeed: DemoSeed = {
  name: "unfinished",
  owner: "DM-1 (UI-B)",
  seed: async ({ ctx, today, weekDay, lastWorkday }) => {
    const plan = ctx.plan;
    if (!plan) return;
    const thisWeek: Left[] = [
      [0, "AM", "Cooptimize", 4411, "Timesheet summary query", "S"],
      [0, "PM", "Northwind", 1112, "Filter orders by date range", "M"],
      [1, "AM", "Harbor", 2212, "Validate date of birth", "S"],
      [1, "PM", "Atlas", 3311, "Map of active shipments", null],
    ];
    const days = new Map<string, Left[]>();
    for (const l of thisWeek) {
      const date = weekDay(l[0]);
      if (date < today) days.set(date, [...(days.get(date) ?? []), l]);
    }
    // The last workday's picks when it's in an earlier week (a Monday). Not the date filter (1112): the script plans
    // that one today.
    if (lastWorkday < weekDay(0) && !days.has(lastWorkday))
      days.set(lastWorkday, [
        [0, "AM", "Northwind", 1130, "Fix login timeout on mobile", "M"],
        [0, "PM", "Harbor", 2212, "Validate date of birth", "S"],
        [0, "PM", "Atlas", 3311, "Map of active shipments", null],
      ]);
    for (const [date, picks] of days) {
      await plan.start(date);
      for (const [, half, clientKey, itemId, title, size] of picks) await plan.addPick({ date, half, clientKey, kind: "item", itemId, title, itemType: "User Story", size });
      await plan.commit(date);
    }
  },
};
