// SW-1: the demo's team. Priya (a Northwind and Harbor lead) sent me a Must and a suggestion; I (a Northwind lead) sent
// Sam a Must he hasn't answered and one he can't take, and Priya one she scheduled. Teammates' committed features for
// the Team view, a Northwind priority, and an Ask to look with Priya's reply. All fictional.
import { DEMO_PEOPLE } from "../data.ts";
import type { DemoSeed } from "./types.ts";

export const teamSeed: DemoSeed = {
  name: "team",
  owner: "DM-1 (SW-1)",
  seed: async ({ ctx, team, weekStart, me: who }) => {
    const [jordan, priya, sam] = DEMO_PEOPLE;
    const p = (x: { aadId: string; name: string }) => ({ id: x.aadId.toLowerCase(), name: x.name });
    const me = { id: who.id, name: who.name };
    const url = (org: string, id: number) => `https://dev.azure.com/${org}/_workitems/edit/${id}`;
    const item = (clientKey: string, org: string, itemId: number, title: string, itemType = "Feature") => ({ clientKey, itemId, title, itemType, url: url(org, itemId), level: itemType === "Feature" ? ("feature" as const) : ("story" as const), parentId: null, weekStart });
    await team.addSend({ ...item("Northwind", "northwind-demo", 1140, "Loyalty points"), kind: "must", note: "The client moved this up. Can you start it this week?", askTake: true, from: p(priya!), to: me });
    await team.addSend({ ...item("Harbor", "harbor-demo", 2220, "Appointment reminders"), kind: "suggested", note: "You built the SMS template, so this may be quick for you.", askTake: false, from: p(priya!), to: me });
    await team.addSend({ ...item("Northwind", "northwind-demo", 1150, "Store locator"), kind: "must", note: null, askTake: false, from: me, to: p(sam!) });
    const cant = await team.addSend({ ...item("Northwind", "northwind-demo", 1131, "Invoice PDF totals round wrong", "Bug"), kind: "must", note: "Finance noticed it.", askTake: false, from: me, to: p(sam!) });
    await team.setSend(cant.id, { state: "cant", reason: "Out Thursday and Friday" });
    const ok = await team.addSend({ ...item("Northwind", "northwind-demo", 1130, "Fix login timeout on mobile", "User Story"), kind: "suggested", note: null, askTake: false, from: me, to: p(priya!) });
    await team.setSend(ok.id, { state: "scheduled" });
    const at = ctx.now();
    await team.publish(p(priya!).id, weekStart, [
      { clientKey: "Northwind", itemId: 1110, title: "Order history export", itemType: "Feature", url: url("northwind-demo", 1110), tier: "must", watching: false },
      { clientKey: "Harbor", itemId: 2220, title: "Appointment reminders", itemType: "Feature", url: url("harbor-demo", 2220), tier: "must", watching: false },
      { clientKey: "Harbor", itemId: 2210, title: "Patient intake form", itemType: "Feature", url: url("harbor-demo", 2210), tier: "nice", watching: false },
      { clientKey: "Northwind", itemId: 1140, title: "Loyalty points", itemType: "Feature", url: url("northwind-demo", 1140), tier: "nice", watching: true },
    ], at);
    await team.publish(p(jordan!).id, weekStart, [
      { clientKey: "Atlas", itemId: 3310, title: "Shipment tracking dashboard", itemType: "Feature", url: url("atlas-demo", 3310), tier: "must", watching: false },
      { clientKey: "Atlas", itemId: 3340, title: "Delivery time estimates", itemType: "Feature", url: url("atlas-demo", 3340), tier: "nice", watching: true },
    ], at);
    await team.flag({ clientKey: "Northwind", itemId: 1110, title: "Order history export", itemType: "Feature", url: url("northwind-demo", 1110), note: "The client's top ask for November", flaggedBy: p(priya!) }, at);
    const look = await team.addLook({ clientKey: "Harbor", weekStart, from: me, to: p(priya!), note: "Is the intake form enough for this week?" }, at);
    await team.reply(look.id, "Yes. Leave reminders for next week if it gets tight.", at);
  },
};
