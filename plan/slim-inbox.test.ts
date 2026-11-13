import { describe, expect, it } from "vitest";
import type { TimeModel } from "../week/hours.ts";
import { checkItemNeeded, checkUpdate, UPDATE_SCHEMA, type Refs } from "./conversations.ts";
import { clearsAs, clearedRecently, notSuggested, tabCount, workingMinutesBetween, type ClearFacts, type SuggestionFacts } from "./slim-inbox.ts";
import { aConversationUpdate, anUpdateAnswer } from "../test/builders/index.ts";

const nineToFive = [{ start: "09:00", end: "17:00" }];
const hours = (timeZone: string): TimeModel => ({ timeZone, weekdays: { mon: nineToFive, tue: nineToFive, wed: nineToFive, thu: nineToFive, fri: nineToFive, sat: [], sun: [] }, lunch: null, overrides: [] });
const NY = hours("America/New_York");
const LONDON = hours("Europe/London");

const conv = (o: Partial<SuggestionFacts> = {}): SuggestionFacts => ({
  itemNeeded: { why: "Asks for a change to the export", title: "Add the delivery fee column", level: "child" },
  itemId: null, likelyItem: null, windDown: false, closedAt: null, status: "discussion", lastWorkAt: "2026-11-05T14:00:00Z", mergedInto: null, ...o,
});

describe("working minutes", () => {
  it("counts only time inside working hours", () => {
    // Thu 9:00 to 17:00 New York is 14:00 to 22:00 UTC.
    expect(workingMinutesBetween("2026-11-05T14:00:00Z", "2026-11-05T18:00:00Z", [NY])).toBe(240);
    expect(workingMinutesBetween("2026-11-05T22:00:00Z", "2026-11-06T13:00:00Z", [NY])).toBe(0);
  });
  it("skips a night and a weekend", () => {
    // Friday 15:00 New York, then Monday 11:00: 2 hours Friday and 2 hours Monday.
    expect(workingMinutesBetween("2026-11-06T20:00:00Z", "2026-11-09T16:00:00Z", [NY])).toBe(240);
  });
  it("uses the union of the followers' hours, each in their own zone", () => {
    // 10:00 to 14:00 UTC: London is working (10 to 14), New York isn't (5 to 9).
    expect(workingMinutesBetween("2026-11-05T10:00:00Z", "2026-11-05T14:00:00Z", [NY])).toBe(0);
    expect(workingMinutesBetween("2026-11-05T10:00:00Z", "2026-11-05T14:00:00Z", [NY, LONDON])).toBe(240);
  });
});

describe("a suggestion", () => {
  const now = "2026-11-05T19:00:00Z"; // Thu 14:00 New York, 5 working hours after 9:00
  const at = { now, hours: [NY] };
  it("needs the sorting step's judgment, no item, no likely item, not wrapped up or closed", () => {
    expect(notSuggested(conv(), at)).toBeNull();
    expect(notSuggested(conv({ itemNeeded: null }), at)).toBe("no_judgment");
    expect(notSuggested(conv({ itemId: 412 }), at)).toBe("has_item");
    expect(notSuggested(conv({ likelyItem: 412 }), at)).toBe("likely_item");
    expect(notSuggested(conv({ windDown: true }), at)).toBe("wrapped_up");
    expect(notSuggested(conv({ closedAt: now, status: "resolved" }), at)).toBe("closed");
  });
  it("waits 4 working hours after the last work message", () => {
    expect(notSuggested(conv({ lastWorkAt: "2026-11-05T16:00:00Z" }), at)).toBe("too_soon");
    expect(notSuggested(conv({ lastWorkAt: "2026-11-05T15:00:00Z" }), at)).toBeNull();
  });
  it("doesn't count the night: a message at 4 PM is ready late the next morning", () => {
    const last = "2026-11-04T21:00:00Z"; // Wed 16:00 New York
    expect(notSuggested(conv({ lastWorkAt: last }), { now: "2026-11-05T15:00:00Z", hours: [NY] })).toBe("too_soon"); // Thu 10:00: 2h
    expect(notSuggested(conv({ lastWorkAt: last }), { now: "2026-11-05T17:00:00Z", hours: [NY] })).toBeNull(); // Thu 12:00: 4h
  });
  it("doesn't count the weekend", () => {
    const last = "2026-11-06T20:00:00Z"; // Fri 15:00
    expect(notSuggested(conv({ lastWorkAt: last }), { now: "2026-11-08T20:00:00Z", hours: [NY] })).toBe("too_soon"); // Sunday
    expect(notSuggested(conv({ lastWorkAt: last }), { now: "2026-11-09T16:00:00Z", hours: [NY] })).toBeNull(); // Mon 11:00
  });
  it("stops after 7 days", () => {
    expect(notSuggested(conv({ lastWorkAt: "2026-10-29T14:00:00Z" }), at)).toBe("too_old");
  });
  it("is gone for me once I dismiss it", () => {
    expect(notSuggested(conv(), { ...at, mark: { outcome: "dismissed", hiddenAt: null } })).toBe("dismissed");
    expect(notSuggested(conv(), { ...at, mark: { outcome: null, hiddenAt: now } })).toBe("dismissed");
  });
});

