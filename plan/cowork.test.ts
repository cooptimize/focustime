// CW-1: call started and ended events read off chat messages, the live rule (and the stale limit), the Teams links and
// the card a live call shows on.
import { describe, expect, it } from "vitest";
import { aCallEventMessage, HOME_TENANT } from "../test/builders/index.ts";
import { messageOf } from "../sources/graph/chats.ts";
import { callEventOf, chatCallLink, durationMs, isLive, liveCall, liveCallCard, liveLine, STALE_CALL_HOURS } from "./cowork.ts";

const CHAT = "19:fabrikam@thread.v2";

describe("call events from Graph chat messages", () => {
  it("a call started event, by its eventDetail whatever messageType says", () => {
    for (const messageType of ["unknownFutureValue", "systemEventMessage"]) {
      expect(callEventOf(aCallEventMessage({ messageType, at: "2026-11-04T14:12:00Z" }), CHAT)).toEqual({
        chatId: CHAT, callId: "9c848c0e-f906-4dfc-b22e-c68a785a587c", kind: "started", at: "2026-11-04T14:12:00.000Z", startedAt: "2026-11-04T14:12:00.000Z",
        initiatorId: "00000000-0000-4000-8000-000000000001", initiatorTenant: HOME_TENANT,
      });
    }
  });

  it("a call ended event works out when it started from callDuration, and keeps no participant", () => {
    const e = callEventOf(aCallEventMessage({ kind: "ended", at: "2026-11-04T16:00:00Z", duration: "PT1H30M", participants: ["Dana Client"] }), CHAT);
    expect(e).toMatchObject({ kind: "ended", at: "2026-11-04T16:00:00.000Z", startedAt: "2026-11-04T14:30:00.000Z" });
    expect(JSON.stringify(e)).not.toContain("Dana");
  });

  it("a Meet now in the chat counts; a screen share alone, another event, a deleted one or a bad id don't", () => {
    expect(callEventOf(aCallEventMessage({ callEventType: "meeting" }), CHAT)?.kind).toBe("started");
    expect(callEventOf(aCallEventMessage({ callEventType: "screenShare" }), CHAT)).toBeNull();
    expect(callEventOf({ ...aCallEventMessage(), eventDetail: { "@odata.type": "#microsoft.graph.membersAddedEventMessageDetail" } }, CHAT)).toBeNull();
    expect(callEventOf({ ...aCallEventMessage(), deletedDateTime: "2026-11-04T15:00:00Z" }, CHAT)).toBeNull();
    expect(callEventOf(aCallEventMessage({ callId: "bad id with spaces" }), CHAT)).toBeNull();
    expect(callEventOf(aCallEventMessage(), "not a chat")).toBeNull();
  });

  it("a person's message is never a call event, and a call event is never a message", () => {
    const msg = { ...aCallEventMessage(), messageType: "message", eventDetail: null, from: { user: { id: "u1" } } };
    expect(callEventOf(msg, CHAT)).toBeNull();
    for (const messageType of ["unknownFutureValue", "systemEventMessage"]) expect(messageOf(aCallEventMessage({ messageType }), CHAT, "fabrikam")).toBeNull();
  });

  it("an unknown starter keeps no id", () => {
    expect(callEventOf(aCallEventMessage({ initiator: null }), CHAT)).toMatchObject({ initiatorId: null, initiatorTenant: null });
  });

  it.each([["PT59S", 59_000], ["PT1H2M3.5S", 3_723_500], ["P1DT2H", 93_600_000], ["PT", null], ["P", null], ["1 hour", null], [null, null]])("durationMs(%s)", (v, ms) => {
    expect(durationMs(v)).toBe(ms);
  });
});

