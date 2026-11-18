// CW-1: a co-working call live in Northwind's delivery chat, started 40 minutes ago by a teammate (so Week and Today
// show "Call live in … · Join"), and one that ended this morning in Atlas's (so an ended call shows nothing). Written
// as the poll would record the call started and ended events; the demo reads nothing from Teams.
// MC-2c: four earlier calls in Northwind's delivery chat, three with Teams' transcript-is-ready event (one reviews
// cleanly, one comes without speaker names, one Microsoft refuses) and one with no event, which Calls never lists.
import { DEMO_TENANT } from "../chats.ts";
import { DEMO_PEOPLE } from "../data.ts";
import type { DemoSeed } from "./types.ts";
import { DEMO_CHAT_CALL_CHAT, DEMO_CHAT_CALLS } from "../adhoc-calls.ts";

export const coworkSeed: DemoSeed = {
  name: "cowork",
  owner: "CW-1",
  seed: async (e) => {
    const [jordan, , , taylor] = DEMO_PEOPLE;
    const tenant = DEMO_TENANT;
    await e.teams.saveCalls("19:demo-northwind-delivery@thread.v2", [
      { chatId: "19:demo-northwind-delivery@thread.v2", callId: "demo-call-northwind", kind: "started", at: e.ago(40), startedAt: e.ago(40), initiatorId: jordan!.aadId, initiatorTenant: tenant },
    ]);
    // MC-2c: (start, minutes long or null when its end wasn't seen, the event's minutes after the start or null).
    const chat = DEMO_CHAT_CALL_CHAT;
    const calls: [string, number, number | null, number | null][] = [
      [DEMO_CHAT_CALLS.clean, 60 * 22, 35, 37],
      [DEMO_CHAT_CALLS.unnamed, 60 * 47, 25, 26],
      [DEMO_CHAT_CALLS.refused, 60 * 70, null, 48],
      [DEMO_CHAT_CALLS.none, 60 * 5, 20, null],
    ];
    for (const [callId, ago, minutes, ready] of calls) {
      const startedAt = e.ago(ago);
      const ev = { chatId: chat, callId, startedAt, initiatorId: jordan!.aadId, initiatorTenant: tenant };
      await e.teams.saveCalls(chat, [{ ...ev, kind: "started", at: startedAt }, ...(minutes ? [{ ...ev, kind: "ended" as const, at: e.ago(ago - minutes) }] : [])]);
      if (ready !== null) await e.teams.saveTranscriptEvents(chat, [{ chatId: chat, callId, at: e.ago(ago - ready), transcriptId: `${callId}-transcript` }]);
    }
    await e.teams.saveCalls("19:demo-atlas-delivery@thread.v2", [
      { chatId: "19:demo-atlas-delivery@thread.v2", callId: "demo-call-atlas", kind: "started", at: e.ago(200), startedAt: e.ago(200), initiatorId: taylor!.aadId, initiatorTenant: tenant },
      { chatId: "19:demo-atlas-delivery@thread.v2", callId: "demo-call-atlas", kind: "ended", at: e.ago(150), startedAt: e.ago(200), initiatorId: taylor!.aadId, initiatorTenant: tenant },
    ]);
  },
};
