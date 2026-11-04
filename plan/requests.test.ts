// Shared polling, the pure rules: the working-hours union decides the interval (5 minutes inside, no polling outside,
// D508), when the next poll is due for the idle rule, the order tokens are tried in, and who may see a chat.
import { describe, expect, it } from "vitest";
import type { TimeModel } from "../week/hours.ts";
import { canSee, chatDue, followersOf, inUnion, nextPollDue, nextUnionStart, pollEvery, POLL_MINUTES, tokenOrder, type ClientChat } from "./requests.ts";

const NY = "America/New_York";
const LONDON = "Europe/London";
const span = (start: string, end: string) => [{ start, end }];
const model = (timeZone: string, days: Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { start: string; end: string }[]>>): TimeModel => ({
  timeZone, lunch: null, overrides: [],
  weekdays: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [], ...days },
});
const weekdays = (tz: string, start = "09:00", end = "17:00") => model(tz, { mon: span(start, end), tue: span(start, end), wed: span(start, end), thu: span(start, end), fri: span(start, end) });
const at = (s: string) => Temporal.Instant.from(s);

const chat = (o: Partial<ClientChat> = {}): ClientChat => ({
  chatId: "19:fabrikam@thread.v2", clientKey: "fabrikam", kind: "customer", displayName: "Fabrikam chat", webUrl: null, position: 0,
  members: [{ userId: "u-ana", displayName: "Ana", email: null, tenantId: "home" }, { userId: "u-ben", displayName: "Ben", email: null, tenantId: "home" }, { userId: "c-dana", displayName: "Dana", email: null, tenantId: "client" }],
  membersFetchedAt: "2026-11-04T12:00:00Z", registeredBy: "u-ana", registeredAt: "2026-11-01T12:00:00Z", readSince: "2026-11-01T12:00:00Z",
  seenAt: null, polledAt: null, fetchedAt: null, retryAt: null, failures: 0, pollState: null, pollNote: null, tokenUser: null, ...o,
});

describe("the interval: the union of followers' working hours", () => {
  // Wednesday 2026-11-04: 14:00Z is 09:00 in New York and 14:00 in London.
  it("inside anyone's hours: every 5 minutes", () => {
    expect(pollEvery(at("2026-11-04T14:00:00Z"), [weekdays(NY)])).toBe(POLL_MINUTES);
    expect(POLL_MINUTES).toBe(5);
  });
  it("one follower's hours are enough (the union, each in their own zone)", () => {
    // 20:00Z: 15:00 in New York (in), 20:00 in London (out).
    expect(pollEvery(at("2026-11-04T20:00:00Z"), [weekdays(LONDON), weekdays(NY)])).toBe(POLL_MINUTES);
  });
  it("outside everyone's hours: no polling (D508; the first poll of the day catches up)", () => {
    expect(pollEvery(at("2026-11-05T03:00:00Z"), [weekdays(LONDON), weekdays(NY)])).toBeNull();
    expect(inUnion(at("2026-11-05T03:00:00Z"), [weekdays(NY)])).toBe(false);
  });
  it("a weekend with no weekend-working follower is skipped; one who works Saturdays brings it back", () => {
    const saturday = at("2026-11-07T15:00:00Z");
    expect(pollEvery(saturday, [weekdays(NY), weekdays(LONDON)])).toBeNull();
    expect(pollEvery(saturday, [weekdays(NY), model(NY, { sat: span("09:00", "13:00") })])).toBe(POLL_MINUTES);
  });
  it("no followers: no polling", () => {
    expect(pollEvery(at("2026-11-04T15:00:00Z"), [])).toBeNull();
  });
});

describe("when a chat is due", () => {
  const now = "2026-11-04T15:00:00Z";
  it("inside hours: never polled, or 5 minutes since the last poll, and not waiting out a retry", () => {
    expect(chatDue(chat(), now, true, false)).toBe(true);
    expect(chatDue(chat({ polledAt: "2026-11-04T14:56:00Z" }), now, true, false)).toBe(false);
    expect(chatDue(chat({ polledAt: "2026-11-04T14:55:00Z" }), now, true, false)).toBe(true);
    expect(chatDue(chat({ polledAt: "2026-11-04T14:00:00Z", retryAt: "2026-11-04T15:10:00Z" }), now, true, false)).toBe(false);
  });
  it("outside hours never; Refresh any time except while waiting out a throttle", () => {
    expect(chatDue(chat(), now, false, false)).toBe(false);
    expect(chatDue(chat({ polledAt: "2026-11-04T14:59:00Z" }), now, false, true)).toBe(true);
    expect(chatDue(chat({ retryAt: "2026-11-04T15:10:00Z" }), now, false, true)).toBe(false);
  });
});