describe("the live rule", () => {
  const started = "2026-11-04T14:12:00.000Z";
  it("live from its start until its end event", () => {
    expect(isLive({ startedAt: started, endedAt: null }, "2026-11-04T15:00:00Z")).toBe(true);
    expect(isLive({ startedAt: started, endedAt: "2026-11-04T15:30:00Z" }, "2026-11-04T16:00:00Z")).toBe(false);
    expect(isLive({ startedAt: null, endedAt: null }, "2026-11-04T15:00:00Z")).toBe(false);
  });

  it(`a call with no end event is treated as ended ${STALE_CALL_HOURS} hours after it started`, () => {
    expect(STALE_CALL_HOURS).toBe(10);
    expect(isLive({ startedAt: started, endedAt: null }, "2026-11-05T00:11:00Z")).toBe(true);
    expect(isLive({ startedAt: started, endedAt: null }, "2026-11-05T00:12:00Z")).toBe(false);
  });

  it("the most recently started of several open calls", () => {
    const a = { chatId: CHAT, callId: "a", startedAt: "2026-11-04T13:00:00.000Z", endedAt: null, startedBy: null, startedByTenant: null };
    const b = { ...a, callId: "b", startedAt: "2026-11-04T14:00:00.000Z" };
    expect(liveCall([a, b], "2026-11-04T15:00:00Z")?.callId).toBe("b");
    expect(liveCall([{ ...b, endedAt: "2026-11-04T14:30:00.000Z" }, a], "2026-11-04T15:00:00Z")?.callId).toBe("a");
    expect(liveCall([], "2026-11-04T15:00:00Z")).toBeNull();
  });
});

describe("words and links", () => {
  it("'Call live in <chat> · started 9:12' in my zone, and who started it", () => {
    expect(liveLine("Fabrikam Delivery", { startedAt: "2026-11-04T14:12:00Z", by: "Person 1", byOutside: false }, "America/New_York")).toEqual({ line: "Call live in Fabrikam Delivery · started 9:12", by: "Started by Person 1" });
    expect(liveLine("Fabrikam Delivery", { startedAt: "2026-11-04T14:12:00Z", by: null, byOutside: true }, "America/New_York").by).toBe("Started by someone outside Cooptimize");
    expect(liveLine("Fabrikam Delivery", { startedAt: "2026-11-04T14:12:00Z", by: null, byOutside: false }, "America/New_York").by).toBeNull();
  });

  it("Join and Start a call open that chat in Teams: its webUrl, else the chat deep link", () => {
    expect(chatCallLink({ chatId: CHAT, webUrl: null })).toBe("https://teams.microsoft.com/l/chat/19%3Afabrikam%40thread.v2/conversations");
    expect(chatCallLink({ chatId: CHAT, webUrl: "https://teams.microsoft.com/l/chat/19%3Afabrikam%40thread.v2/0?tenantId=x" })).toBe("https://teams.microsoft.com/l/chat/19%3Afabrikam%40thread.v2/0?tenantId=x");
    expect(chatCallLink({ chatId: CHAT, webUrl: "https://evil.example/x" })).toBe("https://teams.microsoft.com/l/chat/19%3Afabrikam%40thread.v2/conversations");
    expect(() => chatCallLink({ chatId: "nope", webUrl: null })).toThrow();
  });

  it("a live call shows on the client's first card today that hasn't ended", () => {
    const cards = [
      { key: "am", clientKey: "fabrikam", start: "2026-11-04T13:00:00Z", end: "2026-11-04T17:00:00Z" },
      { key: "pm", clientKey: "fabrikam", start: "2026-11-04T18:00:00Z", end: "2026-11-04T22:00:00Z" },
      { key: "other", clientKey: "contoso", start: "2026-11-04T13:00:00Z", end: "2026-11-04T17:00:00Z" },
    ];
    expect(liveCallCard(cards, "fabrikam", "2026-11-04T14:00:00Z")).toBe("am");
    expect(liveCallCard(cards, "fabrikam", "2026-11-04T17:30:00Z")).toBe("pm");
    expect(liveCallCard(cards, "fabrikam", "2026-11-04T23:00:00Z")).toBeNull();
    expect(liveCallCard(cards, "northwind", "2026-11-04T14:00:00Z")).toBeNull();
  });
});
