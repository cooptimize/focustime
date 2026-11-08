// CW-1: a co-working call live in Northwind's delivery chat, started 40 minutes ago by a teammate (so Week and Today
// show "Call live in … · Join"), and one that ended this morning in Atlas's (so an ended call shows nothing). Written
// as the poll would record the call started and ended events; the demo reads nothing from Teams.
import { DEMO_TENANT } from "../chats.ts";
import { DEMO_PEOPLE } from "../data.ts";
import type { DemoSeed } from "./types.ts";

export const coworkSeed: DemoSeed = {
  name: "cowork",
  owner: "CW-1",
  seed: async (e) => {
    const [jordan, , , taylor] = DEMO_PEOPLE;
    const tenant = DEMO_TENANT;
    await e.teams.saveCalls("19:demo-northwind-delivery@thread.v2", [
      { chatId: "19:demo-northwind-delivery@thread.v2", callId: "demo-call-northwind", kind: "started", at: e.ago(40), startedAt: e.ago(40), initiatorId: jordan!.aadId, initiatorTenant: tenant },
    ]);
    await e.teams.saveCalls("19:demo-atlas-delivery@thread.v2", [
      { chatId: "19:demo-atlas-delivery@thread.v2", callId: "demo-call-atlas", kind: "started", at: e.ago(200), startedAt: e.ago(200), initiatorId: taylor!.aadId, initiatorTenant: tenant },
      { chatId: "19:demo-atlas-delivery@thread.v2", callId: "demo-call-atlas", kind: "ended", at: e.ago(150), startedAt: e.ago(200), initiatorId: taylor!.aadId, initiatorTenant: tenant },
    ]);
  },
};
