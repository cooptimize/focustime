import { describe, expect, it } from "vitest";
import { itemKey, lifecycleOf, needsYou, needsYouCount, parseKey, reasonOf, snoozeChoices, snoozeDayOf, snoozeUntil, viewCounts, viewsOf, type InboxFacts, type Mark } from "./inbox-items.ts";
import type { TimeModel } from "../week/hours.ts";

const today = "2026-11-05";
const now = "2026-11-05T15:00:00Z";
const seen: Mark = { seenAt: "2026-11-01T10:00:00Z", snoozedUntil: null, hiddenAt: null };
const promise = (p: Partial<InboxFacts> = {}): InboxFacts => ({ key: "c1", kind: "promise", clientKey: "contoso", at: now, done: false, due: null, ...p });
const conv = (view: NonNullable<InboxFacts["conversationView"]>, p: Partial<InboxFacts> = {}): InboxFacts => ({ key: "v1", kind: "conversation", clientKey: "contoso", at: now, done: false, conversationView: view, ...p });

describe("item keys", () => {
  it("keep both promise stores apart and come back to their source", () => {
    expect(itemKey("chatPromise", 7)).toBe("c7");
    expect(itemKey("followUp", 7)).toBe("f7");
    expect(parseKey("f7")).toEqual({ source: "followUp", id: 7 });
    expect(parseKey("c12")).toEqual({ source: "chatPromise", id: 12 });
    for (const bad of ["7", "x7", "f0", "f-1", "f7 ", "ff7", ""]) expect(parseKey(bad)).toBeNull();
  });
});

describe("Needs you", () => {
  it("holds a new promise (not seen, not acted on) whatever its due", () => {
    expect(needsYou(promise({ due: "2026-11-20" }), undefined, today, now)).toBe(true);
    expect(lifecycleOf(promise(), undefined, today)).toBe("new");
  });
  it("drops a seen promise due later: it lives only in Promises", () => {
    const f = promise({ due: "2026-11-20" });
    expect(needsYou(f, seen, today, now)).toBe(false);
    expect(viewsOf(f, seen, today, now)).toEqual(["promises"]);
  });
  it("holds a seen promise due today or overdue, linked or not", () => {
    expect(needsYou(promise({ due: today }), seen, today, now)).toBe(true);
    expect(needsYou(promise({ due: "2026-11-02" }), seen, today, now)).toBe(true);
    expect(viewsOf(promise({ due: "2026-11-02", linked: true }), seen, today, now)).toEqual(["needs_you", "promises", "in_progress"]);
  });
  it("never counts a promise I added myself as new", () => {
    expect(needsYou(promise({ byMe: true }), undefined, today, now)).toBe(false);
  });
  it("follows CV-1's conversation views and a send waiting for my answer", () => {
    expect(needsYou(conv("needs"), undefined, today, now)).toBe(true);
    expect(needsYou(conv("teammates"), undefined, today, now)).toBe(false);
    expect(needsYou(conv("progress"), undefined, today, now)).toBe(false);
    expect(needsYou({ key: "s1", kind: "send", clientKey: "contoso", at: now, done: false, sendState: "waiting" }, undefined, today, now)).toBe(true);
    expect(needsYou({ key: "s1", kind: "send", clientKey: "contoso", at: now, done: false, sendState: "accepted" }, undefined, today, now)).toBe(false);
  });
  it("never holds captures, drafts, done, snoozed or hidden items", () => {
    expect(needsYou({ key: "k1", kind: "capture", clientKey: null, at: now, done: false }, undefined, today, now)).toBe(false);
    expect(needsYou(promise({ due: today, done: true }), seen, today, now)).toBe(false);
    expect(needsYou(promise({ due: today }), { ...seen, snoozedUntil: "2026-11-06T14:00:00Z" }, today, now)).toBe(false);
    expect(needsYou(promise({ due: today }), { ...seen, snoozedUntil: "2026-11-05T14:00:00Z" }, today, now)).toBe(true);
    expect(needsYou(conv("needs"), { ...seen, hiddenAt: now }, today, now)).toBe(false);
  });
});

describe("one count", () => {
  it("the badge's number equals the Needs you view's count for the same items", () => {
    const items = [
      { facts: conv("needs", { key: "v1" }) },
      { facts: conv("teammates", { key: "v2" }) },
      { facts: promise({ key: "c1" }) },
      { facts: promise({ key: "c2", due: "2026-11-30" }), mark: seen },
      { facts: promise({ key: "f3", due: "2026-11-01" }), mark: seen },
      { facts: promise({ key: "f4", due: today }), mark: { ...seen, snoozedUntil: "2026-11-09T14:00:00Z" } },
      { facts: { key: "s1", kind: "send", clientKey: "contoso", at: now, done: false, sendState: "waiting" } as InboxFacts },
      { facts: { key: "k1", kind: "capture", clientKey: null, at: now, done: false } as InboxFacts },
    ];
    const counts = viewCounts(items, today, now);
    expect(needsYouCount(items, today, now)).toBe(4);
    expect(counts.needs_you).toBe(needsYouCount(items, today, now));
    expect(counts.promises).toBe(3);
    expect(counts.teammates).toBe(1);
    expect(counts.captures).toBe(1);
  });
});

