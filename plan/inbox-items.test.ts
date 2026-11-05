import { describe, expect, it } from "vitest";
import { itemKey, lifecycleOf, needsYou, needsYouCount, parseKey, viewCounts, viewsOf, type InboxFacts, type Mark } from "./inbox-items.ts";

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