describe("the judgment rides in the sorting request", () => {
  it("is one more field of the conversation update, required in the schema", () => {
    const conv = (UPDATE_SCHEMA.properties as Record<string, { items: { required: string[]; properties: Record<string, unknown> } }>).conversations!.items;
    expect(conv.required).toContain("item_needed");
    expect(conv.properties.item_needed).toBeDefined();
  });
  it("a judgment that doesn't hold together is no suggestion, never a rejected answer", () => {
    expect(checkItemNeeded({ why: "x", title: "Fix it", level: "story" })).toBeNull();
    expect(checkItemNeeded({ why: "x", title: "  ", level: "child" })).toBeNull();
    expect(checkItemNeeded(null)).toBeNull();
    expect(checkItemNeeded({ why: "Asks for a fix", title: "Fix the refresh", level: "feature" })).toEqual({ why: "Asks for a fix", title: "Fix the refresh", level: "feature" });
    const refs: Refs = { messages: new Map([["m1", "msg-1"]]), people: new Map(), conversations: new Map() };
    const a = anUpdateAnswer({ conversations: [aConversationUpdate({ item_needed: { why: "x", title: "y", level: "nonsense" } })] });
    expect(checkUpdate(a, refs, { batch: ["msg-1"], itemIds: [], hints: new Map() }).updates[0]!.itemNeeded).toBeNull();
  });
  it("a likely existing item wins over a new one", () => {
    const refs: Refs = { messages: new Map([["m1", "msg-1"]]), people: new Map(), conversations: new Map() };
    const a = anUpdateAnswer({ conversations: [aConversationUpdate({ likely_item: 7, item_needed: { why: "x", title: "y", level: "child" } })] });
    expect(checkUpdate(a, refs, { batch: ["msg-1"], itemIds: [7], hints: new Map() }).updates[0]!.itemNeeded).toBeNull();
  });
});

describe("promises that clear themselves", () => {
  const zone = "America/New_York";
  const p = (o: Partial<ClearFacts> = {}): ClearFacts => ({ fromChat: true, dueDate: "2026-11-02", createdAt: "2026-11-01T15:00:00Z", item: null, touched: false, putBackAt: null, ...o });
  it("a finished linked item clears it as done", () => {
    expect(clearsAs(p({ item: { closed: true, changedAt: "2026-11-04T15:00:00Z" } }), "2026-11-05T15:00:00Z", zone)).toBe("item");
    expect(clearsAs(p({ item: { closed: false, changedAt: null } }), "2026-11-05T15:00:00Z", zone)).toBeNull();
    // Promises I added too.
    expect(clearsAs(p({ fromChat: false, item: { closed: true, changedAt: null } }), "2026-11-05T15:00:00Z", zone)).toBe("item");
  });
  it("after Put back, only an item finished since clears it", () => {
    const back = "2026-11-05T12:00:00Z";
    expect(clearsAs(p({ putBackAt: back, item: { closed: true, changedAt: "2026-11-04T15:00:00Z" } }), "2026-11-06T15:00:00Z", zone)).toBeNull();
    expect(clearsAs(p({ putBackAt: back, item: { closed: true, changedAt: "2026-11-06T12:00:00Z" } }), "2026-11-06T15:00:00Z", zone)).toBe("item");
  });
  it("an untouched chat promise expires 7 days after its due day", () => {
    expect(clearsAs(p(), "2026-11-09T15:00:00Z", zone)).toBeNull(); // due Nov 2, Nov 9 is the 7th day
    expect(clearsAs(p(), "2026-11-10T15:00:00Z", zone)).toBe("expired");
  });
  it("without a due date, 7 days after it was found", () => {
    expect(clearsAs(p({ dueDate: null }), "2026-11-08T14:00:00Z", zone)).toBeNull();
    expect(clearsAs(p({ dueDate: null }), "2026-11-08T15:00:00Z", zone)).toBe("expired");
  });
  it("a touched one, one put back, one I added or a rule made never expires", () => {
    const late = "2026-12-01T15:00:00Z";
    expect(clearsAs(p({ touched: true }), late, zone)).toBeNull();
    expect(clearsAs(p({ putBackAt: "2026-11-10T15:00:00Z" }), late, zone)).toBeNull();
    expect(clearsAs(p({ fromChat: false }), late, zone)).toBeNull();
  });
  it("cleared ones show for 14 days", () => {
    expect(clearedRecently("2026-11-01T15:00:00Z", "2026-11-14T15:00:00Z")).toBe(true);
    expect(clearedRecently("2026-11-01T15:00:00Z", "2026-11-16T15:00:00Z")).toBe(false);
    expect(clearedRecently(null, "2026-11-16T15:00:00Z")).toBe(false);
  });
});

describe("the tab's count", () => {
  it("is suggestions plus late or due-today promises, never captures", () => {
    expect(tabCount({ suggestions: 3, promisesLateOrToday: 2 })).toBe(5);
    expect(tabCount({ suggestions: 0, promisesLateOrToday: 0 })).toBe(0);
  });
});