describe("why it needs me (slice 3)", () => {
  it("one reason per kind, from fields the item already has", () => {
    expect(reasonOf(conv("needs", { needsWhy: "mention", who: "Joel Park" }), undefined, today, now)).toBe("Joel asked you by name");
    expect(reasonOf(conv("needs", { needsWhy: "work" }), undefined, today, now)).toBe("Work request, no item yet");
    expect(reasonOf(conv("needs", { needsWhy: "unclaimed" }), undefined, today, now)).toBe("Nobody has claimed it, and you lead the client");
    expect(reasonOf(promise({ due: "2026-11-09", fromChat: true }), undefined, today, now)).toBe("You promised it, due Mon");
    expect(reasonOf(promise({ due: "2026-11-05" }), seen, today, now)).toBe("You promised it, due today");
    expect(reasonOf(promise({ due: "2026-11-03" }), seen, today, now)).toBe("You promised it, 2 days late");
    expect(reasonOf(promise({ key: "f1", byMe: true, due: "2026-11-04" }), seen, today, now)).toBe("You added it, 1 day late");
    expect(reasonOf(promise({ fromChat: true }), undefined, today, now)).toBe("You promised it in a chat, with no due day");
    const send = (p: Partial<InboxFacts>): InboxFacts => ({ key: "s1", kind: "send", clientKey: "contoso", at: now, done: false, sendState: "waiting", who: "Josh Lee", where: "next week", ...p });
    expect(reasonOf(send({ must: true }), undefined, today, now)).toBe("Josh sent it as a Must");
    expect(reasonOf(send({}), undefined, today, now)).toBe("Josh suggested it for next week");
  });
  it("nothing outside Needs you: a seen promise due later, a snoozed one, what I wait on", () => {
    expect(reasonOf(promise({ due: "2026-11-20" }), seen, today, now)).toBeNull();
    expect(reasonOf(promise(), { ...seen, snoozedUntil: "2026-11-06T15:00:00Z" }, today, now)).toBeNull();
    const theirs: InboxFacts = { key: "c9", kind: "commitment", clientKey: "contoso", at: now, done: false, waitingOn: true, who: "Lena Hart", due: "2026-11-03" };
    expect(reasonOf(theirs, undefined, today, now)).toBeNull();
    expect(viewsOf(theirs, undefined, today, now)).toEqual(["waiting"]);
  });
});

describe("snooze (slice 3)", () => {
  // Thu Nov 5 in Chicago (UTC-6), working 9 to 5 Mon to Fri; Fri Nov 6 is PTO.
  const zone = "America/Chicago";
  const nine = [{ start: "09:00", end: "17:00" }];
  const model: TimeModel = { timeZone: zone, weekdays: { mon: nine, tue: nine, wed: nine, thu: nine, fri: nine, sat: [], sun: [] }, lunch: null, overrides: [] } as TimeModel;
  const day = snoozeDayOf(model, new Set(["2026-11-06"]));
  it("Later today is 3 hours, never past my end of day, and gone with under an hour left", () => {
    expect(snoozeUntil("later", "2026-11-05T15:00:00Z", day)).toBe("2026-11-05T18:00:00.000Z");
    expect(snoozeUntil("later", "2026-11-05T21:30:00Z", day)).toBe("2026-11-05T23:00:00.000Z");
    expect(snoozeChoices("2026-11-05T21:30:00Z", day)).toEqual(["later", "tomorrow", "next_week"]);
    expect(snoozeChoices("2026-11-05T22:30:00Z", day)).toEqual(["tomorrow", "next_week"]);
    expect(snoozeUntil("later", "2026-11-05T22:30:00Z", day)).toBeNull();
    expect(snoozeChoices("2026-11-07T15:00:00Z", day)).toEqual(["tomorrow", "next_week"]);
  });
  it("Tomorrow is my next workday's start, skipping PTO and the weekend; Next week is Monday's start; a date is its start", () => {
    expect(snoozeUntil("tomorrow", "2026-11-05T15:00:00Z", day)).toBe("2026-11-09T15:00:00Z");
    expect(snoozeUntil("tomorrow", "2026-11-03T15:00:00Z", day)).toBe("2026-11-04T15:00:00Z");
    expect(snoozeUntil("next_week", "2026-11-05T15:00:00Z", day)).toBe("2026-11-09T15:00:00Z");
    expect(snoozeUntil("2026-11-12", "2026-11-05T15:00:00Z", day)).toBe("2026-11-12T15:00:00Z");
  });
  it("a snoozed item is in no view and doesn't count, and its due date stays", () => {
    const f = promise({ due: "2026-11-04" });
    const m: Mark = { ...seen, snoozedUntil: "2026-11-09T15:00:00Z" };
    expect(viewsOf(f, m, today, now)).toEqual([]);
    expect(needsYouCount([{ facts: f, mark: m }], today, now)).toBe(0);
    expect(viewCounts([{ facts: f, mark: m }], today, now).promises).toBe(0);
    expect(f.due).toBe("2026-11-04");
    expect(needsYouCount([{ facts: f, mark: m }], "2026-11-09", "2026-11-09T15:00:01Z")).toBe(1);
  });
});