describe("the next poll for the idle rule", () => {
  it("inside hours: the earliest chat's 5 minutes after its last poll", () => {
    const now = at("2026-11-04T15:00:00Z");
    expect(nextPollDue([{ chat: chat({ polledAt: "2026-11-04T14:58:00Z" }), hours: [weekdays(NY)] }], now)?.toString()).toBe("2026-11-04T15:03:00Z");
  });
  it("outside hours: the start of the next working span in the union", () => {
    // Thursday 03:00Z: London starts at 09:00Z, New York at 14:00Z.
    expect(nextUnionStart(at("2026-11-05T03:00:00Z"), [weekdays(NY), weekdays(LONDON)])?.toString()).toBe("2026-11-05T09:00:00Z");
    expect(nextPollDue([{ chat: chat({ polledAt: "2026-11-04T22:00:00Z" }), hours: [weekdays(NY)] }], at("2026-11-05T03:00:00Z"))?.toString()).toBe("2026-11-05T14:00:00Z");
  });
  it("Friday evening: Monday morning", () => {
    expect(nextUnionStart(at("2026-11-06T23:00:00Z"), [weekdays(NY)])?.toString()).toBe("2026-11-09T14:00:00Z");
  });
  it("no chats or no followers: nothing", () => {
    expect(nextPollDue([], at("2026-11-04T15:00:00Z"))).toBeNull();
    expect(nextPollDue([{ chat: chat(), hours: [] }], at("2026-11-04T15:00:00Z"))).toBeNull();
  });
});

describe("tokens and followers", () => {
  const users = [
    { id: "u-ben", name: "Ben Colleague", deleted: false },
    { id: "u-ana", name: "Ana Registrar", deleted: false },
    { id: "u-cy", name: "Cy Elsewhere", deleted: false },
    { id: "u-old", name: "Old Leaver", deleted: true },
  ];
  it("followers: FocusTime users who are members of the chat (deleted people never)", () => {
    expect(followersOf(chat({ members: [...chat().members!, { userId: "u-old", displayName: "Old", email: null, tenantId: "home" }] }), users)).toEqual(["u-ben", "u-ana"]);
  });
  it("the registering person's token first, then the other followers by name", () => {
    expect(tokenOrder(chat({ registeredBy: "u-ben" }), users)).toEqual(["u-ben", "u-ana"]);
    expect(tokenOrder(chat(), users)).toEqual(["u-ana", "u-ben"]);
  });
  it("a registering person who left the chat or FocusTime isn't tried", () => {
    expect(tokenOrder(chat({ registeredBy: "u-cy" }), users)).toEqual(["u-ana", "u-ben"]);
    expect(tokenOrder(chat({ registeredBy: "u-old" }), users)).toEqual(["u-ana", "u-ben"]);
  });
});

describe("who sees a chat (D509)", () => {
  it("a member who follows the client", () => {
    expect(canSee(chat(), "u-ben", new Set(["fabrikam"]))).toBe(true);
  });
  it("not a member: never, even following the client", () => {
    expect(canSee(chat(), "u-cy", new Set(["fabrikam"]))).toBe(false);
  });
  it("a member who doesn't follow the client: no", () => {
    expect(canSee(chat(), "u-ben", new Set(["northwind"]))).toBe(false);
  });
  it("members not read yet: nobody (the poll reads them first)", () => {
    expect(canSee(chat({ members: null }), "u-ana", new Set(["fabrikam"]))).toBe(false);
  });
  it("followed clients unknown (Dataverse unreadable): membership alone", () => {
    expect(canSee(chat(), "u-ben", null)).toBe(true);
    expect(canSee(chat(), "u-cy", null)).toBe(false);
  });
  it("ids compare without case", () => {
    expect(canSee(chat(), "U-BEN", null)).toBe(true);
  });
});
