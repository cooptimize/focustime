// Step 16 (Roadmap): three weeks of daily counts for the features I own, so the trend and signal show (today's comes
// from the first Ahead read). Step 17: the last 2 weeks for Gantt's planned against worked: committed week plans and
// focused time on picks settled as dropped (nothing carries over into today, and no DevOps update follow-up opens).
import type { DemoSeed } from "./types.ts";

export const historySeed: DemoSeed = {
  name: "history",
  owner: "DM-1 (steps 16, 17)",
  seed: async ({ ctx, day, weekStart, zone }) => {
    const plan = ctx.plan;
    if (!plan) return;
    const past: [number, [string, number, string, number][], [string, number, string, number, number][]][] = [
      [-14, [["Northwind", 1110, "Order history export", 1]], [["Northwind", 1114, "Order export API endpoint", 1, 220]]],
      [-7, [["Northwind", 1110, "Order history export", 2], ["Harbor", 2210, "Patient intake form", 1], ["Cooptimize", 4410, "Internal reporting refresh", 1], ["Atlas", 3310, "Shipment tracking dashboard", 1], ["Atlas", 3350, "Carrier rate alerts", 1], ["Atlas", 3360, "Carrier contact list", 1]], [["Northwind", 1111, "Export orders to CSV", 1, 200], ["Harbor", 2211, "Insurance card upload", 3, 60]]],
    ];
    for (const [n, features, picks] of past) {
      const ws = Temporal.PlainDate.from(weekStart).add({ days: n }).toString();
      for (const [clientKey, itemId, title, blocks] of features) await plan.addWeekItem({ weekStart: ws, clientKey, itemId, title, itemType: "Feature", url: null, level: "feature", tier: "must", estimate: blocks * 240 });
      await plan.commitWeek(ws);
      for (const [clientKey, itemId, title, dayN, minutes] of picks) {
        const date = Temporal.PlainDate.from(ws).add({ days: dayN }).toString();
        const pick = await plan.addPick({ date, half: "AM", clientKey, kind: "item", itemId, title, itemType: "User Story", size: "L" });
        const start = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: zone, plainTime: "09:00" });
        await plan.addFocus({ pickId: pick.id, label: title, startedAt: start.toString(), endedAt: start.add({ minutes }).toString(), seconds: minutes * 60 });
        await plan.drop(pick.id);
      }
    }
    const history: [string, number, [number, number][]][] = [
      ["Northwind", 1110, [[0, 3], [0, 4], [1, 3]]],
      ["Harbor", 2210, [[0, 6], [1, 5], [2, 4]]],
      ["Cooptimize", 4410, [[0, 2], [0, 2], [0, 2]]],
      ["Cooptimize", 4430, [[0, 4], [1, 3], [2, 2]]],
      ["Northwind", 1140, [[0, 2], [0, 2], [0, 2]]],
      ["Northwind", 1150, [[0, 1], [0, 1], [0, 1]]],
      ["Harbor", 2240, [[0, 2], [1, 1], [2, 0]]],
    ];
    for (const [i, n] of [-21, -14, -7].entries()) await plan.recordSnapshots(day(n), history.map(([clientKey, itemId, c]) => ({ clientKey, itemId, done: c[i]![0], open: c[i]![1] })));
  },
};
